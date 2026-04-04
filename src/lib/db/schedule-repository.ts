import { getDb } from '.';
import type { ChargeWindow, PlannedSlot } from '../scheduler/engine';

export function persistSchedulePlan(windows: ChargeWindow[], plannedSlots: PlannedSlot[]) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const insertWindow = db.prepare(`
    INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, type)
    VALUES (?, ?, ?, ?, 'planned', ?, ?)
  `);
  const insertSlot = db.prepare(`
    INSERT OR REPLACE INTO plan_slots (
      date, slot_start, slot_end, action, reason,
      expected_soc_after, expected_value, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?)
  `);

  const insertAll = db.transaction((ws: ChargeWindow[], slots: PlannedSlot[]) => {
    db.prepare("DELETE FROM schedules WHERE date = ? AND status = 'planned'").run(today);
    db.prepare("DELETE FROM plan_slots WHERE date = ? AND status = 'planned'").run(today);
    for (const w of ws) {
      insertWindow.run(today, w.slot_start, w.slot_end, w.avg_price, new Date().toISOString(), w.type ?? 'charge');
    }
    for (const slot of slots) {
      insertSlot.run(
        today,
        slot.slot_start,
        slot.slot_end,
        slot.action,
        slot.reason,
        slot.expected_soc_after,
        slot.expected_value,
        new Date().toISOString(),
      );
    }
  });

  insertAll(windows, plannedSlots);
}

export function updateScheduleStatus(
  slotStart: string,
  slotEnd: string,
  type: string | undefined,
  status: string,
  notes?: string,
) {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const slotAction = type === 'discharge' ? 'discharge' : 'charge';

    if (notes) {
      db.prepare('UPDATE schedules SET status = ?, executed_at = ?, notes = ? WHERE slot_start = ? AND status != ?')
        .run(status, now, notes, slotStart, 'completed');
      db.prepare(
        `UPDATE plan_slots
         SET status = ?, executed_at = ?, notes = ?
         WHERE slot_start >= ? AND slot_end <= ? AND action = ? AND status != ?`,
      ).run(status, now, notes, slotStart, slotEnd, slotAction, 'completed');
    } else {
      db.prepare('UPDATE schedules SET status = ?, executed_at = ? WHERE slot_start = ? AND status != ?')
        .run(status, now, slotStart, 'completed');
      db.prepare(
        `UPDATE plan_slots
         SET status = ?, executed_at = ?
         WHERE slot_start >= ? AND slot_end <= ? AND action = ? AND status != ?`,
      ).run(status, now, slotStart, slotEnd, slotAction, 'completed');
    }
  } catch (err) {
    console.error('[ScheduleRepo] Failed to update schedule status:', err);
  }
}

const SCHEDULE_HISTORY_WINDOW_DAYS = 30;

export function getRecentPlanData() {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SCHEDULE_HISTORY_WINDOW_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  const cutoffIso = cutoff.toISOString();

  const schedules = db
    .prepare('SELECT * FROM schedules WHERE slot_end >= ? ORDER BY slot_start ASC, created_at ASC')
    .all(cutoffIso);
  const plan_slots = db
    .prepare('SELECT * FROM plan_slots WHERE slot_end >= ? ORDER BY slot_start ASC, created_at ASC')
    .all(cutoffIso);

  return { schedules, plan_slots };
}
