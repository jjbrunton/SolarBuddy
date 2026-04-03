import { NextResponse } from 'next/server';
import { getSettings, saveSettings, SETTING_KEY_SET, type AppSettings } from '@/lib/config';

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
      return NextResponse.json(
        { ok: false, error: `Invalid value for ${key}: must be a string` },
        { status: 400 },
      );
    }
    validated[key] = value;
  }

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

  // Trigger schedule replan if any schedule-relevant setting changed
  const { SCHEDULE_RELEVANT_KEYS, requestReplan } = await import('@/lib/scheduler/reevaluate');
  if (Object.keys(validated).some((key) => SCHEDULE_RELEVANT_KEYS.has(key))) {
    requestReplan('settings changed');
  }

  return NextResponse.json({ ok: true, settings: getSettings() });
}
