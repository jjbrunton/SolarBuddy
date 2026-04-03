'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatCost } from '@/lib/forecast';

interface DayData {
  date: string;
  actual_import_cost: number;
  hypothetical_import_cost: number;
  actual_export_revenue: number;
  hypothetical_export_revenue: number;
  actual_net: number;
  hypothetical_net: number;
  difference: number;
}

function ComparisonTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; dataKey: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const actual = payload.find((p) => p.dataKey === 'actual_net');
  const hypothetical = payload.find((p) => p.dataKey === 'hypothetical_net');
  const diff = actual && hypothetical ? actual.value - hypothetical.value : 0;

  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-sb-text-muted">{label}</p>
      {actual && (
        <p className="text-sm" style={{ color: actual.color }}>
          Actual: {formatCost(actual.value)}
        </p>
      )}
      {hypothetical && (
        <p className="text-sm" style={{ color: hypothetical.color }}>
          Hypothetical: {formatCost(hypothetical.value)}
        </p>
      )}
      <p
        className="text-sm font-semibold"
        style={{ color: diff > 0 ? '#f05050' : diff < 0 ? '#27c24c' : '#999' }}
      >
        Diff: {formatCost(Math.abs(diff))} {diff > 0 ? '(more)' : diff < 0 ? '(saving)' : ''}
      </p>
    </div>
  );
}

export function TariffComparisonChart({ data }: { data: DayData[] }) {
  const chartData = data.map((d) => ({
    ...d,
    date: d.date.slice(5),
  }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-sb-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Actual Net
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-[#facc15]" /> Hypothetical Net
        </span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="date" tick={{ fill: '#999', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis
            tick={{ fill: '#999', fontSize: 11 }}
            tickFormatter={(v: number) => formatCost(Math.abs(v))}
          />
          <Tooltip content={<ComparisonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar dataKey="actual_net" fill="#5d9cec" radius={[2, 2, 0, 0]} name="actual_net" />
          <Bar dataKey="hypothetical_net" fill="#facc15" radius={[2, 2, 0, 0]} name="hypothetical_net" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
