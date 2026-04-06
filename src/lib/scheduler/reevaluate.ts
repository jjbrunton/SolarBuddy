import { appendEvent } from '../events';
import { getState, onStateChange } from '../state';

const DEBOUNCE_MS = 5_000;
const MIN_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 30_000;
const STARTUP_HARD_CAP_MS = 5 * 60_000;

export const SCHEDULE_RELEVANT_KEYS = new Set([
  'charging_strategy',
  'charge_hours',
  'price_threshold',
  'min_soc_target',
  'charge_window_start',
  'charge_window_end',
  'smart_discharge',
  'discharge_price_threshold',
  'discharge_soc_floor',
  'peak_protection',
  'peak_period_start',
  'peak_period_end',
  'peak_soc_target',
  'negative_price_charging',
  'negative_price_pre_discharge',
  'battery_capacity_kwh',
  'max_charge_power_kw',
  'estimated_consumption_w',
  'default_work_mode',
  'auto_schedule',
  'always_charge_below_price',
  'always_charge_below_soc',
  'peak_detection',
  'peak_duration_slots',
  'solar_skip_enabled',
  'solar_skip_threshold_kwh',
  'pre_cheapest_suppression',
  'pre_cheapest_lookback_slots',
  'negative_run_discharge',
  'pv_forecast_damp_factor',
  'usage_learning_enabled',
  'usage_source',
  'usage_learning_window_days',
  'usage_baseload_percentile',
  'usage_high_period_multiplier',
  'usage_high_period_min_slots',
  'usage_min_samples_per_bucket',
]);

interface ReplanState {
  debounce: NodeJS.Timeout | null;
  running: boolean;
  pendingReason: string | null;
  lastCompletedAt: number;
  deferredTimer: NodeJS.Timeout | null;
}

const g = globalThis as typeof globalThis & {
  __solarbuddy_replan?: ReplanState;
};

function getReplanState(): ReplanState {
  if (!g.__solarbuddy_replan) {
    g.__solarbuddy_replan = {
      debounce: null,
      running: false,
      pendingReason: null,
      lastCompletedAt: 0,
      deferredTimer: null,
    };
  }
  return g.__solarbuddy_replan;
}

async function executeReplan(reason: string) {
  const runtime = getReplanState();
  if (runtime.running) {
    runtime.pendingReason = reason;
    return;
  }

  const elapsed = Date.now() - runtime.lastCompletedAt;
  if (elapsed < MIN_INTERVAL_MS) {
    // Defer until interval elapses
    if (!runtime.deferredTimer) {
      runtime.deferredTimer = setTimeout(() => {
        runtime.deferredTimer = null;
        void executeReplan(reason);
      }, MIN_INTERVAL_MS - elapsed);
    }
    return;
  }

  runtime.running = true;
  try {
    const { replanFromStoredRates } = await import('./cron');
    console.log(`[Replan] Triggered: ${reason}`);
    appendEvent({ level: 'info', category: 'scheduler', message: `Schedule replan triggered: ${reason}` });
    await replanFromStoredRates();
    runtime.lastCompletedAt = Date.now();
  } catch (err) {
    console.error('[Replan] Failed:', err);
  } finally {
    runtime.running = false;
    if (runtime.pendingReason) {
      const queued = runtime.pendingReason;
      runtime.pendingReason = null;
      void executeReplan(queued);
    }
  }
}

export function requestReplan(reason: string) {
  const runtime = getReplanState();

  if (runtime.debounce) {
    clearTimeout(runtime.debounce);
  }

  runtime.debounce = setTimeout(() => {
    runtime.debounce = null;
    void executeReplan(reason);
  }, DEBOUNCE_MS);
}

export function scheduleStartupReplan() {
  console.log(`[Replan] Startup replan scheduled in ${STARTUP_DELAY_MS / 1000}s`);

  const startupTimeout = setTimeout(() => {
    const state = getState();
    if (state.mqtt_connected) {
      void executeReplan('startup (MQTT connected)');
      return;
    }

    // Wait for MQTT to connect, with hard cap
    const hardCap = setTimeout(() => {
      unsubscribe();
      void executeReplan('startup (MQTT timeout)');
    }, STARTUP_HARD_CAP_MS - STARTUP_DELAY_MS);

    const unsubscribe = onStateChange((newState) => {
      if (newState.mqtt_connected) {
        clearTimeout(hardCap);
        unsubscribe();
        void executeReplan('startup (MQTT connected)');
      }
    });
  }, STARTUP_DELAY_MS);

  // Store for cleanup in tests
  const runtime = getReplanState();
  (runtime as ReplanState & { startupTimeout?: NodeJS.Timeout }).startupTimeout = startupTimeout;
}

/** Reset internal state — for tests only. */
export function _resetForTests() {
  const runtime = getReplanState();
  if (runtime.debounce) clearTimeout(runtime.debounce);
  if (runtime.deferredTimer) clearTimeout(runtime.deferredTimer);
  const ext = runtime as ReplanState & { startupTimeout?: NodeJS.Timeout };
  if (ext.startupTimeout) clearTimeout(ext.startupTimeout);
  g.__solarbuddy_replan = undefined;
}
