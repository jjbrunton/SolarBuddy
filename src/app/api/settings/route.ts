import { NextResponse } from 'next/server';
import {
  getSettings,
  saveSettings,
  SETTING_KEY_SET,
  SENSITIVE_SETTING_KEYS,
  type AppSettings,
} from '@/lib/config';
import { syncVirtualInverterSetting } from '@/lib/virtual-inverter/runtime';
import { ApiError, errorResponse } from '@/lib/api-error';

function sanitise(settings: AppSettings): Partial<AppSettings> {
  const copy: Record<string, string> = { ...(settings as unknown as Record<string, string>) };
  for (const key of SENSITIVE_SETTING_KEYS) delete copy[key];
  return copy as Partial<AppSettings>;
}

export async function GET() {
  return NextResponse.json(sanitise(getSettings()));
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  // Validate: only allow known setting keys with string values, and refuse
  // writes to sensitive keys (password hash, session secret). Those are only
  // mutated by dedicated auth routes so the write goes through proper hashing.
  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!SETTING_KEY_SET.has(key)) continue;
    if (SENSITIVE_SETTING_KEYS.has(key as keyof AppSettings)) {
      return errorResponse(ApiError.badRequest(`Cannot write ${key} via this endpoint`));
    }
    if (typeof value !== 'string') {
      return errorResponse(
        ApiError.badRequest(`Invalid value for ${key}: must be a string`),
      );
    }
    validated[key] = value;
  }

  // Snapshot the usage_learning_enabled flag BEFORE saving so we can detect a
  // false → true transition and trigger an on-demand profile refresh. Only
  // fetched when the caller is actually touching that setting, to avoid
  // an extra getSettings() call on every unrelated settings update.
  const previousLearningEnabled =
    validated.usage_learning_enabled !== undefined
      ? getSettings().usage_learning_enabled
      : undefined;

  saveSettings(validated as Partial<AppSettings>);

  // If MQTT settings changed, reconnect
  if (validated.mqtt_host !== undefined || validated.mqtt_port !== undefined) {
    const { connectMqtt } = await import('@/lib/mqtt/client');
    connectMqtt();
  }

  if (validated.watchdog_enabled !== undefined) {
    const { syncInverterWatchdogSetting } = await import('@/lib/scheduler/watchdog');
    syncInverterWatchdogSetting();
  }

  // Home Assistant integration: sync the publisher if any HA setting changed.
  const HOME_ASSISTANT_KEYS = [
    'homeassistant_enabled',
    'homeassistant_host',
    'homeassistant_port',
    'homeassistant_username',
    'homeassistant_password',
    'homeassistant_discovery_prefix',
    'homeassistant_base_topic',
  ] as const;
  if (HOME_ASSISTANT_KEYS.some((key) => validated[key] !== undefined)) {
    const { syncHomeAssistantSetting } = await import('@/lib/home-assistant/runtime');
    await syncHomeAssistantSetting();
  }

  if (
    validated.virtual_mode_enabled !== undefined ||
    validated.virtual_scenario_id !== undefined ||
    validated.virtual_speed !== undefined
  ) {
    await syncVirtualInverterSetting();
  }

  // Trigger schedule replan if any schedule-relevant setting changed
  const { SCHEDULE_RELEVANT_KEYS, requestReplan } = await import('@/lib/scheduler/reevaluate');
  if (Object.keys(validated).some((key) => SCHEDULE_RELEVANT_KEYS.has(key))) {
    requestReplan('settings changed');
  }

  // On-demand usage profile refresh: fire (fire-and-forget) when learning is
  // freshly enabled or when a parameter that shapes the aggregation changes.
  // The compute call will also invalidate the in-process cache on success.
  const learningJustEnabled =
    previousLearningEnabled !== undefined &&
    previousLearningEnabled !== 'true' &&
    validated.usage_learning_enabled === 'true';
  const aggregationParamsChanged =
    validated.usage_learning_window_days !== undefined ||
    validated.usage_baseload_percentile !== undefined ||
    validated.usage_high_period_multiplier !== undefined ||
    validated.usage_high_period_min_slots !== undefined;
  if (learningJustEnabled || aggregationParamsChanged) {
    void (async () => {
      try {
        const { computeUsageProfile } = await import('@/lib/usage');
        await computeUsageProfile();
      } catch (err) {
        console.error('[Settings] On-demand usage profile refresh failed:', err);
      }
    })();
  }

  return NextResponse.json({ ok: true, settings: sanitise(getSettings()) });
}
