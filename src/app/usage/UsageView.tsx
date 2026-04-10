'use client';

import { useCallback, useState } from 'react';
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
  const [refreshing, setRefreshing] = useState(false);
  const [chartKey, setChartKey] = useState(0);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch('/api/usage-profile/refresh', { method: 'POST' });
      setChartKey((k) => k + 1);
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Usage profile"
        description="Learned household consumption pattern — baseload and high-consumption periods derived from your configured usage source (Octopus consumption data or local telemetry). The scheduler uses this to forecast per-slot drain instead of a flat estimate."
        actions={
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-lg border border-sb-border bg-sb-surface-muted px-3 py-1.5 text-sm text-sb-text hover:border-sb-active disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh now'}
          </button>
        }
      />
      <UsageProfileChart key={chartKey} />
    </div>
  );
}
