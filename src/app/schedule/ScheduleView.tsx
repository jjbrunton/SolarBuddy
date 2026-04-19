'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Figure } from '@/components/ui/Figure';
import { PageHeader } from '@/components/ui/PageHeader';
import { RefreshCw, Play, Trash2, Zap, BatteryLow, Pause, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useChartColors } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { sliceTimeWindowsFromCurrentPeriod } from '@/lib/chart-window';
import { computeSOCForecast, type SOCSlotForecast } from '@/lib/soc-forecast';
import { formatCost } from '@/lib/forecast';
import { formatSlotTimeLabel, formatSlotTooltipLabel, toSlotKey } from '@/lib/slot-key';
import {
  buildSchedulePlanSlots,
  formatScheduleDayLabel,
  getTodayScheduleDayKey,
  selectScheduleDay,
  type ScheduleHistorySlot,
} from '@/lib/schedule-history';
import {
  type PlanAction,
  PLAN_ACTIONS,
  ACTION_COLORS,
  ACTION_LABELS,
  ACTION_BADGE_KIND,
} from '@/lib/plan-actions';
import { alignPVForecastToSlots, type PVConfidence } from '@/lib/pv-forecast-utils';
import type { PVForecastSlot } from '@/lib/solcast/client';

interface UsageBucketSlim {
  day_type: 'weekday' | 'weekend';
  slot_index: number;
  median_w: number;
  sample_count: number;
}

interface Rate {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
}

interface Schedule {
  slot_start: string;
  slot_end: string;
  status: string;
  type?: 'charge' | 'discharge';
}

interface PlannedSlotRow {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  reason: string;
  expected_soc_after: number | null;
}

interface Override {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
}

type PlanSlot = ScheduleHistorySlot & {
  forecastSOC?: SOCSlotForecast;
  /** End-of-slot forecast SOC for chart line rendering. */
  forecastSOCEnd?: number;
  actualSOC?: number;
  pvGenerationKw?: number;
  estimatedLoadKw?: number;
};

const ACTION_ICON: Record<PlanAction, typeof Zap> = {
  charge: Zap,
  discharge: BatteryLow,
  hold: Pause,
};

function SlotTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const price = payload.find((p) => p.dataKey === 'price');
  const actual = payload.find((p) => p.dataKey === 'actualSOC');
  const forecast = payload.find((p) => p.dataKey === 'forecastSOCEnd');
  const pv = payload.find((p) => p.dataKey === 'pvGenerationKw');
  const load = payload.find((p) => p.dataKey === 'estimatedLoadKw');
  return (
    <div className="rounded-[0.5rem] border border-sb-rule-strong bg-sb-card/95 px-4 py-3 backdrop-blur-sm">
      <p className="sb-eyebrow">{label ? formatSlotTooltipLabel(label) : ''}</p>
      {price && (
        <p className="sb-display mt-1 text-2xl leading-none text-sb-ember">
          {price.value}
          <span className="ml-1 text-[0.55rem] uppercase tracking-[0.18em] text-sb-text-muted">p/kWh</span>
        </p>
      )}
      <div className="mt-2 space-y-0.5 font-[family-name:var(--font-sb-mono)] text-[0.7rem] text-sb-text-muted">
        {pv && pv.value != null && <p>PV       {pv.value.toFixed(2)} kW</p>}
        {load && load.value != null && <p>Load     {load.value.toFixed(2)} kW</p>}
        {actual && actual.value != null && <p>Actual   {actual.value}%</p>}
        {forecast && forecast.value != null && <p>Predict  {forecast.value}%</p>}
      </div>
    </div>
  );
}

function formatSlotTime(iso: string) {
  const date = new Date(iso);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// Resolver / auto-override runs on the wall-clock `*/5` cron tick, so the
// current decision is only binding until the next :00/:05/:10/... boundary
// inside the current slot. Ticks its own clock so the label rolls forward
// without depending on the page's frozen `effectiveNow`.
function CurrentSlotTimeCell({ validFrom, validTo }: { validFrom: string; validTo: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const slotStartMs = new Date(validFrom).getTime();
  const slotEndMs = new Date(validTo).getTime();
  const nowMs = now.getTime();

  if (nowMs < slotStartMs || nowMs >= slotEndMs) {
    return <span>{formatSlotTime(validFrom)} - {formatSlotTime(validTo)}</span>;
  }

  const fiveMinMs = 5 * 60 * 1000;
  const windowStartMs = slotStartMs + Math.floor((nowMs - slotStartMs) / fiveMinMs) * fiveMinMs;
  const windowEndMs = Math.min(windowStartMs + fiveMinMs, slotEndMs);
  const windowStart = formatSlotTime(new Date(windowStartMs).toISOString());
  const windowEnd = formatSlotTime(new Date(windowEndMs).toISOString());
  const slotStart = formatSlotTime(validFrom);
  const slotEnd = formatSlotTime(validTo);

  return (
    <div className="flex flex-col">
      <span>{windowStart} - {windowEnd}</span>
      <span className="text-[0.65rem] font-normal text-sb-text-subtle">
        of {slotStart}–{slotEnd}
      </span>
    </div>
  );
}

export default function ScheduleView() {
  const colors = useChartColors();
  const { state } = useSSE();
  const effectiveNow = useMemo(
    () => (state.runtime_mode === 'virtual' && state.virtual_time ? new Date(state.virtual_time) : new Date()),
    [state.runtime_mode, state.virtual_time],
  );
  const effectiveNowRef = useRef(effectiveNow);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    effectiveNowRef.current = effectiveNow;
  }, [effectiveNow]);

  const [slots, setSlots] = useState<PlanSlot[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);
  const [settings, setSettings] = useState<{
    charge_rate: string;
    battery_capacity_kwh: string;
    max_charge_power_kw: string;
    estimated_consumption_w: string;
    discharge_soc_floor: string;
  } | null>(null);
  const [pvForecasts, setPvForecasts] = useState<PVForecastSlot[]>([]);
  const [pvEnabled, setPvEnabled] = useState(false);
  const [pvConfidence, setPvConfidence] = useState<PVConfidence>('estimate');
  const [usageBuckets, setUsageBuckets] = useState<UsageBucketSlim[]>([]);

  const todayDay = getTodayScheduleDayKey(effectiveNow);

  const fetchData = useCallback(async () => {
    try {
      const [ratesRes, scheduleRes, overridesRes, settingsRes] = await Promise.all([
        fetch('/api/rates'),
        fetch('/api/schedule'),
        fetch('/api/overrides'),
        fetch('/api/settings'),
      ]);
      const [ratesJson, scheduleJson, overridesJson, settingsJson] = await Promise.all([
        ratesRes.json(),
        scheduleRes.json(),
        overridesRes.json(),
        settingsRes.json(),
      ]);

      setSettings(settingsJson);

      const isPvEnabled = settingsJson.pv_forecast_enabled === 'true';
      setPvEnabled(isPvEnabled);
      setPvConfidence((settingsJson.pv_forecast_confidence as PVConfidence) || 'estimate');

      const rates: Rate[] = ratesJson.rates || [];
      const schedules: Schedule[] = scheduleJson.schedules || [];
      const plannedSlots: PlannedSlotRow[] = scheduleJson.plan_slots || [];
      const overrides: Override[] = overridesJson.overrides || [];

      setSlots(buildSchedulePlanSlots(rates, schedules, plannedSlots, overrides, effectiveNowRef.current));
      setError(null);

      if (isPvEnabled && rates.length > 0) {
        try {
          const from = rates[0].valid_from;
          const to = rates[rates.length - 1].valid_to;
          const forecastRes = await fetch(`/api/forecast?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
          const forecastJson = await forecastRes.json();
          setPvForecasts(forecastJson.forecasts || []);
        } catch {
          setPvForecasts([]);
        }
      } else {
        setPvForecasts([]);
      }

      try {
        const usageRes = await fetch('/api/usage-profile');
        const usageJson = await usageRes.json();
        setUsageBuckets(usageJson.status === 'ok' ? usageJson.buckets : []);
      } catch {
        setUsageBuckets([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plan data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const [actualSOCMap, setActualSOCMap] = useState<Map<string, number>>(new Map());

  const availableDays = useMemo(() => {
    return [...new Set(slots.map((slot) => slot.dayKey))].sort((a, b) => a.localeCompare(b));
  }, [slots]);

  useEffect(() => {
    setSelectedDay((currentDay) => selectScheduleDay(availableDays, currentDay, todayDay));
  }, [availableDays, todayDay]);

  useEffect(() => {
    if (!selectedDay) return;
    let cancelled = false;
    fetch(`/api/readings?period=soc-slots&date=${selectedDay}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const map = new Map<string, number>();
        for (const row of json.soc_slots || []) {
          map.set(toSlotKey(row.slot_start), row.battery_soc);
        }
        setActualSOCMap(map);
      })
      .catch(() => {
        if (!cancelled) setActualSOCMap(new Map());
      });
    return () => { cancelled = true; };
  }, [selectedDay]);

  const usageLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of usageBuckets) {
      if (b.sample_count > 0) {
        map.set(`${b.day_type}:${b.slot_index}`, b.median_w);
      }
    }
    return map;
  }, [usageBuckets]);

  const pvAligned = useMemo(() => {
    if (!pvEnabled || pvForecasts.length === 0 || slots.length === 0) {
      return { pvChartValues: [] as (number | undefined)[] };
    }
    const { pvChartValues } = alignPVForecastToSlots(
      pvForecasts,
      slots.map((slot) => slot.validFrom),
      pvConfidence,
    );
    return { pvChartValues };
  }, [pvEnabled, pvForecasts, slots, pvConfidence]);

  const slotsWithSOC = useMemo(() => {
    const fallbackConsumptionW = settings ? parseFloat(settings.estimated_consumption_w) || 500 : 500;

    const getEstimatedLoadW = (slotValidFrom: string): number => {
      if (usageLookup.size === 0) return fallbackConsumptionW;
      const d = new Date(slotValidFrom);
      const dow = d.getDay();
      const dayType = dow === 0 || dow === 6 ? 'weekend' : 'weekday';
      const slotIdx = d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
      return usageLookup.get(`${dayType}:${slotIdx}`) ?? fallbackConsumptionW;
    };

    const withExtras = (slot: PlanSlot, index: number): PlanSlot => {
      const pvWatts = pvAligned.pvChartValues[index];
      const loadW = getEstimatedLoadW(slot.validFrom);
      return {
        ...slot,
        pvGenerationKw: pvWatts != null ? pvWatts / 1000 : undefined,
        estimatedLoadKw: loadW / 1000,
      };
    };

    if (slots.length === 0 || state.battery_soc === null || !settings) {
      return slots.map((slot, index) => ({
        ...withExtras(slot, index),
        actualSOC: actualSOCMap.get(toSlotKey(slot.validFrom)) ?? undefined,
      }));
    }

    const currentIndex = slots.findIndex((slot) => slot.isCurrent);
    const slotActions = new Map<number, PlanAction>();
    slots.forEach((slot, index) => {
      slotActions.set(index, slot.effectiveAction);
    });

    // Use earliest actual SOC to model from the start of the day
    let startSOC: number | undefined;
    let startIndex: number | undefined;
    for (let i = 0; i < slots.length; i++) {
      const actual = actualSOCMap.get(toSlotKey(slots[i].validFrom));
      if (actual != null) { startSOC = actual; startIndex = i; break; }
    }

    const drainWAtSlot = usageLookup.size > 0
      ? (slotIndex: number): number => {
          const slot = slots[slotIndex];
          return slot ? getEstimatedLoadW(slot.validFrom) : fallbackConsumptionW;
        }
      : undefined;

    const pvMap = new Map<number, number>();
    pvAligned.pvChartValues.forEach((w, i) => {
      if (w != null) pvMap.set(i, w);
    });

    const forecast = computeSOCForecast({
      currentSOC: state.battery_soc,
      currentSlotIndex: currentIndex >= 0 ? currentIndex : 0,
      slotActions,
      totalSlots: slots.length,
      chargeRatePercent: parseFloat(settings.charge_rate) || 100,
      batteryCapacityWh: (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000,
      maxChargePowerW: (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000,
      estimatedConsumptionW: fallbackConsumptionW,
      drainWAtSlot,
      perSlotPVGenerationW: pvMap.size > 0 ? pvMap : undefined,
      socFloor: parseFloat(settings.discharge_soc_floor) || 0,
      startSOC,
      startIndex,
    });

    return slots.map((slot, index) => ({
      ...withExtras(slot, index),
      forecastSOC: forecast[index] ?? undefined,
      forecastSOCEnd: forecast[index]?.end,
      actualSOC: actualSOCMap.get(toSlotKey(slot.validFrom)) ?? undefined,
    }));
  }, [slots, state.battery_soc, settings, actualSOCMap, pvAligned, usageLookup]);

  const visibleSlots = useMemo(() => {
    if (!selectedDay) {
      return slotsWithSOC;
    }

    return slotsWithSOC.filter((slot) => slot.dayKey === selectedDay);
  }, [selectedDay, slotsWithSOC]);

  const selectedDayIndex = selectedDay ? availableDays.indexOf(selectedDay) : -1;
  const previousDay = selectedDayIndex > 0 ? availableDays[selectedDayIndex - 1] : null;
  const nextDay = selectedDayIndex >= 0 && selectedDayIndex < availableDays.length - 1
    ? availableDays[selectedDayIndex + 1]
    : null;
  const viewingToday = selectedDay === todayDay;
  const isHistoricalDay = Boolean(selectedDay && selectedDay < todayDay);
  const canEditDay = Boolean(selectedDay && selectedDay >= todayDay);

  const chartSlots = useMemo(() => {
    if (!viewingToday) {
      return visibleSlots;
    }

    return sliceTimeWindowsFromCurrentPeriod(
      visibleSlots,
      (slot) => slot.validFrom,
      (slot) => slot.validTo,
      effectiveNow,
    );
  }, [effectiveNow, viewingToday, visibleSlots]);

  useEffect(() => {
    if (!viewingToday || visibleSlots.length === 0 || !tableRef.current) {
      return;
    }

    const currentRow = tableRef.current.querySelector('[data-current="true"]');
    if (currentRow) {
      currentRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [viewingToday, visibleSlots]);

  const handleFetchRates = async () => {
    setLoading(true);
    try {
      await fetch('/api/rates', { method: 'POST' });
      await fetchData();
    } catch {
      setError('Failed to fetch rates');
      setLoading(false);
    }
  };

  const handleRunSchedule = async () => {
    try {
      const res = await fetch('/api/schedule', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || 'Failed to run schedule');
        return;
      }

      setError(null);
      setRunMessage({
        kind: json.status === 'scheduled' ? 'success' : 'warning',
        text: json.message,
      });
      await fetchData();
    } catch {
      setError('Failed to run schedule');
    }
  };

  const handleClearOverrides = async () => {
    try {
      await fetch('/api/overrides', { method: 'DELETE' });
      await fetchData();
    } catch {
      setError('Failed to clear overrides');
    }
  };

  const handleSetOverride = async (slot: PlanSlot, action: PlanAction) => {
    try {
      await fetch('/api/overrides', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_start: slot.validFrom, slot_end: slot.validTo, action }),
      });
      await fetchData();
    } catch {
      setError('Failed to set override');
    }
  };

  const handleClearOverride = async (slot: PlanSlot) => {
    try {
      await fetch(`/api/overrides?slot_start=${encodeURIComponent(slot.validFrom)}`, { method: 'DELETE' });
      await fetchData();
    } catch {
      setError('Failed to clear override');
    }
  };

  const stats = useMemo(() => {
    if (chartSlots.length === 0) {
      return null;
    }

    const prices = chartSlots.map((slot) => slot.price);
    return {
      min: Math.round(Math.min(...prices) * 100) / 100,
      max: Math.round(Math.max(...prices) * 100) / 100,
      avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
    };
  }, [chartSlots]);

  const tableSlots = useMemo(() => {
    if (!viewingToday) return visibleSlots;
    return sliceTimeWindowsFromCurrentPeriod(
      visibleSlots,
      (slot) => slot.validFrom,
      (slot) => slot.validTo,
      effectiveNow,
    );
  }, [effectiveNow, viewingToday, visibleSlots]);

  const hasOverrides = visibleSlots.some((slot) => slot.overrideAction !== null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Charge plan"
        description="See the effective action for every tariff slot, overlay manual overrides, and inspect the resulting state-of-charge forecast."
        actions={(
          <>
            {canEditDay && hasOverrides ? (
              <Button onClick={handleClearOverrides} variant="secondary" size="sm">
                <Trash2 size={14} />
                Clear overrides
              </Button>
            ) : null}
            <Button onClick={handleFetchRates} disabled={loading} size="sm">
              <RefreshCw size={14} />
              Fetch rates
            </Button>
            <Button onClick={handleRunSchedule} variant="success" size="sm">
              <Play size={14} />
              Run schedule
            </Button>
          </>
        )}
      />

      {selectedDay && availableDays.length > 0 ? (
        <Card>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="sb-eyebrow">Viewing day</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h2 className="sb-display text-2xl text-sb-text sm:text-3xl">
                  {formatScheduleDayLabel(selectedDay)}
                </h2>
                <Badge kind={viewingToday ? 'success' : isHistoricalDay ? 'info' : 'warning'}>
                  {viewingToday ? 'Today' : isHistoricalDay ? 'History' : 'Upcoming'}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-sb-text-muted">
                {viewingToday
                  ? 'The plan defaults to the current UK-local day. Navigate backward or forward to inspect recent records.'
                  : isHistoricalDay
                    ? 'Past days remain available as read-only records so you can review how SolarBuddy planned and executed prior slots.'
                    : 'Future days use the currently stored tariff horizon and any persisted planner output for that day.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => previousDay && setSelectedDay(previousDay)} disabled={!previousDay} variant="secondary" size="sm">
                <ChevronLeft size={14} />
                Previous day
              </Button>
              <Button
                onClick={() => setSelectedDay(todayDay)}
                disabled={viewingToday || !availableDays.includes(todayDay)}
                variant="secondary"
                size="sm"
              >
                Today
              </Button>
              <Button onClick={() => nextDay && setSelectedDay(nextDay)} disabled={!nextDay} variant="secondary" size="sm">
                Next day
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {stats && (
        <div className="grid grid-cols-1 divide-y divide-sb-rule border-y border-sb-rule sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-5 sm:px-6">
            <Figure label="Minimum" value={`${stats.min}p/kWh`} tone="success" size="sm" />
          </div>
          <div className="px-4 py-5 sm:px-6">
            <Figure label="Average" value={`${stats.avg}p/kWh`} tone="default" size="sm" />
          </div>
          <div className="px-4 py-5 sm:px-6">
            <Figure label="Maximum" value={`${stats.max}p/kWh`} tone="danger" size="sm" />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-sb-danger">{error}</p>}
      {runMessage && (
        <p className={`text-sm ${runMessage.kind === 'success' ? 'text-sb-success' : 'text-sb-warning'}`}>
          {runMessage.text}
        </p>
      )}

      <Card>
        <CardHeader
          title="Plan overview"
          subtitle="Manual overrides take precedence over the automatically planned action for each slot."
        />
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-sb-text-muted">
          {PLAN_ACTIONS.map((action) => (
            <span key={action} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: ACTION_COLORS[action] }} />
              {ACTION_LABELS[action]}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded border-2 border-sb-ember" /> Current
          </span>
          {state.battery_soc !== null ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sb-text-muted" /> Predicted SOC
            </span>
          ) : null}
          {chartSlots.some((s) => s.actualSOC != null) ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 border-t-2 border-sb-accent" /> Actual SOC
            </span>
          ) : null}
          {pvEnabled && chartSlots.some((s) => s.pvGenerationKw != null) ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: colors.solar, opacity: 0.5 }} /> Solar forecast
            </span>
          ) : null}
          {chartSlots.some((s) => s.estimatedLoadKw != null) ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sb-danger" /> Est. load
            </span>
          ) : null}
        </div>

        {loading && slots.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading plan data...</p>
        ) : slots.length === 0 ? (
          <EmptyState
            title="No rates loaded yet"
            description="Fetch the current rate horizon to populate the charge plan and allow the scheduler to generate actions."
          />
        ) : chartSlots.length === 0 ? (
          <EmptyState
            title="No slot history for this day"
            description="SolarBuddy does not have stored tariff slots for the selected day yet."
          />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartSlots} margin={{ top: 5, right: 50, bottom: 5, left: 5 }}>
              <XAxis
                dataKey="validFrom"
                tick={{ fill: colors.muted, fontSize: 11 }}
                interval="preserveStartEnd"
                tickCount={12}
                tickFormatter={formatSlotTimeLabel}
              />
              <YAxis yAxisId="price" tick={{ fill: colors.muted, fontSize: 11 }} />
              <YAxis
                yAxisId="soc"
                orientation="right"
                domain={[0, 100]}
                tick={{ fill: colors.muted, fontSize: 11 }}
                tickFormatter={(value: number) => `${value}%`}
                width={45}
              />
              <YAxis
                yAxisId="pv"
                orientation="right"
                domain={[0, 'dataMax']}
                hide
                width={0}
              />
              <Tooltip content={<SlotTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <ReferenceLine yAxisId="price" y={0} stroke={colors.border} />
              {pvEnabled && chartSlots.some((s) => s.pvGenerationKw != null) ? (
                <Area
                  yAxisId="pv"
                  type="monotone"
                  dataKey="pvGenerationKw"
                  fill={colors.solar}
                  fillOpacity={0.2}
                  stroke={colors.solar}
                  strokeWidth={1.5}
                  strokeOpacity={0.6}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ) : null}
              {chartSlots.some((s) => s.estimatedLoadKw != null) ? (
                <Line
                  yAxisId="pv"
                  type="stepAfter"
                  dataKey="estimatedLoadKw"
                  stroke={colors.danger}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ) : null}
              <Bar yAxisId="price" dataKey="price" radius={[2, 2, 0, 0]}>
                {chartSlots.map((entry) => (
                  <Cell
                    key={entry.validFrom}
                    fill={ACTION_COLORS[entry.effectiveAction]}
                    stroke={entry.isCurrent ? colors.ember : 'none'}
                    strokeWidth={entry.isCurrent ? 2 : 0}
                    opacity={entry.isPast ? 0.4 : 1}
                  />
                ))}
              </Bar>
              {state.battery_soc !== null ? (
                <Line
                  yAxisId="soc"
                  type="linear"
                  dataKey="forecastSOCEnd"
                  stroke={colors.muted}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                />
              ) : null}
              <Line
                yAxisId="soc"
                type="linear"
                dataKey="actualSOC"
                stroke={colors.accent}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {tableSlots.length > 0 ? (
        <Card>
          <CardHeader
            title="Slot details"
            subtitle={canEditDay
              ? 'Use the action chips to force a charge, discharge, hold, or no-op override on an individual half-hour slot.'
              : 'Past days are read-only so the table reflects the recorded plan and outcomes without allowing retroactive edits.'}
          />
          <div ref={tableRef} className="max-h-[500px] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 z-10 bg-sb-card">
                <tr className="border-b border-sb-border text-left text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                  <th className="px-3 py-3 font-medium">Time</th>
                  <th className="px-3 py-3 font-medium">Price</th>
                  <th className="px-3 py-3 font-medium">Plan</th>
                  <th className="px-3 py-3 font-medium">Est. SoC</th>
                  <th className="px-3 py-3 font-medium">Est. PV</th>
                  <th className="px-3 py-3 font-medium">Est. Load</th>
                  <th className="px-3 py-3 font-medium">Override</th>
                  <th className="px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tableSlots.map((slot) => (
                  <tr
                    key={slot.validFrom}
                    data-current={slot.isCurrent || undefined}
                    className={`border-b border-sb-border/50 transition-colors ${
                      slot.isCurrent
                        ? 'border-l-4 border-l-yellow-400 bg-yellow-400/5'
                        : slot.isPast
                          ? 'opacity-50'
                          : ''
                    }`}
                  >
                    <td className="px-3 py-3 whitespace-nowrap text-sb-text">
                      {slot.isCurrent ? (
                        <CurrentSlotTimeCell validFrom={slot.validFrom} validTo={slot.validTo} />
                      ) : (
                        <>{slot.time} - {formatSlotTime(slot.validTo)}</>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={slot.price < 0 ? 'font-medium text-sb-success' : 'text-sb-text-muted'}>
                        {slot.price.toFixed(2)}p
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="relative cursor-help"
                        onMouseEnter={(e) => {
                          const tip = e.currentTarget.querySelector<HTMLElement>('[data-reason-tip]');
                          if (tip) tip.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          const tip = e.currentTarget.querySelector<HTMLElement>('[data-reason-tip]');
                          if (tip) tip.style.opacity = '0';
                        }}
                      >
                        <Badge kind={ACTION_BADGE_KIND[slot.plannedAction]}>
                          {ACTION_LABELS[slot.plannedAction]}
                        </Badge>
                        <span
                          data-reason-tip
                          className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-56 rounded-md border border-sb-rule-strong bg-sb-card/95 px-3 py-2 text-xs leading-relaxed text-sb-text-muted shadow-lg backdrop-blur-sm transition-opacity"
                          style={{ opacity: 0 }}
                        >
                          {slot.reason}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap font-[family-name:var(--font-sb-mono)] text-xs text-sb-text-muted">
                      {slot.forecastSOC != null
                        ? slot.forecastSOC.start !== slot.forecastSOC.end
                          ? `${slot.forecastSOC.start}% \u2192 ${slot.forecastSOC.end}%`
                          : `${slot.forecastSOC.end}%`
                        : '\u2014'}
                      {(() => {
                        if (!slot.forecastSOC || !settings || slot.forecastSOC.start === slot.forecastSOC.end) return null;
                        const deltaPercent = slot.forecastSOC.end - slot.forecastSOC.start;
                        const batteryKwh = parseFloat(settings.battery_capacity_kwh) || 5.12;
                        // Signed: + for charging (energy in), - for discharging (energy out).
                        // Multiplied by the import price this yields the net cost to the user:
                        // positive = pays, negative = earns/saves. Handles negative-price slots
                        // where charging is actually a credit.
                        const signedEnergyKwh = (deltaPercent / 100) * batteryKwh;
                        const netCostPence = signedEnergyKwh * slot.price;
                        if (Math.abs(netCostPence) < 0.05) return null;
                        const isSaving = netCostPence < 0;
                        const absValue = Math.abs(netCostPence);
                        const formatted = absValue < 1 ? `${absValue.toFixed(1)}p` : formatCost(absValue);
                        return (
                          <span className={isSaving ? 'ml-1 text-sb-success' : 'ml-1 text-sb-danger'}>
                            ({isSaving ? '-' : ''}{formatted})
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap font-[family-name:var(--font-sb-mono)] text-xs text-sb-text-muted">
                      {slot.pvGenerationKw != null ? `${(slot.pvGenerationKw * 0.5).toFixed(2)} kWh` : '\u2014'}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap font-[family-name:var(--font-sb-mono)] text-xs text-sb-text-muted">
                      {slot.estimatedLoadKw != null ? `${(slot.estimatedLoadKw * 0.5).toFixed(2)} kWh` : '\u2014'}
                    </td>
                    <td className="px-3 py-3">
                      {slot.overrideAction ? (
                        <Badge kind={ACTION_BADGE_KIND[slot.overrideAction]}>
                          {ACTION_LABELS[slot.overrideAction]}
                        </Badge>
                      ) : (
                        <span className="text-sb-text-muted">&mdash;</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        {PLAN_ACTIONS.map((action) => {
                          const Icon = ACTION_ICON[action];
                          const isActive = slot.effectiveAction === action;
                          const actionDisabled = !canEditDay;

                          return (
                            <button
                              key={action}
                              type="button"
                              disabled={actionDisabled}
                              onClick={() => handleSetOverride(slot, action)}
                              title={actionDisabled ? 'Historical slots are read-only' : ACTION_LABELS[action]}
                              className={`rounded-xl p-1.5 transition-colors ${
                                actionDisabled
                                  ? 'cursor-not-allowed opacity-40'
                                  : isActive
                                    ? 'ring-2 ring-offset-1 ring-offset-sb-card'
                                    : 'hover:bg-sb-active'
                              }`}
                              style={
                                isActive
                                  ? {
                                      backgroundColor: `${ACTION_COLORS[action]}30`,
                                      color: ACTION_COLORS[action],
                                      boxShadow: `0 0 0 2px ${ACTION_COLORS[action]}55`,
                                    }
                                  : { color: colors.muted }
                              }
                            >
                              <Icon size={14} />
                            </button>
                          );
                        })}
                        {slot.overrideAction ? (
                          <button
                            type="button"
                            disabled={!canEditDay}
                            onClick={() => handleClearOverride(slot)}
                            title={canEditDay ? 'Clear override' : 'Historical slots are read-only'}
                            className={`rounded p-1.5 ${
                              canEditDay
                                ? 'text-sb-text-muted hover:bg-sb-active hover:text-sb-danger'
                                : 'cursor-not-allowed text-sb-text-muted/50'
                            }`}
                          >
                            <X size={14} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
