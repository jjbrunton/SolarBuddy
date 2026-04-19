import { describe, expect, it } from 'vitest';
import {
  buildPlanSummary,
  exportBand,
  formatDuration,
  importBand,
  type PlanSlotRow,
} from '../plan-summary';
import type { AgileRate } from '../../octopus/rates';
import type { ResolvedSlotAction } from '../resolve';

function rate(valid_from: string, valid_to: string, price: number): AgileRate {
  return { valid_from, valid_to, price_inc_vat: price, price_exc_vat: price };
}

function slot(
  slot_start: string,
  slot_end: string,
  action: PlanSlotRow['action'],
  expected_soc_after: number | null = null,
): PlanSlotRow {
  return { slot_start, slot_end, action, reason: null, expected_soc_after, expected_value: null };
}

describe('importBand', () => {
  it('returns free for zero price', () => {
    expect(importBand(0, -5, 30)).toBe('free');
  });
  it('returns negative for sub-zero price', () => {
    expect(importBand(-1, -5, 30)).toBe('negative');
  });
  it('returns cheap for bottom third', () => {
    expect(importBand(5, 0, 30)).toBe('cheap');
  });
  it('returns very expensive for top 10%', () => {
    expect(importBand(29, 0, 30)).toBe('very expensive');
  });
});

describe('exportBand', () => {
  it('buckets at thresholds', () => {
    expect(exportBand(2, 0, 40)).toBe('very low');
    expect(exportBand(15, 0, 40)).toBe('low');
    expect(exportBand(25, 0, 40)).toBe('good');
    expect(exportBand(35, 0, 40)).toBe('very good');
  });
});

describe('formatDuration', () => {
  it('handles sub-hour durations in minutes', () => {
    expect(formatDuration(30 * 60 * 1000)).toBe('30 min');
  });
  it('handles whole hours', () => {
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe('2 hours');
    expect(formatDuration(60 * 60 * 1000)).toBe('1 hour');
  });
  it('handles quarter fractions', () => {
    expect(formatDuration(2.5 * 60 * 60 * 1000)).toContain('and a half');
    expect(formatDuration(1.25 * 60 * 60 * 1000)).toContain('and a quarter');
    expect(formatDuration(1.75 * 60 * 60 * 1000)).toContain('and three quarters');
  });
});

describe('buildPlanSummary', () => {
  const now = new Date('2026-04-19T20:00:00Z');

  it('returns an import-rate bullet with merged bands', () => {
    const rates: AgileRate[] = [
      rate('2026-04-19T20:00:00Z', '2026-04-19T20:30:00Z', 8),
      rate('2026-04-19T20:30:00Z', '2026-04-19T21:00:00Z', 9),
      rate('2026-04-19T21:00:00Z', '2026-04-19T21:30:00Z', 28),
      rate('2026-04-19T21:30:00Z', '2026-04-19T22:00:00Z', 30),
    ];

    const bullets = buildPlanSummary({
      now,
      rates,
      planSlots: [],
      currentAction: null,
      currentSoc: null,
    });

    const importBullet = bullets.find((b) => b.key === 'import-rates');
    expect(importBullet?.text).toMatch(/Import rates are cheap/);
    expect(importBullet?.text).toMatch(/then very expensive/);
  });

  it('reports current charging action with target SOC and remaining duration', () => {
    const planSlots: PlanSlotRow[] = [
      slot('2026-04-19T19:30:00Z', '2026-04-19T20:00:00Z', 'charge', 70),
      slot('2026-04-19T20:00:00Z', '2026-04-19T20:30:00Z', 'charge', 80),
      slot('2026-04-19T20:30:00Z', '2026-04-19T21:00:00Z', 'charge', 90),
      slot('2026-04-19T21:00:00Z', '2026-04-19T21:30:00Z', 'hold', 90),
    ];
    const currentAction: ResolvedSlotAction = {
      action: 'charge',
      source: 'plan',
      reason: 'plan',
      detail: 'plan',
    };

    const bullets = buildPlanSummary({
      now: new Date('2026-04-19T20:00:00Z'),
      rates: [],
      planSlots,
      currentAction,
      currentSoc: 64,
    });

    const current = bullets.find((b) => b.key === 'current-state');
    expect(current?.text).toContain('Battery at 64%');
    expect(current?.text).toContain('charging to 90%');
    expect(current?.text).toContain('1 hour');
  });

  it('announces the next discharge slot when idle', () => {
    const planSlots: PlanSlotRow[] = [
      slot('2026-04-19T20:00:00Z', '2026-04-19T20:30:00Z', 'hold', 80),
      slot('2026-04-19T21:00:00Z', '2026-04-19T21:30:00Z', 'discharge', 60),
      slot('2026-04-19T21:30:00Z', '2026-04-19T22:00:00Z', 'discharge', 40),
    ];
    const currentAction: ResolvedSlotAction = {
      action: 'hold',
      source: 'plan',
      reason: 'plan',
      detail: 'plan',
    };

    const bullets = buildPlanSummary({
      now,
      rates: [],
      planSlots,
      currentAction,
      currentSoc: 80,
    });

    const nextDischarge = bullets.find((b) => b.key === 'next-discharge');
    expect(nextDischarge?.text).toMatch(/Next discharge slot is in 1 hour for 1 hour/);
  });

  it('skips the next-charge bullet while currently charging', () => {
    const bullets = buildPlanSummary({
      now,
      rates: [],
      planSlots: [slot('2026-04-19T20:00:00Z', '2026-04-19T20:30:00Z', 'charge', 80)],
      currentAction: { action: 'charge', source: 'plan', reason: 'plan', detail: 'plan' },
      currentSoc: 60,
    });

    expect(bullets.find((b) => b.key === 'next-charge')).toBeUndefined();
  });

  it('falls back gracefully when no data is available', () => {
    const bullets = buildPlanSummary({
      now,
      rates: [],
      planSlots: [],
      currentAction: null,
      currentSoc: null,
    });
    expect(bullets).toEqual([]);
  });

  it('reports end-of-plan SOC from the last future slot', () => {
    const planSlots: PlanSlotRow[] = [
      slot('2026-04-19T20:00:00Z', '2026-04-19T20:30:00Z', 'charge', 70),
      slot('2026-04-19T20:30:00Z', '2026-04-19T21:00:00Z', 'charge', 85),
    ];

    const bullets = buildPlanSummary({
      now,
      rates: [],
      planSlots,
      currentAction: null,
      currentSoc: 60,
    });

    const horizon = bullets.find((b) => b.key === 'horizon-soc');
    expect(horizon?.text).toMatch(/ending at 85% SOC/);
  });
});
