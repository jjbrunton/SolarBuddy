import { describe, expect, it } from 'vitest';
import { Button } from '../Button';
import { PageHeader } from '../PageHeader';

describe('design system primitives', () => {
  it('applies the requested button variant and size classes', () => {
    const button = Button({ variant: 'secondary', size: 'sm', children: 'Run now' });

    expect(button.props.className).toContain('bg-sb-card');
    expect(button.props.className).toContain('px-3');
    expect(button.props.type).toBe('button');
  });

  it('renders page header title, description, and actions', () => {
    const header = PageHeader({
      eyebrow: 'Analytics',
      title: 'Energy flow',
      description: 'Track import and export over time.',
      actions: 'Controls',
    });

    const children = Array.isArray(header.props.children) ? header.props.children : [header.props.children];
    expect(children[0].props.children[0].props.children).toBe('Analytics');
    expect(children[0].props.children[1].props.children).toBe('Energy flow');
    expect(children[0].props.children[2].props.children).toBe('Track import and export over time.');
    expect(children[1].props.children).toBe('Controls');
  });
});
