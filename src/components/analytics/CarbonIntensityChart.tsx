'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface SlotData {
  from: string;
  to: string;
  forecast: number | null;
  actual: number | null;
  index: string | null;
  solar_kwh: number;
  carbon_saved_g: number;
}

const INDEX_COLORS: Record<string, string> = {
  'very low': '#27c24c',
  'low': '#7ec850',
  'moderate': '#facc15',
  'high': '#ff902b',
  'very high': '#f05050',
};

function CarbonTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: { index: string | null; solar_kwh: number; carbon_saved_g: number }; value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-sb-border bg-sb-card px-3 py-2 shadow-lg">
      <p className="text-xs text-sb-text-muted">{label}</p>
      <p className="text-sm font-semibold text-sb-text">{payload[0].value} gCO2/kWh</p>
      {d.index && <p className="text-xs capitalize" style={{ color: INDEX_COLORS[d.index] || '#999' }}>{d.index}</p>}
      {d.solar_kwh > 0 && (
        <p className="mt-1 text-xs text-sb-success">Solar: {d.solar_kwh} kWh ({d.carbon_saved_g}g CO2 saved)</p>
      )}
    </div>
  );
}

export function CarbonIntensityChart({ data }: { data: SlotData[] }) {
  const chartData = data.map((d) => {
    const dt = new Date(d.from);
    return {
      ...d,
      time: `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`,
      intensity: d.forecast ?? d.actual ?? 0,
    };
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-sb-text-muted">
        {Object.entries(INDEX_COLORS).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: color }} />
            <span className="capitalize">{label}</span>
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="time" tick={{ fill: '#999', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: '#999', fontSize: 11 }} unit=" g" />
          <Tooltip content={<CarbonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <Bar dataKey="intensity" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={INDEX_COLORS[entry.index ?? 'moderate'] || '#999'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
