'use client';

import type { LucideIcon } from 'lucide-react';
import { PlaceholderValue } from './PlaceholderValue';

type FigureTone = 'default' | 'ember' | 'frost' | 'success' | 'danger' | 'ink';
type FigureSize = 'sm' | 'md' | 'lg';

const toneClasses: Record<FigureTone, string> = {
  default: 'text-sb-text',
  ember: 'text-sb-ember',
  frost: 'text-sb-frost',
  success: 'text-sb-success',
  danger: 'text-sb-danger',
  ink: 'text-sb-ink',
};

const sizeClasses: Record<FigureSize, string> = {
  sm: 'text-[1.75rem] sm:text-[2rem] leading-[0.95]',
  md: 'text-[2.5rem] sm:text-[3rem] leading-[0.92]',
  lg: 'text-[3.5rem] sm:text-[4.5rem] leading-[0.9]',
};

interface FigureProps {
  label: string;
  value: number | string | null;
  unit?: string;
  tone?: FigureTone;
  size?: FigureSize;
  Icon?: LucideIcon;
  caption?: string;
  format?: (v: number) => string;
  trailing?: React.ReactNode;
  className?: string;
}

/*
 * Figure — monospace hero numeric for data-dense terminal displays.
 *
 * Structure: uppercase eyebrow label, large monospace number with
 * optional unit, a structural rule, then a one-line caption.
 * Values refresh via `animate-value-pop` on key change.
 */
export function Figure({
  label,
  value,
  unit,
  tone = 'default',
  size = 'md',
  Icon,
  caption,
  format,
  trailing,
  className = '',
}: FigureProps) {
  let displayValue: string | null = null;
  if (value !== null && value !== undefined) {
    if (typeof value === 'number') {
      displayValue = format ? format(value) : `${Math.round(value * 10) / 10}`;
    } else {
      displayValue = value;
    }
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        {Icon ? <Icon size={12} strokeWidth={1.5} className="text-sb-text-subtle" /> : null}
        <span className="sb-eyebrow">{label}</span>
      </div>

      {displayValue === null ? (
        <div className="py-2">
          <PlaceholderValue />
        </div>
      ) : (
        <div className="animate-value-pop" key={displayValue}>
          <div className={`sb-display flex items-baseline gap-2 ${toneClasses[tone]} ${sizeClasses[size]}`}>
            <span>{displayValue}</span>
            {unit ? (
              <span className="text-[0.35em] font-medium tracking-[0.1em] text-sb-text-muted uppercase">
                {unit}
              </span>
            ) : null}
            {trailing}
          </div>
        </div>
      )}

      <div className="sb-rule" />

      {caption ? (
        <p className="text-[0.7rem] leading-5 text-sb-text-muted">{caption}</p>
      ) : null}
    </div>
  );
}
