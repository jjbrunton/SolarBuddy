import { describe, expect, it } from 'vitest';
import { DASHBOARD_WIDGETS } from '../widget-registry';

describe('dashboard widget registry', () => {
  it('keeps the default view focused on five non-overlapping widgets', () => {
    const defaultVisible = DASHBOARD_WIDGETS
      .filter((w) => w.defaultVisible !== false)
      .map((w) => w.id);

    expect(defaultVisible).toEqual([
      'live-gauges',
      'current-rate',
      'energy-flow',
      'upcoming-charges',
      'rate-chart',
    ]);
  });

  it('registers every widget with a unique id', () => {
    const ids = DASHBOARD_WIDGETS.map((widget) => widget.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps legacy widgets available but hidden by default', () => {
    const hidden = DASHBOARD_WIDGETS
      .filter((w) => w.defaultVisible === false)
      .map((w) => w.id);

    expect(hidden).toEqual(expect.arrayContaining([
      'current-mode',
      'bill-estimate',
      'solar-forecast',
    ]));
  });
});
