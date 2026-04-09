'use client';

import { useId } from 'react';
import { getAnimatedGaugeLayout } from './animatedGaugeLayout';

interface Threshold {
  value: number;
  color: string;
}

interface SunArcProps {
  value: number | null;
  min: number;
  max: number;
  unit: string;
  label: string;
  thresholds: Threshold[];
  size?: 'sm' | 'md' | 'lg';
  /** Optional target tick mark (e.g. target SOC). */
  target?: number | null;
}

const SIZES = {
  sm: { width: 112, strokeWidth: 4, fontSize: 22, labelSize: 9 },
  md: { width: 156, strokeWidth: 5, fontSize: 34, labelSize: 11 },
  lg: { width: 208, strokeWidth: 6, fontSize: 48, labelSize: 13 },
};

/*
 * SunArc — a 180° partial-arc gauge. The filled portion uses an
 * ember-deep → ember gradient stroke above a hairline background track.
 * A soft radial glow behind the active region adds depth.
 *
 * Exported as both `SunArc` (canonical) and `AnimatedGauge` (back-compat
 * for the test suite and any existing consumer).
 */
export function SunArc({
  value,
  min,
  max,
  unit,
  label,
  thresholds,
  size = 'md',
  target = null,
}: SunArcProps) {
  const cfg = SIZES[size];
  const { radius, circumference, center, svgHeight, unitY, valueY } = getAnimatedGaugeLayout(cfg);
  const gradientId = useId();
  const glowId = useId();

  const pct = value !== null ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const offset = circumference - pct * circumference;

  // Pick the strongest threshold whose value is below the current reading.
  let activeColor = thresholds[0]?.color ?? 'var(--color-sb-ember)';
  if (value !== null) {
    for (const t of thresholds) {
      if (value >= t.value) activeColor = t.color;
    }
  }

  // Target tick position along the arc.
  let targetX: number | null = null;
  let targetY: number | null = null;
  if (target !== null && target !== undefined) {
    const targetPct = Math.max(0, Math.min(1, (target - min) / (max - min)));
    const angle = Math.PI * (1 - targetPct);
    targetX = center + Math.cos(angle) * radius;
    targetY = center - Math.sin(angle) * radius;
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={cfg.width}
        height={svgHeight}
        viewBox={`0 0 ${cfg.width} ${svgHeight}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--color-sb-ember-deep)" />
            <stop offset="55%" stopColor="var(--color-sb-ember)" />
            <stop offset="100%" stopColor="var(--color-sb-ember-hover)" />
          </linearGradient>
          <radialGradient id={glowId} cx="50%" cy="90%" r="70%">
            <stop offset="0%" stopColor={activeColor} stopOpacity="0.22" />
            <stop offset="55%" stopColor={activeColor} stopOpacity="0.06" />
            <stop offset="100%" stopColor={activeColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft radial warmth behind the arc */}
        {value !== null ? (
          <circle cx={center} cy={center} r={radius * 0.95} fill={`url(#${glowId})`} />
        ) : null}

        {/* Background track */}
        <path
          d={`M ${cfg.strokeWidth / 2} ${center} A ${radius} ${radius} 0 0 1 ${cfg.width - cfg.strokeWidth / 2} ${center}`}
          fill="none"
          stroke="var(--color-sb-rule)"
          strokeWidth={cfg.strokeWidth}
          strokeLinecap="butt"
        />

        {/* Active arc */}
        <path
          d={`M ${cfg.strokeWidth / 2} ${center} A ${radius} ${radius} 0 0 1 ${cfg.width - cfg.strokeWidth / 2} ${center}`}
          fill="none"
          stroke={value !== null ? `url(#${gradientId})` : 'var(--color-sb-rule)'}
          strokeWidth={cfg.strokeWidth}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />

        {/* Target tick */}
        {targetX !== null && targetY !== null ? (
          <circle
            cx={targetX}
            cy={targetY}
            r={cfg.strokeWidth * 0.9}
            fill="var(--color-sb-parchment)"
            stroke="var(--color-sb-ember)"
            strokeWidth={1}
          />
        ) : null}

        {/* Value text — monospace display */}
        <text
          x={center}
          y={valueY}
          textAnchor="middle"
          fill="var(--color-sb-text)"
          fontFamily="var(--font-sb-mono), monospace"
          fontSize={cfg.fontSize}
          fontWeight="600"
          style={{ letterSpacing: '-0.02em' }}
        >
          {value !== null ? `${Math.round(value * 10) / 10}` : '\u2014'}
        </text>
        <text
          x={center}
          y={unitY}
          textAnchor="middle"
          fill="var(--color-sb-text-subtle)"
          fontFamily="var(--font-sb-mono), monospace"
          fontSize={cfg.labelSize}
          letterSpacing="0.18em"
          style={{ textTransform: 'uppercase' }}
        >
          {unit}
        </text>
      </svg>
      <span className="sb-eyebrow">{label}</span>
    </div>
  );
}

/**
 * @deprecated Use `SunArc` instead. This alias is kept so existing
 * imports of `AnimatedGauge` (and the layout test) keep working.
 */
export const AnimatedGauge = SunArc;
