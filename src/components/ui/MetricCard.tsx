'use client';

import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: number | string | null;
  unit?: string;
  Icon?: LucideIcon;
  accent?: string;
  subtitle?: string;
  format?: (v: number) => string;
}

export function MetricCard({ label, value, unit = '', Icon, accent = 'text-sb-accent', subtitle, format }: MetricCardProps) {
  let displayValue = '\u2014';
  if (value !== null && value !== undefined) {
    if (typeof value === 'number') {
      displayValue = format ? format(value) : `${Math.round(value * 10) / 10}`;
    } else {
      displayValue = value;
    }
  }

  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-4 transition-colors hover:bg-sb-card-hover">
      <div className="flex items-center gap-2 text-sm text-sb-text-muted">
        {Icon && <Icon size={16} className={accent} />}
        <span>{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-sb-text transition-opacity duration-300">
          {displayValue}
        </span>
        {value !== null && unit && (
          <span className="text-sm text-sb-text-muted">{unit}</span>
        )}
      </div>
      {subtitle && (
        <p className="mt-1 text-xs text-sb-text-muted">{subtitle}</p>
      )}
    </div>
  );
}
