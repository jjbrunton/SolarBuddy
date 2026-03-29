interface DescriptionListProps {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}

export function DescriptionList({ items, className = '' }: DescriptionListProps) {
  return (
    <dl className={`space-y-3 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-sm text-sb-text-muted">{item.label}</dt>
          <dd className="text-sm font-medium text-sb-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
