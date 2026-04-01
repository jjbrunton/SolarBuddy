'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { StatCard } from '@/components/analytics/StatCard';

const RateComparisonChart = dynamic(
  () => import('@/components/analytics/RateComparisonChart').then((m) => ({ default: m.RateComparisonChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-sb-card" /> },
);

const PERIODS = [
  { label: '7 Days', value: '7d' },
  { label: '14 Days', value: '14d' },
  { label: '30 Days', value: '30d' },
];

interface TimeSlot {
  time_slot: string;
  today_price: number | null;
  avg_price: number;
  min_price: number;
  max_price: number;
}

interface DailyAvg {
  date: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  negative_slots: number;
}

interface ApiData {
  today: { avg_price: number | null; min_price: number | null; max_price: number | null };
  comparison: { avg_price: number | null; price_change_pct: number | null };
  daily_averages: DailyAvg[];
  time_of_day: TimeSlot[];
}

export default function RateTrendsView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || '7d';
  const [data, setData] = useState<ApiData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/analytics/rates-compare?compare=${period}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [period]);

  const changePct = data?.comparison.price_change_pct;
  const changeLabel = changePct !== null && changePct !== undefined
    ? `${changePct > 0 ? '+' : ''}${changePct}%`
    : '--';
  const changeColor = changePct !== null && changePct !== undefined
    ? changePct <= 0 ? 'text-sb-success' : 'text-sb-danger'
    : 'text-sb-text';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Rate trends"
        description="Compare today’s slot prices with recent history to spot whether the current tariff horizon is unusually cheap or expensive."
        actions={<PeriodSelector periods={PERIODS} selected={period} />}
      />

      {data && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Today's Avg"
            value={data.today.avg_price !== null ? `${data.today.avg_price}p` : '--'}
            valueColor="text-sb-accent"
          />
          <StatCard
            label="Historical Avg"
            value={data.comparison.avg_price !== null ? `${data.comparison.avg_price}p` : '--'}
          />
          <StatCard
            label="vs Historical"
            value={changeLabel}
            valueColor={changeColor}
            subtext={changePct !== null && changePct !== undefined
              ? changePct <= 0 ? 'cheaper than average' : 'more expensive'
              : undefined}
          />
        </div>
      )}

      <Card>
        <CardHeader title="Today vs historical (by time of day)" subtitle="Time-of-day comparison between the current day and the selected historical baseline." />
        {isLoading && !data ? (
          <p className="py-12 text-center text-sb-text-muted">Loading rate trends...</p>
        ) : !data?.time_of_day.length ? (
          <EmptyState
            title="Not enough historical rate data"
            description="SolarBuddy needs a larger history of imported rates before it can compare today's slot prices against prior periods."
          />
        ) : (
          <RateComparisonChart data={data.time_of_day} />
        )}
      </Card>

      {data && data.daily_averages.length > 0 && (
        <Card>
          <CardHeader title="Daily averages" subtitle="Average, minimum, and maximum rate for each stored day in the comparison period." />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-sb-border text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Avg</th>
                  <th className="px-3 py-3">Min</th>
                  <th className="px-3 py-3">Max</th>
                  <th className="px-3 py-3">Negative Slots</th>
                </tr>
              </thead>
              <tbody>
                {data.daily_averages.map((d) => (
                  <tr key={d.date} className="border-b border-sb-border/50">
                    <td className="px-3 py-3 text-sb-text">{d.date}</td>
                    <td className="px-3 py-3 text-sb-text">{d.avg_price}p</td>
                    <td className="px-3 py-3 text-sb-success">{d.min_price}p</td>
                    <td className="px-3 py-3 text-sb-danger">{d.max_price}p</td>
                    <td className="px-3 py-3 text-sb-text-muted">{d.negative_slots}</td>
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
