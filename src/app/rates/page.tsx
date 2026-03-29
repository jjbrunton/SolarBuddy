'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { Card, CardHeader } from '@/components/ui/Card';
import { RefreshCw, Play } from 'lucide-react';

interface Rate {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
}

interface Schedule {
  slot_start: string;
  slot_end: string;
  status: string;
}

interface ChartData {
  time: string;
  price: number;
  isScheduled: boolean;
  isCurrent: boolean;
}

export default function RatesPage() {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ min: number; max: number; avg: number } | null>(null);

  const fetchData = async () => {
    try {
      const [ratesRes, scheduleRes] = await Promise.all([fetch('/api/rates'), fetch('/api/schedule')]);
      const ratesJson = await ratesRes.json();
      const scheduleJson = await scheduleRes.json();

      const rates: Rate[] = ratesJson.rates || [];
      const schedules: Schedule[] = scheduleJson.schedules || [];
      const now = new Date();

      const scheduledTimes = new Set<string>();
      for (const s of schedules) {
        if (s.status === 'planned' || s.status === 'active') {
          let cursor = new Date(s.slot_start);
          const end = new Date(s.slot_end);
          while (cursor < end) {
            scheduledTimes.add(cursor.toISOString());
            cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
          }
        }
      }

      const chartData: ChartData[] = rates.map((rate) => {
        const dt = new Date(rate.valid_from);
        return {
          time: `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`,
          price: Math.round(rate.price_inc_vat * 100) / 100,
          isScheduled: scheduledTimes.has(rate.valid_from),
          isCurrent: now >= dt && now < new Date(rate.valid_to),
        };
      });

      if (rates.length > 0) {
        const prices = rates.map((r) => r.price_inc_vat);
        setStats({
          min: Math.round(Math.min(...prices) * 100) / 100,
          max: Math.round(Math.max(...prices) * 100) / 100,
          avg: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100,
        });
      }

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
    const interval = setInterval(fetchData, 60000);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-sb-text">Energy Rates</h1>
        <div className="flex gap-2">
          <button
            onClick={handleFetchRates}
            disabled={loading}
            className="flex items-center gap-2 rounded-md bg-sb-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-sb-accent-hover disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Fetch Rates
          </button>
          <button
            onClick={handleRunSchedule}
            className="flex items-center gap-2 rounded-md bg-sb-success px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            <Play size={14} />
            Run Schedule
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <p className="text-xs text-sb-text-muted">Minimum</p>
            <p className="mt-1 text-lg font-bold text-sb-success">{stats.min}p/kWh</p>
          </Card>
          <Card>
            <p className="text-xs text-sb-text-muted">Average</p>
            <p className="mt-1 text-lg font-bold text-sb-text">{stats.avg}p/kWh</p>
          </Card>
          <Card>
            <p className="text-xs text-sb-text-muted">Maximum</p>
            <p className="mt-1 text-lg font-bold text-sb-danger">{stats.max}p/kWh</p>
          </Card>
        </div>
      )}

      {error && <p className="text-sm text-sb-danger">{error}</p>}

      {/* Chart */}
      <Card>
        <CardHeader title="Agile Rates (p/kWh)" />
        <div className="mb-3 flex gap-4 text-xs text-sb-text-muted">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Rate
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded bg-sb-success" /> Scheduled Charge
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded border-2 border-yellow-400" /> Current
          </span>
        </div>
        {loading && data.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">Loading rates...</p>
        ) : data.length === 0 ? (
          <p className="py-12 text-center text-sb-text-muted">
            No rates loaded. Click &quot;Fetch Rates&quot; to get current Agile prices.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis dataKey="time" tick={{ fill: '#999', fontSize: 11 }} interval="preserveStartEnd" tickCount={12} />
              <YAxis tick={{ fill: '#999', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#2a2a2a',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  color: '#e1e2e3',
                }}
                labelFormatter={(label) => `Time: ${label}`}
                formatter={(value) => [`${value}p/kWh`, 'Price']}
              />
              <ReferenceLine y={0} stroke="#555" />
              <Bar dataKey="price" radius={[2, 2, 0, 0]}>
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.isScheduled ? '#27c24c' : entry.price < 0 ? '#ff902b' : '#5d9cec'}
                    stroke={entry.isCurrent ? '#facc15' : 'none'}
                    strokeWidth={entry.isCurrent ? 2 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}
