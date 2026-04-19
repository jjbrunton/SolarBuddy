import { describe, expect, it } from 'vitest';
import { classifyCurrentRate, summarizeCurrentRate } from '../current-rate-summary';

describe('classifyCurrentRate', () => {
  it('marks negative prices as negative', () => {
    expect(classifyCurrentRate(-1.2, -1.2, 18.4)).toBe('negative');
  });

  it('marks the lowest price as best', () => {
    expect(classifyCurrentRate(5.4, 5.4, 18.4)).toBe('best');
  });

  it('marks rates near the top of the spread as expensive', () => {
    expect(classifyCurrentRate(17, 5, 18)).toBe('expensive');
  });

  it('marks mid-range rates as average when the spread is narrow', () => {
    expect(classifyCurrentRate(10.2, 10, 10.4)).toBe('average');
  });
});

describe('summarizeCurrentRate', () => {
  const rates = [
    {
      valid_from: '2026-03-30T10:00:00.000Z',
      valid_to: '2026-03-30T10:30:00.000Z',
      price_inc_vat: 9.123,
    },
    {
      valid_from: '2026-03-30T10:30:00.000Z',
      valid_to: '2026-03-30T11:00:00.000Z',
      price_inc_vat: 6.2,
    },
    {
      valid_from: '2026-03-30T11:00:00.000Z',
      valid_to: '2026-03-30T11:30:00.000Z',
      price_inc_vat: 14.987,
    },
  ];

  it('returns the current slot, next slot, and upcoming-window aggregates', () => {
    const summary = summarizeCurrentRate(rates, new Date('2026-03-30T10:40:00.000Z'));

    expect(summary).toEqual({
      current: {
        valid_from: '2026-03-30T10:30:00.000Z',
        valid_to: '2026-03-30T11:00:00.000Z',
        price_inc_vat: 6.2,
      },
      next: {
        valid_from: '2026-03-30T11:00:00.000Z',
        valid_to: '2026-03-30T11:30:00.000Z',
        price_inc_vat: 14.99,
      },
      minPrice: 6.2,
      maxPrice: 14.99,
      averagePrice: 10.6,
      minWindow: {
        valid_from: '2026-03-30T10:30:00.000Z',
        valid_to: '2026-03-30T11:00:00.000Z',
      },
      maxWindow: {
        valid_from: '2026-03-30T11:00:00.000Z',
        valid_to: '2026-03-30T11:30:00.000Z',
      },
      status: 'best',
    });
  });

  it('ignores elapsed slots when computing the best/min price', () => {
    const ratesWithCheaperPast = [
      {
        valid_from: '2026-03-30T09:00:00.000Z',
        valid_to: '2026-03-30T09:30:00.000Z',
        price_inc_vat: 1.0,
      },
      ...rates,
    ];
    const summary = summarizeCurrentRate(ratesWithCheaperPast, new Date('2026-03-30T10:40:00.000Z'));

    expect(summary?.minPrice).toBe(6.2);
    expect(summary?.status).toBe('best');
  });

  it('returns null when there is no active rate for the current time', () => {
    expect(summarizeCurrentRate(rates, new Date('2026-03-30T09:55:00.000Z'))).toBeNull();
  });
});
