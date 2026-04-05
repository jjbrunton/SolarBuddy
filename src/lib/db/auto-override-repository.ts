import { getDb } from '.';

export type AutoOverrideSource = 'soc_boost' | 'battery_exhausted_guard' | 'manual_expired';

export type AutoOverrideAction = 'charge' | 'discharge' | 'hold';

export interface AutoOverrideRow {
  slot_start: string;
  slot_end: string;
  action: AutoOverrideAction;
  source: AutoOverrideSource;
  reason: string;
  expires_at: string;
}

/**
 * Inserts a new auto override entry. `created_at` is set to the current ISO
 * timestamp. Returns the new row's id.
 */
export function insertAutoOverride(row: AutoOverrideRow): number {
  const db = getDb();
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO auto_overrides (
        slot_start, slot_end, action, source, reason, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.slot_start,
      row.slot_end,
      row.action,
      row.source,
      row.reason,
      row.expires_at,
      createdAt,
    );
  return Number(result.lastInsertRowid);
}

/**
 * Returns the most recent non-expired auto override whose
 * `[slot_start, slot_end)` window contains `nowIso`.
 */
export function getCurrentAutoOverride(nowIso: string): AutoOverrideRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT slot_start, slot_end, action, source, reason, expires_at
       FROM auto_overrides
       WHERE slot_start <= ? AND slot_end > ? AND expires_at > ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(nowIso, nowIso, nowIso) as AutoOverrideRow | undefined;
  return row ?? null;
}

/**
 * Deletes all auto overrides whose `expires_at` is at or before `nowIso`.
 * Returns the number of rows deleted.
 */
export function clearExpiredAutoOverrides(nowIso: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM auto_overrides WHERE expires_at <= ?').run(nowIso);
  return Number(result.changes ?? 0);
}

/**
 * Deletes all auto overrides with the given `slot_start`.
 */
export function clearAutoOverridesForSlot(slotStart: string): void {
  const db = getDb();
  db.prepare('DELETE FROM auto_overrides WHERE slot_start = ?').run(slotStart);
}

/**
 * Returns all auto overrides ordered by most recent first. Intended for tests
 * and UI debug surfaces only.
 */
export function getAllAutoOverrides(): AutoOverrideRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT slot_start, slot_end, action, source, reason, expires_at
       FROM auto_overrides
       ORDER BY created_at DESC, id DESC`,
    )
    .all() as AutoOverrideRow[];
}
