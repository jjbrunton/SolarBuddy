import { describe, expect, it } from 'vitest';
import { ChartTooltip, ChartTooltipRow } from '../ChartTooltip';

describe('ChartTooltip', () => {
  it('renders the shared themed wrapper and row content', () => {
    const emphasizedRow = ChartTooltipRow({ label: 'Solar', value: '1200W', emphasized: true });
    const coloredRow = ChartTooltipRow({ label: 'Grid', value: '-150W', color: '#5d9cec' });
    const tooltip = ChartTooltip({
      label: '12:00',
      children: [emphasizedRow, coloredRow],
    });

    expect(tooltip.props.className).toContain('border-sb-border-strong');
    expect(tooltip.props.className).toContain('bg-sb-card/95');

    const tooltipChildren = Array.isArray(tooltip.props.children) ? tooltip.props.children : [tooltip.props.children];
    expect(tooltipChildren[0].props.children).toBe('12:00');
    expect(tooltipChildren[0].props.className).toContain('sb-eyebrow');

    expect(emphasizedRow.props.className).toContain('font-semibold');
    expect(emphasizedRow.props.children).toEqual(['Solar', ': ', '1200W']);

    expect(coloredRow.props.style).toEqual({ color: '#5d9cec' });
    expect(coloredRow.props.children).toEqual(['Grid', ': ', '-150W']);
  });
});
