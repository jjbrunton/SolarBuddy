'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardHeader } from '@/components/ui/Card';
import { PeriodSelector } from '@/components/analytics/PeriodSelector';
import { StatCard } from '@/components/analytics/StatCard';

const CarbonIntensityChart = dynamic(
  () => import('@/components/analytics/CarbonIntensityChart').then((m) => ({ default: m.CarbonIntensityChart })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded bg-sb-card" /> },
);

const PERIODS = [
  { label: 'Today', value: 'today' },
  { label: '48 Hours', value: '48h' },
];

interface SlotData {
  from: string;
  to: string;
  forecast: number | null;
  actual: number | null;
  index: string | null;
  solar_kwh: number;
  carbon_saved_g: number;
}

interface Summary {
  current_intensity: number | null;
  current_index: string | null;
  avg_intensity: number | null;
  carbon_saved_g: number;
  carbon_saved_kg: number;
}

export default function CarbonView() {
  const searchParams = useSearchParams();
  const period = searchParams.get('period') || 'today';
  const [summary, setSummary] = useState<Summary | null>(null);
  const [halfhourly, setHalfhourly] = useState<SlotData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/analytics/carbon?period=${period}`)
      .then((r) => r.json())
      .then((json) => {
        setSummary(json.summary);
        setHalfhourly(json.halfhourly || []);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [period]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-sb-text">Carbon Intensity</h1>
        <PeriodSelector periods={PERIODS} selected={period} />
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Current Intensity"
            value={summary.current_intensity !== null ? `${summary.current_intensity} g` : '--'}
            subtext="gCO2/kWh"
            valueColor="text-sb-text"
          />
          <StatCard
            label="Current Index"
            value={summary.current_index ?? '--'}
            valueColor={
              summary.current_index === 'very low' || summary.current_index === 'low'
                ? 'text-sb-success'
                : summary.current_index === 'high' || summary.current_index === 'very high'
                  ? 'text-sb-danger'
                  : 'text-sb-warning'
            }
          />
          <StatCard
            label="Average Intensity"
            value={summary.avg_intensity !== null ? `${summary.avg_intensity} g` : '--'}
            subtext="gCO2/kWh"
          />
          <StatCard
            label="Carbon Saved by Solar"
            value={summary.carbon_saved_kg > 1 ? `${summary.carbon_saved_kg} kg` : `${summary.carbon_saved_g} g`}
            valueColor="text-sb-success"
            subtext="CO2 avoided"
          />
        </div>
      )}

      <Card>
        <CardHeader title="Half-Hourly Carbon Intensity" />
        {isLoading && halfhourly.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading carbon data...</p>
        ) : halfhourly.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">
            No carbon intensity data available.
          </p>
        ) : (
          <CarbonIntensityChart data={halfhourly} />
        )}
      </Card>
    </div>
  );
}
