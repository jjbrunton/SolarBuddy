'use client';

import { useRouter, usePathname } from 'next/navigation';

interface PeriodOption {
  label: string;
  value: string;
}

export function PeriodSelector({
  periods,
  selected,
  paramName = 'period',
  onChange,
}: {
  periods: PeriodOption[];
  selected: string;
  paramName?: string;
  onChange?: (value: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function handleChange(value: string) {
    if (onChange) {
      onChange(value);
      return;
    }
    const params = new URLSearchParams();
    params.set(paramName, value);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex gap-1 rounded-lg bg-sb-card p-1">
      {periods.map((p) => (
        <button
          key={p.value}
          onClick={() => handleChange(p.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            selected === p.value
              ? 'bg-sb-accent text-white'
              : 'text-sb-text-muted hover:text-sb-text'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
