import { describe, expect, it } from 'vitest';
import { ACTION_COLORS } from '../plan-actions';

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function colorDistance(first: string, second: string) {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  return Math.sqrt(
    ((a.r - b.r) ** 2) +
    ((a.g - b.g) ** 2) +
    ((a.b - b.b) ** 2),
  );
}

describe('ACTION_COLORS', () => {
  it('keeps hold visually separate from charge in the shared action palette', () => {
    expect(colorDistance(ACTION_COLORS.charge, ACTION_COLORS.hold)).toBeGreaterThan(150);
  });
});
