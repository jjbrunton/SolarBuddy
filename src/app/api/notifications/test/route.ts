import { NextResponse } from 'next/server';
import { sendTestNotification } from '@/lib/notifications/dispatcher';

export async function POST(request: Request) {
  const body = (await request.json()) as { channel?: string };
  const channel = body.channel;

  if (!channel || (channel !== 'discord' && channel !== 'telegram')) {
    return NextResponse.json({ ok: false, error: 'Invalid channel. Must be "discord" or "telegram".' }, { status: 400 });
  }

  const error = await sendTestNotification(channel);
  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 422 });
  }

  return NextResponse.json({ ok: true });
}
