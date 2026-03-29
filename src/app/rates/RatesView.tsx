'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { RefreshCw, Play, Pencil, X, Save } from 'lucide-react';
import { useChartColors } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { computeSOCForecast } from '@/lib/soc-forecast';
import { useSlotSelection } from '@/hooks/useSlotSelection';

interface Rate {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
}

interface Schedule {
  slot_start: string;
  slot_end: string;
  status: string;
}

interface Override {
  slot_start: string;
  slot_end: string;
}

interface ChartData {
  time: string;
  price: number;
  isScheduled: boolean;
  isCurrent: boolean;
  isOverride: boolean;
  forecastSOC?: number;
  validFrom: string;
  validTo: string;
}

const TEAL = '#26a69a';
const CHART_LEFT_MARGIN = 45;
const CHART_RIGHT_MARGIN = 50;

function RateTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const price = payload.find((p) => p.dataKey === 'price');
  const soc = payload.find((p) => p.dataKey === 'forecastSOC');
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">{label}</p>
      {price && <p className="text-sm font-semibold text-sb-text">{price.value}p/kWh</p>}
      {soc && soc.value != null && <p className="text-xs text-sb-text-muted">SOC: {soc.value}%</p>}
    </div>
  );
}

export default function RatesView() {
  const colors = useChartColors();
  const { state } = useSSE();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ min: number; max: number; avg: number } | null>(null);
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0);
  const [scheduledIndices, setScheduledIndices] = useState<Set<number>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<{
    charge_rate: string;
    battery_capacity_kwh: string;
    max_charge_power_kw: string;
    estimated_consumption_w: string;
  } | null>(null);

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

  const fetchData = async () => {
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

      const rates: Rate[] = ratesJson.rates || [];
      const schedules: Schedule[] = scheduleJson.schedules || [];
      const overrides: Override[] = overridesJson.overrides || [];
      const now = new Date();

      const scheduledTimes = new Set<string>();
      for (const s of schedules) {
        if (s.status === 'planned' || s.status === 'active') {
          let cursor = new Date(s.slot_start);
          const end = new Date(s.slot_end);
          while (cursor < end) {
            scheduledTimes.add(cursor.toISOString());
            cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
          }
        }
      }

      const overrideTimes = new Set<string>();
      for (const o of overrides) {
        let cursor = new Date(o.slot_start);
        const end = new Date(o.slot_end);
        while (cursor < end) {
          overrideTimes.add(cursor.toISOString());
          cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
        }
      }

      const newScheduledIndices = new Set<number>();
      const overrideIndices = new Set<number>();
      let curSlotIdx = 0;

      const chartData: ChartData[] = rates.map((rate, i) => {
        const dt = new Date(rate.valid_from);
        const isCurrent = now >= dt && now < new Date(rate.valid_to);
        if (isCurrent) curSlotIdx = i;
        const isScheduled = scheduledTimes.has(rate.valid_from);
        const isOverride = overrideTimes.has(rate.valid_from);
        if (isScheduled) newScheduledIndices.add(i);
        if (isOverride) overrideIndices.add(i);

        return {
          time: `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`,
          price: Math.round(rate.price_inc_vat * 100) / 100,
          isScheduled,
          isCurrent,
          isOverride,
          validFrom: rate.valid_from,
          validTo: rate.valid_to,
        };
      });

      setCurrentSlotIndex(curSlotIdx);
      setScheduledIndices(newScheduledIndices);
      setSelectedIndices(overrideIndices);

      if (rates.length > 0) {
        const prices = rates.map((r) => r.price_inc_vat);
        setStats({
          min: Math.round(Math.min(...prices) * 100) / 100,
          max: Math.round(Math.max(...prices) * 100) / 100,
          avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
        });
      }

      setData(chartData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  // Combine scheduled + manual override slots for SOC forecast
  const allChargeSlots = useMemo(() => {
    const combined = new Set(scheduledIndices);
    for (const idx of selectedIndices) combined.add(idx);
    return combined;
  }, [scheduledIndices, selectedIndices]);

  // Compute SOC forecast
  const chartDataWithSOC = useMemo(() => {
    if (data.length === 0 || state.battery_soc === null || !settings) return data;

    const forecast = computeSOCForecast({
      currentSOC: state.battery_soc,
      currentSlotIndex,
      scheduledSlots: allChargeSlots,
      totalSlots: data.length,
      chargeRatePercent: parseFloat(settings.charge_rate) || 100,
      batteryCapacityWh: (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000,
      maxChargePowerW: (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000,
      estimatedConsumptionW: parseFloat(settings.estimated_consumption_w) || 500,
    });

    return data.map((d, i) => ({
      ...d,
      forecastSOC: forecast[i] ?? undefined,
    }));
  }, [data, state.battery_soc, currentSlotIndex, allChargeSlots, settings]);

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
      await fetch('/api/schedule', { method: 'POST' });
      await fetchData();
    } catch {
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
    if (isInDragRange) return TEAL + 'aa';
    if (isSelected) return TEAL;
    if (entry.isScheduled) return colors.success;
    if (entry.price < 0) return colors.warning;
    return colors.accent;
  };

  const selectedCount = selectedIndices.size;
  const selectedHours = (selectedCount * 0.5).toFixed(1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-sb-text">Energy Rates</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setEditMode(!editMode)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              editMode
                ? 'bg-sb-warning text-white'
                : 'bg-sb-card text-sb-text-muted hover:bg-sb-active hover:text-sb-text'
            }`}
          >
            {editMode ? <X size={14} /> : <Pencil size={14} />}
            {editMode ? 'Cancel' : 'Edit Slots'}
          </button>
          <button
            onClick={handleFetchRates}
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-sb-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-sb-accent-hover disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Fetch Rates
          </button>
          <button
            onClick={handleRunSchedule}
            className="flex items-center gap-2 rounded-md bg-sb-success px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            <Play size={14} />
            Run Schedule
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <p className="text-xs text-sb-text-muted">Minimum</p>
            <p className="mt-1 text-lg font-bold text-sb-success">{stats.min}p/kWh</p>
          </Card>
          <Card>
            <p className="text-xs text-sb-text-muted">Average</p>
            <p className="mt-1 text-lg font-bold text-sb-text">{stats.avg}p/kWh</p>
          </Card>
          <Card>
            <p className="text-xs text-sb-text-muted">Maximum</p>
            <p className="mt-1 text-lg font-bold text-sb-danger">{stats.max}p/kWh</p>
          </Card>
        </div>
      )}

      {error && <p className="text-sm text-sb-danger">{error}</p>}

      {/* Chart */}
      <Card>
        <CardHeader title="Agile Rates (p/kWh)" />
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-sb-text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Rate
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded bg-sb-success" /> Scheduled Charge
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: TEAL }} /> Manual Override
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded border-2 border-yellow-400" /> Current
          </span>
          {state.battery_soc !== null && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sb-text-muted" /> Predicted SOC
            </span>
          )}
        </div>
        {loading && data.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading rates...</p>
        ) : data.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">
            No rates loaded. Click &quot;Fetch Rates&quot; to get current Agile prices.
          </p>
        ) : (
          <div
            ref={chartContainerRef}
            className={`relative ${editMode ? 'cursor-crosshair' : ''}`}
            style={{ touchAction: editMode ? 'none' : undefined }}
          >
            {editMode && <div className="absolute inset-0 z-10" {...dragHandlers} />}
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart data={chartDataWithSOC} margin={{ top: 5, right: 50, bottom: 5, left: 5 }}>
                <XAxis dataKey="time" tick={{ fill: colors.muted, fontSize: 11 }} interval="preserveStartEnd" tickCount={12} />
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
                <Bar yAxisId="price" dataKey="price" radius={[2, 2, 0, 0]}>
                  {chartDataWithSOC.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={getBarFill(entry, i)}
                      stroke={entry.isCurrent ? '#facc15' : 'none'}
                      strokeWidth={entry.isCurrent ? 2 : 0}
                    />
                  ))}
                </Bar>
                {state.battery_soc !== null && (
                  <Line
                    yAxisId="soc"
                    type="monotone"
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
          <div className="mt-3 flex items-center justify-between rounded-md bg-sb-bg px-4 py-2.5">
            <p className="text-sm text-sb-text-muted">
              {selectedCount > 0
                ? `${selectedCount} slot${selectedCount !== 1 ? 's' : ''} selected (${selectedHours}h)`
                : 'Click and drag on the chart to select charge slots'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClearOverrides}
                disabled={selectedCount === 0}
                className="rounded-md bg-sb-card px-3 py-1.5 text-sm text-sb-text-muted hover:bg-sb-active disabled:opacity-50"
              >
                Clear All
              </button>
              <button
                onClick={handleSaveOverrides}
                disabled={saving}
                className="flex items-center gap-2 rounded-md bg-sb-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-sb-accent-hover disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
