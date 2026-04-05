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

export type OverrideSource =
  | 'manual'
  | 'scheduled'
  | 'auto'
  | 'plan'
  | 'target_soc'
  | 'solar_surplus'
  | 'default';

export interface SlotExecutionRow {
  slot_start: string;
  slot_end: string;
  action: string;
  reason: string | null;
  override_source: OverrideSource;
  soc_at_start: number | null;
  soc_at_end?: number | null;
  command_signature: string | null;
  command_issued_at: string;
  actual_import_wh?: number | null;
  actual_export_wh?: number | null;
  notes?: string | null;
}

export function recordSlotExecution(row: SlotExecutionRow): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO plan_slot_executions (
        slot_start, slot_end, action, reason, override_source,
        soc_at_start, soc_at_end, command_signature, command_issued_at,
        actual_import_wh, actual_export_wh, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.slot_start,
      row.slot_end,
      row.action,
      row.reason,
      row.override_source,
      row.soc_at_start,
      row.soc_at_end ?? null,
      row.command_signature,
      row.command_issued_at,
      row.actual_import_wh ?? null,
      row.actual_export_wh ?? null,
      row.notes ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function updateSlotExecutionActuals(
  id: number,
  updates: { soc_at_end?: number; actual_import_wh?: number; actual_export_wh?: number },
): void {
  const setClauses: string[] = [];
  const params: (number | string)[] = [];

  if (updates.soc_at_end !== undefined) {
    setClauses.push('soc_at_end = ?');
    params.push(updates.soc_at_end);
  }
  if (updates.actual_import_wh !== undefined) {
    setClauses.push('actual_import_wh = ?');
    params.push(updates.actual_import_wh);
  }
  if (updates.actual_export_wh !== undefined) {
    setClauses.push('actual_export_wh = ?');
    params.push(updates.actual_export_wh);
  }

  if (setClauses.length === 0) return;

  params.push(id);
  const db = getDb();
  db.prepare(`UPDATE plan_slot_executions SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
}

export function getSlotExecutions(startIso: string, endIso: string): SlotExecutionRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT slot_start, slot_end, action, reason, override_source,
              soc_at_start, soc_at_end, command_signature, command_issued_at,
              actual_import_wh, actual_export_wh, notes
       FROM plan_slot_executions
       WHERE command_issued_at >= ? AND command_issued_at < ?
       ORDER BY command_issued_at DESC`,
    )
    .all(startIso, endIso) as SlotExecutionRow[];
}

export function getLatestExecutionForSlot(
  slotStart: string,
): (SlotExecutionRow & { id: number }) | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, slot_start, slot_end, action, reason, override_source,
              soc_at_start, soc_at_end, command_signature, command_issued_at,
              actual_import_wh, actual_export_wh, notes
       FROM plan_slot_executions
       WHERE slot_start = ?
       ORDER BY command_issued_at DESC
       LIMIT 1`,
    )
    .get(slotStart) as (SlotExecutionRow & { id: number }) | undefined;
  return row ?? null;
}
