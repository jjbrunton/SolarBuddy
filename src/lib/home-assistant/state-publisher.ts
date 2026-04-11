/**
 * HA state publisher.
 *
 * Two publish paths:
 *
 * 1. Debounced telemetry flush: subscribes once to onStateChange, coalesces
 *    multi-Hz MQTT-driven state updates, and publishes a diff at most once
 *    per second. Per-entity numeric tolerance suppresses nuisance deltas on
 *    power/SOC/temperature sensors.
 *
 * 2. 60s periodic tick: republishes tariff-driven sensors (current_rate,
 *    next_rate, rate_status) and plan-driven sensors (current_action,
 *    current_action_reason, current_slot_override) which don't change on
 *    `onStateChange` events. Also used to detect tariff half-hour boundary
 *    crossings so HA sees the new rate as soon as the slot rolls.
 *
 * The publisher is stateful — it remembers the last payload it published per
 * entity key so reconnects/HA-birth can do a full resend by calling
 * `publishFullSnapshot()` (which clears the memo and publishes everything).
 */

import { onStateChange, getState } from '../state';
import type { InverterState } from '../types';
import { getSettings } from '../config';
import { getResolvedSlotAction } from '../scheduler/watchdog';
import { summarizeCurrentRate, type CurrentRateSummary } from '../octopus/current-rate-summary';
import { getStoredRates, type AgileRate } from '../octopus/rates';
import { getVirtualNow, getVirtualRates, isVirtualModeEnabled } from '../virtual-inverter/runtime';
import { listTodayOverrides } from '../db/override-repository';
import { READ_ONLY_ENTITIES, WRITABLE_ENTITIES, type EntityDefinition, type PublishSnapshot } from './entities';
import type { TopicComposer } from './topics';

const TELEMETRY_DEBOUNCE_MS = 1_000;
const PERIODIC_TICK_MS = 60_000;

export interface Publisher {
  publish: (topic: string, payload: string, opts?: { retain?: boolean; qos?: 0 | 1 | 2 }) => void;
}

export interface StatePublisherControl {
  /** Publish every entity (including unchanged ones). Used on connect + HA birth. */
  publishFullSnapshot: () => void;
  /** Publish the current switch/select writable-entity state (no debounce). */
  publishWritableEntity: (key: string) => void;
  /** Number of entities published in the last flush. */
  getPublishedEntityCount: () => number;
  /** Shut down listeners and timers. */
  stop: () => void;
}

interface PublisherInternals {
  publisher: Publisher;
  topics: TopicComposer;
  lastPublished: Map<string, string>;
  debounceTimer: NodeJS.Timeout | null;
  periodicTimer: NodeJS.Timeout | null;
  unsubscribeStateChange: (() => void) | null;
  publishedCount: number;
}

/**
 * Load the current rate summary using the same source selection as
 * /api/rates (virtual runtime when sandbox mode is on, DB otherwise).
 */
function loadRateSummary(now: Date): CurrentRateSummary | null {
  const rates: AgileRate[] = isVirtualModeEnabled() ? getVirtualRates() : getStoredRates();
  if (rates.length === 0) return null;
  return summarizeCurrentRate(rates, now);
}

/**
 * Build the publish snapshot used by entity readState functions.
 */
function buildSnapshot(): PublishSnapshot {
  const now = getVirtualNow();
  const state = getState();
  const rateSummary = loadRateSummary(now);
  let resolvedAction: PublishSnapshot['resolvedAction'] = null;
  try {
    resolvedAction = getResolvedSlotAction(now, state);
  } catch {
    // Plan resolution can throw when no rates/plan is stored yet; swallow and
    // publish `None` for the action sensors until a plan exists.
    resolvedAction = null;
  }
  return { state, rateSummary, resolvedAction };
}

/**
 * Compute the writable-entity read state from current settings and DB.
 */
function readWritableEntityState(key: string, snap: PublishSnapshot): string | null {
  const settings = getSettings() as unknown as Record<string, string>;

  switch (key) {
    case 'auto_schedule':
      return settings.auto_schedule === 'true' ? 'ON' : 'OFF';
    case 'watchdog_enabled':
      return settings.watchdog_enabled === 'true' ? 'ON' : 'OFF';
    case 'smart_discharge':
      return settings.smart_discharge === 'true' ? 'ON' : 'OFF';
    case 'charging_strategy':
      return settings.charging_strategy === 'opportunistic_topup' ? 'opportunistic_topup' : 'night_fill';
    case 'current_slot_override': {
      // Reflect the currently active override if one exists for this slot.
      // Fall back to 'none' otherwise.
      try {
        const overrides = listTodayOverrides();
        const slotStart = snap.resolvedAction?.slotStart;
        if (!slotStart) return 'none';
        const match = overrides.find((o) => o.slot_start === slotStart);
        return match?.action ?? 'none';
      } catch {
        return 'none';
      }
    }
    default:
      return null;
  }
}

/**
 * Numeric-tolerance aware change detector. Returns true if the new payload
 * should be published (payload differs from lastPublished OR the numeric
 * delta exceeds the entity's tolerance).
 */
function shouldPublish(
  entity: EntityDefinition,
  newPayload: string | null,
  lastPayload: string | undefined,
): boolean {
  if (newPayload === null && lastPayload === undefined) return false;
  if (newPayload === null) {
    // Was published before; now null. Publish the null to clear HA.
    return lastPayload !== 'None';
  }
  if (lastPayload === undefined) return true;
  if (newPayload === lastPayload) return false;

  if (entity.changeTolerance !== undefined) {
    const prev = Number(lastPayload);
    const next = Number(newPayload);
    if (Number.isFinite(prev) && Number.isFinite(next)) {
      if (Math.abs(next - prev) < entity.changeTolerance) {
        return false;
      }
    }
  }
  return true;
}

function publishEntity(
  internals: PublisherInternals,
  entity: EntityDefinition,
  snap: PublishSnapshot,
  force: boolean,
): boolean {
  if (entity.stateless) return false;
  if (!entity.readState) {
    // Writable entity without a catalog-level readState — use the mapping.
    const payload = readWritableEntityState(entity.key, snap);
    return deliverPayload(internals, entity, payload, force);
  }
  const payload = entity.readState(snap);
  return deliverPayload(internals, entity, payload, force);
}

function deliverPayload(
  internals: PublisherInternals,
  entity: EntityDefinition,
  payload: string | null,
  force: boolean,
): boolean {
  const lastPayload = internals.lastPublished.get(entity.key);
  if (!force && !shouldPublish(entity, payload, lastPayload)) {
    return false;
  }
  const topic = internals.topics.stateTopic(entity.component, entity.key);
  const mqttPayload = payload === null ? 'None' : payload;
  internals.publisher.publish(topic, mqttPayload, { retain: true, qos: 1 });
  internals.lastPublished.set(entity.key, mqttPayload);
  return true;
}

/**
 * Start the state publisher. Caller owns the mqtt `Publisher` used for all
 * outbound messages. Returns a control object to publish full snapshots
 * (on connect / HA birth) and stop the publisher cleanly.
 */
export function startStatePublisher(publisher: Publisher, topics: TopicComposer): StatePublisherControl {
  const internals: PublisherInternals = {
    publisher,
    topics,
    lastPublished: new Map(),
    debounceTimer: null,
    periodicTimer: null,
    unsubscribeStateChange: null,
    publishedCount: 0,
  };

  const flushDebounced = (force = false) => {
    internals.debounceTimer = null;
    const snap = buildSnapshot();
    let published = 0;
    for (const entity of READ_ONLY_ENTITIES) {
      if (publishEntity(internals, entity, snap, force)) published++;
    }
    for (const entity of WRITABLE_ENTITIES) {
      if (entity.stateless) continue;
      if (publishEntity(internals, entity, snap, force)) published++;
    }
    if (force || published > 0) internals.publishedCount = internals.lastPublished.size;
  };

  const schedule = (_state: InverterState) => {
    if (internals.debounceTimer) return;
    internals.debounceTimer = setTimeout(() => flushDebounced(false), TELEMETRY_DEBOUNCE_MS);
  };

  internals.unsubscribeStateChange = onStateChange(schedule);

  internals.periodicTimer = setInterval(() => flushDebounced(false), PERIODIC_TICK_MS);
  // Unref so tests don't hang on the timer during teardown.
  if (internals.periodicTimer && typeof internals.periodicTimer.unref === 'function') {
    internals.periodicTimer.unref();
  }

  return {
    publishFullSnapshot: () => {
      internals.lastPublished.clear();
      flushDebounced(true);
    },
    publishWritableEntity: (key: string) => {
      const entity = WRITABLE_ENTITIES.find((e) => e.key === key);
      if (!entity || entity.stateless) return;
      const snap = buildSnapshot();
      publishEntity(internals, entity, snap, true);
    },
    getPublishedEntityCount: () => internals.publishedCount,
    stop: () => {
      if (internals.debounceTimer) {
        clearTimeout(internals.debounceTimer);
        internals.debounceTimer = null;
      }
      if (internals.periodicTimer) {
        clearInterval(internals.periodicTimer);
        internals.periodicTimer = null;
      }
      if (internals.unsubscribeStateChange) {
        internals.unsubscribeStateChange();
        internals.unsubscribeStateChange = null;
      }
      internals.lastPublished.clear();
    },
  };
}
