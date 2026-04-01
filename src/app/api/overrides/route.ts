import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { type PlanAction, PLAN_ACTIONS } from '@/lib/plan-actions';

export async function GET() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const overrides = db
    .prepare('SELECT slot_start, slot_end, action FROM manual_overrides WHERE date = ? ORDER BY slot_start')
    .all(today);
  return NextResponse.json({ overrides });
}

export async function POST(request: Request) {
  const db = getDb();
  const { slots } = (await request.json()) as {
    slots: { slot_start: string; slot_end: string; action?: PlanAction }[];
  };

  if (!Array.isArray(slots)) {
    return NextResponse.json({ error: 'slots must be an array' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM manual_overrides WHERE date = ?').run(today);

    const insert = db.prepare(
      'INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const slot of slots) {
      const action = slot.action && PLAN_ACTIONS.includes(slot.action) ? slot.action : 'charge';
      insert.run(today, slot.slot_start, slot.slot_end, action, now);
    }
  });

  transaction();

  return NextResponse.json({ ok: true, count: slots.length });
}

/** Upsert a single slot override */
export async function PATCH(request: Request) {
  const db = getDb();
  const { slot_start, slot_end, action } = (await request.json()) as {
    slot_start: string;
    slot_end: string;
    action: PlanAction;
  };

  if (!slot_start || !slot_end || !action || !PLAN_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'slot_start, slot_end, and valid action required' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM manual_overrides WHERE date = ? AND slot_start = ?').run(today, slot_start);
    db.prepare(
      'INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(today, slot_start, slot_end, action, now);
  });

  transaction();

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  // Support deleting a single slot via query params
  const url = new URL(request.url);
  const slotStart = url.searchParams.get('slot_start');

  if (slotStart) {
    db.prepare('DELETE FROM manual_overrides WHERE date = ? AND slot_start = ?').run(today, slotStart);
  } else {
    db.prepare('DELETE FROM manual_overrides WHERE date = ?').run(today);
  }

  return NextResponse.json({ ok: true });
}
