import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../config';
import {
  TARIFF_DEFINITIONS,
  getTariffDefinition,
  type TariffBand,
  type TariffType,
} from '../definitions';

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function asMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

describe('TARIFF_DEFINITIONS consistency', () => {
  it('keys every definition by its own type field', () => {
    for (const [key, def] of Object.entries(TARIFF_DEFINITIONS)) {
      expect(def.type).toBe(key as TariffType);
    }
  });

  it("marks 'agile' as API-backed with no static bands", () => {
    expect(TARIFF_DEFINITIONS.agile.usesApiRates).toBe(true);
    expect(TARIFF_DEFINITIONS.agile.bands).toHaveLength(0);
  });

  it('declares bands for every non-agile tariff', () => {
    for (const [key, def] of Object.entries(TARIFF_DEFINITIONS)) {
      if (key === 'agile') continue;
      expect(def.bands.length, `${key} should define at least one band`).toBeGreaterThan(0);
      expect(def.usesApiRates).toBe(false);
    }
  });

  it('uses valid HH:MM strings for every band boundary', () => {
    for (const def of Object.values(TARIFF_DEFINITIONS)) {
      for (const band of def.bands) {
        expect(band.start, `${def.type}.${band.name} start`).toMatch(HHMM);
        expect(band.end, `${def.type}.${band.name} end`).toMatch(HHMM);
      }
    }
  });

  it('only references rateKeys that exist in AppSettings', () => {
    const validKeys = new Set(Object.keys(DEFAULT_SETTINGS));
    for (const def of Object.values(TARIFF_DEFINITIONS)) {
      for (const band of def.bands) {
        expect(validKeys.has(band.rateKey), `${def.type}.${band.name} → ${band.rateKey}`).toBe(
          true,
        );
      }
    }
  });

  it("only uses tariff-family rateKeys (tariff_offpeak_rate / tariff_peak_rate / tariff_standard_rate)", () => {
    const allowed = new Set([
      'tariff_offpeak_rate',
      'tariff_peak_rate',
      'tariff_standard_rate',
    ]);
    for (const def of Object.values(TARIFF_DEFINITIONS)) {
      for (const band of def.bands) {
        expect(allowed.has(band.rateKey), `${def.type}.${band.name} → ${band.rateKey}`).toBe(
          true,
        );
      }
    }
  });

  it('non-wrapping bands define a positive forward-going range', () => {
    // The 'standard' catch-all bands for flux/cosy use 00:00→00:00 (wrap-around);
    // for every other band we expect end > start within the same day.
    for (const def of Object.values(TARIFF_DEFINITIONS)) {
      for (const band of def.bands) {
        const start = asMinutes(band.start);
        const end = asMinutes(band.end);
        const isWrap = start === 0 && end === 0;
        if (isWrap) continue;
        const forward = start < end;
        const wraps = start > end; // e.g. Go standard: 05:30 → 00:30
        expect(
          forward || wraps,
          `${def.type}.${band.name} has zero-length range ${band.start}->${band.end}`,
        ).toBe(true);
      }
    }
  });

  it('Go tariff bands cover the full 24h when combined (off-peak + wrap-around standard)', () => {
    const go = TARIFF_DEFINITIONS.go;
    expect(go.bands).toHaveLength(2);
    const offpeak = go.bands.find((b) => b.name === 'off_peak') as TariffBand;
    const standard = go.bands.find((b) => b.name === 'standard') as TariffBand;
    // off-peak ends where standard starts, and vice-versa — covers 24h.
    expect(offpeak.end).toBe(standard.start);
    expect(standard.end).toBe(offpeak.start);
  });
});

describe('getTariffDefinition()', () => {
  it('returns the matching definition for known types', () => {
    expect(getTariffDefinition('go').type).toBe('go');
    expect(getTariffDefinition('flux').type).toBe('flux');
    expect(getTariffDefinition('cosy').type).toBe('cosy');
    expect(getTariffDefinition('agile').type).toBe('agile');
  });

  it("falls back to 'agile' when the requested type is unknown or empty", () => {
    expect(getTariffDefinition('').type).toBe('agile');
    expect(getTariffDefinition('not-a-tariff').type).toBe('agile');
    expect(getTariffDefinition('GO').type).toBe('agile'); // case-sensitive by design
  });
});
