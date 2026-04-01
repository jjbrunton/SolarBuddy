'use client';

import { PlaceholderValue } from './PlaceholderValue';

interface StatusIndicatorProps {
  label: string;
  value: string | null;
  colorMap?: Record<string, string>;
  size?: 'sm' | 'md';
}

const DEFAULT_COLOR_MAP: Record<string, string> = {
  'Battery': 'bg-sb-success',
  'Grid tie': 'bg-sb-accent',
  'Grid': 'bg-sb-accent',
  'Fault': 'bg-sb-danger',
  'Off': 'bg-sb-text-muted',
  'Line': 'bg-sb-accent',
  'Standby': 'bg-sb-warning',
};

export function StatusIndicator({ label, value, colorMap, size = 'md' }: StatusIndicatorProps) {
  const map = colorMap ?? DEFAULT_COLOR_MAP;
  const hasValue = value !== null && value.trim().length > 0;
  const dotColor = hasValue ? (map[value] ?? 'bg-sb-accent') : 'bg-sb-text-muted';
  const isActive = hasValue && value !== 'Off' && value !== 'Standby';

  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex h-2.5 w-2.5">
        {isActive && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${dotColor}`} />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotColor}`} />
      </span>
      <div className={size === 'sm' ? '' : ''}>
        <span className="text-xs text-sb-text-muted">{label}</span>
        <p className={`font-semibold text-sb-text ${size === 'sm' ? 'text-sm' : 'text-base'}`}>
          {hasValue ? value : <PlaceholderValue tone="text" />}
        </p>
      </div>
    </div>
  );
}
