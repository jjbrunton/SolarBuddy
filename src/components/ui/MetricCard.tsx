'use client';

import type { LucideIcon } from 'lucide-react';
import { Card } from './Card';
import { Figure } from './Figure';

interface MetricCardProps {
  label: string;
  value: number | string | null;
  unit?: string;
  Icon?: LucideIcon;
  /**
   * Deprecated. The Figure primitive resolves its own tone based on the
   * semantic `tone` prop. Retained so existing call sites still type-check.
   */
  accent?: string;
  subtitle?: string;
  format?: (v: number) => string;
}

/*
 * MetricCard — thin wrapper around Figure that keeps the older
 * `accent`-string API alive. New code should reach for `Figure`
 * directly and place it inside a `Card` only when a boxed surface
 * is actually useful.
 */
export function MetricCard({
  label,
  value,
  unit,
  Icon,
  subtitle,
  format,
}: MetricCardProps) {
  return (
    <Card tone="subtle" className="h-full">
      <Figure
        label={label}
        value={value}
        unit={unit}
        Icon={Icon}
        caption={subtitle}
        format={format}
        size="sm"
      />
    </Card>
  );
}
