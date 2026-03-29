'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { useSSE } from '@/hooks/useSSE';
import { calculateCostForecast, formatCost, type RateSlot } from '@/lib/forecast';

interface Schedule {
  slot_start: string;
  slot_end: string;
  avg_price: number;
  status: string;
}

export default function QuickStatsWidget() {
  const { state } = useSSE();
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [rawRates, setRawRates] = useState<RateSlot[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
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

        const rates: RateSlot[] = ratesJson.rates || [];
        setRawRates(rates);
        const now = new Date();
        for (const r of rates) {
          const dt = new Date(r.valid_from);
          if (now >= dt && now < new Date(r.valid_to)) {
            setCurrentRate(Math.round(r.price_inc_vat * 100) / 100);
            break;
          }
        }

        const rawScheds: Schedule[] = schedJson.schedules || [];
        setSchedules(rawScheds.filter((s) => s.status === 'planned' || s.status === 'active'));
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

  return (
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
        <p className="text-xs text-sb-text-muted">Est. Charge Cost</p>
        <p className="mt-1 text-lg font-bold text-sb-success">
          {costForecast ? formatCost(costForecast.total_cost_pence) : '\u2014'}
        </p>
        {costForecast && (
          <p className="text-xs text-sb-text-muted">
            {costForecast.total_energy_kwh.toFixed(1)} kWh &middot; {costForecast.windows.length} window{costForecast.windows.length !== 1 ? 's' : ''}
          </p>
        )}
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
  );
}
