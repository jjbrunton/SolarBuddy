import { describe, expect, it } from 'vitest';
import { StatCard } from '@/components/analytics/StatCard';
import { DescriptionList } from '../DescriptionList';
import { PlaceholderValue, isPlaceholderValue } from '../PlaceholderValue';

describe('placeholder values', () => {
  it('treats blank and dash values as missing', () => {
    expect(isPlaceholderValue(null)).toBe(true);
    expect(isPlaceholderValue(undefined)).toBe(true);
    expect(isPlaceholderValue('')).toBe(true);
    expect(isPlaceholderValue('  ')).toBe(true);
    expect(isPlaceholderValue('--')).toBe(true);
    expect(isPlaceholderValue('\u2014')).toBe(true);
    expect(isPlaceholderValue('Live')).toBe(false);
  });

  it('uses the shared placeholder for missing description-list values', () => {
    const list = DescriptionList({
      items: [{ label: 'MQTT Broker', value: '--' }],
    });

    const rows = Array.isArray(list.props.children) ? list.props.children : [list.props.children];
    const dd = rows[0].props.children[1];

    expect(dd.props.children.type).toBe(PlaceholderValue);
  });

  it('uses the shared placeholder for missing stat-card values', () => {
    const card = StatCard({
      label: 'Current rate',
      value: '--',
    });

    const children = Array.isArray(card.props.children) ? card.props.children : [card.props.children];
    expect(children[1].props.children.type).toBe(PlaceholderValue);
  });
});
