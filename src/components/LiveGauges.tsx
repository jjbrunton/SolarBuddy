'use client';

import { Battery, Sun, Zap, Home, ArrowUpDown, Gauge, Thermometer, Activity } from 'lucide-react';
import type { InverterState } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { PlaceholderValue } from '@/components/ui/PlaceholderValue';
import { StatusIndicator } from '@/components/ui/StatusIndicator';

interface Props {
  state: InverterState;
  connected: boolean;
  targetSoc?: number | null;
  capacityWh?: number | null;
}

function GaugeCard({
  label,
  value,
  unit,
  Icon,
  accent,
  subtitle,
}: {
  label: string;
  value: number | null;
  unit: string;
  Icon: LucideIcon;
  accent: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-4 transition-colors hover:bg-sb-card-hover">
      <div className="flex items-center gap-2 text-sm text-sb-text-muted">
        <Icon size={16} className={accent} />
        <span>{label}</span>
      </div>
      {value !== null ? (
        <div className="mt-2 text-2xl font-bold text-sb-text">{value}{unit}</div>
      ) : (
        <div className="mt-2">
          <PlaceholderValue />
        </div>
      )}
      {subtitle && <p className="mt-1 text-xs text-sb-text-muted">{subtitle}</p>}
    </div>
  );
}

function formatEta(hours: number): string {
  if (hours < 1 / 60) return '<1m';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function BatteryGauge({
  soc,
  voltage,
  batteryPower,
  targetSoc,
  capacityWh,
}: {
  soc: number | null;
  voltage: number | null;
  batteryPower: number | null;
  targetSoc: number | null | undefined;
  capacityWh: number | null | undefined;
}) {
  const pct = soc ?? 0;
  const color =
    pct >= 80 ? 'text-sb-success' : pct >= 40 ? 'text-sb-accent' : pct >= 20 ? 'text-sb-warning' : 'text-sb-danger';

  return (
    <div className="rounded-lg border border-sb-border bg-sb-card p-4 transition-colors hover:bg-sb-card-hover">
      <div className="flex items-center gap-2 text-sm text-sb-text-muted">
        <Battery size={16} className={color} />
        <span>Battery</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        {soc !== null ? (
          <span className={`text-2xl font-bold ${color}`}>{soc}%</span>
        ) : (
          <PlaceholderValue />
        )}
        {voltage !== null && (
          <span className="mb-0.5 text-xs text-sb-text-muted">{voltage}V</span>
        )}
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
      {soc !== null &&
        targetSoc != null &&
        capacityWh != null &&
        batteryPower != null &&
        batteryPower > 0 &&
        soc < targetSoc && (
          <p className="mt-1.5 text-xs text-sb-text-muted">
            ~{formatEta(((targetSoc - soc) / 100 * capacityWh) / batteryPower)} to {targetSoc}%
          </p>
        )}
    </div>
  );
}

function TempBadge({ label, value, warnAt = 45 }: { label: string; value: number | null; warnAt?: number }) {
  if (value === null) return null;
  const color = value >= warnAt ? 'text-sb-warning' : 'text-sb-text-muted';
  return (
    <span className={`flex items-center gap-1 text-xs ${color}`}>
      <Thermometer size={12} />
      {label}: {value}°C
    </span>
  );
}

export default function LiveGauges({ state, connected, targetSoc, capacityWh }: Props) {
  return (
    <div>
      {/* Connection + status bar */}
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
        {state.device_mode && (
          <Badge kind={state.device_mode === 'Fault' ? 'danger' : 'default'}>{state.device_mode}</Badge>
        )}
      </div>

      {/* Primary gauge grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <BatteryGauge
          soc={state.battery_soc}
          voltage={state.battery_voltage}
          batteryPower={state.battery_power}
          targetSoc={targetSoc}
          capacityWh={capacityWh}
        />
        <GaugeCard label="Solar" value={state.pv_power} unit="W" Icon={Sun} accent="text-yellow-400" />
        <GaugeCard label="Grid" value={state.grid_power} unit="W" Icon={Zap} accent="text-sb-accent"
          subtitle={state.grid_voltage != null ? `${state.grid_voltage}V` : undefined} />
        <GaugeCard label="Load" value={state.load_power} unit="W" Icon={Home} accent="text-purple-400" />
        <GaugeCard label="Battery Flow" value={state.battery_power} unit="W" Icon={ArrowUpDown} accent="text-sb-success"
          subtitle={state.battery_power != null ? (state.battery_power > 0 ? 'Charging' : state.battery_power < 0 ? 'Discharging' : 'Idle') : undefined} />
      </div>

      {/* Secondary metrics strip */}
      <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-sb-border/60 bg-sb-card/50 px-4 py-2.5">
        <TempBadge label="Inverter" value={state.inverter_temperature} warnAt={45} />
        <TempBadge label="Battery" value={state.battery_temperature} warnAt={40} />
        {state.grid_frequency != null && (
          <span className="flex items-center gap-1 text-xs text-sb-text-muted">
            <Activity size={12} />
            Grid: {state.grid_frequency}Hz
          </span>
        )}
        {state.grid_voltage != null && (
          <span className="flex items-center gap-1 text-xs text-sb-text-muted">
            <Gauge size={12} />
            Grid: {state.grid_voltage}V
          </span>
        )}
        {state.device_mode && (
          <StatusIndicator label="Mode" value={state.device_mode} size="sm" />
        )}
      </div>
    </div>
  );
}
