import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testDb } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE rates (
      valid_from TEXT NOT NULL PRIMARY KEY,
      valid_to TEXT NOT NULL,
      price_inc_vat REAL NOT NULL,
      price_exc_vat REAL,
      fetched_at TEXT NOT NULL,
      source TEXT DEFAULT 'api'
    );
    CREATE TABLE export_rates (
      valid_from TEXT NOT NULL PRIMARY KEY,
      valid_to TEXT NOT NULL,
      price_inc_vat REAL NOT NULL,
      price_exc_vat REAL,
      fetched_at TEXT NOT NULL,
      source TEXT DEFAULT 'api'
    );
  `);
  return { testDb: db };
});

vi.mock('..', () => ({
  getDb: () => testDb,
}));

import {
  getStoredImportRates,
  normalizeRateTimestamp,
  storeImportRates,
} from '../rate-repository';

describe('rate repository', () => {
  beforeEach(() => {
    testDb.prepare('DELETE FROM rates').run();
    testDb.prepare('DELETE FROM export_rates').run();
  });

  describe('normalizeRateTimestamp', () => {
    it('strips millisecond precision from toISOString output', () => {
      expect(normalizeRateTimestamp('2026-04-16T20:00:00.000Z')).toBe('2026-04-16T20:00:00Z');
    });

    it('preserves already-canonical timestamps', () => {
      expect(normalizeRateTimestamp('2026-04-16T20:00:00Z')).toBe('2026-04-16T20:00:00Z');
    });

    it('normalises non-UTC offsets to UTC', () => {
      expect(normalizeRateTimestamp('2026-04-16T21:00:00+01:00')).toBe('2026-04-16T20:00:00Z');
    });
  });

  describe('storeImportRates', () => {
    it('treats Nordpool and Octopus timestamps for the same slot as the same key', () => {
      storeImportRates(
        [
          {
            valid_from: '2026-04-16T20:00:00.000Z',
            valid_to: '2026-04-16T20:30:00.000Z',
            price_inc_vat: 28.9,
            price_exc_vat: 27.5,
          },
        ],
        'nordpool',
      );
      storeImportRates(
        [
          {
            valid_from: '2026-04-16T20:00:00Z',
            valid_to: '2026-04-16T20:30:00Z',
            price_inc_vat: 23.8,
            price_exc_vat: 22.7,
          },
        ],
        'octopus',
      );

      const rows = getStoredImportRates();
      expect(rows).toHaveLength(1);
      expect(rows[0].price_inc_vat).toBe(23.8);
      expect(rows[0].valid_from).toBe('2026-04-16T20:00:00Z');
    });

    it('does not overwrite Octopus rows with later Nordpool data for the same slot', () => {
      storeImportRates(
        [
          {
            valid_from: '2026-04-16T20:00:00Z',
            valid_to: '2026-04-16T20:30:00Z',
            price_inc_vat: 23.8,
            price_exc_vat: 22.7,
          },
        ],
        'octopus',
      );
      storeImportRates(
        [
          {
            valid_from: '2026-04-16T20:00:00.000Z',
            valid_to: '2026-04-16T20:30:00.000Z',
            price_inc_vat: 28.9,
            price_exc_vat: 27.5,
          },
        ],
        'nordpool',
      );

      const rows = getStoredImportRates();
      expect(rows).toHaveLength(1);
      expect(rows[0].price_inc_vat).toBe(23.8);
    });
  });
});
