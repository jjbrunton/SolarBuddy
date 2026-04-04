'use client';

import { useEffect, useState } from 'react';
import LiveGauges from '@/components/LiveGauges';
import { useSSE } from '@/hooks/useSSE';

export default function LiveGaugesWidget() {
  const { state, connected } = useSSE();
  const [settings, setSettings] = useState<{
    min_soc_target: string;
    battery_capacity_kwh: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/settings');
        setSettings(await res.json());
      } catch { /* silent */ }
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  const targetSoc = state.battery_first_stop_charge
    ?? (settings ? parseFloat(settings.min_soc_target) || 80 : null);
  const capacityWh = settings
    ? (parseFloat(settings.battery_capacity_kwh) || 5.12) * 1000
    : null;

  return (
    <LiveGauges
      state={state}
      connected={connected}
      targetSoc={targetSoc}
      capacityWh={capacityWh}
    />
  );
}
