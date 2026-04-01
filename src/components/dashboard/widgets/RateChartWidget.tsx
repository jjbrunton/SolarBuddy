'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { useChartColors } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { computeSOCForecast } from '@/lib/soc-forecast';
import type { PlanAction } from '@/lib/plan-actions';

interface RatePoint {
  time: string;
  price: number;
  isCurrent: boolean;
  isScheduled: boolean;
  forecastSOC?: number;
}

function RateTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">{label}</p>
      <p className="text-sm font-semibold text-sb-text">{payload[0].value}p/kWh</p>
    </div>
  );
}

export default function RateChartWidget() {
  const router = useRouter();
  const colors = useChartColors();
  const { state } = useSSE();
  const [rates, setRates] = useState<RatePoint[]>([]);
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0);
  const [scheduledIndices, setScheduledIndices] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState<{
    charge_rate: string;
    battery_capacity_kwh: string;
    max_charge_power_kw: string;
    estimated_consumption_w: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [ratesRes, schedRes, settingsRes] = await Promise.all([
          fetch('/api/rates'),
          fetch('/api/schedule'),
          fetch('/api/settings'),
        ]);
        const ratesJson = await ratesRes.json();
        const schedJson = await schedRes.json();
        const settingsJson = await settingsRes.json();
        setSettings(settingsJson);

        const rawRates = ratesJson.rates || [];
        const rawScheds = schedJson.schedules || [];
        const now = new Date();

        const scheduledTimes = new Set<number>();
        for (const s of rawScheds) {
          if (s.status === 'planned' || s.status === 'active') {
            let cursor = new Date(s.slot_start).getTime();
            const end = new Date(s.slot_end).getTime();
            while (cursor < end) {
              scheduledTimes.add(cursor);
              cursor += 30 * 60 * 1000;
            }
          }
        }

        const newScheduledIndices = new Set<number>();
        let curSlotIdx = 0;

        const chartData: RatePoint[] = rawRates.map((r: { valid_from: string; valid_to: string; price_inc_vat: number }, i: number) => {
          const dt = new Date(r.valid_from);
          const isCurrent = now >= dt && now < new Date(r.valid_to);
          if (isCurrent) curSlotIdx = i;
          const isScheduled = scheduledTimes.has(dt.getTime());
          if (isScheduled) newScheduledIndices.add(i);
          return {
            time: `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`,
            price: Math.round(r.price_inc_vat * 100) / 100,
            isCurrent,
            isScheduled,
          };
        });

        setCurrentSlotIndex(curSlotIdx);
        setScheduledIndices(newScheduledIndices);
        setRates(chartData);
      } catch { /* silent */ }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const ratesWithSOC = useMemo(() => {
    if (rates.length === 0 || state.battery_soc === null || !settings) return rates;
    const slotActions = new Map<number, PlanAction>();
    for (const index of scheduledIndices) {
      slotActions.set(index, 'charge');
    }
    const forecast = computeSOCForecast({
      currentSOC: state.battery_soc,
      currentSlotIndex,
      slotActions,
      totalSlots: rates.length,
      chargeRatePercent: parseFloat(settings.charge_rate) || 100,
      batteryCapacityWh: (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000,
      maxChargePowerW: (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000,
      estimatedConsumptionW: parseFloat(settings.estimated_consumption_w) || 500,
    });
    return rates.map((r, i) => ({ ...r, forecastSOC: forecast[i] ?? undefined }));
  }, [rates, state.battery_soc, currentSlotIndex, scheduledIndices, settings]);

  if (rates.length === 0) return null;

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-sb-card-hover"
      onClick={() => router.push('/rates')}
    >
      <CardHeader title="Today's Rates">
        <span className="text-xs text-sb-text-muted">View all &rarr;</span>
      </CardHeader>
      <div className="flex gap-4 text-xs text-sb-text-muted mb-2">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Rate
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-success" /> Scheduled
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={ratesWithSOC} margin={{ top: 5, right: 40, bottom: 5, left: 5 }}>
          <XAxis dataKey="time" tick={{ fill: colors.muted, fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis yAxisId="price" tick={{ fill: colors.muted, fontSize: 10 }} width={35} />
          <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fill: colors.muted, fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} width={35} />
          <Tooltip content={<RateTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <ReferenceLine yAxisId="price" y={0} stroke={colors.border} />
          <Bar yAxisId="price" dataKey="price" radius={[2, 2, 0, 0]}>
            {ratesWithSOC.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.isScheduled ? colors.success : entry.price < 0 ? colors.warning : colors.accent}
                stroke={entry.isCurrent ? '#facc15' : 'none'}
                strokeWidth={entry.isCurrent ? 2 : 0}
              />
            ))}
          </Bar>
          {state.battery_soc !== null && (
            <Line yAxisId="soc" type="monotone" dataKey="forecastSOC" stroke={colors.muted} strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}
