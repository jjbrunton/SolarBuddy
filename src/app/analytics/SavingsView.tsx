'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { StatCard } from '@/components/analytics/StatCard';

const SavingsChart = dynamic(
  () => import('@/components/analytics/SavingsChart').then((m) => ({ default: m.SavingsChart })),
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
  actual_cost: number;
  flat_rate_cost: number;
  peak_rate_cost: number;
  savings: number;
}

interface Summary {
  total_import_kwh: number;
  actual_cost: number;
  flat_rate_cost: number;
  peak_rate_cost: number;
  savings_vs_flat: number;
  savings_vs_peak: number;
}

function formatPence(p: number) {
  if (Math.abs(p) >= 100) return `£${(p / 100).toFixed(2)}`;
  return `${p.toFixed(1)}p`;
}

export default function SavingsView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || '7d';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/analytics/savings?period=${period}`)
      .then((r) => r.json())
      .then((json) => {
        setSummary(json.summary);
        setDaily(json.daily || []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [period]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Cost savings"
        description="Compare actual charging cost against flat-rate and peak-rate baselines to see whether the current strategy is paying off."
        actions={<PeriodSelector periods={PERIODS} selected={period} />}
      />

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Total Savings vs Flat"
            value={formatPence(summary.savings_vs_flat)}
            valueColor={summary.savings_vs_flat >= 0 ? 'text-sb-success' : 'text-sb-danger'}
            subtext={`vs ${formatPence(summary.savings_vs_peak)} vs peak`}
          />
          <StatCard
            label="Actual Cost"
            value={formatPence(summary.actual_cost)}
            valueColor="text-sb-warning"
          />
          <StatCard
            label="Flat Rate Would Be"
            value={formatPence(summary.flat_rate_cost)}
            subtext="at 24.5p/kWh"
          />
          <StatCard
            label="Total Import"
            value={`${summary.total_import_kwh} kWh`}
          />
        </div>
      )}

      <Card>
        <CardHeader title="Daily cost comparison" subtitle="Actual import cost versus a flat-rate baseline over the selected period." />
        {isLoading && daily.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading savings data...</p>
        ) : daily.length === 0 ? (
          <EmptyState
            title="No savings data yet"
            description="SolarBuddy needs both stored readings and tariff data before it can calculate a meaningful savings comparison."
          />
        ) : (
          <SavingsChart data={daily} />
        )}
      </Card>

      {daily.length > 0 && (
        <Card>
          <CardHeader title="Daily breakdown" subtitle="Day-by-day import volume and cost comparison." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sb-border text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Import</th>
                  <th className="px-3 py-3">Actual Cost</th>
                  <th className="px-3 py-3">Flat Rate</th>
                  <th className="px-3 py-3">Savings</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date} className="border-b border-sb-border/50">
                    <td className="px-3 py-3 text-sb-text">{d.date}</td>
                    <td className="px-3 py-3 text-sb-text">{d.import_kwh} kWh</td>
                    <td className="px-3 py-3 text-sb-warning">{formatPence(d.actual_cost)}</td>
                    <td className="px-3 py-3 text-sb-text-muted">{formatPence(d.flat_rate_cost)}</td>
                    <td className={`px-3 py-3 font-medium ${d.savings >= 0 ? 'text-sb-success' : 'text-sb-danger'}`}>
                      {formatPence(d.savings)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
