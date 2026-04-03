'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { useChartColors } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { computeSOCForecast } from '@/lib/soc-forecast';
import { ACTION_COLORS, type PlanAction } from '@/lib/plan-actions';
import { expandHalfHourSlotKeys, formatSlotTimeLabel, formatSlotTooltipLabel, toSlotKey } from '@/lib/slot-key';
import { alignPVForecastToSlots, type PVConfidence } from '@/lib/pv-forecast-utils';
import type { PVForecastSlot } from '@/lib/solcast/client';

interface RatePoint {
  validFrom: string;
  price: number;
  isCurrent: boolean;
  plannedAction: PlanAction;
  forecastSOC?: number;
  pvGenerationKw?: number;
}

interface PlannedSlotRow {
  slot_start: string;
  action: PlanAction;
}

function RateTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">{label ? formatSlotTooltipLabel(label) : ''}</p>
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
  const [settings, setSettings] = useState<{
    charge_rate: string;
    battery_capacity_kwh: string;
    max_charge_power_kw: string;
    estimated_consumption_w: string;
  } | null>(null);
  const [pvForecasts, setPvForecasts] = useState<PVForecastSlot[]>([]);
  const [pvEnabled, setPvEnabled] = useState(false);
  const [pvConfidence, setPvConfidence] = useState<PVConfidence>('estimate');

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

        const isPvEnabled = settingsJson.pv_forecast_enabled === 'true';
        setPvEnabled(isPvEnabled);
        setPvConfidence(settingsJson.pv_forecast_confidence || 'estimate');

        const rawRates = ratesJson.rates || [];
        const rawScheds = schedJson.schedules || [];
        const rawPlanSlots: PlannedSlotRow[] = schedJson.plan_slots || [];
        const now = new Date();

        const plannedActionMap = new Map<string, PlanAction>();
        for (const slot of rawPlanSlots) {
          plannedActionMap.set(toSlotKey(slot.slot_start), slot.action);
        }
        for (const s of rawScheds) {
          if (s.status === 'planned' || s.status === 'active') {
            for (const slotKey of expandHalfHourSlotKeys(s.slot_start, s.slot_end)) {
              if (!plannedActionMap.has(slotKey)) {
                plannedActionMap.set(slotKey, s.type === 'discharge' ? 'discharge' : 'charge');
              }
            }
          }
        }

        let curSlotIdx = 0;

        const chartData: RatePoint[] = rawRates.map((r: { valid_from: string; valid_to: string; price_inc_vat: number }, i: number) => {
          const dt = new Date(r.valid_from);
          const isCurrent = now >= dt && now < new Date(r.valid_to);
          if (isCurrent) curSlotIdx = i;
          return {
            validFrom: r.valid_from,
            price: Math.round(r.price_inc_vat * 100) / 100,
            isCurrent,
            plannedAction: plannedActionMap.get(toSlotKey(r.valid_from)) ?? 'do_nothing',
          };
        });

        setCurrentSlotIndex(curSlotIdx);
        setRates(chartData);

        if (isPvEnabled && rawRates.length > 0) {
          try {
            const from = rawRates[0].valid_from;
            const to = rawRates[rawRates.length - 1].valid_to;
            const forecastRes = await fetch(`/api/forecast?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
            const forecastJson = await forecastRes.json();
            setPvForecasts(forecastJson.forecasts || []);
          } catch {
            setPvForecasts([]);
          }
        } else {
          setPvForecasts([]);
        }
      } catch { /* silent */ }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const pvAligned = useMemo(() => {
    if (!pvEnabled || pvForecasts.length === 0 || rates.length === 0) {
      return { perSlotPVGenerationW: undefined, pvChartValues: [] as (number | undefined)[] };
    }
    return alignPVForecastToSlots(pvForecasts, rates.map((r) => r.validFrom), pvConfidence);
  }, [pvEnabled, pvForecasts, rates, pvConfidence]);

  const ratesWithSOC = useMemo(() => {
    if (rates.length === 0 || state.battery_soc === null || !settings) return rates;
    const slotActions = new Map<number, PlanAction>();
    rates.forEach((rate, index) => {
      if (rate.plannedAction !== 'do_nothing') {
        slotActions.set(index, rate.plannedAction);
      }
    });
    const forecast = computeSOCForecast({
      currentSOC: state.battery_soc,
      currentSlotIndex,
      slotActions,
      totalSlots: rates.length,
      chargeRatePercent: parseFloat(settings.charge_rate) || 100,
      batteryCapacityWh: (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000,
      maxChargePowerW: (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000,
      estimatedConsumptionW: parseFloat(settings.estimated_consumption_w) || 500,
      perSlotPVGenerationW: pvAligned.perSlotPVGenerationW,
    });
    return rates.map((r, i) => ({
      ...r,
      forecastSOC: forecast[i] ?? undefined,
      pvGenerationKw: pvAligned.pvChartValues[i] != null ? pvAligned.pvChartValues[i]! / 1000 : undefined,
    }));
  }, [rates, state.battery_soc, currentSlotIndex, settings, pvAligned]);

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
          <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: ACTION_COLORS.charge }} /> Charge
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: ACTION_COLORS.hold }} /> Hold
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: ACTION_COLORS.discharge }} /> Discharge
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={ratesWithSOC} margin={{ top: 5, right: 40, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="validFrom"
            tick={{ fill: colors.muted, fontSize: 10 }}
            interval="preserveStartEnd"
            tickFormatter={formatSlotTimeLabel}
          />
          <YAxis yAxisId="price" tick={{ fill: colors.muted, fontSize: 10 }} width={35} />
          <YAxis yAxisId="soc" orientation="right" domain={[0, 100]} tick={{ fill: colors.muted, fontSize: 9 }} tickFormatter={(v: number) => `${v}%`} width={35} />
          <Tooltip content={<RateTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <ReferenceLine yAxisId="price" y={0} stroke={colors.border} />
          {pvEnabled && pvForecasts.length > 0 && (
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="pvGenerationKw"
              fill={colors.solar}
              fillOpacity={0.15}
              stroke={colors.solar}
              strokeWidth={1}
              strokeOpacity={0.4}
              dot={false}
            />
          )}
          <Bar yAxisId="price" dataKey="price" radius={[2, 2, 0, 0]}>
            {ratesWithSOC.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.plannedAction !== 'do_nothing' ? ACTION_COLORS[entry.plannedAction] : entry.price < 0 ? colors.warning : colors.accent}
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
