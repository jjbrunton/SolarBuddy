'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCost } from '@/lib/forecast';

// Concrete moments where SolarBuddy beat a passive self-use battery. The
// counterpart to WorstSlotsPanel — together they make the scheduling-value
// number on the hero band tangible: you can see exactly which decisions
// earned the saving and which ones cost you.

interface BestSlot {
  slot_start: string;
  action: string | null;
  reason: string | null;
  import_rate: number;
  export_rate: number;
  load_kwh: number;
  pv_kwh: number;
  actual_import_kwh: number;
  actual_export_kwh: number;
  actual_cost: number;
  passive_cost: number;
  delta: number;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}

const ACTION_LABEL: Record<string, string> = {
  charge: 'Charge',
  discharge: 'Discharge',
  hold: 'Hold',
};

export function BestSlotsPanel({ period }: { period: string }) {
  const [slots, setSlots] = useState<BestSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/analytics/best-slots?period=${period}&limit=10`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setSlots(json.slots ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const winningSlots = slots.filter((s) => s.delta < 0);

  return (
    <Card>
      <CardHeader
        title="Best scheduling decisions"
        subtitle="Slots where SolarBuddy's plan beat a passive self-use battery. Priced against your actual half-hour tariff."
      />
      {loading && winningSlots.length === 0 ? (
        <p className="py-8 text-center text-sb-text-muted">Loading…</p>
      ) : winningSlots.length === 0 ? (
        <EmptyState
          title="No winning slots found"
          description="Over this period, SolarBuddy's decisions did not save more than a passive self-use battery would have in any single slot."
        />
      ) : (
        <ul className="divide-y divide-sb-border/50">
          {winningSlots.map((s) => (
            <li key={s.slot_start} className="grid grid-cols-[1fr_auto] items-start gap-4 py-3">
              <div>
                <div className="flex flex-wrap items-baseline gap-x-2 text-[0.85rem]">
                  <span className="text-sb-text">{formatTime(s.slot_start)}</span>
                  <span className="text-[0.7rem] uppercase tracking-[0.12em] text-sb-text-subtle">
                    {s.action ? ACTION_LABEL[s.action] ?? s.action : 'No plan'} · {s.import_rate.toFixed(1)}p
                  </span>
                </div>
                {s.reason ? (
                  <p className="mt-1 text-[0.72rem] text-sb-text-muted">{s.reason}</p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-x-4 text-[0.7rem] text-sb-text-muted">
                  <span>Load <span className="text-sb-text">{s.load_kwh.toFixed(2)} kWh</span></span>
                  <span>PV <span className="text-sb-text">{s.pv_kwh.toFixed(2)} kWh</span></span>
                  <span>Imported <span className="text-sb-text">{s.actual_import_kwh.toFixed(2)} kWh</span></span>
                  {s.actual_export_kwh > 0.01 ? (
                    <span>Exported <span className="text-sb-text">{s.actual_export_kwh.toFixed(2)} kWh</span></span>
                  ) : null}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[0.9rem] font-semibold text-sb-success">
                  −{formatCost(Math.abs(s.delta))}
                </div>
                <div className="text-[0.65rem] uppercase tracking-[0.16em] text-sb-text-subtle">
                  vs passive
                </div>
                <div className="mt-1 text-[0.7rem] text-sb-text-muted">
                  paid {formatCost(s.actual_cost)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
