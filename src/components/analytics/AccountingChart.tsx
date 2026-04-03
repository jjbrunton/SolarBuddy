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
import { formatCost } from '@/lib/forecast';

interface DayData {
  date: string;
  import_kwh: number;
  import_cost: number;
  export_kwh: number;
  export_revenue: number;
  net_cost: number;
}

function AccountingTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; dataKey: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const importCost = payload.find((p) => p.dataKey === 'import_cost');
  const exportRevenue = payload.find((p) => p.dataKey === 'export_revenue');
  const netCost = payload.find((p) => p.dataKey === 'net_cost');

  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-sb-text-muted">{label}</p>
      {importCost && (
        <p className="text-sm" style={{ color: importCost.color }}>
          Import cost: {formatCost(importCost.value)}
        </p>
      )}
      {exportRevenue && (
        <p className="text-sm" style={{ color: exportRevenue.color }}>
          Export revenue: {formatCost(exportRevenue.value)}
        </p>
      )}
      {netCost && (
        <p className="text-sm font-semibold" style={{ color: netCost.value < 0 ? '#27c24c' : '#f05050' }}>
          Net: {formatCost(Math.abs(netCost.value))} {netCost.value < 0 ? '(profit)' : '(cost)'}
        </p>
      )}
    </div>
  );
}

export function AccountingChart({ data }: { data: DayData[] }) {
  const chartData = data.map((d) => ({
    ...d,
    date: d.date.slice(5),
  }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-sb-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-[#f05050]" /> Import Cost
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-success" /> Export Revenue
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Net Cost
        </span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="date" tick={{ fill: '#999', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis
            yAxisId="left"
            tick={{ fill: '#999', fontSize: 11 }}
            tickFormatter={(v: number) => formatCost(Math.abs(v))}
          />
          <Tooltip content={<AccountingTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar yAxisId="left" dataKey="import_cost" fill="#f05050" radius={[2, 2, 0, 0]} name="import_cost" />
          <Bar yAxisId="left" dataKey="export_revenue" fill="#27c24c" radius={[2, 2, 0, 0]} name="export_revenue" />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="net_cost"
            stroke="#5d9cec"
            strokeWidth={2}
            dot={{ r: 3, fill: '#5d9cec' }}
            name="net_cost"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
