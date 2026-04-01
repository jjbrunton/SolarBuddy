'use client';

import { getAnimatedGaugeLayout } from './animatedGaugeLayout';

interface Threshold {
  value: number;
  color: string;
}

interface AnimatedGaugeProps {
  value: number | null;
  min: number;
  max: number;
  unit: string;
  label: string;
  thresholds: Threshold[];
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { width: 100, strokeWidth: 6, fontSize: 16, labelSize: 9 },
  md: { width: 140, strokeWidth: 8, fontSize: 22, labelSize: 11 },
  lg: { width: 180, strokeWidth: 10, fontSize: 28, labelSize: 13 },
};

export function AnimatedGauge({
  value,
  min,
  max,
  unit,
  label,
  thresholds,
  size = 'md',
}: AnimatedGaugeProps) {
  const cfg = SIZES[size];
  const { radius, circumference, center, svgHeight, unitY, valueY } = getAnimatedGaugeLayout(cfg);

  const pct = value !== null ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const offset = circumference - pct * circumference;

  // Determine color from thresholds (last threshold whose value is <= current value)
  let color = thresholds[0]?.color ?? '#5d9cec';
  if (value !== null) {
    for (const t of thresholds) {
      if (value >= t.value) color = t.color;
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={cfg.width}
        height={svgHeight}
        viewBox={`0 0 ${cfg.width} ${svgHeight}`}
      >
        {/* Background arc */}
        <path
          d={`M ${cfg.strokeWidth / 2} ${center} A ${radius} ${radius} 0 0 1 ${cfg.width - cfg.strokeWidth / 2} ${center}`}
          fill="none"
          stroke="var(--color-sb-border)"
          strokeWidth={cfg.strokeWidth}
          strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          d={`M ${cfg.strokeWidth / 2} ${center} A ${radius} ${radius} 0 0 1 ${cfg.width - cfg.strokeWidth / 2} ${center}`}
          fill="none"
          stroke={value !== null ? color : 'var(--color-sb-border)'}
          strokeWidth={cfg.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
        {/* Value text */}
        <text
          x={center}
          y={valueY}
          textAnchor="middle"
          fill="var(--color-sb-text)"
          fontSize={cfg.fontSize}
          fontWeight="bold"
        >
          {value !== null ? `${Math.round(value * 10) / 10}` : '\u2014'}
        </text>
        <text
          x={center}
          y={unitY}
          textAnchor="middle"
          fill="var(--color-sb-text-muted)"
          fontSize={cfg.labelSize}
        >
          {unit}
        </text>
      </svg>
      <span className="text-xs text-sb-text-muted">{label}</span>
    </div>
  );
}
