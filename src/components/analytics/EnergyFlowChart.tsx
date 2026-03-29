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
  import_kwh: number;
  export_kwh: number;
  generation_kwh: number;
  consumption_kwh: number;
  self_sufficiency: number;
}

function EnergyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-sb-text-muted">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="text-sm" style={{ color: p.color }}>
          {p.name === 'self_sufficiency'
            ? `Self-sufficiency: ${p.value}%`
            : `${p.name.replace('_kwh', '').replace('_', ' ')}: ${p.value} kWh`}
        </p>
      ))}
    </div>
  );
}

export function EnergyFlowChart({ data }: { data: DayData[] }) {
  const chartData = data.map((d) => ({
    ...d,
    date: d.date.slice(5),
  }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-sb-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-[#f05050]" /> Import
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-success" /> Export
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-[#facc15]" /> Generation
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Self-Sufficiency
        </span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="date" tick={{ fill: '#999', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fill: '#999', fontSize: 11 }} unit=" kWh" />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: '#999', fontSize: 11 }} unit="%" domain={[0, 100]} />
          <Tooltip content={<EnergyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar yAxisId="left" dataKey="import_kwh" fill="#f05050" radius={[2, 2, 0, 0]} name="import_kwh" />
          <Bar yAxisId="left" dataKey="export_kwh" fill="#27c24c" radius={[2, 2, 0, 0]} name="export_kwh" />
          <Bar yAxisId="left" dataKey="generation_kwh" fill="#facc15" radius={[2, 2, 0, 0]} name="generation_kwh" />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="self_sufficiency"
            stroke="#5d9cec"
            strokeWidth={2}
            dot={{ r: 3, fill: '#5d9cec' }}
            name="self_sufficiency"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
