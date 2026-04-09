import type { ReactNode } from 'react';

/*
 * Terminal chart tooltip — sharp corners, structural border,
 * monospace values for precise data reading.
 */
export function ChartTooltip({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-sb-border-strong bg-sb-card/95 px-4 py-3 backdrop-blur-sm">
      {label && <p className="sb-eyebrow mb-2">{label}</p>}
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
  const className = emphasized
    ? 'text-[0.78rem] font-semibold'
    : 'text-[0.72rem]';

  return (
    <p
      className={`${className} ${colorClassName ?? 'text-sb-text'}`.trim()}
      style={color ? { color } : undefined}
    >
      {label}: {value}
    </p>
  );
}
