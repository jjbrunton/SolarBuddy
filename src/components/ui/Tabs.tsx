import Link from 'next/link';

interface TabItem {
  label: string;
  value: string;
}

interface LinkTabItem {
  label: string;
  href: string;
}

export function SegmentedTabs({
  items,
  activeValue,
  onChange,
  className = '',
}: {
  items: TabItem[];
  activeValue: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex flex-wrap gap-1 rounded-2xl border border-sb-border bg-sb-surface-muted p-1 ${className}`}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            activeValue === item.value
              ? 'bg-sb-active text-sb-text shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
              : 'text-sb-text-muted hover:text-sb-text'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedLinkTabs({
  items,
  activeHref,
  className = '',
}: {
  items: LinkTabItem[];
  activeHref: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1 rounded-2xl border border-sb-border bg-sb-surface-muted p-1 ${className}`}>
      {items.map((item) => {
        const active = activeHref === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-sb-active text-sb-text shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
                : 'text-sb-text-muted hover:text-sb-text'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
