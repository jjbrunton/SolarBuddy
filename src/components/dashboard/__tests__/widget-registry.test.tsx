import { describe, expect, it } from 'vitest';
import { DASHBOARD_WIDGETS } from '../widget-registry';

describe('dashboard widget registry', () => {
  it('keeps the overview focused on non-overlapping widgets', () => {
    const ids = DASHBOARD_WIDGETS.map((widget) => widget.id);

    expect(ids).toEqual([
      'live-gauges',
      'energy-flow',
      'current-rate',
      'rate-chart',
      'upcoming-charges',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
