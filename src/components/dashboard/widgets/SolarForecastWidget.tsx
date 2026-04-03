'use client';

import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { useChartColors } from '@/hooks/useTheme';
import type { PVForecastSlot } from '@/lib/solcast/client';
import type { PVConfidence } from '@/lib/pv-forecast-utils';

interface ChartPoint {
  time: string;
  estimate: number;
  low: number;
  high: number;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function SolarTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const estimate = payload.find((p) => p.dataKey === 'estimate');
  const low = payload.find((p) => p.dataKey === 'low');
  const high = payload.find((p) => p.dataKey === 'high');
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">{label ? formatTime(label) : ''}</p>
      {estimate && <p className="text-sm font-semibold text-sb-text">{estimate.value.toFixed(2)} kW</p>}
      {low && high && (
        <p className="text-xs text-sb-text-muted">
          Range: {low.value.toFixed(2)} – {high.value.toFixed(2)} kW
        </p>
      )}
    </div>
  );
}

export default function SolarForecastWidget() {
  const colors = useChartColors();
  const [forecasts, setForecasts] = useState<PVForecastSlot[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [confidence, setConfidence] = useState<PVConfidence>('estimate');

  useEffect(() => {
    async function load() {
      try {
        const settingsRes = await fetch('/api/settings');
        const settings = await settingsRes.json();
        const pvEnabled = settings.pv_forecast_enabled === 'true';
        setEnabled(pvEnabled);
        setConfidence(settings.pv_forecast_confidence || 'estimate');

        if (!pvEnabled) return;

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const forecastRes = await fetch(
          `/api/forecast?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(tomorrow.toISOString())}`,
        );
        const forecastJson = await forecastRes.json();
        setForecasts(forecastJson.forecasts || []);
      } catch { /* silent */ }
    }
    load();
    const interval = setInterval(load, 5 * 60000);
    return () => clearInterval(interval);
  }, []);

  const totalKwh = useMemo(() => {
    return forecasts.reduce((sum, slot) => {
      const w = confidence === 'estimate10' ? slot.pv_estimate10_w
        : confidence === 'estimate90' ? slot.pv_estimate90_w
          : slot.pv_estimate_w;
      return sum + (w * 0.5) / 1000;
    }, 0);
  }, [forecasts, confidence]);

  const chartData: ChartPoint[] = useMemo(() => {
    return forecasts.map((slot) => ({
      time: slot.valid_from,
      estimate: slot.pv_estimate_w / 1000,
      low: slot.pv_estimate10_w / 1000,
      high: slot.pv_estimate90_w / 1000,
    }));
  }, [forecasts]);

  if (!enabled || forecasts.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Solar Forecast">
        <span className="text-xs text-sb-text-muted">
          {totalKwh.toFixed(1)} kWh expected
        </span>
      </CardHeader>
      <div className="flex gap-4 text-xs text-sb-text-muted mb-2">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: colors.solar }} /> Estimate
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: colors.solar, opacity: 0.2 }} /> P10–P90 Range
        </span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="time"
            tick={{ fill: colors.muted, fontSize: 10 }}
            interval="preserveStartEnd"
            tickFormatter={formatTime}
          />
          <YAxis
            tick={{ fill: colors.muted, fontSize: 10 }}
            tickFormatter={(v: number) => `${v}kW`}
            width={40}
          />
          <Tooltip content={<SolarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Area
            type="monotone"
            dataKey="high"
            fill={colors.solar}
            fillOpacity={0.1}
            stroke="none"
          />
          <Area
            type="monotone"
            dataKey="low"
            fill={colors.card}
            fillOpacity={1}
            stroke="none"
          />
          <Area
            type="monotone"
            dataKey="estimate"
            fill={colors.solar}
            fillOpacity={0.2}
            stroke={colors.solar}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}
