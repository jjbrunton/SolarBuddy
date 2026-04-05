import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('..', () => ({
  getDb: () => testDb,
}));

import {
  clearAutoOverridesForSlot,
  clearExpiredAutoOverrides,
  getAllAutoOverrides,
  getCurrentAutoOverride,
  insertAutoOverride,
  type AutoOverrideRow,
} from '../auto-override-repository';

function row(overrides: Partial<AutoOverrideRow> = {}): AutoOverrideRow {
  return {
    slot_start: '2026-04-05T10:00:00.000Z',
    slot_end: '2026-04-05T10:30:00.000Z',
    action: 'charge',
    source: 'soc_boost',
    reason: 'SOC below threshold',
    expires_at: '2026-04-05T10:30:00.000Z',
    ...overrides,
  };
}

describe('auto_overrides repository', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM auto_overrides').run();
  });

  it('insertAutoOverride returns a positive id', () => {
    const id = insertAutoOverride(row());
    expect(id).toBeGreaterThan(0);
  });

  it('getCurrentAutoOverride returns the active override for a timestamp inside the window', () => {
    insertAutoOverride(
      row({
        slot_start: '2026-04-05T10:00:00.000Z',
        slot_end: '2026-04-05T10:30:00.000Z',
        expires_at: '2026-04-05T10:30:00.000Z',
      }),
    );
    const active = getCurrentAutoOverride('2026-04-05T10:10:00.000Z');
    expect(active).not.toBeNull();
    expect(active?.action).toBe('charge');
    expect(active?.source).toBe('soc_boost');
  });

  it('getCurrentAutoOverride returns null when the timestamp is outside the window', () => {
    insertAutoOverride(
      row({
        slot_start: '2026-04-05T10:00:00.000Z',
        slot_end: '2026-04-05T10:30:00.000Z',
        expires_at: '2026-04-05T10:30:00.000Z',
      }),
    );
    // Before the window
    expect(getCurrentAutoOverride('2026-04-05T09:59:00.000Z')).toBeNull();
    // After the window (slot_end is exclusive)
    expect(getCurrentAutoOverride('2026-04-05T10:30:00.000Z')).toBeNull();
  });

  it('getCurrentAutoOverride ignores expired entries even if timestamp is inside slot', () => {
    // An override whose slot covers 10:00–10:30 but expires at 10:15.
    insertAutoOverride(
      row({
        slot_start: '2026-04-05T10:00:00.000Z',
        slot_end: '2026-04-05T10:30:00.000Z',
        expires_at: '2026-04-05T10:15:00.000Z',
      }),
    );
    // Before the expiry is fine.
    expect(getCurrentAutoOverride('2026-04-05T10:10:00.000Z')).not.toBeNull();
    // After the expiry is filtered out.
    expect(getCurrentAutoOverride('2026-04-05T10:20:00.000Z')).toBeNull();
  });

  it('getCurrentAutoOverride returns the most recent entry when multiple exist for the slot', () => {
    insertAutoOverride(
      row({
        slot_start: '2026-04-05T10:00:00.000Z',
        slot_end: '2026-04-05T10:30:00.000Z',
        reason: 'first entry',
      }),
    );
    insertAutoOverride(
      row({
        slot_start: '2026-04-05T10:00:00.000Z',
        slot_end: '2026-04-05T10:30:00.000Z',
        source: 'battery_exhausted_guard',
        action: 'hold',
        reason: 'second entry',
      }),
    );
    const active = getCurrentAutoOverride('2026-04-05T10:10:00.000Z');
    expect(active?.reason).toBe('second entry');
    expect(active?.source).toBe('battery_exhausted_guard');
  });

  it('clearExpiredAutoOverrides removes rows whose expires_at is <= now', () => {
    insertAutoOverride(
      row({
        slot_start: '2026-04-05T09:00:00.000Z',
        slot_end: '2026-04-05T09:30:00.000Z',
        expires_at: '2026-04-05T09:30:00.000Z',
      }),
    );
    insertAutoOverride(
      row({
        slot_start: '2026-04-05T10:00:00.000Z',
        slot_end: '2026-04-05T10:30:00.000Z',
        expires_at: '2026-04-05T10:30:00.000Z',
      }),
    );
    const removed = clearExpiredAutoOverrides('2026-04-05T10:00:00.000Z');
    expect(removed).toBe(1);
    const remaining = getAllAutoOverrides();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].slot_start).toBe('2026-04-05T10:00:00.000Z');
  });

  it('clearAutoOverridesForSlot removes only rows matching the slot_start', () => {
    insertAutoOverride(row({ slot_start: '2026-04-05T10:00:00.000Z' }));
    insertAutoOverride(row({ slot_start: '2026-04-05T10:30:00.000Z' }));
    clearAutoOverridesForSlot('2026-04-05T10:00:00.000Z');
    const remaining = getAllAutoOverrides();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].slot_start).toBe('2026-04-05T10:30:00.000Z');
  });

  it('getAllAutoOverrides returns all rows ordered by most recent first', () => {
    insertAutoOverride(row({ reason: 'first' }));
    insertAutoOverride(row({ reason: 'second' }));
    insertAutoOverride(row({ reason: 'third' }));
    const rows = getAllAutoOverrides();
    expect(rows.map((r) => r.reason)).toEqual(['third', 'second', 'first']);
  });
});
