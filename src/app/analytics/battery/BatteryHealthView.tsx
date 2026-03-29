'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardHeader } from '@/components/ui/Card';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { StatCard } from '@/components/analytics/StatCard';

const BatteryCycleChart = dynamic(
  () => import('@/components/analytics/BatteryCycleChart').then((m) => ({ default: m.BatteryCycleChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-sb-card" /> },
);

const PERIODS = [
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
];

interface DayData {
  date: string;
  min_soc: number;
  max_soc: number;
  depth_of_discharge: number;
  equivalent_cycles: number;
  cumulative_cycles: number;
}

interface Summary {
  total_equivalent_cycles: number;
  avg_daily_cycles: number;
  avg_depth_of_discharge: number;
  max_depth_of_discharge: number;
  avg_min_soc: number;
}

export default function BatteryHealthView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || '30d';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/analytics/battery?period=${period}`)
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-sb-text">Battery Health</h1>
        <PeriodSelector periods={PERIODS} selected={period} />
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Total Equiv. Cycles"
            value={`${summary.total_equivalent_cycles}`}
            valueColor="text-sb-accent"
          />
          <StatCard
            label="Avg Daily Cycles"
            value={`${summary.avg_daily_cycles}`}
          />
          <StatCard
            label="Avg Depth of Discharge"
            value={`${summary.avg_depth_of_discharge}%`}
            valueColor="text-sb-warning"
          />
          <StatCard
            label="Avg Min SOC"
            value={`${summary.avg_min_soc}%`}
            subtext={`Max DoD: ${summary.max_depth_of_discharge}%`}
          />
        </div>
      )}

      <Card>
        <CardHeader title="Daily Battery Cycles" />
        {isLoading && daily.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading battery data...</p>
        ) : daily.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">
            No battery SOC data available yet.
          </p>
        ) : (
          <BatteryCycleChart data={daily} />
        )}
      </Card>
    </div>
  );
}
