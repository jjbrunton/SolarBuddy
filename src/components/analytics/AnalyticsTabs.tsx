'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { label: 'Cost Savings', href: '/analytics' },
  { label: 'Energy Flow', href: '/analytics/energy' },
  { label: 'Battery Health', href: '/analytics/battery' },
  { label: 'Carbon', href: '/analytics/carbon' },
  { label: 'Rate Trends', href: '/analytics/rates' },
];

export function AnalyticsTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg bg-sb-card p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            pathname === tab.href
              ? 'bg-sb-active text-sb-text'
              : 'text-sb-text-muted hover:bg-sb-active/50 hover:text-sb-text'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
