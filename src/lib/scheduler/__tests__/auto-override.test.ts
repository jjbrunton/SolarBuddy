import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../config';
import type { InverterState } from '../../types';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE auto_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_start TEXT NOT NULL,
      slot_end TEXT NOT NULL,
      action TEXT NOT NULL,
      source TEXT NOT NULL,
      reason TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_auto_overrides_slot_start ON auto_overrides(slot_start);
    CREATE INDEX idx_auto_overrides_expires_at ON auto_overrides(expires_at);
  `);
  return { testDb: db };
});

vi.mock('../../db', () => ({
  getDb: () => testDb,
}));

// Stub out the usage module to keep the test hermetic — the real module
// transitively hits the DB and pulls in unrelated WIP code.
vi.mock('../../usage', () => ({
  getForecastedConsumptionW: () => 0,
  getBaseloadW: () => 0,
  getAverageForecastedConsumptionW: () => 0,
  getUsageHighPeriods: () => [],
  getUsageProfile: () => null,
  invalidateUsageProfileCache: () => {},
}));

const appendEventSpy = vi.fn();
vi.mock('../../events', () => ({
  appendEvent: (...args: unknown[]) => appendEventSpy(...args),
}));

import { evaluateAutoOverrides } from '../auto-override';
import { getAllAutoOverrides, clearExpiredAutoOverrides } from '../../db/auto-override-repository';

function buildSettings(partial: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    discharge_soc_floor: '20',
    ...partial,
  };
}

function buildState(soc: number | null): Pick<InverterState, 'battery_soc'> {
  return { battery_soc: soc };
}

describe('evaluateAutoOverrides', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM auto_overrides').run();
    appendEventSpy.mockClear();
  });

  it('is a no-op when always_charge_below_soc is empty and SOC is above the floor', () => {
    const now = new Date('2026-04-01T10:10:00Z');
    const decision = evaluateAutoOverrides(
      now,
      buildState(60),
      buildSettings({ always_charge_below_soc: '' }),
    );
    expect(decision.applied).toBe(false);
    expect(getAllAutoOverrides()).toHaveLength(0);
  });

  it('creates a charge override when SOC is below always_charge_below_soc', () => {
    const now = new Date('2026-04-01T10:10:00Z');
    const decision = evaluateAutoOverrides(
      now,
      buildState(25),
      buildSettings({ always_charge_below_soc: '30' }),
    );
    expect(decision.applied).toBe(true);
    expect(decision.override).toMatchObject({
      action: 'charge',
      source: 'soc_boost',
      slot_start: '2026-04-01T10:00:00.000Z',
      slot_end: '2026-04-01T10:30:00.000Z',
    });
    const all = getAllAutoOverrides();
    expect(all).toHaveLength(1);
    expect(all[0].action).toBe('charge');
    expect(all[0].source).toBe('soc_boost');
  });

  it('sets expires_at to the end of the current slot', () => {
    const now = new Date('2026-04-01T10:10:00Z');
    const decision = evaluateAutoOverrides(
      now,
      buildState(10),
      buildSettings({ always_charge_below_soc: '30' }),
    );
    expect(decision.applied).toBe(true);
    expect(decision.override?.expires_at).toBe('2026-04-01T10:30:00.000Z');
  });

  it('returns applied:false on a subsequent call if an override already exists for the slot', () => {
    const now = new Date('2026-04-01T10:10:00Z');
    evaluateAutoOverrides(now, buildState(10), buildSettings({ always_charge_below_soc: '30' }));
    const second = evaluateAutoOverrides(
      new Date('2026-04-01T10:15:00Z'),
      buildState(10),
      buildSettings({ always_charge_below_soc: '30' }),
    );
    expect(second.applied).toBe(false);
    expect(getAllAutoOverrides()).toHaveLength(1);
  });

  it('clearExpiredAutoOverrides removes past entries', () => {
    testDb
      .prepare(
        `INSERT INTO auto_overrides (slot_start, slot_end, action, source, reason, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '2026-04-01T09:00:00.000Z',
        '2026-04-01T09:30:00.000Z',
        'charge',
        'soc_boost',
        'old',
        '2026-04-01T09:30:00.000Z',
        '2026-04-01T09:00:00.000Z',
      );
    expect(getAllAutoOverrides()).toHaveLength(1);
    const removed = clearExpiredAutoOverrides('2026-04-01T10:00:00.000Z');
    expect(removed).toBe(1);
    expect(getAllAutoOverrides()).toHaveLength(0);
  });

  it('evaluateAutoOverrides cleans up expired entries before evaluating', () => {
    // Insert an expired override with a past slot so it cannot match the
    // current window lookup but is eligible for expiry cleanup.
    testDb
      .prepare(
        `INSERT INTO auto_overrides (slot_start, slot_end, action, source, reason, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        '2026-04-01T08:00:00.000Z',
        '2026-04-01T08:30:00.000Z',
        'charge',
        'soc_boost',
        'old',
        '2026-04-01T08:30:00.000Z',
        '2026-04-01T08:00:00.000Z',
      );

    const now = new Date('2026-04-01T10:10:00Z');
    const decision = evaluateAutoOverrides(
      now,
      buildState(60),
      buildSettings({ always_charge_below_soc: '' }),
    );
    expect(decision.cleared).toBe(1);
    expect(getAllAutoOverrides()).toHaveLength(0);
  });

  it('fires battery exhausted guard when SOC <= discharge_soc_floor (hold override)', () => {
    const now = new Date('2026-04-01T10:10:00Z');
    const decision = evaluateAutoOverrides(
      now,
      buildState(20),
      buildSettings({ always_charge_below_soc: '', discharge_soc_floor: '20' }),
    );
    expect(decision.applied).toBe(true);
    expect(decision.override).toMatchObject({
      action: 'hold',
      source: 'battery_exhausted_guard',
    });
  });

  it('soc_boost takes precedence over battery_exhausted_guard when both would fire', () => {
    // SOC below both always_charge_below_soc and discharge_soc_floor → charge wins.
    const now = new Date('2026-04-01T10:10:00Z');
    const decision = evaluateAutoOverrides(
      now,
      buildState(15),
      buildSettings({ always_charge_below_soc: '30', discharge_soc_floor: '20' }),
    );
    expect(decision.applied).toBe(true);
    expect(decision.override?.action).toBe('charge');
    expect(decision.override?.source).toBe('soc_boost');
  });

  it('returns applied:false and does not throw when the DB throws', () => {
    // Temporarily swap in a broken prepare so every DB call in the evaluator
    // path throws. The function must catch, log, and return a safe result.
    const originalPrepare = testDb.prepare.bind(testDb);
    (testDb as unknown as { prepare: unknown }).prepare = () => {
      throw new Error('simulated DB failure');
    };

    try {
      const decision = evaluateAutoOverrides(
        new Date('2026-04-01T10:10:00Z'),
        buildState(15),
        buildSettings({ always_charge_below_soc: '30' }),
      );
      expect(decision.applied).toBe(false);
      expect(appendEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          category: 'auto-override',
        }),
      );
    } finally {
      (testDb as unknown as { prepare: typeof originalPrepare }).prepare = originalPrepare;
    }
  });

  it('is a no-op when battery_soc is null', () => {
    const now = new Date('2026-04-01T10:10:00Z');
    const decision = evaluateAutoOverrides(
      now,
      buildState(null),
      buildSettings({ always_charge_below_soc: '30' }),
    );
    expect(decision.applied).toBe(false);
    expect(getAllAutoOverrides()).toHaveLength(0);
  });
});
