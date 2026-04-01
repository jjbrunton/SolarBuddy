'use client';

import { useSSE } from '@/hooks/useSSE';
import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, BarChart, Bar, Cell } from 'recharts';
import { useChartColors } from '@/hooks/useTheme';
import { MpptCard } from '@/components/solar/MpptCard';
import { Activity, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { ChartTooltip, ChartTooltipRow } from '@/components/ui/ChartTooltip';
import { PageHeader } from '@/components/ui/PageHeader';
import { PlaceholderValue } from '@/components/ui/PlaceholderValue';

interface Reading {
  timestamp: string;
  pv_power: number | null;
  grid_power: number | null;
  load_power: number | null;
  battery_soc: number | null;
}

interface DailySummary {
  date: string;
  max_pv: number;
  readings_count: number;
}

function MpptTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: { name: string; power: number; fill: string } }[];
}) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;

  const point = payload[0].payload;

  return (
    <ChartTooltip label={point.name}>
      <ChartTooltipRow label="Power" value={`${point.power}W`} color={point.fill} emphasized />
    </ChartTooltip>
  );
}

function PowerFlowTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string; color?: string; value?: number }[];
}) {
  if (!active || !payload?.length) return null;

  const seriesLabels: Record<string, string> = {
    solar: 'Solar',
    load: 'Load',
    grid: 'Grid',
  };

  return (
    <ChartTooltip label={label}>
      {payload.map((entry) => {
        if (!entry.dataKey || entry.value == null) return null;

        return (
          <ChartTooltipRow
            key={entry.dataKey}
            label={seriesLabels[entry.dataKey] ?? entry.dataKey}
            value={`${entry.value}W`}
            color={entry.color}
          />
        );
      })}
    </ChartTooltip>
  );
}

export default function SolarView() {
  const colors = useChartColors();
  const { state } = useSSE();
  const [readings, setReadings] = useState<Reading[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/readings?period=today');
        const json = await res.json();
        setReadings(json.readings || []);
        setDailySummaries(json.daily || []);
      } catch { /* silent */ }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const chartData = readings.map((r) => ({
    time: new Date(r.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    solar: r.pv_power ?? 0,
    load: r.load_power ?? 0,
    grid: r.grid_power ?? 0,
  }));

  const maxPvToday = readings.reduce((max, r) => Math.max(max, r.pv_power ?? 0), 0);

  // MPPT comparison data for bar chart
  const mpptData = [
    { name: 'MPPT 1', power: state.pv_power_1 ?? 0, fill: '#facc15' },
    { name: 'MPPT 2', power: state.pv_power_2 ?? 0, fill: '#fb923c' },
  ];
  const hasMpptData = state.pv_power_1 != null || state.pv_power_2 != null;
  const renderCardValue = (value: string | null, className: string) =>
    value ? <p className={className}>{value}</p> : <div className="mt-3"><PlaceholderValue /></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Live Telemetry"
        title="Solar production"
        description="Understand total PV output, per-string MPPT performance, and how generation is flowing between load, battery, and grid."
      />

      {/* Overview cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Total Output</p>
          {renderCardValue(
            state.pv_power !== null ? `${state.pv_power}W` : null,
            'mt-3 text-[1.8rem] font-semibold tracking-[-0.03em] text-sb-solar',
          )}
          {hasMpptData && (
            <p className="mt-1 text-xs text-sb-text-muted">
              MPPT1: {state.pv_power_1 ?? 0}W + MPPT2: {state.pv_power_2 ?? 0}W
            </p>
          )}
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Peak Today</p>
          {renderCardValue(
            maxPvToday > 0 ? `${maxPvToday}W` : null,
            'mt-3 text-[1.8rem] font-semibold tracking-[-0.03em] text-sb-text',
          )}
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Grid Power</p>
          {renderCardValue(
            state.grid_power !== null
              ? `${state.grid_power > 0 ? 'Importing' : state.grid_power < 0 ? 'Exporting' : 'Neutral'} ${Math.abs(state.grid_power)}W`
              : null,
            'mt-3 text-[1.8rem] font-semibold tracking-[-0.03em] text-sb-text',
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">Grid Frequency</p>
              {renderCardValue(
                state.grid_frequency != null ? `${state.grid_frequency}Hz` : null,
                'mt-3 text-[1.8rem] font-semibold tracking-[-0.03em] text-sb-text',
              )}
            </div>
            <Activity size={20} className="text-sb-text-muted" />
          </div>
        </Card>
      </div>

      {/* Per-MPPT breakdown */}
      {hasMpptData && (
        <>
          <div className="flex items-center gap-2">
            <Sun size={16} className="text-sb-solar" />
            <h2 className="text-base font-semibold tracking-[-0.02em] text-sb-text">MPPT string detail</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MpptCard
              stringNumber={1}
              voltage={state.pv_voltage_1}
              current={state.pv_current_1}
              power={state.pv_power_1}
            />
            <MpptCard
              stringNumber={2}
              voltage={state.pv_voltage_2}
              current={state.pv_current_2}
              power={state.pv_power_2}
            />
          </div>

          {/* MPPT comparison chart */}
          <Card>
            <CardHeader title="MPPT Comparison">
              <Badge kind="info">Live</Badge>
            </CardHeader>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={mpptData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <XAxis type="number" tick={{ fill: colors.muted, fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: colors.muted, fontSize: 11 }} width={55} />
                  <Tooltip content={<MpptTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="power" radius={[0, 4, 4, 0]} barSize={20}>
                    {mpptData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}

      {/* Production chart */}
      <Card>
        <CardHeader title="Today's power flow" subtitle="Overlay solar generation, load demand, and grid flow across the current day." />
        {chartData.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">
            No readings recorded yet. Data will appear as the inverter reports values.
          </p>
        ) : (
          <>
            <div className="mb-3 flex gap-4 text-xs text-sb-text-muted">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-yellow-400" /> Solar
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-purple-400" /> Load
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Grid
              </span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <XAxis dataKey="time" tick={{ fill: colors.muted, fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: colors.muted, fontSize: 10 }} width={45} />
                <Tooltip content={<PowerFlowTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                <Line type="monotone" dataKey="solar" stroke="#facc15" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="load" stroke="#c084fc" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="grid" stroke="#5d9cec" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

      {/* Daily summary */}
      {dailySummaries.length > 0 && (
        <Card>
          <CardHeader title="Recent days" subtitle="Recent peak PV output and sample density from stored telemetry snapshots." />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sb-border text-left text-xs uppercase tracking-[0.16em] text-sb-text-subtle">
                  <th className="px-3 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium">Peak Solar</th>
                  <th className="px-3 py-3 font-medium">Readings</th>
                </tr>
              </thead>
              <tbody>
                {dailySummaries.map((d) => (
                  <tr key={d.date} className="border-b border-sb-border/50">
                    <td className="px-3 py-3 text-sb-text">{d.date}</td>
                    <td className="px-3 py-3 text-sb-solar">{d.max_pv}W</td>
                    <td className="px-3 py-3 text-sb-text-muted">{d.readings_count}</td>
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
