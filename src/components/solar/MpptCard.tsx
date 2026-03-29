'use client';

import { Sun } from 'lucide-react';

interface MpptCardProps {
  stringNumber: 1 | 2;
  voltage: number | null;
  current: number | null;
  power: number | null;
  maxPower?: number;
}

export function MpptCard({ stringNumber, voltage, current, power, maxPower = 3000 }: MpptCardProps) {
  const pct = power != null ? Math.min(100, (power / maxPower) * 100) : 0;
  const hasData = voltage != null || current != null || power != null;

  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-5 transition-colors hover:bg-sb-card-hover">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-400/10">
            <Sun size={16} className="text-yellow-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-sb-text">MPPT {stringNumber}</h3>
            <p className="text-xs text-sb-text-muted">String {stringNumber}</p>
          </div>
        </div>
        {power != null && (
          <span className="text-xl font-bold text-yellow-400">{power}W</span>
        )}
      </div>

      {/* Power bar */}
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-sb-border">
        <div
          className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-orange-400 transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Metrics grid */}
      {hasData ? (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-sb-text-muted">Voltage</p>
            <p className="text-sm font-semibold text-sb-text">
              {voltage != null ? `${voltage}V` : '\u2014'}
            </p>
          </div>
          <div>
            <p className="text-xs text-sb-text-muted">Current</p>
            <p className="text-sm font-semibold text-sb-text">
              {current != null ? `${current}A` : '\u2014'}
            </p>
          </div>
          <div>
            <p className="text-xs text-sb-text-muted">Power</p>
            <p className="text-sm font-semibold text-sb-text">
              {power != null ? `${power}W` : '\u2014'}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-center text-xs text-sb-text-muted">No data from this string</p>
      )}
    </div>
  );
}
