'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DayData {
  date: string;
  actual_cost: number;
  flat_rate_cost: number;
  savings: number;
}

function SavingsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const actual = payload.find((p) => p.name === 'actual_cost');
  const flat = payload.find((p) => p.name === 'flat_rate_cost');
  const savings = flat && actual ? flat.value - actual.value : 0;
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">{label}</p>
      {actual && <p className="text-sm text-sb-warning">Actual: {actual.value.toFixed(1)}p</p>}
      {flat && <p className="text-sm text-sb-text-muted">Flat rate: {flat.value.toFixed(1)}p</p>}
      <p className={`text-sm font-semibold ${savings >= 0 ? 'text-sb-success' : 'text-sb-danger'}`}>
        Saved: {savings.toFixed(1)}p
      </p>
    </div>
  );
}

export function SavingsChart({ data }: { data: DayData[] }) {
  const chartData = data.map((d) => ({
    ...d,
    date: d.date.slice(5), // MM-DD
  }));

  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-sb-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-warning" /> Actual Cost
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-[#555]" /> Flat Rate Cost
        </span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="date" tick={{ fill: '#999', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#999', fontSize: 11 }} unit="p" />
          <Tooltip content={<SavingsTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar dataKey="flat_rate_cost" fill="#555" radius={[2, 2, 0, 0]} name="flat_rate_cost" />
          <Bar dataKey="actual_cost" fill="#ff902b" radius={[2, 2, 0, 0]} name="actual_cost" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
