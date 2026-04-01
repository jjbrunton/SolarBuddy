import { PlaceholderValue, isPlaceholderValue } from './PlaceholderValue';

interface DescriptionListProps {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}

export function DescriptionList({ items, className = '' }: DescriptionListProps) {
  return (
    <dl className={`grid gap-3 ${className}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className="grid gap-1 rounded-2xl border border-sb-border/80 bg-sb-surface-muted/70 px-4 py-3 sm:grid-cols-[minmax(0,180px)_1fr] sm:items-center sm:gap-4"
        >
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">{item.label}</dt>
          <dd className="min-w-0 text-sm font-medium text-sb-text">
            {isPlaceholderValue(item.value) ? <PlaceholderValue /> : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
