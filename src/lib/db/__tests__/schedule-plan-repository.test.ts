import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      avg_price REAL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      type TEXT,
      executed_at TEXT,
      notes TEXT
    );

    CREATE TABLE plan_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL UNIQUE,
      slot_end TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      expected_soc_after REAL,
      expected_value REAL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      executed_at TEXT,
      notes TEXT,
      actual_value REAL
    );

    CREATE TABLE readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      grid_power REAL NOT NULL
    );

    CREATE TABLE rates (
      valid_from TEXT PRIMARY KEY,
      price_inc_vat REAL NOT NULL
    );

    CREATE TABLE export_rates (
      valid_from TEXT PRIMARY KEY,
      price_inc_vat REAL NOT NULL
    );
  `);
  return { testDb: db };
});

vi.mock('..', () => ({
  getDb: () => testDb,
}));

import {
  backfillActualValues,
  calculateAndPersistSlotActualValue,
  getRecentPlanData,
  persistSchedulePlan,
  updateScheduleStatus,
} from '../schedule-repository';

describe('schedule plan repository', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T12:00:00.000Z'));

    testDb.prepare('DELETE FROM schedules').run();
    testDb.prepare('DELETE FROM plan_slots').run();
    testDb.prepare('DELETE FROM readings').run();
    testDb.prepare('DELETE FROM rates').run();
    testDb.prepare('DELETE FROM export_rates').run();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists fresh schedule data and removes stale planned rows', () => {
    testDb
      .prepare(
        `INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T06:00:00.000Z', '2026-04-05T06:30:00.000Z', 12, 'planned', 'old', 'charge');
    testDb
      .prepare(
        `INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-04', '2026-04-04T06:00:00.000Z', '2026-04-04T06:30:00.000Z', 18, 'planned', 'old', 'discharge');
    testDb
      .prepare(
        `INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T07:00:00.000Z', '2026-04-05T07:30:00.000Z', 22, 'completed', 'old', 'charge');

    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T06:00:00.000Z', '2026-04-05T06:30:00.000Z', 'charge', 'old', 40, -5, 'planned', 'old');

    persistSchedulePlan(
      [
        {
          slot_start: '2026-04-05T12:00:00.000Z',
          slot_end: '2026-04-05T12:30:00.000Z',
          avg_price: 9,
          slots: [],
        },
      ],
      [
        {
          slot_start: '2026-04-05T12:00:00.000Z',
          slot_end: '2026-04-05T12:30:00.000Z',
          action: 'charge',
          reason: 'selected by planner',
          expected_soc_after: 52,
          expected_value: -4.5,
        },
      ],
    );

    const plannedSchedules = testDb
      .prepare(`SELECT slot_start, status, type FROM schedules WHERE status = 'planned' ORDER BY slot_start`)
      .all() as Array<{ slot_start: string; status: string; type: string }>;
    expect(plannedSchedules).toEqual([
      {
        slot_start: '2026-04-05T12:00:00.000Z',
        status: 'planned',
        type: 'charge',
      },
    ]);

    const completedCount = testDb
      .prepare(`SELECT COUNT(*) as count FROM schedules WHERE status = 'completed'`)
      .get() as { count: number };
    expect(completedCount.count).toBe(1);

    const plannedSlots = testDb
      .prepare(`SELECT slot_start, action, status FROM plan_slots WHERE status = 'planned'`)
      .all() as Array<{ slot_start: string; action: string; status: string }>;
    expect(plannedSlots).toEqual([
      {
        slot_start: '2026-04-05T12:00:00.000Z',
        action: 'charge',
        status: 'planned',
      },
    ]);
  });

  it('marks schedule and plan slots as completed and persists slot actual values for charge windows', () => {
    const slotStart = '2026-04-05T01:00:00Z';
    const slotEnd = '2026-04-05T02:00:00Z';

    testDb
      .prepare(
        `INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', slotStart, slotEnd, 10, 'planned', 'seed', 'charge');

    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T01:00:00Z', '2026-04-05T01:30:00Z', 'charge', null, null, null, 'planned', 'seed');
    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T01:30:00Z', '2026-04-05T02:00:00Z', 'charge', null, null, null, 'planned', 'seed');

    testDb.prepare(`INSERT INTO rates (valid_from, price_inc_vat) VALUES (?, ?)`).run('2026-04-05T01:00:00Z', 10);
    testDb.prepare(`INSERT INTO rates (valid_from, price_inc_vat) VALUES (?, ?)`).run('2026-04-05T01:30:00Z', 20);

    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T01:05:00Z', 1000);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T01:20:00Z', 1000);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T01:35:00Z', 1000);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T01:50:00Z', 1000);

    updateScheduleStatus(slotStart, slotEnd, 'charge', 'completed', 'executed');

    const updatedSchedule = testDb
      .prepare(`SELECT status, notes, executed_at FROM schedules WHERE slot_start = ?`)
      .get(slotStart) as { status: string; notes: string; executed_at: string | null };
    expect(updatedSchedule.status).toBe('completed');
    expect(updatedSchedule.notes).toBe('executed');
    expect(updatedSchedule.executed_at).not.toBeNull();

    const updatedSlots = testDb
      .prepare(`SELECT slot_start, status, notes, actual_value FROM plan_slots ORDER BY slot_start`)
      .all() as Array<{
      slot_start: string;
      status: string;
      notes: string | null;
      actual_value: number | null;
    }>;
    expect(updatedSlots).toEqual([
      {
        slot_start: '2026-04-05T01:00:00Z',
        status: 'completed',
        notes: 'executed',
        actual_value: -5,
      },
      {
        slot_start: '2026-04-05T01:30:00Z',
        status: 'completed',
        notes: 'executed',
        actual_value: -10,
      },
    ]);
  });

  it('calculates discharge slot value using export rate first and import rate fallback', () => {
    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T03:00:00.000Z', '2026-04-05T03:30:00.000Z', 'discharge', null, null, null, 'completed', 'seed');
    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T04:00:00.000Z', '2026-04-05T04:30:00.000Z', 'discharge', null, null, null, 'completed', 'seed');

    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T03:05:00.000Z', -1200);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T03:20:00.000Z', -1200);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T04:05:00.000Z', -1200);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T04:20:00.000Z', -1200);

    testDb.prepare(`INSERT INTO export_rates (valid_from, price_inc_vat) VALUES (?, ?)`).run('2026-04-05T03:00:00.000Z', 15);
    testDb.prepare(`INSERT INTO rates (valid_from, price_inc_vat) VALUES (?, ?)`).run('2026-04-05T03:00:00.000Z', 30);
    testDb.prepare(`INSERT INTO rates (valid_from, price_inc_vat) VALUES (?, ?)`).run('2026-04-05T04:00:00.000Z', 40);

    const exportRateValue = calculateAndPersistSlotActualValue('2026-04-05T03:00:00.000Z', 'discharge');
    const importRateFallbackValue = calculateAndPersistSlotActualValue('2026-04-05T04:00:00.000Z', 'discharge');

    expect(exportRateValue).toBe(9);
    expect(importRateFallbackValue).toBe(24);
  });

  it('backfills completed slot actual values only for charge/discharge actions', () => {
    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at, actual_value
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T05:00:00.000Z', '2026-04-05T05:30:00.000Z', 'charge', null, null, null, 'completed', 'seed', null);
    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at, actual_value
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T05:30:00.000Z', '2026-04-05T06:00:00.000Z', 'discharge', null, null, null, 'completed', 'seed', null);
    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at, actual_value
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-05', '2026-04-05T06:00:00.000Z', '2026-04-05T06:30:00.000Z', 'hold', null, null, null, 'completed', 'seed', null);

    testDb.prepare(`INSERT INTO rates (valid_from, price_inc_vat) VALUES (?, ?)`).run('2026-04-05T05:00:00.000Z', 10);
    testDb.prepare(`INSERT INTO export_rates (valid_from, price_inc_vat) VALUES (?, ?)`).run('2026-04-05T05:30:00.000Z', 20);

    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T05:05:00.000Z', 1000);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T05:20:00.000Z', 1000);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T05:35:00.000Z', -1000);
    testDb.prepare(`INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)`).run('2026-04-05T05:50:00.000Z', -1000);

    const filledCount = backfillActualValues();
    expect(filledCount).toBe(2);

    const values = testDb
      .prepare(`SELECT slot_start, actual_value FROM plan_slots ORDER BY slot_start`)
      .all() as Array<{ slot_start: string; actual_value: number | null }>;
    expect(values).toEqual([
      { slot_start: '2026-04-05T05:00:00.000Z', actual_value: -5 },
      { slot_start: '2026-04-05T05:30:00.000Z', actual_value: 10 },
      { slot_start: '2026-04-05T06:00:00.000Z', actual_value: null },
    ]);
  });

  it('returns only recent schedule and plan slot rows within the history window', () => {
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    testDb
      .prepare(
        `INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-03-20', '2026-03-20T01:00:00.000Z', '2026-03-20T01:30:00.000Z', 9, 'planned', 'seed', 'charge');
    testDb
      .prepare(
        `INSERT INTO schedules (date, slot_start, slot_end, avg_price, status, created_at, type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-10', '2026-04-10T01:00:00.000Z', '2026-04-10T01:30:00.000Z', 11, 'planned', 'seed', 'charge');

    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-03-20', '2026-03-20T01:00:00.000Z', '2026-03-20T01:30:00.000Z', 'charge', null, null, null, 'planned', 'seed');
    testDb
      .prepare(
        `INSERT INTO plan_slots (
           date, slot_start, slot_end, action, reason, expected_soc_after, expected_value, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('2026-04-10', '2026-04-10T01:00:00.000Z', '2026-04-10T01:30:00.000Z', 'charge', null, null, null, 'planned', 'seed');

    const { schedules, plan_slots } = getRecentPlanData();

    expect((schedules as Array<{ slot_start: string }>).map((row) => row.slot_start)).toEqual([
      '2026-04-10T01:00:00.000Z',
    ]);
    expect((plan_slots as Array<{ slot_start: string }>).map((row) => row.slot_start)).toEqual([
      '2026-04-10T01:00:00.000Z',
    ]);
  });
});
