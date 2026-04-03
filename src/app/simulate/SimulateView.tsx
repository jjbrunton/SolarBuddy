'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/analytics/StatCard';
import { Play, Loader2 } from 'lucide-react';
import { useChartColors } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { formatCost } from '@/lib/forecast';
import {
  type PlanAction,
  PLAN_ACTIONS,
  ACTION_COLORS,
  ACTION_LABELS,
  ACTION_BADGE_KIND,
} from '@/lib/plan-actions';

/* ---------- Types ---------- */

interface SimSlot {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  reason: string;
  soc_before: number;
  soc_after: number;
  import_kwh: number;
  export_kwh: number;
  cost_pence: number;
  revenue_pence: number;
  pv_generation_kwh: number;
  import_rate: number;
  export_rate: number;
}

interface SimSummary {
  total_import_cost: number;
  total_export_revenue: number;
  net_cost: number;
  max_soc: number;
  min_soc: number;
  charge_slot_count: number;
  discharge_slot_count: number;
  hold_slot_count: number;
  total_pv_kwh: number;
}

interface SimResult {
  ok: true;
  startSoc: number;
  slots: SimSlot[];
  summary: SimSummary;
}

/* ---------- Helpers ---------- */

function formatSlotTime(iso: string) {
  const date = new Date(iso);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatSlotRange(start: string, end: string) {
  return `${formatSlotTime(start)} - ${formatSlotTime(end)}`;
}

/* ---------- Chart tooltip ---------- */

function SimTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; dataKey: string; payload: SimSlot }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const slot = payload[0]?.payload;
  if (!slot) return null;

  const rate = payload.find((p) => p.dataKey === 'import_rate');
  const soc = payload.find((p) => p.dataKey === 'soc_after');
  const pv = payload.find((p) => p.dataKey === 'pv_generation_kwh');

  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">
        {label ? formatSlotTime(label) : ''}
      </p>
      <p className="text-xs font-medium text-sb-text">
        <span
          className="mr-1.5 inline-block h-2 w-2 rounded"
          style={{ backgroundColor: ACTION_COLORS[slot.action] }}
        />
        {ACTION_LABELS[slot.action]}
      </p>
      {rate && (
        <p className="text-sm font-semibold text-sb-text">
          {rate.value.toFixed(2)}p/kWh
        </p>
      )}
      {soc && soc.value != null && (
        <p className="text-xs text-sb-text-muted">
          SOC: {slot.soc_before}% &rarr; {slot.soc_after}%
        </p>
      )}
      {slot.cost_pence !== 0 && (
        <p className="text-xs text-sb-text-muted">
          Cost: {formatCost(slot.cost_pence)}
        </p>
      )}
      {slot.revenue_pence !== 0 && (
        <p className="text-xs text-sb-text-muted">
          Revenue: {formatCost(slot.revenue_pence)}
        </p>
      )}
      {pv && pv.value > 0 && (
        <p className="text-xs text-sb-text-muted">
          PV: {pv.value.toFixed(2)} kWh
        </p>
      )}
    </div>
  );
}

/* ---------- Main component ---------- */

export default function SimulateView() {
  const colors = useChartColors();
  const { state: inverterState } = useSSE();

  const [startSoc, setStartSoc] = useState<number>(
    inverterState.battery_soc ?? 50,
  );
  const [smartDischarge, setSmartDischarge] = useState(true);
  const [peakProtection, setPeakProtection] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);

  const runSimulation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_soc: startSoc,
          settings_overrides: {
            smart_discharge: String(smartDischarge),
            peak_protection: String(peakProtection),
          },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.message || 'Simulation failed');
        return;
      }
      setResult(json as SimResult);
    } catch {
      setError('Failed to run simulation');
    } finally {
      setLoading(false);
    }
  }, [startSoc, smartDischarge, peakProtection]);

  const hasPV = useMemo(
    () => result?.summary.total_pv_kwh != null && result.summary.total_pv_kwh > 0,
    [result],
  );

  const netCostColor = useMemo(() => {
    if (!result) return 'text-sb-text';
    return result.summary.net_cost <= 0 ? 'text-sb-success' : 'text-sb-danger';
  }, [result]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tools"
        title="Simulation"
        description="Preview how the planner would schedule your battery without sending any commands."
        actions={
          <Button onClick={runSimulation} disabled={loading} variant="success" size="sm">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Run simulation
          </Button>
        }
      />

      {/* Controls */}
      <Card>
        <CardHeader
          title="Simulation parameters"
          subtitle="Adjust inputs to model different scenarios."
        />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {/* SOC slider */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">
              Starting SOC
            </label>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={startSoc}
                onChange={(e) => setStartSoc(Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-sb-border accent-sb-accent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sb-accent"
              />
              <span className="w-12 text-right text-sm font-semibold text-sb-text">
                {startSoc}%
              </span>
            </div>
          </div>

          {/* Smart discharge toggle */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">
              Smart Discharge
            </label>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setSmartDischarge(!smartDischarge)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  smartDischarge ? 'bg-sb-success' : 'bg-sb-border'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    smartDischarge ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="ml-2 text-sm text-sb-text-muted">
                {smartDischarge ? 'On' : 'Off'}
              </span>
            </div>
          </div>

          {/* Peak protection toggle */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">
              Peak Protection
            </label>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setPeakProtection(!peakProtection)}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  peakProtection ? 'bg-sb-success' : 'bg-sb-border'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    peakProtection ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="ml-2 text-sm text-sb-text-muted">
                {peakProtection ? 'On' : 'Off'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Error */}
      {error && <p className="text-sm text-sb-danger">{error}</p>}

      {/* Empty state */}
      {!result && !loading && (
        <EmptyState
          title="Run a simulation to see results"
          description="Configure your parameters above and click Run Simulation to preview how the planner would schedule your battery."
          action={
            <Button onClick={runSimulation} variant="success" size="sm">
              <Play size={14} />
              Run simulation
            </Button>
          }
        />
      )}

      {/* Loading state */}
      {loading && !result && (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-sb-text-muted" />
          <span className="ml-3 text-sm text-sb-text-muted">Running simulation...</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard
              label="Net Cost"
              value={formatCost(result.summary.net_cost)}
              valueColor={netCostColor}
              subtext={result.summary.net_cost <= 0 ? 'Savings' : 'Cost'}
            />
            <StatCard
              label="Import Cost"
              value={formatCost(result.summary.total_import_cost)}
              valueColor="text-sb-danger"
            />
            <StatCard
              label="Export Revenue"
              value={formatCost(result.summary.total_export_revenue)}
              valueColor="text-sb-success"
            />
            <StatCard
              label="SOC Range"
              value={`${result.summary.min_soc}–${result.summary.max_soc}%`}
            />
            <StatCard
              label="Slot Counts"
              value={`${result.summary.charge_slot_count}C / ${result.summary.discharge_slot_count}D / ${result.summary.hold_slot_count}H`}
              subtext="Charge / Discharge / Hold"
            />
            {hasPV && (
              <StatCard
                label="Total PV"
                value={`${result.summary.total_pv_kwh.toFixed(1)} kWh`}
                valueColor="text-sb-warning"
              />
            )}
          </div>

          {/* Chart */}
          <Card>
            <CardHeader
              title="Simulation timeline"
              subtitle="Import rate per slot coloured by planned action, with SOC forecast overlaid."
            />
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-sb-text-muted">
              {PLAN_ACTIONS.filter((a) => a !== 'do_nothing').map((action) => (
                <span key={action} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded"
                    style={{ backgroundColor: ACTION_COLORS[action] }}
                  />
                  {ACTION_LABELS[action]}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded"
                  style={{ backgroundColor: ACTION_COLORS.do_nothing }}
                />
                {ACTION_LABELS.do_nothing}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sb-text-muted" />
                SOC
              </span>
              {hasPV && (
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded"
                    style={{ backgroundColor: colors.solar, opacity: 0.3 }}
                  />
                  PV Generation
                </span>
              )}
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart
                data={result.slots}
                margin={{ top: 5, right: 50, bottom: 5, left: 5 }}
              >
                <XAxis
                  dataKey="slot_start"
                  tick={{ fill: colors.muted, fontSize: 11 }}
                  interval="preserveStartEnd"
                  tickCount={12}
                  tickFormatter={formatSlotTime}
                />
                <YAxis
                  yAxisId="rate"
                  tick={{ fill: colors.muted, fontSize: 11 }}
                  label={{
                    value: 'p/kWh',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: colors.muted, fontSize: 10 },
                  }}
                />
                <YAxis
                  yAxisId="soc"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fill: colors.muted, fontSize: 11 }}
                  tickFormatter={(value: number) => `${value}%`}
                  width={45}
                />
                <Tooltip
                  content={<SimTooltip />}
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                />
                <ReferenceLine yAxisId="rate" y={0} stroke={colors.border} />

                {hasPV && (
                  <Area
                    yAxisId="rate"
                    type="monotone"
                    dataKey="pv_generation_kwh"
                    fill={colors.solar}
                    fillOpacity={0.15}
                    stroke={colors.solar}
                    strokeWidth={1}
                    strokeOpacity={0.4}
                    dot={false}
                  />
                )}

                <Bar yAxisId="rate" dataKey="import_rate" radius={[2, 2, 0, 0]}>
                  {result.slots.map((entry) => (
                    <Cell
                      key={entry.slot_start}
                      fill={ACTION_COLORS[entry.action]}
                    />
                  ))}
                </Bar>

                <Line
                  yAxisId="soc"
                  type="monotone"
                  dataKey="soc_after"
                  stroke={colors.muted}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {/* Slot table */}
          <Card>
            <CardHeader
              title="Slot details"
              subtitle="Every half-hour slot with its planned action, rate, SOC transition, and cost impact."
            />
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-sb-card">
                  <tr className="border-b border-sb-border text-left text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                    <th className="px-3 py-3 font-medium">Time</th>
                    <th className="px-3 py-3 font-medium">Action</th>
                    <th className="px-3 py-3 font-medium">Rate</th>
                    <th className="px-3 py-3 font-medium">SOC</th>
                    <th className="px-3 py-3 font-medium">Cost / Rev</th>
                    {hasPV && <th className="px-3 py-3 font-medium">PV</th>}
                    <th className="px-3 py-3 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.slots.map((slot) => {
                    const netPence = slot.cost_pence - slot.revenue_pence;
                    return (
                      <tr
                        key={slot.slot_start}
                        className="border-b border-sb-border/50 transition-colors hover:bg-sb-active/30"
                      >
                        <td className="whitespace-nowrap px-3 py-3 text-sb-text">
                          {formatSlotRange(slot.slot_start, slot.slot_end)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge kind={ACTION_BADGE_KIND[slot.action]}>
                            {ACTION_LABELS[slot.action]}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-sb-text-muted">
                          {slot.import_rate.toFixed(2)}p
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-sb-text-muted">
                          {slot.soc_before}% &rarr; {slot.soc_after}%
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {netPence === 0 ? (
                            <span className="text-sb-text-muted">&mdash;</span>
                          ) : netPence > 0 ? (
                            <span className="font-medium text-sb-danger">
                              {formatCost(netPence)}
                            </span>
                          ) : (
                            <span className="font-medium text-sb-success">
                              {formatCost(Math.abs(netPence))}
                            </span>
                          )}
                        </td>
                        {hasPV && (
                          <td className="whitespace-nowrap px-3 py-3 text-sb-text-muted">
                            {slot.pv_generation_kwh > 0
                              ? `${slot.pv_generation_kwh.toFixed(2)} kWh`
                              : '\u2014'}
                          </td>
                        )}
                        <td className="px-3 py-3 text-xs leading-5 text-sb-text-muted">
                          {slot.reason}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
