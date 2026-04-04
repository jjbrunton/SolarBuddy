'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { expandHalfHourSlotKeys, formatSlotTimeLabel, formatSlotTooltipLabel, toSlotKey } from '@/lib/slot-key';
import { ACTION_COLORS, ACTION_LABELS, type PlanAction } from '@/lib/plan-actions';
import { useSSE } from '@/hooks/useSSE';

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
  action: PlanAction;
}

interface ChartData {
  price: number;
  plannedAction: PlanAction;
  isCurrent: boolean;
  fullTime: string;
}

export default function RateChart() {
  const { state } = useSSE();
  const effectiveNow = useMemo(
    () => (state.runtime_mode === 'virtual' && state.virtual_time ? new Date(state.virtual_time) : new Date()),
    [state.runtime_mode, state.virtual_time],
  );
  const effectiveNowRef = useRef(effectiveNow);
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    effectiveNowRef.current = effectiveNow;
  }, [effectiveNow]);

  const fetchData = async () => {
    try {
      const [ratesRes, scheduleRes] = await Promise.all([fetch('/api/rates'), fetch('/api/schedule')]);

      const ratesJson = await ratesRes.json();
      const scheduleJson = await scheduleRes.json();

      const rates: Rate[] = ratesJson.rates || [];
      const schedules: Schedule[] = scheduleJson.schedules || [];
      const plannedSlots: PlannedSlotRow[] = scheduleJson.plan_slots || [];

      const now = effectiveNowRef.current;

      const plannedActionMap = new Map<string, PlanAction>();
      for (const slot of plannedSlots) {
        plannedActionMap.set(toSlotKey(slot.slot_start), slot.action);
      }

      for (const s of schedules) {
        if (s.status === 'planned' || s.status === 'active') {
          for (const slotKey of expandHalfHourSlotKeys(s.slot_start, s.slot_end)) {
            if (!plannedActionMap.has(slotKey)) {
              plannedActionMap.set(slotKey, s.type === 'discharge' ? 'discharge' : 'charge');
            }
          }
        }
      }

      const chartData: ChartData[] = rates.map((rate) => {
        const dt = new Date(rate.valid_from);
        const isCurrent = now >= dt && now < new Date(rate.valid_to);

        return {
          price: Math.round(rate.price_inc_vat * 100) / 100,
          plannedAction: plannedActionMap.get(toSlotKey(rate.valid_from)) ?? 'do_nothing',
          isCurrent,
          fullTime: rate.valid_from,
        };
      });

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
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

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

  if (loading && data.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-zinc-400">Loading rates...</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Agile Rates (p/kWh)</h2>
        <div className="flex gap-2">
          <button
            onClick={handleFetchRates}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Fetch Rates
          </button>
          <button
            onClick={handleRunSchedule}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
          >
            Run Schedule
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {data.length === 0 ? (
        <p className="text-zinc-400">
          No rates loaded. Click &quot;Fetch Rates&quot; to get current Agile prices.
        </p>
      ) : (
        <>
          <div className="mb-3 flex gap-4 text-xs text-zinc-400">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-blue-500" /> Rate
            </span>
            {(['charge', 'discharge', 'hold'] as PlanAction[]).map((action) => (
              <span key={action} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: ACTION_COLORS[action] }} /> {ACTION_LABELS[action]}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded border-2 border-yellow-400" /> Current
            </span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis
                dataKey="fullTime"
                tick={{ fill: '#a1a1aa', fontSize: 11 }}
                interval="preserveStartEnd"
                tickCount={12}
                tickFormatter={formatSlotTimeLabel}
              />
              <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  color: '#fafafa',
                }}
                labelFormatter={(label) => `Time: ${formatSlotTooltipLabel(label)}`}
                formatter={(value) => [`${value}p/kWh`, 'Price']}
              />
              <ReferenceLine y={0} stroke="#666" />
              <Bar dataKey="price" radius={[2, 2, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={entry.plannedAction !== 'do_nothing' ? ACTION_COLORS[entry.plannedAction] : entry.price < 0 ? '#f59e0b' : '#3b82f6'}
                    stroke={entry.isCurrent ? '#facc15' : 'none'}
                    strokeWidth={entry.isCurrent ? 2 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
