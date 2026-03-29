'use client';

import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface SlotData {
  time_slot: string;
  today_price: number | null;
  avg_price: number;
  min_price: number;
  max_price: number;
}

function ComparisonTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const today = payload.find((p) => p.name === 'today_price');
  const avg = payload.find((p) => p.name === 'avg_price');
  const range = payload.find((p) => p.name === 'range');
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">{label}</p>
      {today && <p className="text-sm text-sb-accent">Today: {today.value}p/kWh</p>}
      {avg && <p className="text-sm text-sb-text-muted">Avg: {avg.value}p/kWh</p>}
      {range && Array.isArray(range.value) && (
        <p className="text-xs text-sb-text-muted">Range: {range.value[0]}p - {range.value[1]}p</p>
      )}
    </div>
  );
}

export function RateComparisonChart({ data }: { data: SlotData[] }) {
  const chartData = data.map((d) => ({
    ...d,
    range: [d.min_price, d.max_price],
  }));

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-sb-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-sb-accent" /> Today
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-[#999]" style={{ borderTop: '2px dashed #999' }} /> Historical Avg
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-white/10" /> Min/Max Range
        </span>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="time_slot" tick={{ fill: '#999', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#999', fontSize: 11 }} unit="p" />
          <Tooltip content={<ComparisonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Area
            type="monotone"
            dataKey="range"
            fill="rgba(255,255,255,0.05)"
            stroke="none"
            name="range"
          />
          <Line
            type="monotone"
            dataKey="avg_price"
            stroke="#999"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            name="avg_price"
          />
          <Line
            type="monotone"
            dataKey="today_price"
            stroke="#5d9cec"
            strokeWidth={2}
            dot={false}
            name="today_price"
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
