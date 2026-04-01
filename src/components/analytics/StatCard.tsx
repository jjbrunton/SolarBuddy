import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { PlaceholderValue, isPlaceholderValue } from '@/components/ui/PlaceholderValue';

export function StatCard({
  label,
  value,
  subtext,
  valueColor,
}: {
  label: string;
  value: ReactNode;
  subtext?: string;
  valueColor?: string;
}) {
  const shouldShowPlaceholder = isPlaceholderValue(value);

  return (
    <Card tone="subtle" className="h-full">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">{label}</p>
      {shouldShowPlaceholder ? (
        <div className="mt-3">
          <PlaceholderValue />
        </div>
      ) : (
        <p className={`mt-3 text-[1.65rem] font-semibold tracking-[-0.03em] ${valueColor || 'text-sb-text'}`}>
          {value}
        </p>
      )}
      {subtext ? <p className="mt-2 text-xs leading-5 text-sb-text-muted">{subtext}</p> : null}
    </Card>
  );
}
