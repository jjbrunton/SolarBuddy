'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Figure } from '@/components/ui/Figure';
import { PageHeader } from '@/components/ui/PageHeader';
import { RefreshCw, Play, Pencil, X, Save } from 'lucide-react';
import { useChartColors } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { sliceTimeWindowsFromCurrentPeriod } from '@/lib/chart-window';
import { computeSOCForecast } from '@/lib/soc-forecast';
import { expandHalfHourSlotKeys, formatSlotTimeLabel, formatSlotTooltipLabel, toSlotKey } from '@/lib/slot-key';
import { useSlotSelection } from '@/hooks/useSlotSelection';
import { ACTION_COLORS, ACTION_LABELS, type PlanAction } from '@/lib/plan-actions';
import { alignPVForecastToSlots, type PVConfidence } from '@/lib/pv-forecast-utils';
import type { PVForecastSlot } from '@/lib/solcast/client';

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
}

interface Override {
  slot_start: string;
  slot_end: string;
}

interface ScheduleRunResponse {
  ok: boolean;
  status: 'scheduled' | 'no_rates' | 'no_windows' | 'missing_config' | 'error';
  message: string;
}

interface ChartData {
  price: number;
  plannedAction: PlanAction;
  isCurrent: boolean;
  isOverride: boolean;
  forecastSOC?: number;
  validFrom: string;
  validTo: string;
  pvGenerationKw?: number;
}

// Ember is the override / selected colour — ties the selection state back to
// the Agile Almanac ember pole instead of a stray teal.
const OVERRIDE_EMBER = '#ffb547';
const CHART_LEFT_MARGIN = 45;
const CHART_RIGHT_MARGIN = 50;

function RateTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const price = payload.find((p) => p.dataKey === 'price');
  const soc = payload.find((p) => p.dataKey === 'forecastSOC');
  const pv = payload.find((p) => p.dataKey === 'pvGenerationKw');
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
        {soc && soc.value != null && <p>SOC  {soc.value}%</p>}
        {pv && pv.value != null && pv.value > 0 && <p>PV   {pv.value.toFixed(2)} kW</p>}
      </div>
    </div>
  );
}

export default function RatesView() {
  const colors = useChartColors();
  const { state } = useSSE();
  const effectiveNow = useMemo(
    () => (state.runtime_mode === 'virtual' && state.virtual_time ? new Date(state.virtual_time) : new Date()),
    [state.runtime_mode, state.virtual_time],
  );
  const effectiveNowRef = useRef(effectiveNow);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    effectiveNowRef.current = effectiveNow;
  }, [effectiveNow]);
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);
  const [stats, setStats] = useState<{ min: number; max: number; avg: number } | null>(null);
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<{
    charge_rate: string;
    battery_capacity_kwh: string;
    max_charge_power_kw: string;
    estimated_consumption_w: string;
  } | null>(null);
  const [pvForecasts, setPvForecasts] = useState<PVForecastSlot[]>([]);
  const [pvEnabled, setPvEnabled] = useState(false);
  const [pvConfidence, setPvConfidence] = useState<PVConfidence>('estimate');

  const {
    selectedIndices,
    isDragging,
    dragRange,
    setSelectedIndices,
    clearSelection,
    handlers: dragHandlers,
  } = useSlotSelection({
    containerRef: chartContainerRef,
    slotCount: data.length,
    chartLeftMargin: CHART_LEFT_MARGIN,
    chartRightMargin: CHART_RIGHT_MARGIN,
    enabled: editMode,
  });

  const fetchData = useCallback(async () => {
    try {
      const [ratesRes, scheduleRes, settingsRes, overridesRes] = await Promise.all([
        fetch('/api/rates'),
        fetch('/api/schedule'),
        fetch('/api/settings'),
        fetch('/api/overrides'),
      ]);
      const ratesJson = await ratesRes.json();
      const scheduleJson = await scheduleRes.json();
      const settingsJson = await settingsRes.json();
      const overridesJson = await overridesRes.json();
      setSettings(settingsJson);

      const isPvEnabled = settingsJson.pv_forecast_enabled === 'true';
      setPvEnabled(isPvEnabled);
      setPvConfidence(settingsJson.pv_forecast_confidence || 'estimate');

      const rates: Rate[] = ratesJson.rates || [];
      const schedules: Schedule[] = scheduleJson.schedules || [];
      const plannedSlots: PlannedSlotRow[] = scheduleJson.plan_slots || [];
      const overrides: Override[] = overridesJson.overrides || [];
      const now = effectiveNowRef.current;
      const visibleRates = sliceTimeWindowsFromCurrentPeriod(
        rates,
        (rate) => rate.valid_from,
        (rate) => rate.valid_to,
        now,
      );

      const plannedActionMap = new Map<string, PlanAction>();
      for (const slot of plannedSlots) {
        plannedActionMap.set(toSlotKey(slot.slot_start), slot.action);
      }

      const scheduledTimes = new Set<string>();
      for (const s of schedules) {
        if (s.status === 'planned' || s.status === 'active') {
          for (const slotKey of expandHalfHourSlotKeys(s.slot_start, s.slot_end)) {
            scheduledTimes.add(slotKey);
            if (!plannedActionMap.has(slotKey)) {
              plannedActionMap.set(slotKey, s.type === 'discharge' ? 'discharge' : 'charge');
            }
          }
        }
      }

      const overrideTimes = new Set<string>();
      for (const o of overrides) {
        for (const slotKey of expandHalfHourSlotKeys(o.slot_start, o.slot_end)) {
          overrideTimes.add(slotKey);
        }
      }

      const overrideIndices = new Set<number>();
      let curSlotIdx = 0;

      const chartData: ChartData[] = visibleRates.map((rate, i) => {
        const dt = new Date(rate.valid_from);
        const isCurrent = now >= dt && now < new Date(rate.valid_to);
        if (isCurrent) curSlotIdx = i;
        const slotKey = toSlotKey(rate.valid_from);
        const plannedAction: PlanAction = plannedActionMap.get(slotKey) ?? 'hold';
        const isOverride = overrideTimes.has(slotKey);
        if (isOverride) overrideIndices.add(i);

        return {
          price: Math.round(rate.price_inc_vat * 100) / 100,
          plannedAction,
          isCurrent,
          isOverride,
          validFrom: rate.valid_from,
          validTo: rate.valid_to,
        };
      });

      setCurrentSlotIndex(curSlotIdx);
      setSelectedIndices(overrideIndices);

      if (visibleRates.length > 0) {
        const prices = visibleRates.map((r) => r.price_inc_vat);
        setStats({
          min: Math.round(Math.min(...prices) * 100) / 100,
          max: Math.round(Math.max(...prices) * 100) / 100,
          avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
        });
      }

      setData(chartData);
      setError(null);

      if (isPvEnabled && visibleRates.length > 0) {
        try {
          const from = visibleRates[0].valid_from;
          const to = visibleRates[visibleRates.length - 1].valid_to;
          const forecastRes = await fetch(`/api/forecast?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
          const forecastJson = await forecastRes.json();
          setPvForecasts(forecastJson.forecasts || []);
        } catch {
          setPvForecasts([]);
        }
      } else {
        setPvForecasts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rates');
    } finally {
      setLoading(false);
    }
  }, [setSelectedIndices]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Combine scheduled + manual override slots for SOC forecast
  const allSlotActions = useMemo(() => {
    const actions = new Map<number, PlanAction>();
    data.forEach((entry, index) => {
      actions.set(index, entry.plannedAction);
    });
    for (const idx of selectedIndices) actions.set(idx, 'charge');
    return actions;
  }, [data, selectedIndices]);

  // Align PV forecast to rate slots
  const pvAligned = useMemo(() => {
    if (!pvEnabled || pvForecasts.length === 0 || data.length === 0) {
      return { perSlotPVGenerationW: undefined, pvChartValues: [] as (number | undefined)[] };
    }
    return alignPVForecastToSlots(pvForecasts, data.map((d) => d.validFrom), pvConfidence);
  }, [pvEnabled, pvForecasts, data, pvConfidence]);

  // Compute SOC forecast
  const chartDataWithSOC = useMemo(() => {
    if (data.length === 0 || state.battery_soc === null || !settings) return data;

    const forecast = computeSOCForecast({
      currentSOC: state.battery_soc,
      currentSlotIndex,
      slotActions: allSlotActions,
      totalSlots: data.length,
      chargeRatePercent: parseFloat(settings.charge_rate) || 100,
      batteryCapacityWh: (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000,
      maxChargePowerW: (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000,
      estimatedConsumptionW: parseFloat(settings.estimated_consumption_w) || 500,
      perSlotPVGenerationW: pvAligned.perSlotPVGenerationW,
    });

    return data.map((d, i) => ({
      ...d,
      forecastSOC: forecast[i] ?? undefined,
      pvGenerationKw: pvAligned.pvChartValues[i] != null ? pvAligned.pvChartValues[i]! / 1000 : undefined,
    }));
  }, [data, state.battery_soc, currentSlotIndex, allSlotActions, settings, pvAligned]);

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
      const json = await res.json() as ScheduleRunResponse;
      if (!res.ok || !json.ok) {
        setRunMessage(null);
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
      setRunMessage(null);
      setError('Failed to run schedule');
    }
  };

  const handleSaveOverrides = async () => {
    if (data.length === 0) return;
    setSaving(true);
    const slots: { slot_start: string; slot_end: string }[] = [];
    for (const idx of Array.from(selectedIndices).sort((a, b) => a - b)) {
      if (data[idx]) slots.push({ slot_start: data[idx].validFrom, slot_end: data[idx].validTo });
    }
    try {
      await fetch('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots }),
      });
      setEditMode(false);
    } catch {
      setError('Failed to save overrides');
    }
    setSaving(false);
  };

  const handleClearOverrides = async () => {
    try {
      await fetch('/api/overrides', { method: 'DELETE' });
      clearSelection();
    } catch {
      setError('Failed to clear overrides');
    }
  };

  const getBarFill = (entry: ChartData, index: number) => {
    const isInDragRange = isDragging && dragRange && index >= dragRange[0] && index <= dragRange[1];
    const isSelected = selectedIndices.has(index);
    if (isInDragRange) return OVERRIDE_EMBER + 'aa';
    if (isSelected) return OVERRIDE_EMBER;
    if (entry.price < 0 && entry.plannedAction === 'hold') return colors.ember;
    return ACTION_COLORS[entry.plannedAction];
  };

  const selectedCount = selectedIndices.size;
  const selectedHours = (selectedCount * 0.5).toFixed(1);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tariffs"
        title="Energy rates"
        description="Review the current Agile price horizon, compare it to the scheduler output, and set manual slot overrides directly on the chart."
        actions={(
          <>
            <Button onClick={() => setEditMode(!editMode)} variant={editMode ? 'warning' : 'secondary'} size="sm">
              {editMode ? <X size={14} /> : <Pencil size={14} />}
              {editMode ? 'Cancel' : 'Edit slots'}
            </Button>
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

      {/* Editorial stats band — hairline-divided, no boxed cards */}
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

      {/* Chart */}
      <Card>
        <CardHeader
          title="Agile rates (p/kWh)"
          subtitle="Manual overrides appear in teal and take precedence over the planner for SOC forecasting."
        />
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-sb-text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Rate
          </span>
          {(['charge', 'discharge', 'hold'] as PlanAction[]).map((action) => (
            <span key={action} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: ACTION_COLORS[action] }} /> {ACTION_LABELS[action]}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: OVERRIDE_EMBER }} /> Manual Override
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded border-2 border-sb-ember" /> Current
          </span>
          {state.battery_soc !== null && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sb-text-muted" /> Predicted SOC
            </span>
          )}
          {pvEnabled && pvForecasts.length > 0 && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded"
                style={{ backgroundColor: colors.solar, opacity: 0.3 }}
              />
              PV Forecast
            </span>
          )}
        </div>
        {loading && data.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading rates...</p>
        ) : data.length === 0 ? (
          <EmptyState
            title="No rates loaded yet"
            description="Fetch the current Agile price horizon to populate the chart and enable scheduling analysis."
          />
        ) : (
          <div
            ref={chartContainerRef}
            className={`relative ${editMode ? 'cursor-crosshair' : ''}`}
            style={{ touchAction: editMode ? 'none' : undefined }}
          >
            {editMode && <div className="absolute inset-0 z-10" {...dragHandlers} />}
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={chartDataWithSOC} margin={{ top: 5, right: 50, bottom: 5, left: 5 }}>
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
                  tickFormatter={(v: number) => `${v}%`}
                  width={45}
                />
                {!editMode && <Tooltip content={<RateTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />}
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
                  {chartDataWithSOC.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={getBarFill(entry, i)}
                      stroke={entry.isCurrent ? colors.ember : 'none'}
                      strokeWidth={entry.isCurrent ? 2 : 0}
                    />
                  ))}
                </Bar>
                {state.battery_soc !== null && (
                  <Line
                    yAxisId="soc"
                    type="linear"
                    dataKey="forecastSOC"
                    stroke={colors.muted}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Edit mode toolbar */}
        {editMode && data.length > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-sb-border bg-sb-surface-muted px-4 py-3">
            <p className="text-sm text-sb-text-muted">
              {selectedCount > 0
                ? `${selectedCount} slot${selectedCount !== 1 ? 's' : ''} selected (${selectedHours}h)`
                : 'Click and drag on the chart to select charge slots'}
            </p>
            <div className="flex gap-2">
              <Button onClick={handleClearOverrides} disabled={selectedCount === 0} variant="secondary" size="sm">
                Clear all
              </Button>
              <Button onClick={handleSaveOverrides} disabled={saving} size="sm">
                <Save size={14} />
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
