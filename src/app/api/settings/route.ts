import { NextResponse } from 'next/server';
import { getSettings, saveSettings, type AppSettings } from '@/lib/config';

export async function GET() {
  const settings = getSettings();
  return NextResponse.json(settings);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<AppSettings>;
  saveSettings(body);

  // If MQTT settings changed, reconnect
  if (body.mqtt_host !== undefined || body.mqtt_port !== undefined) {
    const { connectMqtt } = await import('@/lib/mqtt/client');
    connectMqtt();
  }

  return NextResponse.json({ ok: true, settings: getSettings() });
}
