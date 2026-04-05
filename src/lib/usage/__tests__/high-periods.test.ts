import { describe, expect, it } from 'vitest';
import { detectHighPeriods } from '../compute';
import type { UsageBucket } from '../types';

function bucket(slotIndex: number, medianW: number, sampleCount = 20): UsageBucket {
  return {
    day_type: 'weekday',
    slot_index: slotIndex,
    median_w: medianW,
    p25_w: medianW * 0.9,
    p75_w: medianW * 1.1,
    mean_w: medianW,
    sample_count: sampleCount,
    updated_at: '2026-04-05T03:17:00Z',
  };
}

describe('detectHighPeriods', () => {
  const baseload = 300;
  const multiplier = 1.5; // threshold = 450

  it('returns an empty array when baseload is zero', () => {
    const buckets = Array.from({ length: 48 }, (_, i) => bucket(i, 1000));
    expect(detectHighPeriods(buckets, 0, multiplier, 2)).toEqual([]);
  });

  it('detects a single high run that meets min length', () => {
    const buckets: UsageBucket[] = [];
    for (let i = 0; i < 48; i++) buckets.push(bucket(i, 200));
    // Slots 34..37 above threshold (e.g. 1200W)
    for (let i = 34; i <= 37; i++) buckets[i] = bucket(i, 1200);

    const periods = detectHighPeriods(buckets, baseload, multiplier, 2);
    expect(periods).toHaveLength(1);
    expect(periods[0].start_slot).toBe(34);
    expect(periods[0].end_slot).toBe(37);
    expect(periods[0].median_w).toBeCloseTo(1200);
    expect(periods[0].start_local).toBe('17:00');
    expect(periods[0].end_local).toBe('19:00');
  });

  it('excludes runs shorter than min length', () => {
    const buckets: UsageBucket[] = [];
    for (let i = 0; i < 48; i++) buckets.push(bucket(i, 200));
    buckets[20] = bucket(20, 800); // single slot, below min length 2

    const periods = detectHighPeriods(buckets, baseload, multiplier, 2);
    expect(periods).toEqual([]);
  });

  it('detects exactly-min-length runs', () => {
    const buckets: UsageBucket[] = [];
    for (let i = 0; i < 48; i++) buckets.push(bucket(i, 200));
    buckets[20] = bucket(20, 800);
    buckets[21] = bucket(21, 800);

    const periods = detectHighPeriods(buckets, baseload, multiplier, 2);
    expect(periods).toHaveLength(1);
    expect(periods[0].start_slot).toBe(20);
    expect(periods[0].end_slot).toBe(21);
  });

  it('returns multiple non-adjacent runs', () => {
    const buckets: UsageBucket[] = [];
    for (let i = 0; i < 48; i++) buckets.push(bucket(i, 200));
    // Morning peak 14-17 (07:00-08:30)
    for (let i = 14; i <= 17; i++) buckets[i] = bucket(i, 900);
    // Evening peak 34-37 (17:00-18:30)
    for (let i = 34; i <= 37; i++) buckets[i] = bucket(i, 1200);

    const periods = detectHighPeriods(buckets, baseload, multiplier, 2);
    expect(periods).toHaveLength(2);
    expect(periods[0].start_slot).toBe(14);
    expect(periods[0].end_slot).toBe(17);
    expect(periods[1].start_slot).toBe(34);
    expect(periods[1].end_slot).toBe(37);
  });

  it('ignores buckets with zero sample count even when median exceeds threshold', () => {
    const buckets: UsageBucket[] = [];
    for (let i = 0; i < 48; i++) buckets.push(bucket(i, 200));
    // Stale bucket: high median but no samples — must be ignored.
    buckets[10] = { ...bucket(10, 2000, 0) };
    buckets[11] = { ...bucket(11, 2000, 0) };

    const periods = detectHighPeriods(buckets, baseload, multiplier, 2);
    expect(periods).toEqual([]);
  });
});
