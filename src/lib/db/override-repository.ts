import { getDb } from './connection';
import { type PlanAction, PLAN_ACTIONS } from '../plan-actions';
import { getVirtualNow } from '../virtual-inverter/runtime';

export interface ManualOverrideRow {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
}

function todayKey(): string {
  return getVirtualNow().toISOString().split('T')[0];
}

function nowIso(): string {
  return getVirtualNow().toISOString();
}

export function listTodayOverrides(): ManualOverrideRow[] {
  const db = getDb();
  return db
    .prepare('SELECT slot_start, slot_end, action FROM manual_overrides WHERE date = ? ORDER BY slot_start')
    .all(todayKey()) as ManualOverrideRow[];
}

/**
 * Replace every override for today with the provided slot list.
 * Unknown actions are coerced to 'charge' to match the existing route behavior.
 */
export function replaceTodayOverrides(
  slots: Array<{ slot_start: string; slot_end: string; action?: PlanAction }>,
): number {
  const db = getDb();
  const date = todayKey();
  const created = nowIso();

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM manual_overrides WHERE date = ?').run(date);
    const insert = db.prepare(
      'INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const slot of slots) {
      const action = slot.action && PLAN_ACTIONS.includes(slot.action) ? slot.action : 'charge';
      insert.run(date, slot.slot_start, slot.slot_end, action, created);
    }
  });

  transaction();
  return slots.length;
}

/** Upsert a single slot override for today. */
export function upsertTodayOverride(slot_start: string, slot_end: string, action: PlanAction): void {
  const db = getDb();
  const date = todayKey();
  const created = nowIso();

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM manual_overrides WHERE date = ? AND slot_start = ?').run(date, slot_start);
    db.prepare(
      'INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(date, slot_start, slot_end, action, created);
  });

  transaction();
}

/** Delete a single slot override for today. */
export function deleteTodayOverrideSlot(slot_start: string): void {
  const db = getDb();
  db.prepare('DELETE FROM manual_overrides WHERE date = ? AND slot_start = ?').run(todayKey(), slot_start);
}

/** Delete every override for today. */
export function clearTodayOverrides(): void {
  const db = getDb();
  db.prepare('DELETE FROM manual_overrides WHERE date = ?').run(todayKey());
}

/**
 * Floors a Date to the nearest 30-minute half-hour boundary (UTC).
 * Matches the tariff slot convention used across the planner.
 */
export function currentSlotBoundsUtc(now: Date = getVirtualNow()): { slot_start: string; slot_end: string } {
  const floored = new Date(now.getTime());
  floored.setUTCSeconds(0, 0);
  const minutes = floored.getUTCMinutes();
  floored.setUTCMinutes(minutes < 30 ? 0 : 30);
  const end = new Date(floored.getTime() + 30 * 60 * 1000);
  return {
    slot_start: floored.toISOString(),
    slot_end: end.toISOString(),
  };
}
