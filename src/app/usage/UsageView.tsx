'use client';

import dynamic from 'next/dynamic';
import { PageHeader } from '@/components/ui/PageHeader';

const UsageProfileChart = dynamic(
  () =>
    import('@/components/analytics/UsageProfileChart').then((m) => ({
      default: m.UsageProfileChart,
    })),
  { ssr: false, loading: () => <div className="h-[340px] animate-pulse rounded bg-sb-card" /> },
);

export default function UsageView() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Usage profile"
        description="Learned household consumption pattern — baseload and high-consumption periods derived from your telemetry history. The scheduler uses these to forecast per-slot drain instead of a flat estimate."
      />
      <UsageProfileChart />
    </div>
  );
}
