/**
 * Home Assistant command router.
 *
 * Handles inbound MQTT messages on `<base>/<component>/<entity>/set` and
 * `<base>/<component>/<entity>/press` topics. Every command maps to a direct
 * library call — no HTTP round-trips to own API routes.
 *
 * Errors are caught per-command so one failing write never takes the handler
 * down. All routing logs through events.ts so operators see HA-driven actions
 * in the Activity feed.
 */

import { appendEvent } from '../events';
import { saveSettings, type AppSettings } from '../config';
import { requestReplan } from '../scheduler/reevaluate';
import { reconcileInverterState, syncInverterWatchdogSetting } from '../scheduler/watchdog';
import { fetchAndStoreRates } from '../octopus/rates';
import {
  clearTodayOverrides,
  currentSlotBoundsUtc,
  deleteTodayOverrideSlot,
  upsertTodayOverride,
} from '../db/override-repository';
import { isVirtualModeEnabled, getVirtualNow } from '../virtual-inverter/runtime';
import type { TopicComposer, ParsedCommandTopic } from './topics';
import type { StatePublisherControl } from './state-publisher';
import { WRITABLE_ENTITIES, type WritableEntityKey } from './entities';

export interface CommandHandlerDependencies {
  topics: TopicComposer;
  publisher: StatePublisherControl;
  /** Direct MQTT publish (used to retract test topics or publish diagnostic payloads). */
  mqttPublish: (topic: string, payload: string, opts?: { retain?: boolean; qos?: 0 | 1 | 2 }) => void;
}

function logEvent(level: 'info' | 'success' | 'warning' | 'error', message: string) {
  try {
    appendEvent({ level, category: 'home-assistant', message });
  } catch {
    // event log failures must never break command handling
  }
  (level === 'error' ? console.error : console.log)(`[HA] ${message}`);
}

async function handleWritableCommand(
  parsed: ParsedCommandTopic,
  payload: string,
  deps: CommandHandlerDependencies,
): Promise<void> {
  const key = parsed.entityKey as WritableEntityKey;
  const entity = WRITABLE_ENTITIES.find((e) => e.key === key);
  if (!entity || entity.component !== parsed.component) {
    logEvent('warning', `Unknown command topic for entity "${key}"`);
    return;
  }

  switch (key) {
    case 'auto_schedule':
      return handleToggle(key, 'auto_schedule', payload, deps, {
        replanReason: 'home-assistant auto_schedule',
      });
    case 'watchdog_enabled':
      return handleToggle(key, 'watchdog_enabled', payload, deps, {
        onApply: () => syncInverterWatchdogSetting(),
      });
    case 'smart_discharge':
      return handleToggle(key, 'smart_discharge', payload, deps, {
        replanReason: 'home-assistant smart_discharge',
      });
    case 'charging_strategy':
      return handleStrategySelect(payload, deps);
    case 'current_slot_override':
      return handleSlotOverrideSelect(payload, deps);
    case 'replan_now':
      logEvent('info', 'Replan requested from Home Assistant');
      requestReplan('home-assistant button');
      return;
    case 'fetch_rates':
      await handleFetchRates();
      return;
    case 'clear_overrides':
      try {
        clearTodayOverrides();
        logEvent('success', 'Cleared today’s overrides from Home Assistant');
        await safeReconcile('home-assistant clear overrides');
        deps.publisher.publishWritableEntity('current_slot_override');
      } catch (err) {
        logEvent('error', `clear_overrides failed: ${describeError(err)}`);
      }
      return;
    case 'reconcile_now':
      logEvent('info', 'Reconcile requested from Home Assistant');
      await safeReconcile('home-assistant reconcile');
      return;
  }
}

async function handleToggle(
  entityKey: WritableEntityKey,
  settingKey: keyof AppSettings,
  payload: string,
  deps: CommandHandlerDependencies,
  opts: { replanReason?: string; onApply?: () => void } = {},
): Promise<void> {
  const next = payload.trim().toUpperCase();
  if (next !== 'ON' && next !== 'OFF') {
    logEvent('warning', `Invalid payload "${payload}" for ${entityKey}`);
    return;
  }
  const nextValue = next === 'ON' ? 'true' : 'false';
  try {
    saveSettings({ [settingKey]: nextValue } as Partial<AppSettings>);
    logEvent('success', `${entityKey} set to ${next} from Home Assistant`);
    if (opts.onApply) opts.onApply();
    if (opts.replanReason) requestReplan(opts.replanReason);
    deps.publisher.publishWritableEntity(entityKey);
  } catch (err) {
    logEvent('error', `${entityKey} toggle failed: ${describeError(err)}`);
  }
}

async function handleStrategySelect(payload: string, deps: CommandHandlerDependencies): Promise<void> {
  const next = payload.trim();
  if (next !== 'night_fill' && next !== 'opportunistic_topup') {
    logEvent('warning', `Invalid charging_strategy payload "${payload}"`);
    return;
  }
  try {
    saveSettings({ charging_strategy: next });
    logEvent('success', `charging_strategy set to ${next} from Home Assistant`);
    requestReplan('home-assistant charging_strategy');
    deps.publisher.publishWritableEntity('charging_strategy');
  } catch (err) {
    logEvent('error', `charging_strategy update failed: ${describeError(err)}`);
  }
}

async function handleSlotOverrideSelect(payload: string, deps: CommandHandlerDependencies): Promise<void> {
  const next = payload.trim().toLowerCase();
  if (next !== 'none' && next !== 'charge' && next !== 'discharge' && next !== 'hold') {
    logEvent('warning', `Invalid current_slot_override payload "${payload}"`);
    return;
  }
  try {
    const { slot_start, slot_end } = currentSlotBoundsUtc(getVirtualNow());
    if (next === 'none') {
      deleteTodayOverrideSlot(slot_start);
      logEvent('success', 'Current slot override cleared from Home Assistant');
    } else {
      upsertTodayOverride(slot_start, slot_end, next);
      logEvent('success', `Current slot override set to ${next} from Home Assistant`);
    }
    await safeReconcile('home-assistant slot override');
    deps.publisher.publishWritableEntity('current_slot_override');
    deps.publisher.publishWritableEntity('charging_strategy'); // no-op: ensures trail entities stay fresh
    deps.publisher.publishWritableEntity('auto_schedule');
  } catch (err) {
    logEvent('error', `current_slot_override update failed: ${describeError(err)}`);
  }
}

async function handleFetchRates(): Promise<void> {
  if (isVirtualModeEnabled()) {
    logEvent('info', 'fetch_rates ignored in virtual inverter mode');
    return;
  }
  try {
    const rates = await fetchAndStoreRates();
    logEvent('success', `Fetched ${rates.length} Octopus rate rows from Home Assistant`);
  } catch (err) {
    logEvent('error', `fetch_rates failed: ${describeError(err)}`);
  }
}

/**
 * reconcileInverterState publishes through the Solar Assistant MQTT client.
 * In virtual mode (or with Solar Assistant disconnected) that throws — we
 * swallow and log the failure so the HA command handler stays responsive.
 */
async function safeReconcile(reason: string): Promise<void> {
  try {
    await reconcileInverterState(reason);
  } catch (err) {
    logEvent('warning', `Reconcile after HA command failed: ${describeError(err)}`);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wire up the message handler. Returns a single function the client can pass
 * to `mqtt.on('message', …)`.
 */
export function createCommandDispatcher(deps: CommandHandlerDependencies) {
  return async function dispatch(topic: string, payload: Buffer): Promise<void> {
    if (topic === deps.topics.homeAssistantStatusTopic) {
      // HA birth handled by client.ts — ignore here.
      return;
    }
    const parsed = deps.topics.parseCommandTopic(topic);
    if (!parsed) return;
    try {
      await handleWritableCommand(parsed, payload.toString(), deps);
    } catch (err) {
      logEvent('error', `Command ${topic} threw: ${describeError(err)}`);
    }
  };
}
