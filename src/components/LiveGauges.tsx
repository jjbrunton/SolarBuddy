'use client';

import { Battery, Sun, Zap, Home, ArrowUpDown } from 'lucide-react';
import type { InverterState } from '@/lib/state';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

interface Props {
  state: InverterState;
  connected: boolean;
}

function GaugeCard({
  label,
  value,
  unit,
  Icon,
  accent,
}: {
  label: string;
  value: number | null;
  unit: string;
  Icon: LucideIcon;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-4">
      <div className="flex items-center gap-2 text-sm text-sb-text-muted">
        <Icon size={16} className={accent} />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold text-sb-text">
        {value !== null ? `${value}${unit}` : '\u2014'}
      </div>
    </div>
  );
}

function BatteryGauge({ soc }: { soc: number | null }) {
  const pct = soc ?? 0;
  const color =
    pct >= 80 ? 'text-sb-success' : pct >= 40 ? 'text-sb-accent' : pct >= 20 ? 'text-sb-warning' : 'text-sb-danger';

  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-4">
      <div className="flex items-center gap-2 text-sm text-sb-text-muted">
        <Battery size={16} className={color} />
        <span>Battery</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className={`text-2xl font-bold ${color}`}>{soc !== null ? `${soc}%` : '\u2014'}</span>
      </div>
      {soc !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sb-border">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              pct >= 80 ? 'bg-sb-success' : pct >= 40 ? 'bg-sb-accent' : pct >= 20 ? 'bg-sb-warning' : 'bg-sb-danger'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function LiveGauges({ state, connected }: Props) {
  return (
    <div>
      {/* Connection status bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge kind={state.mqtt_connected ? 'success' : 'danger'}>
          MQTT: {state.mqtt_connected ? 'Connected' : 'Disconnected'}
        </Badge>
        <Badge kind={connected ? 'success' : 'warning'}>
          SSE: {connected ? 'Live' : 'Reconnecting...'}
        </Badge>
        {state.work_mode && (
          <Badge kind="info">{state.work_mode}</Badge>
        )}
      </div>

      {/* Gauge grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <BatteryGauge soc={state.battery_soc} />
        <GaugeCard label="Solar" value={state.pv_power} unit="W" Icon={Sun} accent="text-yellow-400" />
        <GaugeCard label="Grid" value={state.grid_power} unit="W" Icon={Zap} accent="text-sb-accent" />
        <GaugeCard label="Load" value={state.load_power} unit="W" Icon={Home} accent="text-purple-400" />
        <GaugeCard
          label="Battery Flow"
          value={state.battery_power}
          unit="W"
          Icon={ArrowUpDown}
          accent="text-sb-success"
        />
      </div>
    </div>
  );
}
