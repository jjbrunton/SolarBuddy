'use client';

import { useRouter, usePathname } from 'next/navigation';
import { SegmentedTabs } from '@/components/ui/Tabs';

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

  return <SegmentedTabs items={periods} activeValue={selected} onChange={handleChange} />;
}
