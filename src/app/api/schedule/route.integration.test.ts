import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb, getResolvedSlotActionMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
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

    CREATE TABLE readings (
      timestamp TEXT NOT NULL,
      grid_power REAL
    );

    CREATE TABLE rates (
      valid_from TEXT PRIMARY KEY,
      valid_to TEXT NOT NULL,
      price_inc_vat REAL NOT NULL,
      price_exc_vat REAL,
      fetched_at TEXT NOT NULL,
      source TEXT DEFAULT 'api'
    );

    CREATE TABLE export_rates (
      valid_from TEXT PRIMARY KEY,
      valid_to TEXT NOT NULL,
      price_inc_vat REAL NOT NULL,
      price_exc_vat REAL,
      fetched_at TEXT NOT NULL,
      source TEXT DEFAULT 'api'
    );
  `);

  return {
    testDb: db,
    getResolvedSlotActionMock: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  getDb: () => testDb,
}));

vi.mock('@/lib/scheduler/watchdog', () => ({
  getResolvedSlotAction: getResolvedSlotActionMock,
}));

vi.mock('@/lib/virtual-inverter/runtime', () => ({
  isVirtualModeEnabled: () => false,
  getVirtualNow: () => new Date('2026-04-05T17:45:00Z'),
  getVirtualScheduleData: () => ({ schedules: [], plan_slots: [] }),
}));

import { GET } from './route';
import { persistSchedulePlan, updateScheduleStatus } from '@/lib/db/schedule-repository';

describe('/api/schedule API+DB integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T17:45:00Z'));
    testDb.prepare('DELETE FROM schedules').run();
    testDb.prepare('DELETE FROM plan_slots').run();
    testDb.prepare('DELETE FROM readings').run();
    testDb.prepare('DELETE FROM rates').run();
    testDb.prepare('DELETE FROM export_rates').run();
    getResolvedSlotActionMock.mockReset();
    getResolvedSlotActionMock.mockReturnValue({
      action: 'charge',
      source: 'plan',
      reason: 'scheduled_slot',
      detail: 'Charge slot active',
      slotStart: '2026-04-05T18:00:00Z',
      slotEnd: '2026-04-05T19:00:00Z',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns persisted lifecycle state after plan, execution update, and readback', async () => {
    persistSchedulePlan(
      [
        {
          slot_start: '2026-04-05T18:00:00Z',
          slot_end: '2026-04-05T19:00:00Z',
          avg_price: 15,
          slots: [],
          type: 'charge',
        },
      ],
      [
        {
          slot_start: '2026-04-05T18:00:00Z',
          slot_end: '2026-04-05T18:30:00Z',
          action: 'charge',
          reason: 'slot one',
          expected_soc_after: 62,
          expected_value: -5,
        },
        {
          slot_start: '2026-04-05T18:30:00Z',
          slot_end: '2026-04-05T19:00:00Z',
          action: 'charge',
          reason: 'slot two',
          expected_soc_after: 72,
          expected_value: -10,
        },
      ],
    );

    testDb.prepare(
      `INSERT INTO rates (valid_from, valid_to, price_inc_vat, price_exc_vat, fetched_at, source)
       VALUES (?, ?, ?, ?, ?, 'api')`,
    ).run('2026-04-05T18:00:00Z', '2026-04-05T18:30:00Z', 10, 10, '2026-04-05T17:00:00Z');
    testDb.prepare(
      `INSERT INTO rates (valid_from, valid_to, price_inc_vat, price_exc_vat, fetched_at, source)
       VALUES (?, ?, ?, ?, ?, 'api')`,
    ).run('2026-04-05T18:30:00Z', '2026-04-05T19:00:00Z', 20, 20, '2026-04-05T17:00:00Z');

    testDb.prepare('INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)').run('2026-04-05T18:05:00Z', 1000);
    testDb.prepare('INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)').run('2026-04-05T18:20:00Z', 1000);
    testDb.prepare('INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)').run('2026-04-05T18:35:00Z', 1000);
    testDb.prepare('INSERT INTO readings (timestamp, grid_power) VALUES (?, ?)').run('2026-04-05T18:50:00Z', 1000);

    updateScheduleStatus(
      '2026-04-05T18:00:00Z',
      '2026-04-05T19:00:00Z',
      'charge',
      'completed',
      'integration execution',
    );

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=30');
    expect(payload.current_action).toMatchObject({
      action: 'charge',
      source: 'plan',
      slotStart: '2026-04-05T18:00:00Z',
      slotEnd: '2026-04-05T19:00:00Z',
    });

    expect(payload.schedules).toHaveLength(1);
    expect(payload.schedules[0]).toMatchObject({
      slot_start: '2026-04-05T18:00:00Z',
      slot_end: '2026-04-05T19:00:00Z',
      status: 'completed',
      notes: 'integration execution',
      type: 'charge',
    });

    expect(payload.plan_slots).toHaveLength(2);
    const firstSlot = payload.plan_slots.find((slot: { slot_start: string }) => slot.slot_start === '2026-04-05T18:00:00Z');
    const secondSlot = payload.plan_slots.find((slot: { slot_start: string }) => slot.slot_start === '2026-04-05T18:30:00Z');

    expect(firstSlot).toMatchObject({
      status: 'completed',
      notes: 'integration execution',
      actual_value: -5,
    });
    expect(secondSlot).toMatchObject({
      status: 'completed',
      notes: 'integration execution',
      actual_value: -10,
    });
  });
});
