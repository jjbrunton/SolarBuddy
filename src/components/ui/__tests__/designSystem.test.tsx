import { describe, expect, it } from 'vitest';
import { Button } from '../Button';
import { PageHeader } from '../PageHeader';

describe('design system primitives', () => {
  it('applies the requested button variant and size classes', () => {
    const button = Button({ variant: 'secondary', size: 'sm', children: 'Run now' });

    // Secondary is now a hairline-outline affordance — transparent
    // background with a rule border that lights up to ember on hover.
    expect(button.props.className).toContain('bg-transparent');
    expect(button.props.className).toContain('border-sb-rule-strong');
    expect(button.props.className).toContain('hover:border-sb-ember/60');
    expect(button.props.className).toContain('px-3');
    expect(button.props.type).toBe('button');
  });

  it('renders page header eyebrow, title, description, and actions', () => {
    const header = PageHeader({
      eyebrow: 'Analytics',
      title: 'Energy flow',
      description: 'Track import and export over time.',
      actions: 'Controls',
    });

    // The editorial header wraps its eyebrow/title/description stack and
    // its actions inside an outer flex row, so drill past that wrapper.
    const outer = Array.isArray(header.props.children) ? header.props.children : [header.props.children];
    const row = outer[0];
    const rowChildren = Array.isArray(row.props.children) ? row.props.children : [row.props.children];
    const [stack, actions] = rowChildren;
    const stackChildren = Array.isArray(stack.props.children) ? stack.props.children : [stack.props.children];

    // [eyebrow, title, description]
    expect(stackChildren[0].props.children).toBe('Analytics');
    expect(stackChildren[0].props.className).toContain('sb-eyebrow');
    expect(stackChildren[1].props.children).toBe('Energy flow');
    expect(stackChildren[1].props.className).toContain('sb-display');
    expect(stackChildren[2].props.children).toBe('Track import and export over time.');
    expect(actions.props.children).toBe('Controls');
  });
});
