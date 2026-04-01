'use client';

import type { InverterState } from '@/lib/types';
import { Badge } from '@/components/ui/Badge';
import { PlaceholderValue } from '@/components/ui/PlaceholderValue';
import { resolveMaxChargeCurrentDisplay, resolveOutputSourcePriority } from '@/lib/inverter/settings';
import { Settings, Zap, Battery, Gauge } from 'lucide-react';

interface ConfigReadbackProps {
  state: InverterState;
}

interface ConfigItem {
  label: string;
  value: string | number | null;
  unit?: string;
  kind?: 'number' | 'badge';
}

function ConfigRow({ label, value, unit, kind = 'number' }: ConfigItem) {
  let display: React.ReactNode;

  if (value === null || value === undefined) {
    display = <PlaceholderValue />;
  } else if (kind === 'badge') {
    display = <Badge kind="info">{String(value)}</Badge>;
  } else {
    display = (
      <span className="font-semibold text-sb-text">
        {typeof value === 'number' ? Math.round(value * 100) / 100 : value}
        {unit && <span className="ml-0.5 text-xs font-normal text-sb-text-muted">{unit}</span>}
      </span>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-md bg-sb-bg px-3 py-2.5">
      <span className="text-sm text-sb-text-muted">{label}</span>
      {display}
    </div>
  );
}

function ConfigGroup({
  title,
  icon: Icon,
  accent,
  items,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
  items: ConfigItem[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon size={14} className={accent} />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-sb-text-muted">{title}</h4>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <ConfigRow key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

export function ConfigReadback({ state }: ConfigReadbackProps) {
  const outputSourcePriority = resolveOutputSourcePriority(state);
  const maxChargeCurrent = resolveMaxChargeCurrentDisplay(state);

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <ConfigGroup
        title="Charge Settings"
        icon={Zap}
        accent="text-sb-accent"
        items={[
          { label: 'Charge Rate', value: state.battery_first_charge_rate, unit: '%' },
          { label: 'Grid Charge', value: state.battery_first_grid_charge, kind: 'badge' },
          { label: 'Stop Charge At', value: state.battery_first_stop_charge, unit: '%' },
          { label: 'Max Charge Current', value: maxChargeCurrent.value, unit: maxChargeCurrent.unit },
        ]}
      />
      <ConfigGroup
        title="Discharge Settings"
        icon={Battery}
        accent="text-sb-success"
        items={[
          { label: 'Stop Discharge At', value: state.load_first_stop_discharge, unit: '%' },
          { label: 'Grid Discharge Rate', value: state.grid_first_discharge_rate, unit: '%' },
        ]}
      />
      <ConfigGroup
        title="Voltage Limits"
        icon={Gauge}
        accent="text-sb-warning"
        items={[
          { label: 'Absorption Voltage', value: state.battery_absorption_charge_voltage, unit: 'V' },
          { label: 'Float Voltage', value: state.battery_float_charge_voltage, unit: 'V' },
          { label: 'Bus Voltage', value: state.bus_voltage, unit: 'V' },
        ]}
      />
      <ConfigGroup
        title="Priority Settings"
        icon={Settings}
        accent="text-purple-400"
        items={[
          { label: 'Output Source', value: outputSourcePriority, kind: 'badge' },
          { label: 'Work Mode', value: state.work_mode, kind: 'badge' },
        ]}
      />
    </div>
  );
}
