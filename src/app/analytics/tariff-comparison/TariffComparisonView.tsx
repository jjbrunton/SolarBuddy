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

const TariffComparisonChart = dynamic(
  () =>
    import('@/components/analytics/TariffComparisonChart').then((m) => ({
      default: m.TariffComparisonChart,
    })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-sb-card" /> },
);

const PERIODS = [
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

const TARIFFS = [
  { label: 'Agile', value: 'agile' },
  { label: 'Go', value: 'go' },
  { label: 'Flux', value: 'flux' },
  { label: 'Cosy', value: 'cosy' },
];

interface DayData {
  date: string;
  actual_import_cost: number;
  hypothetical_import_cost: number;
  actual_export_revenue: number;
  hypothetical_export_revenue: number;
  actual_net: number;
  hypothetical_net: number;
  difference: number;
}

interface Summary {
  total_actual_net: number;
  total_hypothetical_net: number;
  total_difference: number;
  percentage_difference: number;
}

export default function TariffComparisonView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || '30d';
  const [targetTariff, setTargetTariff] = useState('go');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/analytics/tariff-comparison?period=${period}&target_tariff=${targetTariff}`)
      .then((r) => r.json())
      .then((json) => {
        setSummary(json.summary);
        setDaily(json.daily || []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [period, targetTariff]);

  // positive difference = hypothetical is more expensive (you save money on current)
  // negative difference = hypothetical is cheaper (you'd save by switching)
  const diffColor =
    summary && summary.total_difference > 0
      ? 'text-sb-success'
      : summary && summary.total_difference < 0
        ? 'text-sb-danger'
        : 'text-sb-text';

  const diffLabel =
    summary && summary.total_difference > 0
      ? 'You save on your current tariff'
      : summary && summary.total_difference < 0
        ? 'You could save by switching'
        : '';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Tariff Comparison"
        description="Compare your actual energy costs against what you would have paid on a different tariff to see if switching could save money."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PeriodSelector periods={PERIODS} selected={period} />
            <select
              value={targetTariff}
              onChange={(e) => setTargetTariff(e.target.value)}
              className="rounded-xl border border-sb-border bg-sb-card px-3 py-2 text-sm text-sb-text outline-none focus:border-sb-accent"
            >
              {TARIFFS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Your Actual Cost"
            value={formatCost(Math.abs(summary.total_actual_net))}
            subtext={summary.total_actual_net < 0 ? 'Net profit' : 'Net cost'}
            valueColor={summary.total_actual_net < 0 ? 'text-sb-success' : 'text-sb-danger'}
          />
          <StatCard
            label={`Hypothetical (${TARIFFS.find((t) => t.value === targetTariff)?.label ?? targetTariff})`}
            value={formatCost(Math.abs(summary.total_hypothetical_net))}
            subtext={summary.total_hypothetical_net < 0 ? 'Net profit' : 'Net cost'}
            valueColor={summary.total_hypothetical_net < 0 ? 'text-sb-success' : 'text-sb-danger'}
          />
          <StatCard
            label="Difference"
            value={`${formatCost(Math.abs(summary.total_difference))} (${Math.abs(summary.percentage_difference).toFixed(1)}%)`}
            subtext={diffLabel}
            valueColor={diffColor}
          />
        </div>
      )}

      <Card>
        <CardHeader
          title="Daily net cost comparison"
          subtitle={`Your actual net cost vs hypothetical on the ${TARIFFS.find((t) => t.value === targetTariff)?.label ?? targetTariff} tariff.`}
        />
        {isLoading && daily.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading comparison data...</p>
        ) : daily.length === 0 ? (
          <EmptyState
            title="No comparison data yet"
            description="Tariff comparison requires historical energy usage and rate data to calculate hypothetical costs."
          />
        ) : (
          <TariffComparisonChart data={daily} />
        )}
      </Card>
    </div>
  );
}
