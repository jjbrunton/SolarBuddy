'use client';

import { useSSE } from '@/hooks/useSSE';
import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

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

export default function SolarPage() {
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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Solar Production</h1>

      {/* Overview cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-sb-text-muted">Current Output</p>
          <p className="mt-1 text-2xl font-bold text-yellow-400">
            {state.pv_power !== null ? `${state.pv_power}W` : '\u2014'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Peak Today</p>
          <p className="mt-1 text-2xl font-bold text-sb-text">
            {maxPvToday > 0 ? `${maxPvToday}W` : '\u2014'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Grid Power</p>
          <p className="mt-1 text-2xl font-bold text-sb-text">
            {state.grid_power !== null
              ? `${state.grid_power > 0 ? 'Importing' : state.grid_power < 0 ? 'Exporting' : 'Neutral'} ${Math.abs(state.grid_power)}W`
              : '\u2014'}
          </p>
        </Card>
      </div>

      {/* Production chart */}
      <Card>
        <CardHeader title="Today's Power Flow" />
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
                <XAxis dataKey="time" tick={{ fill: '#999', fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#999', fontSize: 10 }} width={45} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#2a2a2a',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    color: '#e1e2e3',
                  }}
                />
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
          <CardHeader title="Recent Days" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sb-border text-left text-sb-text-muted">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Peak Solar</th>
                  <th className="pb-2 font-medium">Readings</th>
                </tr>
              </thead>
              <tbody>
                {dailySummaries.map((d) => (
                  <tr key={d.date} className="border-b border-sb-border/50">
                    <td className="py-2.5 text-sb-text">{d.date}</td>
                    <td className="py-2.5 text-yellow-400">{d.max_pv}W</td>
                    <td className="py-2.5 text-sb-text-muted">{d.readings_count}</td>
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
