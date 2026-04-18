import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb, getVirtualNowMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE manual_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      action TEXT DEFAULT 'charge',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_overrides_date ON manual_overrides(date);
  `);
  return {
    testDb: db,
    getVirtualNowMock: vi.fn(() => new Date('2026-04-10T13:17:00.000Z')),
  };
});

vi.mock('../connection', () => ({
  getDb: () => testDb,
}));

vi.mock('../../virtual-inverter/runtime', () => ({
  getVirtualNow: getVirtualNowMock,
}));

import {
  clearTodayOverrides,
  currentSlotBoundsUtc,
  deleteTodayOverrideSlot,
  listTodayOverrides,
  replaceTodayOverrides,
  upsertTodayOverride,
} from '../override-repository';

beforeEach(() => {
  testDb.prepare('DELETE FROM manual_overrides').run();
  getVirtualNowMock.mockReturnValue(new Date('2026-04-10T13:17:00.000Z'));
});

describe('listTodayOverrides', () => {
  it('returns only rows dated to today (virtual now)', () => {
    testDb
      .prepare(
        "INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES ('2026-04-10', '2026-04-10T13:00:00.000Z', '2026-04-10T13:30:00.000Z', 'charge', '2026-04-10T12:00:00.000Z')",
      )
      .run();
    testDb
      .prepare(
        "INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES ('2026-04-09', '2026-04-09T13:00:00.000Z', '2026-04-09T13:30:00.000Z', 'hold', '2026-04-09T12:00:00.000Z')",
      )
      .run();

    const today = listTodayOverrides();
    expect(today).toHaveLength(1);
    expect(today[0].slot_start).toBe('2026-04-10T13:00:00.000Z');
    expect(today[0].action).toBe('charge');
  });

  it('returns rows ordered by slot_start ascending', () => {
    upsertTodayOverride('2026-04-10T15:00:00.000Z', '2026-04-10T15:30:00.000Z', 'discharge');
    upsertTodayOverride('2026-04-10T09:00:00.000Z', '2026-04-10T09:30:00.000Z', 'charge');
    upsertTodayOverride('2026-04-10T12:00:00.000Z', '2026-04-10T12:30:00.000Z', 'hold');

    const rows = listTodayOverrides();
    expect(rows.map((r) => r.slot_start)).toEqual([
      '2026-04-10T09:00:00.000Z',
      '2026-04-10T12:00:00.000Z',
      '2026-04-10T15:00:00.000Z',
    ]);
  });
});

describe('replaceTodayOverrides', () => {
  it("deletes existing rows and inserts the new slot list atomically", () => {
    upsertTodayOverride('2026-04-10T09:00:00.000Z', '2026-04-10T09:30:00.000Z', 'charge');

    const inserted = replaceTodayOverrides([
      { slot_start: '2026-04-10T10:00:00.000Z', slot_end: '2026-04-10T10:30:00.000Z', action: 'discharge' },
      { slot_start: '2026-04-10T11:00:00.000Z', slot_end: '2026-04-10T11:30:00.000Z', action: 'hold' },
    ]);

    expect(inserted).toBe(2);
    const rows = listTodayOverrides();
    expect(rows.map((r) => r.slot_start)).toEqual([
      '2026-04-10T10:00:00.000Z',
      '2026-04-10T11:00:00.000Z',
    ]);
  });

  it("coerces unknown actions to 'charge'", () => {
    replaceTodayOverrides([
      {
        slot_start: '2026-04-10T10:00:00.000Z',
        slot_end: '2026-04-10T10:30:00.000Z',
        // cast away the type so we can verify the runtime coercion path
        action: 'bogus' as never,
      },
      {
        slot_start: '2026-04-10T10:30:00.000Z',
        slot_end: '2026-04-10T11:00:00.000Z',
        // missing action
      },
    ]);

    const rows = listTodayOverrides();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === 'charge')).toBe(true);
  });

  it('rolls back all inserts if any single insert fails (transaction atomicity)', () => {
    // Seed a row we expect to remain present after the aborted transaction.
    testDb
      .prepare(
        "INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES ('2026-04-10', '2026-04-10T08:00:00.000Z', '2026-04-10T08:30:00.000Z', 'charge', '2026-04-10T00:00:00.000Z')",
      )
      .run();

    expect(() =>
      replaceTodayOverrides([
        { slot_start: '2026-04-10T10:00:00.000Z', slot_end: '2026-04-10T10:30:00.000Z', action: 'hold' },
        // This row violates NOT NULL on slot_start, aborting the transaction.
        { slot_start: null as unknown as string, slot_end: '2026-04-10T11:00:00.000Z', action: 'hold' },
      ]),
    ).toThrow();

    const rows = listTodayOverrides();
    // The seeded row survives — the DELETE inside the transaction was rolled back.
    expect(rows).toHaveLength(1);
    expect(rows[0].slot_start).toBe('2026-04-10T08:00:00.000Z');
  });
});

describe('upsertTodayOverride', () => {
  it('overwrites an existing slot with a new action', () => {
    upsertTodayOverride('2026-04-10T13:00:00.000Z', '2026-04-10T13:30:00.000Z', 'charge');
    upsertTodayOverride('2026-04-10T13:00:00.000Z', '2026-04-10T13:30:00.000Z', 'discharge');

    const rows = listTodayOverrides();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('discharge');
  });
});

describe('deleteTodayOverrideSlot / clearTodayOverrides', () => {
  it('deleteTodayOverrideSlot removes only the matching slot', () => {
    upsertTodayOverride('2026-04-10T10:00:00.000Z', '2026-04-10T10:30:00.000Z', 'charge');
    upsertTodayOverride('2026-04-10T11:00:00.000Z', '2026-04-10T11:30:00.000Z', 'hold');

    deleteTodayOverrideSlot('2026-04-10T10:00:00.000Z');

    const rows = listTodayOverrides();
    expect(rows).toHaveLength(1);
    expect(rows[0].slot_start).toBe('2026-04-10T11:00:00.000Z');
  });

  it('clearTodayOverrides only removes today, leaving other dates intact', () => {
    upsertTodayOverride('2026-04-10T10:00:00.000Z', '2026-04-10T10:30:00.000Z', 'charge');
    testDb
      .prepare(
        "INSERT INTO manual_overrides (date, slot_start, slot_end, action, created_at) VALUES ('2026-04-09', '2026-04-09T10:00:00.000Z', '2026-04-09T10:30:00.000Z', 'hold', '2026-04-09T00:00:00.000Z')",
      )
      .run();

    clearTodayOverrides();

    expect(listTodayOverrides()).toHaveLength(0);
    const all = testDb.prepare('SELECT date FROM manual_overrides').all() as Array<{ date: string }>;
    expect(all.map((r) => r.date)).toEqual(['2026-04-09']);
  });
});

describe('currentSlotBoundsUtc', () => {
  it('floors timestamps before :30 to the top of the hour', () => {
    expect(currentSlotBoundsUtc(new Date('2026-04-10T13:00:00.000Z'))).toEqual({
      slot_start: '2026-04-10T13:00:00.000Z',
      slot_end: '2026-04-10T13:30:00.000Z',
    });
    expect(currentSlotBoundsUtc(new Date('2026-04-10T13:17:45.200Z'))).toEqual({
      slot_start: '2026-04-10T13:00:00.000Z',
      slot_end: '2026-04-10T13:30:00.000Z',
    });
    expect(currentSlotBoundsUtc(new Date('2026-04-10T13:29:59.999Z'))).toEqual({
      slot_start: '2026-04-10T13:00:00.000Z',
      slot_end: '2026-04-10T13:30:00.000Z',
    });
  });

  it('floors timestamps >= :30 to the half hour', () => {
    expect(currentSlotBoundsUtc(new Date('2026-04-10T13:30:00.000Z'))).toEqual({
      slot_start: '2026-04-10T13:30:00.000Z',
      slot_end: '2026-04-10T14:00:00.000Z',
    });
    expect(currentSlotBoundsUtc(new Date('2026-04-10T13:45:12.500Z'))).toEqual({
      slot_start: '2026-04-10T13:30:00.000Z',
      slot_end: '2026-04-10T14:00:00.000Z',
    });
  });

  it('rolls the slot_end forward into the next hour at the top of the hour', () => {
    expect(currentSlotBoundsUtc(new Date('2026-04-10T13:31:00.000Z'))).toEqual({
      slot_start: '2026-04-10T13:30:00.000Z',
      slot_end: '2026-04-10T14:00:00.000Z',
    });
  });

  it('crosses UTC midnight cleanly', () => {
    expect(currentSlotBoundsUtc(new Date('2026-04-10T23:45:00.000Z'))).toEqual({
      slot_start: '2026-04-10T23:30:00.000Z',
      slot_end: '2026-04-11T00:00:00.000Z',
    });
    expect(currentSlotBoundsUtc(new Date('2026-04-11T00:00:00.000Z'))).toEqual({
      slot_start: '2026-04-11T00:00:00.000Z',
      slot_end: '2026-04-11T00:30:00.000Z',
    });
  });

  it('uses getVirtualNow() when no argument is supplied', () => {
    getVirtualNowMock.mockReturnValue(new Date('2026-06-01T09:48:00.000Z'));
    expect(currentSlotBoundsUtc()).toEqual({
      slot_start: '2026-06-01T09:30:00.000Z',
      slot_end: '2026-06-01T10:00:00.000Z',
    });
  });
});
