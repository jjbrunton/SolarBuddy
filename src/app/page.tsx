'use client';

import LiveGauges from '@/components/LiveGauges';
import { useSSE } from '@/hooks/useSSE';
import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

interface RatePoint {
  time: string;
  price: number;
  isCurrent: boolean;
  isScheduled: boolean;
}

interface Schedule {
  id: number;
  slot_start: string;
  slot_end: string;
  avg_price: number;
  status: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function statusKind(status: string) {
  switch (status) {
    case 'planned': return 'primary' as const;
    case 'active': return 'success' as const;
    case 'completed': return 'default' as const;
    case 'failed': return 'danger' as const;
    default: return 'default' as const;
  }
}

export default function DashboardPage() {
  const { state, connected } = useSSE();
  const [rates, setRates] = useState<RatePoint[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [currentRate, setCurrentRate] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [ratesRes, schedRes] = await Promise.all([
          fetch('/api/rates'),
          fetch('/api/schedule'),
        ]);
        const ratesJson = await ratesRes.json();
        const schedJson = await schedRes.json();

        const rawRates = ratesJson.rates || [];
        const rawScheds: Schedule[] = schedJson.schedules || [];
        const now = new Date();

        const scheduledTimes = new Set<string>();
        for (const s of rawScheds) {
          if (s.status === 'planned' || s.status === 'active') {
            let cursor = new Date(s.slot_start);
            const end = new Date(s.slot_end);
            while (cursor < end) {
              scheduledTimes.add(cursor.toISOString());
              cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
            }
          }
        }

        const chartData: RatePoint[] = rawRates.map((r: { valid_from: string; valid_to: string; price_inc_vat: number }) => {
          const dt = new Date(r.valid_from);
          const isCurrent = now >= dt && now < new Date(r.valid_to);
          if (isCurrent) setCurrentRate(Math.round(r.price_inc_vat * 100) / 100);
          return {
            time: `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`,
            price: Math.round(r.price_inc_vat * 100) / 100,
            isCurrent,
            isScheduled: scheduledTimes.has(r.valid_from),
          };
        });

        setRates(chartData);
        setSchedules(rawScheds.filter((s: Schedule) => s.status === 'planned' || s.status === 'active'));
      } catch { /* silent */ }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-sb-text">Dashboard</h1>

      <LiveGauges state={state} connected={connected} />

      {/* Quick stats row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <p className="text-xs text-sb-text-muted">Current Rate</p>
          <p className="mt-1 text-lg font-bold text-sb-text">
            {currentRate !== null ? `${currentRate}p/kWh` : '\u2014'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Work Mode</p>
          <p className="mt-1 text-lg font-bold text-sb-text">{state.work_mode || '\u2014'}</p>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Upcoming Charges</p>
          <p className="mt-1 text-lg font-bold text-sb-text">{schedules.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-sb-text-muted">Battery Flow</p>
          <p className="mt-1 text-lg font-bold text-sb-text">
            {state.battery_power !== null
              ? `${state.battery_power > 0 ? '+' : ''}${state.battery_power}W`
              : '\u2014'}
          </p>
        </Card>
      </div>

      {/* Mini rate chart */}
      {rates.length > 0 && (
        <Card>
          <CardHeader title="Today's Rates" />
          <div className="flex gap-4 text-xs text-sb-text-muted mb-2">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded bg-sb-accent" /> Rate
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded bg-sb-success" /> Scheduled
            </span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rates} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis dataKey="time" tick={{ fill: '#999', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#999', fontSize: 10 }} width={35} />
              <ReferenceLine y={0} stroke="#555" />
              <Bar dataKey="price" radius={[2, 2, 0, 0]}>
                {rates.map((entry, i) => (
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
        </Card>
      )}

      {/* Upcoming schedules */}
      {schedules.length > 0 && (
        <Card>
          <CardHeader title="Upcoming Charges" />
          <div className="space-y-2">
            {schedules.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md bg-sb-bg px-3 py-2">
                <span className="text-sm text-sb-text">
                  {formatTime(s.slot_start)} – {formatTime(s.slot_end)}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-sb-text-muted">{s.avg_price?.toFixed(2)}p/kWh</span>
                  <Badge kind={statusKind(s.status)}>{s.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
