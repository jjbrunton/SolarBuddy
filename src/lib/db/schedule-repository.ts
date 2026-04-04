import { getDb } from '.';
import type { ChargeWindow, PlannedSlot } from '../scheduler/engine';
import { expandHalfHourSlotKeys } from '../slot-key';
import { wattSamplesToKwh } from '../analytics';

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

  const nowIso = new Date().toISOString();
  const insertAll = db.transaction((ws: ChargeWindow[], slots: PlannedSlot[]) => {
    db.prepare("DELETE FROM schedules WHERE (date = ? OR slot_end <= ?) AND status = 'planned'").run(today, nowIso);
    db.prepare("DELETE FROM plan_slots WHERE (date = ? OR slot_end <= ?) AND status = 'planned'").run(today, nowIso);
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

    // Calculate actual cost/revenue for completed charge/discharge slots
    if (status === 'completed' && (slotAction === 'charge' || slotAction === 'discharge')) {
      const slotKeys = expandHalfHourSlotKeys(slotStart, slotEnd);
      for (const key of slotKeys) {
        calculateAndPersistSlotActualValue(key, slotAction);
      }
    }
  } catch (err) {
    console.error('[ScheduleRepo] Failed to update schedule status:', err);
  }
}

const HALF_HOUR_SECONDS = 1800;

export function calculateAndPersistSlotActualValue(
  slotStart: string,
  action: string,
): number | null {
  try {
    const db = getDb();
    const slotEnd = new Date(new Date(slotStart).getTime() + 30 * 60 * 1000).toISOString();

    const readings = db.prepare(`
      SELECT
        SUM(CASE WHEN grid_power > 0 THEN grid_power ELSE 0 END) as import_w_sum,
        SUM(CASE WHEN grid_power < 0 THEN ABS(grid_power) ELSE 0 END) as export_w_sum,
        COUNT(*) as sample_count
      FROM readings
      WHERE timestamp >= ? AND timestamp < ?
    `).get(slotStart, slotEnd) as { import_w_sum: number; export_w_sum: number; sample_count: number } | undefined;

    if (!readings || readings.sample_count === 0) return null;

    let energyKwh: number;
    let price: number;

    if (action === 'charge') {
      energyKwh = wattSamplesToKwh(readings.import_w_sum, readings.sample_count, HALF_HOUR_SECONDS);
      const rate = db.prepare('SELECT price_inc_vat FROM rates WHERE valid_from = ?').get(slotStart) as { price_inc_vat: number } | undefined;
      price = rate?.price_inc_vat ?? 0;
      const actualValue = Math.round(-energyKwh * price * 100) / 100;
      db.prepare('UPDATE plan_slots SET actual_value = ? WHERE slot_start = ?').run(actualValue, slotStart);
      return actualValue;
    } else if (action === 'discharge') {
      energyKwh = wattSamplesToKwh(readings.export_w_sum, readings.sample_count, HALF_HOUR_SECONDS);
      // Try export rate first, fall back to import rate
      const exportRate = db.prepare('SELECT price_inc_vat FROM export_rates WHERE valid_from = ?').get(slotStart) as { price_inc_vat: number } | undefined;
      const importRate = db.prepare('SELECT price_inc_vat FROM rates WHERE valid_from = ?').get(slotStart) as { price_inc_vat: number } | undefined;
      price = exportRate?.price_inc_vat ?? importRate?.price_inc_vat ?? 0;
      const actualValue = Math.round(energyKwh * price * 100) / 100;
      db.prepare('UPDATE plan_slots SET actual_value = ? WHERE slot_start = ?').run(actualValue, slotStart);
      return actualValue;
    }

    return null;
  } catch (err) {
    console.error('[ScheduleRepo] Failed to calculate actual value for slot:', slotStart, err);
    return null;
  }
}

export function backfillActualValues(): number {
  try {
    const db = getDb();
    const slots = db.prepare(`
      SELECT slot_start, action FROM plan_slots
      WHERE status = 'completed' AND actual_value IS NULL AND action IN ('charge', 'discharge')
    `).all() as { slot_start: string; action: string }[];

    let filled = 0;
    for (const slot of slots) {
      const result = calculateAndPersistSlotActualValue(slot.slot_start, slot.action);
      if (result !== null) filled++;
    }
    return filled;
  } catch (err) {
    console.error('[ScheduleRepo] Failed to backfill actual values:', err);
    return 0;
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
