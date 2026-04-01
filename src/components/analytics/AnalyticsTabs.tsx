'use client';

import { usePathname } from 'next/navigation';
import { SegmentedLinkTabs } from '@/components/ui/Tabs';

const tabs = [
  { label: 'Cost Savings', href: '/analytics' },
  { label: 'Energy Flow', href: '/analytics/energy' },
  { label: 'Battery Health', href: '/analytics/battery' },
  { label: 'Carbon', href: '/analytics/carbon' },
  { label: 'Rate Trends', href: '/analytics/rates' },
];

export function AnalyticsTabs() {
  const pathname = usePathname();
  return <SegmentedLinkTabs items={tabs} activeHref={pathname} className="w-full overflow-x-auto" />;
}
