'use client';

import { useEffect, useState } from 'react';

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
  const dt = new Date(iso);
  return dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function statusColor(status: string) {
  switch (status) {
    case 'planned':
      return 'bg-blue-500/20 text-blue-400';
    case 'active':
      return 'bg-green-500/20 text-green-400';
    case 'completed':
      return 'bg-zinc-500/20 text-zinc-400';
    case 'failed':
      return 'bg-red-500/20 text-red-400';
    default:
      return 'bg-zinc-500/20 text-zinc-400';
  }
}

export default function ScheduleTable() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/schedule');
      const json = await res.json();
      setSchedules(json.schedules || []);
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (schedules.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="mb-2 text-lg font-semibold text-zinc-100">Charge Schedule</h2>
        <p className="text-zinc-400">No schedules yet. Fetch rates and run the scheduler.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">Charge Schedule</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-400">
              <th className="pb-2">Window</th>
              <th className="pb-2">Avg Price</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-zinc-800/50">
                <td className="py-2 text-zinc-100">
                  {formatTime(s.slot_start)} – {formatTime(s.slot_end)}
                </td>
                <td className="py-2 text-zinc-300">{s.avg_price?.toFixed(2)}p</td>
                <td className="py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(s.status)}`}>
                    {s.status}
                  </span>
                </td>
                <td className="py-2 text-zinc-400">{s.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
