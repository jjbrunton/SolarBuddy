'use client';

import { Battery, Sun, Zap, Home, ArrowUpDown, Gauge, Thermometer, Activity } from 'lucide-react';
import type { InverterState } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { PlaceholderValue } from '@/components/ui/PlaceholderValue';

interface Props {
  state: InverterState;
  targetSoc?: number | null;
  capacityWh?: number | null;
}

// Connection status lives in the sticky Header; the SolarBuddy action
// (charge / discharge / hold) is shown on the Current Rate widget. This
// panel focuses on telemetry numbers and only surfaces raw inverter state
// if the device reports a Fault, since that's an escalation the operator
// needs to see immediately.

/*
 * Editorial gauge tile. Same layout as before but uses the Figure
 * typography vocabulary: small-caps eyebrow, Fraunces display number,
 * hairline underline, caption row. Visual frame is a hairline Card.
 */
function GaugeTile({
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
    <div className="flex h-full flex-col gap-2 rounded-[0.75rem] border border-sb-border bg-sb-card p-4 transition-colors hover:bg-sb-card-hover">
      <div className="flex items-center gap-2">
        <Icon size={14} className={accent} />
        <span className="sb-eyebrow">{label}</span>
      </div>
      {value !== null ? (
        <div className="sb-display flex items-baseline gap-1 text-[2rem] leading-none text-sb-text">
          <span>{value}</span>
          <span className="text-[0.68rem] uppercase tracking-[0.2em] text-sb-text-muted">{unit}</span>
        </div>
      ) : (
        <div className="py-1">
          <PlaceholderValue />
        </div>
      )}
      <div className="sb-rule" />
      {subtitle ? <p className="text-[0.7rem] leading-4 text-sb-text-muted">{subtitle}</p> : null}
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

function BatteryTile({
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
  // The ember pole owns stored energy, so the fill gradient lives in ember
  // regardless of level; low-battery warnings come from the signal palette.
  const tone =
    pct >= 80
      ? 'text-sb-ember'
      : pct >= 40
        ? 'text-sb-ember'
        : pct >= 20
          ? 'text-sb-warning'
          : 'text-sb-danger';

  const barTone =
    pct >= 80
      ? 'bg-sb-ember'
      : pct >= 40
        ? 'bg-sb-ember'
        : pct >= 20
          ? 'bg-sb-warning'
          : 'bg-sb-danger';

  return (
    <div className="flex h-full flex-col gap-2 rounded-[0.75rem] border border-sb-border bg-sb-card p-4 transition-colors hover:bg-sb-card-hover">
      <div className="flex items-center gap-2">
        <Battery size={14} className={tone} />
        <span className="sb-eyebrow">Battery</span>
      </div>
      <div className="flex items-baseline gap-2">
        {soc !== null ? (
          <span className={`sb-display text-[2rem] leading-none ${tone}`}>
            {soc}
            <span className="ml-0.5 text-[0.68rem] uppercase tracking-[0.2em] text-sb-text-muted">%</span>
          </span>
        ) : (
          <PlaceholderValue />
        )}
        {voltage !== null && (
          <span className="font-[family-name:var(--font-sb-mono)] text-[0.68rem] text-sb-text-muted">{voltage}V</span>
        )}
      </div>
      {soc !== null && (
        <div className="h-[2px] w-full overflow-hidden bg-sb-rule">
          <div
            className={`h-full transition-all duration-700 ${barTone}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="sb-rule" />
      {soc !== null &&
        targetSoc != null &&
        capacityWh != null &&
        batteryPower != null &&
        batteryPower > 0 &&
        soc < targetSoc && (
          <p className="text-[0.7rem] leading-4 text-sb-text-muted">
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
    <span className={`flex items-center gap-1 text-[0.7rem] ${color}`}>
      <Thermometer size={12} />
      {label}: {value}°C
    </span>
  );
}

export default function LiveGauges({ state, targetSoc, capacityWh }: Props) {
  const hasFault = state.device_mode === 'Fault';

  return (
    <div>
      {/* Only escalate the inverter's raw device_mode when it reports a fault.
          The SolarBuddy action (charge/discharge/hold) lives on Current Rate. */}
      {hasFault ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Badge kind="danger">Inverter fault</Badge>
        </div>
      ) : null}

      {/* Primary gauge grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <BatteryTile
          soc={state.battery_soc}
          voltage={state.battery_voltage}
          batteryPower={state.battery_power}
          targetSoc={targetSoc}
          capacityWh={capacityWh}
        />
        <GaugeTile label="Solar" value={state.pv_power} unit="W" Icon={Sun} accent="text-sb-ember" />
        <GaugeTile
          label="Grid"
          value={state.grid_power}
          unit="W"
          Icon={Zap}
          accent="text-sb-frost"
          subtitle={state.grid_voltage != null ? `${state.grid_voltage}V` : undefined}
        />
        <GaugeTile label="Load" value={state.load_power} unit="W" Icon={Home} accent="text-sb-load" />
        <GaugeTile
          label="Battery Flow"
          value={state.battery_power}
          unit="W"
          Icon={ArrowUpDown}
          accent="text-sb-ember"
          subtitle={
            state.battery_power != null
              ? state.battery_power > 0
                ? 'Charging'
                : state.battery_power < 0
                  ? 'Discharging'
                  : 'Idle'
              : undefined
          }
        />
      </div>

      {/* Secondary metrics strip */}
      <div className="mt-3 flex flex-wrap items-center gap-4 rounded-[0.75rem] border border-sb-border/60 bg-sb-surface-muted px-4 py-2.5">
        <TempBadge label="Inverter" value={state.inverter_temperature} warnAt={45} />
        <TempBadge label="Battery" value={state.battery_temperature} warnAt={40} />
        {state.grid_frequency != null && (
          <span className="flex items-center gap-1 text-[0.7rem] text-sb-text-muted">
            <Activity size={12} />
            Grid: {state.grid_frequency}Hz
          </span>
        )}
        {state.grid_voltage != null && (
          <span className="flex items-center gap-1 text-[0.7rem] text-sb-text-muted">
            <Gauge size={12} />
            Grid: {state.grid_voltage}V
          </span>
        )}
      </div>
    </div>
  );
}
