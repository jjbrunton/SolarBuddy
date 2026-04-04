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

  if (schedules.length === 0) return null;

  return (
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
              {costForecast?.windows.find((w) => w.slot_start === s.slot_start) && (
                <span className="text-sm font-medium text-sb-success">
                  {formatCost(costForecast.windows.find((w) => w.slot_start === s.slot_start)!.cost_pence)}
                </span>
              )}
              <Badge kind={statusKind(s.status)}>{s.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
