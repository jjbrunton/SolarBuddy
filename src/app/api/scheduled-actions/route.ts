import { NextResponse } from 'next/server';
import {
  getScheduledActions,
  upsertScheduledAction,
  deleteScheduledAction,
} from '@/lib/scheduled-actions';
import { ApiError, errorResponse } from '@/lib/api-error';

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
    return errorResponse(ApiError.badRequest('Missing id'));
  }
  const action = upsertScheduledAction(body);
  return NextResponse.json({ ok: true, action });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return errorResponse(ApiError.badRequest('Missing id'));
  }
  deleteScheduledAction(parseInt(id, 10));
  return NextResponse.json({ ok: true });
}
