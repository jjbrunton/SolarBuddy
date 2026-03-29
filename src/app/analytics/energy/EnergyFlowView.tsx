'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardHeader } from '@/components/ui/Card';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { StatCard } from '@/components/analytics/StatCard';

const EnergyFlowChart = dynamic(
  () => import('@/components/analytics/EnergyFlowChart').then((m) => ({ default: m.EnergyFlowChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-sb-card" /> },
);

const PERIODS = [
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
];

interface DayData {
  date: string;
  import_kwh: number;
  export_kwh: number;
  generation_kwh: number;
  consumption_kwh: number;
  self_sufficiency: number;
}

interface Summary {
  total_import_kwh: number;
  total_export_kwh: number;
  total_generation_kwh: number;
  total_consumption_kwh: number;
  avg_self_sufficiency: number;
}

export default function EnergyFlowView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || '7d';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DayData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/analytics/energy?period=${period}`)
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
        <h1 className="text-xl font-bold text-sb-text">Energy Flow</h1>
        <PeriodSelector periods={PERIODS} selected={period} />
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Total Generation"
            value={`${summary.total_generation_kwh} kWh`}
            valueColor="text-yellow-400"
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
          <StatCard
            label="Total Consumption"
            value={`${summary.total_consumption_kwh} kWh`}
            valueColor="text-purple-400"
          />
          <StatCard
            label="Avg Self-Sufficiency"
            value={`${summary.avg_self_sufficiency}%`}
            valueColor="text-sb-accent"
          />
        </div>
      )}

      <Card>
        <CardHeader title="Daily Energy Flows" />
        {isLoading && daily.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading energy data...</p>
        ) : daily.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">
            No readings data available yet.
          </p>
        ) : (
          <EnergyFlowChart data={daily} />
        )}
      </Card>
    </div>
  );
}
