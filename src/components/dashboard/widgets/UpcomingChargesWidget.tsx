'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useSSE } from '@/hooks/useSSE';
import { calculateCostForecast, formatCost, type RateSlot } from '@/lib/forecast';

interface Schedule {
  id: number;
  slot_start: string;
  slot_end: string;
  avg_price: number;
  status: string;
  type?: 'charge' | 'discharge';
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

export default function UpcomingChargesWidget() {
  const { state } = useSSE();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [rawRates, setRawRates] = useState<RateSlot[]>([]);
  const [chargeSettings, setChargeSettings] = useState<{
    min_soc_target: string;
    battery_capacity_kwh: string;
    max_charge_power_kw: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [ratesRes, schedRes, settingsRes] = await Promise.all([
          fetch('/api/rates'),
          fetch('/api/schedule'),
          fetch('/api/settings'),
        ]);
        const ratesJson = await ratesRes.json();
        const schedJson = await schedRes.json();
        const settingsJson = await settingsRes.json();
        setChargeSettings(settingsJson);
        setRawRates(ratesJson.rates || []);

        const rawScheds: Schedule[] = schedJson.schedules || [];
        const nowIso = new Date().toISOString();
        setSchedules(rawScheds.filter((s) =>
          (s.status === 'planned' || s.status === 'active') &&
          (s.type ?? 'charge') === 'charge' &&
          s.slot_end > nowIso,
        ));
      } catch { /* silent */ }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const costForecast = useMemo(() => {
    if (!chargeSettings || state.battery_soc === null || schedules.length === 0 || rawRates.length === 0) return null;
    return calculateCostForecast(
      schedules,
      rawRates,
      state.battery_soc,
      parseFloat(chargeSettings.min_soc_target) || 80,
      parseFloat(chargeSettings.battery_capacity_kwh) || 5.12,
      parseFloat(chargeSettings.max_charge_power_kw) || 3.6,
    );
  }, [schedules, rawRates, chargeSettings, state.battery_soc]);

  const groups = useMemo(() => {
    const sorted = [...schedules].sort(
      (a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime(),
    );
    const costByStart = new Map<string, number>();
    for (const w of costForecast?.windows ?? []) {
      costByStart.set(w.slot_start, w.cost_pence);
    }

    type Group = {
      key: number;
      slot_start: string;
      slot_end: string;
      status: string;
      avg_price: number;
      cost_pence: number | null;
      has_cost: boolean;
    };

    const result: Group[] = [];
    for (const s of sorted) {
      const last = result[result.length - 1];
      const slotCost = costByStart.get(s.slot_start);
      const contiguous =
        last &&
        last.slot_end === s.slot_start &&
        last.status === s.status;

      if (contiguous) {
        // Weighted merge of avg_price by slot count via running counter stored on key trick.
        // Simpler: recompute as incremental mean using count tracked via (end-start)/30min.
        const prevSlots =
          (new Date(last.slot_end).getTime() - new Date(last.slot_start).getTime()) / (30 * 60 * 1000);
        last.avg_price = (last.avg_price * prevSlots + (s.avg_price ?? 0)) / (prevSlots + 1);
        last.slot_end = s.slot_end;
        if (slotCost !== undefined) {
          last.cost_pence = (last.cost_pence ?? 0) + slotCost;
          last.has_cost = true;
        }
      } else {
        result.push({
          key: s.id,
          slot_start: s.slot_start,
          slot_end: s.slot_end,
          status: s.status,
          avg_price: s.avg_price ?? 0,
          cost_pence: slotCost ?? null,
          has_cost: slotCost !== undefined,
        });
      }
    }
    return result;
  }, [schedules, costForecast]);

  if (schedules.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Upcoming Charges" />
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.key} className="flex items-center justify-between rounded-md bg-sb-bg px-3 py-2">
            <span className="text-sm text-sb-text">
              {formatTime(g.slot_start)} – {formatTime(g.slot_end)}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-sm text-sb-text-muted">{g.avg_price.toFixed(2)}p/kWh</span>
              {g.has_cost && g.cost_pence !== null && (
                <span className="text-sm font-medium text-sb-success">
                  {formatCost(g.cost_pence)}
                </span>
              )}
              <Badge kind={statusKind(g.status)}>{g.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
