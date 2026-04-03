'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { StatCard } from '@/components/analytics/StatCard';
import { formatCost } from '@/lib/forecast';

const AccountingChart = dynamic(
  () => import('@/components/analytics/AccountingChart').then((m) => ({ default: m.AccountingChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-sb-card" /> },
);

const PERIODS = [
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

interface DayData {
  date: string;
  import_kwh: number;
  import_cost: number;
  export_kwh: number;
  export_revenue: number;
  net_cost: number;
}

interface Summary {
  total_import_kwh: number;
  total_import_cost: number;
  total_export_kwh: number;
  total_export_revenue: number;
  total_net_cost: number;
}

export default function AccountingView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || '7d';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/analytics/accounting?period=${period}`)
      .then((r) => r.json())
      .then((json) => {
        setSummary(json.summary);
        setDaily(json.daily || []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [period]);

  const netColor =
    summary && summary.total_net_cost < 0
      ? 'text-sb-success'
      : summary && summary.total_net_cost > 0
        ? 'text-sb-danger'
        : 'text-sb-text';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Cost & Profit"
        description="Track daily import costs, export revenue, and net spend to understand the financial performance of your solar and battery system."
        actions={<PeriodSelector periods={PERIODS} selected={period} />}
      />

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Total Import Cost"
            value={formatCost(summary.total_import_cost)}
            valueColor="text-sb-danger"
          />
          <StatCard
            label="Total Export Revenue"
            value={formatCost(summary.total_export_revenue)}
            valueColor="text-sb-success"
          />
          <StatCard
            label="Net Cost"
            value={formatCost(Math.abs(summary.total_net_cost))}
            subtext={summary.total_net_cost < 0 ? 'Profit' : summary.total_net_cost > 0 ? 'Cost' : 'Break even'}
            valueColor={netColor}
          />
          <StatCard
            label="Total Import"
            value={`${summary.total_import_kwh} kWh`}
            valueColor="text-sb-danger"
          />
          <StatCard
            label="Total Export"
            value={`${summary.total_export_kwh} kWh`}
            valueColor="text-sb-success"
          />
        </div>
      )}

      <Card>
        <CardHeader title="Daily cost breakdown" subtitle="Import costs, export revenue, and running net cost per day." />
        {isLoading && daily.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading accounting data...</p>
        ) : daily.length === 0 ? (
          <EmptyState
            title="No accounting data yet"
            description="Cost and revenue data will appear once energy import and export readings have been recorded."
          />
        ) : (
          <AccountingChart data={daily} />
        )}
      </Card>
    </div>
  );
}
