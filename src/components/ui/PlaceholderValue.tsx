import type { ReactNode } from 'react';

interface PlaceholderValueProps {
  label?: string;
  tone?: 'pill' | 'text';
  className?: string;
}

const MISSING_TOKENS = new Set(['', '--', '\u2014']);

export function isPlaceholderValue(value: ReactNode) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value !== 'string') {
    return false;
  }

  return MISSING_TOKENS.has(value.trim());
}

export function PlaceholderValue({
  label = 'Awaiting data',
  tone = 'pill',
  className = '',
}: PlaceholderValueProps) {
  const toneClassName =
    tone === 'pill'
      ? 'inline-flex items-center border border-sb-border bg-sb-surface-muted px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-sb-text-subtle'
      : 'text-[0.78rem] font-medium text-sb-text-muted';

  return <span className={`${toneClassName} ${className}`.trim()}>{label}</span>;
}
