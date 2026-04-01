'use client';

import type { LucideIcon } from 'lucide-react';
import { Card } from './Card';
import { PlaceholderValue } from './PlaceholderValue';

interface MetricCardProps {
  label: string;
  value: number | string | null;
  unit?: string;
  Icon?: LucideIcon;
  accent?: string;
  subtitle?: string;
  format?: (v: number) => string;
}

export function MetricCard({
  label,
  value,
  unit = '',
  Icon,
  accent = 'text-sb-accent',
  subtitle,
  format,
}: MetricCardProps) {
  let displayValue: string | null = null;
  if (value !== null && value !== undefined) {
    if (typeof value === 'number') {
      displayValue = format ? format(value) : `${Math.round(value * 10) / 10}`;
    } else {
      displayValue = value;
    }
  }

  return (
    <Card tone="subtle" className="h-full transition-colors duration-200 hover:bg-sb-card-hover/70">
      <div className="flex items-center gap-2 text-sm text-sb-text-muted">
        {Icon ? <Icon size={16} className={accent} /> : null}
        <span>{label}</span>
      </div>
      {displayValue === null ? (
        <div className="mt-3">
          <PlaceholderValue />
        </div>
      ) : (
        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tracking-[-0.03em] text-sb-text transition-opacity duration-300">
            {displayValue}
          </span>
          {unit ? <span className="text-sm font-medium text-sb-text-muted">{unit}</span> : null}
        </div>
      )}
      {subtitle ? <p className="mt-2 text-xs leading-5 text-sb-text-muted">{subtitle}</p> : null}
    </Card>
  );
}
