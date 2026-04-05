import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  testDb,
  resolveRatesMock,
  resolveExportRatesMock,
  scheduleExecutionMock,
  notifyMock,
} = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE rates (
      valid_from TEXT NOT NULL,
      valid_to TEXT NOT NULL,
      price_inc_vat REAL NOT NULL,
      price_exc_vat REAL,
      fetched_at TEXT NOT NULL,
      source TEXT DEFAULT 'api',
      PRIMARY KEY (valid_from)
    );

    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      avg_price REAL,
      status TEXT DEFAULT 'planned',
      created_at TEXT NOT NULL,
      executed_at TEXT,
      notes TEXT,
      type TEXT DEFAULT 'charge'
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
      status TEXT DEFAULT 'planned',
      created_at TEXT NOT NULL,
      executed_at TEXT,
      notes TEXT,
      actual_value REAL
    );

    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'info',
      category TEXT NOT NULL,
      message TEXT NOT NULL
    );
  `);

  return {
    testDb: db,
    resolveRatesMock: vi.fn(),
    resolveExportRatesMock: vi.fn(),
    scheduleExecutionMock: vi.fn(),
    notifyMock: vi.fn(),
  };
});

vi.mock('../../db', () => ({
  getDb: () => testDb,
}));

vi.mock('../../octopus/rates', () => ({
  resolveRates: resolveRatesMock,
  getStoredRates: vi.fn(),
}));

vi.mock('../../octopus/export-rates', () => ({
  resolveExportRates: resolveExportRatesMock,
  getStoredExportRates: vi.fn(() => []),
}));

vi.mock('../executor', () => ({
  scheduleExecution: scheduleExecutionMock,
}));

vi.mock('../../notifications/dispatcher', () => ({
  notify: notifyMock,
}));

vi.mock('../../virtual-inverter/runtime', () => ({
  isVirtualModeEnabled: () => false,
  getVirtualScheduleData: () => ({ schedules: [] }),
  getVirtualNow: () => new Date('2026-04-06T00:00:00Z'),
  getVirtualRates: () => [],
  getVirtualExportRates: () => [],
  getVirtualForecast: () => [],
}));

import { runScheduleCycle, _resetCronStateForTests } from '../cron';

describe('runScheduleCycle scheduler+SQLite integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-06T00:00:00Z'));
    vi.clearAllMocks();
    _resetCronStateForTests();

    testDb.prepare('DELETE FROM settings').run();
    testDb.prepare('DELETE FROM rates').run();
    testDb.prepare('DELETE FROM schedules').run();
    testDb.prepare('DELETE FROM plan_slots').run();
    testDb.prepare('DELETE FROM events').run();

    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('octopus_region', 'H');
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('charging_strategy', 'opportunistic_topup');
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('charge_hours', '2');
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('price_threshold', '0');
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('auto_schedule', 'true');
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('usage_learning_enabled', 'false');
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('smart_discharge', 'false');

    resolveRatesMock.mockResolvedValue([
      {
        valid_from: '2026-04-06T00:00:00Z',
        valid_to: '2026-04-06T00:30:00Z',
        price_inc_vat: 22,
        price_exc_vat: 22,
      },
      {
        valid_from: '2026-04-06T00:30:00Z',
        valid_to: '2026-04-06T01:00:00Z',
        price_inc_vat: 8,
        price_exc_vat: 8,
      },
      {
        valid_from: '2026-04-06T01:00:00Z',
        valid_to: '2026-04-06T01:30:00Z',
        price_inc_vat: 6,
        price_exc_vat: 6,
      },
    ]);
    resolveExportRatesMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds a plan from fixed rates and persists it into SQLite', async () => {
    const result = await runScheduleCycle();

    expect(result).toMatchObject({
      ok: true,
      status: 'scheduled',
    });

    const schedules = testDb
      .prepare('SELECT slot_start, slot_end, status, type FROM schedules ORDER BY slot_start ASC')
      .all() as Array<{
      slot_start: string;
      slot_end: string;
      status: string;
      type: string;
    }>;
    expect(schedules.length).toBeGreaterThan(0);
    expect(schedules.every((row) => row.status === 'planned')).toBe(true);

    const planSlots = testDb
      .prepare('SELECT slot_start, action, status FROM plan_slots ORDER BY slot_start ASC')
      .all() as Array<{ slot_start: string; action: string; status: string }>;
    expect(planSlots.length).toBeGreaterThan(0);
    expect(planSlots.some((row) => row.action === 'charge')).toBe(true);
    expect(planSlots.every((row) => row.status === 'planned')).toBe(true);

    const schedulerEvents = testDb
      .prepare(`SELECT category, level, message FROM events WHERE category = 'scheduler' ORDER BY id DESC LIMIT 1`)
      .all() as Array<{ category: string; level: string; message: string }>;
    expect(schedulerEvents).toHaveLength(1);
    expect(schedulerEvents[0]).toMatchObject({
      category: 'scheduler',
      level: 'success',
    });
    expect(schedulerEvents[0].message).toContain('scheduled');

    expect(scheduleExecutionMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
});
