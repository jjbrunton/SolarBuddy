'use client';

import { Thermometer } from 'lucide-react';

interface TemperatureIndicatorProps {
  label: string;
  value: number | null;
  warnAt?: number;
  dangerAt?: number;
  min?: number;
  max?: number;
}

export function TemperatureIndicator({
  label,
  value,
  warnAt = 45,
  dangerAt = 55,
  min = 0,
  max = 70,
}: TemperatureIndicatorProps) {
  const color =
    value === null
      ? 'text-sb-text-muted'
      : value >= dangerAt
        ? 'text-sb-danger'
        : value >= warnAt
          ? 'text-sb-warning'
          : 'text-sb-success';

  const bgColor =
    value === null
      ? 'bg-sb-border'
      : value >= dangerAt
        ? 'bg-sb-danger'
        : value >= warnAt
          ? 'bg-sb-warning'
          : 'bg-sb-success';

  const pct = value !== null ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;

  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-4 transition-colors hover:bg-sb-card-hover">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Thermometer size={18} className={color} />
          <span className="text-sm text-sb-text-muted">{label}</span>
        </div>
        <span className={`text-2xl font-bold ${color}`}>
          {value !== null ? `${value}°C` : '\u2014'}
        </span>
      </div>

      {/* Temperature bar */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sb-border">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${bgColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Scale labels */}
      <div className="mt-1 flex justify-between text-[10px] text-sb-text-muted">
        <span>{min}°</span>
        <span className="text-sb-warning">{warnAt}°</span>
        <span className="text-sb-danger">{dangerAt}°</span>
        <span>{max}°</span>
      </div>
    </div>
  );
}
