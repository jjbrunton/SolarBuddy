import { describe, expect, it } from 'vitest';
import { getAnimatedGaugeLayout } from '../animatedGaugeLayout';

describe('getAnimatedGaugeLayout', () => {
  it('allocates enough SVG height for the unit label below the gauge arc', () => {
    const layout = getAnimatedGaugeLayout({
      width: 140,
      strokeWidth: 8,
      fontSize: 22,
      labelSize: 11,
    });

    expect(layout.unitY).toBeGreaterThan(78);
    expect(layout.svgHeight).toBeGreaterThan(layout.unitY + 11);
  });

  it('preserves the half-circle arc geometry', () => {
    const layout = getAnimatedGaugeLayout({
      width: 180,
      strokeWidth: 10,
      fontSize: 28,
      labelSize: 13,
    });

    expect(layout.radius).toBe(85);
    expect(layout.center).toBe(90);
    expect(layout.circumference).toBeCloseTo(Math.PI * 85);
  });
});
