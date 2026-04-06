import { NextResponse } from 'next/server';
import { getSettings, saveSettings, SETTING_KEY_SET, type AppSettings } from '@/lib/config';
import { syncVirtualInverterSetting } from '@/lib/virtual-inverter/runtime';
import { ApiError, errorResponse } from '@/lib/api-error';

export async function GET() {
  const settings = getSettings();
  return NextResponse.json(settings);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  // Validate: only allow known setting keys with string values
  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!SETTING_KEY_SET.has(key)) continue;
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
    validated.usage_source !== undefined ||
    validated.usage_learning_window_days !== undefined ||
    validated.usage_baseload_percentile !== undefined ||
    validated.usage_high_period_multiplier !== undefined ||
    validated.usage_high_period_min_slots !== undefined;
  const usageSourceConfigChanged =
    validated.octopus_api_key !== undefined ||
    validated.octopus_mpan !== undefined ||
    validated.octopus_meter_serial !== undefined;
  if (learningJustEnabled || aggregationParamsChanged || usageSourceConfigChanged) {
    void (async () => {
      try {
        const { computeUsageProfile } = await import('@/lib/usage');
        await computeUsageProfile();
      } catch (err) {
        console.error('[Settings] On-demand usage profile refresh failed:', err);
      }
    })();
  }

  return NextResponse.json({ ok: true, settings: getSettings() });
}
