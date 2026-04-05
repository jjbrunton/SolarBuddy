import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE plan_slot_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      override_source TEXT NOT NULL,
      soc_at_start REAL,
      soc_at_end REAL,
      command_signature TEXT,
      command_issued_at TEXT NOT NULL,
      actual_import_wh REAL,
      actual_export_wh REAL,
      notes TEXT
    );

    CREATE INDEX idx_plan_slot_executions_slot_start ON plan_slot_executions(slot_start);
    CREATE INDEX idx_plan_slot_executions_issued_at ON plan_slot_executions(command_issued_at);
  `);

  return { testDb: db };
});

vi.mock('..', () => ({
  getDb: () => testDb,
}));

import {
  getLatestExecutionForSlot,
  getSlotExecutions,
  recordSlotExecution,
  updateSlotExecutionActuals,
  type SlotExecutionRow,
} from '../schedule-repository';

describe('plan_slot_executions repository', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM plan_slot_executions').run();
  });

  it('inserts a row and returns it via getLatestExecutionForSlot', () => {
    const row: SlotExecutionRow = {
      slot_start: '2026-04-05T02:00:00.000Z',
      slot_end: '2026-04-05T02:30:00.000Z',
      action: 'charge',
      reason: 'Cheap overnight rate',
      override_source: 'plan',
      soc_at_start: 35,
      soc_at_end: null,
      command_signature: 'charge:02:00:02:30',
      command_issued_at: '2026-04-05T01:59:45.000Z',
      actual_import_wh: null,
      actual_export_wh: null,
      notes: null,
    };

    const id = recordSlotExecution(row);
    expect(id).toBeGreaterThan(0);

    const fetched = getLatestExecutionForSlot(row.slot_start);
    expect(fetched).not.toBeNull();
    expect(fetched).toMatchObject({
      id,
      slot_start: row.slot_start,
      slot_end: row.slot_end,
      action: 'charge',
      reason: 'Cheap overnight rate',
      override_source: 'plan',
      soc_at_start: 35,
      soc_at_end: null,
      command_signature: 'charge:02:00:02:30',
      command_issued_at: row.command_issued_at,
      actual_import_wh: null,
      actual_export_wh: null,
      notes: null,
    });
  });

  it('returns the most recent execution when multiple rows exist for a slot', () => {
    const base: SlotExecutionRow = {
      slot_start: '2026-04-05T03:00:00.000Z',
      slot_end: '2026-04-05T03:30:00.000Z',
      action: 'charge',
      reason: 'first attempt',
      override_source: 'plan',
      soc_at_start: 40,
      command_signature: 'sig-1',
      command_issued_at: '2026-04-05T02:59:00.000Z',
    };

    recordSlotExecution(base);
    recordSlotExecution({
      ...base,
      reason: 'resend after retry',
      override_source: 'auto',
      command_signature: 'sig-2',
      command_issued_at: '2026-04-05T02:59:30.000Z',
    });

    const latest = getLatestExecutionForSlot(base.slot_start);
    expect(latest).not.toBeNull();
    expect(latest?.reason).toBe('resend after retry');
    expect(latest?.override_source).toBe('auto');
    expect(latest?.command_signature).toBe('sig-2');
  });

  it('returns null from getLatestExecutionForSlot when no rows match', () => {
    expect(getLatestExecutionForSlot('2099-01-01T00:00:00.000Z')).toBeNull();
  });

  it('updates actuals via updateSlotExecutionActuals', () => {
    const id = recordSlotExecution({
      slot_start: '2026-04-05T04:00:00.000Z',
      slot_end: '2026-04-05T04:30:00.000Z',
      action: 'discharge',
      reason: 'Peak export',
      override_source: 'plan',
      soc_at_start: 90,
      command_signature: 'sig-disch',
      command_issued_at: '2026-04-05T03:59:45.000Z',
    });

    updateSlotExecutionActuals(id, {
      soc_at_end: 72,
      actual_import_wh: 0,
      actual_export_wh: 1450,
    });

    const latest = getLatestExecutionForSlot('2026-04-05T04:00:00.000Z');
    expect(latest).not.toBeNull();
    expect(latest?.soc_at_end).toBe(72);
    expect(latest?.actual_import_wh).toBe(0);
    expect(latest?.actual_export_wh).toBe(1450);
  });

  it('allows partial updates without touching other fields', () => {
    const id = recordSlotExecution({
      slot_start: '2026-04-05T05:00:00.000Z',
      slot_end: '2026-04-05T05:30:00.000Z',
      action: 'hold',
      reason: null,
      override_source: 'default',
      soc_at_start: 55,
      soc_at_end: null,
      command_signature: null,
      command_issued_at: '2026-04-05T04:59:45.000Z',
      actual_import_wh: 200,
    });

    updateSlotExecutionActuals(id, { soc_at_end: 54 });

    const latest = getLatestExecutionForSlot('2026-04-05T05:00:00.000Z');
    expect(latest?.soc_at_end).toBe(54);
    expect(latest?.actual_import_wh).toBe(200);
    expect(latest?.actual_export_wh).toBeNull();
  });

  it('is a no-op when updateSlotExecutionActuals receives no fields', () => {
    const id = recordSlotExecution({
      slot_start: '2026-04-05T06:00:00.000Z',
      slot_end: '2026-04-05T06:30:00.000Z',
      action: 'charge',
      reason: null,
      override_source: 'plan',
      soc_at_start: 20,
      command_signature: 'noop',
      command_issued_at: '2026-04-05T05:59:45.000Z',
    });

    expect(() => updateSlotExecutionActuals(id, {})).not.toThrow();

    const latest = getLatestExecutionForSlot('2026-04-05T06:00:00.000Z');
    expect(latest?.soc_at_start).toBe(20);
  });

  it('getSlotExecutions returns rows in the requested window and excludes rows outside', () => {
    recordSlotExecution({
      slot_start: '2026-04-05T07:00:00.000Z',
      slot_end: '2026-04-05T07:30:00.000Z',
      action: 'charge',
      reason: 'before-window',
      override_source: 'plan',
      soc_at_start: 30,
      command_signature: 'before',
      command_issued_at: '2026-04-05T06:00:00.000Z',
    });
    recordSlotExecution({
      slot_start: '2026-04-05T08:00:00.000Z',
      slot_end: '2026-04-05T08:30:00.000Z',
      action: 'charge',
      reason: 'in-window-1',
      override_source: 'plan',
      soc_at_start: 32,
      command_signature: 'in-1',
      command_issued_at: '2026-04-05T08:00:00.000Z',
    });
    recordSlotExecution({
      slot_start: '2026-04-05T09:00:00.000Z',
      slot_end: '2026-04-05T09:30:00.000Z',
      action: 'discharge',
      reason: 'in-window-2',
      override_source: 'auto',
      soc_at_start: 60,
      command_signature: 'in-2',
      command_issued_at: '2026-04-05T08:30:00.000Z',
    });
    recordSlotExecution({
      slot_start: '2026-04-05T10:00:00.000Z',
      slot_end: '2026-04-05T10:30:00.000Z',
      action: 'hold',
      reason: 'after-window',
      override_source: 'default',
      soc_at_start: 58,
      command_signature: 'after',
      command_issued_at: '2026-04-05T10:00:00.000Z',
    });

    const results = getSlotExecutions(
      '2026-04-05T07:30:00.000Z',
      '2026-04-05T10:00:00.000Z',
    );

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.reason)).toEqual(['in-window-2', 'in-window-1']);
    expect(results.every((r) => r.command_issued_at >= '2026-04-05T07:30:00.000Z')).toBe(true);
    expect(results.every((r) => r.command_issued_at < '2026-04-05T10:00:00.000Z')).toBe(true);
  });
});
