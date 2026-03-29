'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Play } from 'lucide-react';

interface Schedule {
  id: number;
  date: string;
  slot_start: string;
  slot_end: string;
  avg_price: number;
  status: string;
  notes: string | null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
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

export default function ScheduleView({ initialSchedules }: { initialSchedules: Schedule[] }) {
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/schedule');
      const json = await res.json();
      setSchedules(json.schedules || []);
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRunSchedule = async () => {
    try {
      await fetch('/api/schedule', { method: 'POST' });
      await load();
    } catch { /* silent */ }
  };

  // Group by date
  const grouped = schedules.reduce<Record<string, Schedule[]>>((acc, s) => {
    const day = s.date || new Date(s.slot_start).toISOString().split('T')[0];
    if (!acc[day]) acc[day] = [];
    acc[day].push(s);
    return acc;
  }, {});

  const sortedDays = Object.keys(grouped).sort().reverse();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-sb-text">Charge Schedule</h1>
        <button
          onClick={handleRunSchedule}
          className="flex items-center gap-2 rounded-md bg-sb-success px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <Play size={14} />
          Run Schedule
        </button>
      </div>

      {loading ? (
        <Card><p className="text-sb-text-muted">Loading schedules...</p></Card>
      ) : schedules.length === 0 ? (
        <Card>
          <p className="text-sb-text-muted">No schedules yet. Fetch rates and run the scheduler.</p>
        </Card>
      ) : (
        sortedDays.map((day) => (
          <Card key={day}>
            <CardHeader title={formatDate(day + 'T00:00:00')} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sb-border text-left text-sb-text-muted">
                    <th className="pb-2 font-medium">Window</th>
                    <th className="pb-2 font-medium">Avg Price</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped[day].map((s) => (
                    <tr key={s.id} className="border-b border-sb-border/50">
                      <td className="py-2.5 text-sb-text">
                        {formatTime(s.slot_start)} – {formatTime(s.slot_end)}
                      </td>
                      <td className="py-2.5 text-sb-text-muted">{s.avg_price?.toFixed(2)}p/kWh</td>
                      <td className="py-2.5">
                        <Badge kind={statusKind(s.status)}>{s.status}</Badge>
                      </td>
                      <td className="py-2.5 text-sb-text-muted">{s.notes || '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
