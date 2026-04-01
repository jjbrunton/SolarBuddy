interface ProgressBarProps {
  value: number;
  max?: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function getColor(pct: number) {
  if (pct >= 90) return 'bg-sb-danger';
  if (pct >= 75) return 'bg-sb-warning';
  if (pct >= 45) return 'bg-sb-success';
  if (pct >= 20) return 'bg-sb-accent';
  return 'bg-sb-grid';
}

const sizeClasses = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

export function ProgressBar({
  value,
  max = 100,
  showLabel = false,
  size = 'md',
  className = '',
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className={`flex-1 overflow-hidden rounded-full bg-sb-surface-muted ${sizeClasses[size]}`}>
        <div
          className={`${sizeClasses[size]} rounded-full transition-all duration-500 ${getColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel ? (
        <span className="min-w-[3ch] text-right text-xs font-semibold text-sb-text-muted">
          {Math.round(pct)}%
        </span>
      ) : null}
    </div>
  );
}
