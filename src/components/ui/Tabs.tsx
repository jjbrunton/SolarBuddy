import Link from 'next/link';

interface TabItem {
  label: string;
  value: string;
}

interface LinkTabItem {
  label: string;
  href: string;
}

/*
 * Terminal segmented tabs — monospace uppercase labels with the active
 * tab marked by an orange underline. Sharp, no rounded corners.
 */
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
    <div className={`inline-flex flex-wrap gap-0 border-b border-sb-rule ${className}`}>
      {items.map((item) => {
        const active = activeValue === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`relative px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
              active ? 'text-sb-ember' : 'text-sb-text-muted hover:text-sb-text'
            }`}
          >
            {item.label}
            {active ? (
              <span className="absolute inset-x-2 -bottom-[1px] h-[2px] bg-sb-ember" />
            ) : null}
          </button>
        );
      })}
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
    <div className={`flex flex-wrap gap-0 border-b border-sb-rule ${className}`}>
      {items.map((item) => {
        const active = activeHref === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative whitespace-nowrap px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.1em] transition-colors ${
              active ? 'text-sb-ember' : 'text-sb-text-muted hover:text-sb-text'
            }`}
          >
            {item.label}
            {active ? (
              <span className="absolute inset-x-2 -bottom-[1px] h-[2px] bg-sb-ember" />
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
