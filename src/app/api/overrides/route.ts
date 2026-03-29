import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const overrides = db
    .prepare('SELECT * FROM manual_overrides WHERE date = ? ORDER BY slot_start')
    .all(today);
  return NextResponse.json({ overrides });
}

export async function POST(request: Request) {
  const db = getDb();
  const { slots } = (await request.json()) as {
    slots: { slot_start: string; slot_end: string }[];
  };

  if (!Array.isArray(slots)) {
    return NextResponse.json({ error: 'slots must be an array' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    // Clear existing overrides for today
    db.prepare('DELETE FROM manual_overrides WHERE date = ?').run(today);

    // Insert new overrides
    const insert = db.prepare(
      'INSERT INTO manual_overrides (date, slot_start, slot_end, created_at) VALUES (?, ?, ?, ?)',
    );
    for (const slot of slots) {
      insert.run(today, slot.slot_start, slot.slot_end, now);
    }
  });

  transaction();

  return NextResponse.json({ ok: true, count: slots.length });
}

export async function DELETE() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  db.prepare('DELETE FROM manual_overrides WHERE date = ?').run(today);
  return NextResponse.json({ ok: true });
}
