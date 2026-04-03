import { NextResponse } from 'next/server';
import {
  getScheduledActions,
  upsertScheduledAction,
  deleteScheduledAction,
} from '@/lib/scheduled-actions';

export async function GET() {
  return NextResponse.json({ actions: getScheduledActions() });
}

export async function POST(req: Request) {
  const body = await req.json();
  const action = upsertScheduledAction(body);
  return NextResponse.json({ ok: true, action });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  if (!body.id) {
    return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
  }
  const action = upsertScheduledAction(body);
  return NextResponse.json({ ok: true, action });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
  }
  deleteScheduledAction(parseInt(id, 10));
  return NextResponse.json({ ok: true });
}
