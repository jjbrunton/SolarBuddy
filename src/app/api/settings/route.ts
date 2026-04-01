import { NextResponse } from 'next/server';
import { getSettings, saveSettings, type AppSettings } from '@/lib/config';

export async function GET() {
  const settings = getSettings();
  return NextResponse.json(settings);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  // Validate: only allow known setting keys with string values
  const validKeys = new Set<string>([
    'mqtt_host', 'mqtt_port', 'mqtt_username', 'mqtt_password',
    'octopus_region', 'octopus_product_code', 'octopus_api_key', 'octopus_account',
    'octopus_mpan', 'octopus_meter_serial',
    'charging_strategy',
    'charge_hours', 'price_threshold', 'min_soc_target',
    'charge_window_start', 'charge_window_end', 'default_work_mode',
    'charge_rate', 'auto_schedule',
    'battery_capacity_kwh', 'max_charge_power_kw', 'estimated_consumption_w',
  ]);

  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!validKeys.has(key)) continue;
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

  return NextResponse.json({ ok: true, settings: getSettings() });
}
