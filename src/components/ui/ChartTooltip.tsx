import type { ReactNode } from 'react';

export function ChartTooltip({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      {label && <p className="mb-1 text-xs text-sb-text-muted">{label}</p>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function ChartTooltipRow({
  label,
  value,
  colorClassName,
  color,
  emphasized = false,
}: {
  label: string;
  value: string;
  colorClassName?: string;
  color?: string;
  emphasized?: boolean;
}) {
  const className = emphasized ? 'text-sm font-semibold' : 'text-sm';

  return (
    <p className={`${className} ${colorClassName ?? 'text-sb-text'}`.trim()} style={color ? { color } : undefined}>
      {label}: {value}
    </p>
  );
}
