'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DayData {
  date: string;
  min_soc: number;
  max_soc: number;
  depth_of_discharge: number;
  equivalent_cycles: number;
  cumulative_cycles: number;
}

function BatteryTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const dod = payload.find((p) => p.name === 'depth_of_discharge');
  const cumulative = payload.find((p) => p.name === 'cumulative_cycles');
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">{label}</p>
      {dod && <p className="text-sm text-sb-accent">Depth of Discharge: {dod.value}%</p>}
      {cumulative && <p className="text-sm text-sb-warning">Cumulative Cycles: {cumulative.value}</p>}
    </div>
  );
}

export function BatteryCycleChart({ data }: { data: DayData[] }) {
  const chartData = data.map((d) => ({
    ...d,
    date: d.date.slice(5),
  }));

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-sb-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Depth of Discharge
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-warning" /> Cumulative Cycles
        </span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="date" tick={{ fill: '#999', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fill: '#999', fontSize: 11 }} unit="%" domain={[0, 100]} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#999', fontSize: 11 }} />
          <Tooltip content={<BatteryTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar yAxisId="left" dataKey="depth_of_discharge" fill="#5d9cec" radius={[2, 2, 0, 0]} name="depth_of_discharge" />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulative_cycles"
            stroke="#ff902b"
            strokeWidth={2}
            dot={{ r: 3, fill: '#ff902b' }}
            name="cumulative_cycles"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
