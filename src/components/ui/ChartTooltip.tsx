import type { ReactNode } from 'react';

/*
 * Editorial chart tooltip — hairline frame, small-caps label, quiet
 * backdrop blur. Paired with `ChartTooltipRow` for diagnostic rows
 * rendered in the mono face.
 */
export function ChartTooltip({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[0.5rem] border border-sb-rule-strong bg-sb-card/95 px-4 py-3 backdrop-blur-sm">
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
    ? 'font-[family-name:var(--font-sb-mono)] text-sm font-semibold'
    : 'font-[family-name:var(--font-sb-mono)] text-[0.78rem]';

  return (
    <p
      className={`${className} ${colorClassName ?? 'text-sb-text'}`.trim()}
      style={color ? { color } : undefined}
    >
      {label}: {value}
    </p>
  );
}
