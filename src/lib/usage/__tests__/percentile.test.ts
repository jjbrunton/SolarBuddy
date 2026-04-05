import { describe, expect, it } from 'vitest';
import { percentileSorted } from '../percentile';

describe('percentileSorted', () => {
  it('returns 0 for an empty array', () => {
    expect(percentileSorted([], 50)).toBe(0);
  });

  it('returns the only element for a single-element array regardless of p', () => {
    expect(percentileSorted([42], 0)).toBe(42);
    expect(percentileSorted([42], 50)).toBe(42);
    expect(percentileSorted([42], 100)).toBe(42);
  });

  it('returns the median of [1,2,3,4,5] as 3', () => {
    expect(percentileSorted([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('matches linear-interpolated p25 and p75 for [1,2,3,4,5]', () => {
    // rank = 0.25 * 4 = 1.0 → exact index 1 → 2
    expect(percentileSorted([1, 2, 3, 4, 5], 25)).toBe(2);
    // rank = 0.75 * 4 = 3.0 → exact index 3 → 4
    expect(percentileSorted([1, 2, 3, 4, 5], 75)).toBe(4);
  });

  it('interpolates between two neighbouring values', () => {
    // [0, 10]: rank at p50 = 0.5 * 1 = 0.5 → 0 + (10-0)*0.5 = 5
    expect(percentileSorted([0, 10], 50)).toBe(5);
    // p25 = 0.25 * 1 = 0.25 → 0 + 10*0.25 = 2.5
    expect(percentileSorted([0, 10], 25)).toBe(2.5);
  });

  it('returns min and max at p=0 and p=100', () => {
    const data = [100, 200, 300, 400, 500];
    expect(percentileSorted(data, 0)).toBe(100);
    expect(percentileSorted(data, 100)).toBe(500);
  });

  it('clamps p values outside 0..100', () => {
    expect(percentileSorted([1, 2, 3], -50)).toBe(1);
    expect(percentileSorted([1, 2, 3], 150)).toBe(3);
  });

  it('p10 of a wide sequence reflects the bottom tail', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    // rank = 0.10 * 99 = 9.9 → between index 9 (value 10) and 10 (value 11)
    // → 10 + (11-10)*0.9 = 10.9
    expect(percentileSorted(data, 10)).toBeCloseTo(10.9, 5);
  });
});
