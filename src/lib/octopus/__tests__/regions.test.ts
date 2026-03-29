import { describe, it, expect } from 'vitest';
import { REGION_NAMES } from '../regions';

describe('REGION_NAMES', () => {
  it('contains all 14 UK distribution regions', () => {
    expect(Object.keys(REGION_NAMES)).toHaveLength(14);
  });

  it('maps single-letter codes to region names', () => {
    expect(REGION_NAMES['A']).toBe('Eastern England');
    expect(REGION_NAMES['C']).toBe('London');
    expect(REGION_NAMES['H']).toBe('Southern England');
    expect(REGION_NAMES['P']).toBe('Northern Scotland');
  });

  it('does not include region I (skipped in UK grid)', () => {
    expect(REGION_NAMES['I']).toBeUndefined();
  });

  it('all values are non-empty strings', () => {
    for (const [code, name] of Object.entries(REGION_NAMES)) {
      expect(code).toMatch(/^[A-P]$/);
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
