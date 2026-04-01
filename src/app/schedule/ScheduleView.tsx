'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { RefreshCw, Play, Trash2, Zap, BatteryLow, Pause, Circle, X } from 'lucide-react';
import { useChartColors } from '@/hooks/useTheme';
import { useSSE } from '@/hooks/useSSE';
import { computeSOCForecast } from '@/lib/soc-forecast';
import {
  type PlanAction,
  PLAN_ACTIONS,
  ACTION_COLORS,
  ACTION_LABELS,
  ACTION_BADGE_KIND,
} from '@/lib/plan-actions';

/* ---------- types ---------- */

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
  action: PlanAction;
}

interface PlanSlot {
  time: string;
  price: number;
  validFrom: string;
  validTo: string;
  isCurrent: boolean;
  isPast: boolean;
  plannedAction: PlanAction;
  overrideAction: PlanAction | null;
  effectiveAction: PlanAction;
  forecastSOC?: number;
}

/* ---------- helpers ---------- */

const ACTION_ICON: Record<PlanAction, typeof Zap> = {
  charge: Zap,
  discharge: BatteryLow,
  hold: Pause,
  do_nothing: Circle,
};

function SlotTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) {
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

function formatSlotTime(iso: string) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/* ---------- component ---------- */

export default function ScheduleView() {
  const colors = useChartColors();
  const { state } = useSSE();
  const tableRef = useRef<HTMLDivElement>(null);

  const [slots, setSlots] = useState<PlanSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<{ kind: 'success' | 'warning'; text: string } | null>(null);
  const [settings, setSettings] = useState<{
    charge_rate: string;
    battery_capacity_kwh: string;
    max_charge_power_kw: string;
    estimated_consumption_w: string;
  } | null>(null);

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

      const rates: Rate[] = ratesJson.rates || [];
      const schedules: Schedule[] = scheduleJson.schedules || [];
      const overrides: Override[] = overridesJson.overrides || [];
      const now = new Date();

      // Build set of scheduled charge slot starts
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

      // Build map of override actions by slot start
      const overrideMap = new Map<string, PlanAction>();
      for (const o of overrides) {
        overrideMap.set(o.slot_start, o.action || 'charge');
      }

      const planSlots: PlanSlot[] = rates.map((rate) => {
        const dt = new Date(rate.valid_from);
        const endDt = new Date(rate.valid_to);
        const isCurrent = now >= dt && now < endDt;
        const isPast = now >= endDt;
        const plannedAction: PlanAction = scheduledTimes.has(rate.valid_from) ? 'charge' : 'do_nothing';
        const overrideAction = overrideMap.get(rate.valid_from) ?? null;
        const effectiveAction = overrideAction ?? plannedAction;

        return {
          time: `${formatSlotTime(rate.valid_from)}`,
          price: Math.round(rate.price_inc_vat * 100) / 100,
          validFrom: rate.valid_from,
          validTo: rate.valid_to,
          isCurrent,
          isPast,
          plannedAction,
          overrideAction,
          effectiveAction,
        };
      });

      setSlots(planSlots);
      setError(null);
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

  // Auto-scroll table to current slot
  useEffect(() => {
    if (slots.length === 0 || !tableRef.current) return;
    const currentRow = tableRef.current.querySelector('[data-current="true"]');
    if (currentRow) {
      currentRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [slots]);

  // Build SOC forecast
  const slotsWithSOC = useMemo(() => {
    if (slots.length === 0 || state.battery_soc === null || !settings) return slots;

    const currentIndex = slots.findIndex((s) => s.isCurrent);
    const slotActions = new Map<number, PlanAction>();
    slots.forEach((s, i) => {
      if (s.effectiveAction !== 'do_nothing') {
        slotActions.set(i, s.effectiveAction);
      }
    });

    const forecast = computeSOCForecast({
      currentSOC: state.battery_soc,
      currentSlotIndex: currentIndex >= 0 ? currentIndex : 0,
      slotActions,
      totalSlots: slots.length,
      chargeRatePercent: parseFloat(settings.charge_rate) || 100,
      batteryCapacityWh: (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000,
      maxChargePowerW: (parseFloat(settings.max_charge_power_kw) || 3.6) * 1000,
      estimatedConsumptionW: parseFloat(settings.estimated_consumption_w) || 500,
    });

    return slots.map((s, i) => ({ ...s, forecastSOC: forecast[i] ?? undefined }));
  }, [slots, state.battery_soc, settings]);

  /* ---------- actions ---------- */

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

  /* ---------- stats ---------- */

  const stats = useMemo(() => {
    if (slots.length === 0) return null;
    const prices = slots.map((s) => s.price);
    return {
      min: Math.round(Math.min(...prices) * 100) / 100,
      max: Math.round(Math.max(...prices) * 100) / 100,
      avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
    };
  }, [slots]);

  const hasOverrides = slots.some((s) => s.overrideAction !== null);

  /* ---------- render ---------- */

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Charge plan"
        description="See the effective action for every tariff slot, overlay manual overrides, and inspect the resulting state-of-charge forecast."
        actions={(
          <>
            {hasOverrides ? (
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

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Minimum</p>
            <p className="mt-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-sb-success">{stats.min}p/kWh</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Average</p>
            <p className="mt-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-sb-text">{stats.avg}p/kWh</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Maximum</p>
            <p className="mt-3 text-[1.7rem] font-semibold tracking-[-0.03em] text-sb-danger">{stats.max}p/kWh</p>
          </Card>
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
            <span className="inline-block h-2.5 w-2.5 rounded border-2 border-yellow-400" /> Current
          </span>
          {state.battery_soc !== null && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sb-text-muted" /> Predicted SOC
            </span>
          )}
        </div>

        {loading && slots.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading plan data...</p>
        ) : slots.length === 0 ? (
          <EmptyState
            title="No rates loaded yet"
            description="Fetch the current rate horizon to populate the charge plan and allow the scheduler to generate actions."
          />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={slotsWithSOC} margin={{ top: 5, right: 50, bottom: 5, left: 5 }}>
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
              <Tooltip content={<SlotTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <ReferenceLine yAxisId="price" y={0} stroke={colors.border} />
              <Bar yAxisId="price" dataKey="price" radius={[2, 2, 0, 0]}>
                {slotsWithSOC.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={ACTION_COLORS[entry.effectiveAction]}
                    stroke={entry.isCurrent ? '#facc15' : 'none'}
                    strokeWidth={entry.isCurrent ? 2 : 0}
                    opacity={entry.isPast ? 0.4 : 1}
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
        )}
      </Card>

      {/* Slot Table */}
      {slots.length > 0 && (
        <Card>
          <CardHeader
            title="Slot details"
            subtitle="Use the action chips to force a charge, discharge, hold, or no-op override on an individual half-hour slot."
          />
          <div ref={tableRef} className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-sb-card">
                <tr className="border-b border-sb-border text-left text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                  <th className="px-3 py-3 font-medium">Time</th>
                  <th className="px-3 py-3 font-medium">Price</th>
                  <th className="px-3 py-3 font-medium">Plan</th>
                  <th className="px-3 py-3 font-medium">Override</th>
                  <th className="px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {slotsWithSOC.map((slot) => (
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
                      {slot.time} – {formatSlotTime(slot.validTo)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={slot.price < 0 ? 'text-sb-success font-medium' : 'text-sb-text-muted'}>
                        {slot.price.toFixed(2)}p
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Badge kind={ACTION_BADGE_KIND[slot.plannedAction]}>
                        {ACTION_LABELS[slot.plannedAction]}
                      </Badge>
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
                          return (
                            <button
                              key={action}
                              onClick={() => handleSetOverride(slot, action)}
                              title={ACTION_LABELS[action]}
                              className={`rounded-xl p-1.5 transition-colors ${
                                isActive
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
                        {slot.overrideAction && (
                          <button
                            onClick={() => handleClearOverride(slot)}
                            title="Clear override"
                            className="rounded p-1.5 text-sb-text-muted hover:bg-sb-active hover:text-sb-danger"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </td>
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
