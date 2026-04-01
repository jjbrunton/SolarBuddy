'use client';

import { useSSE } from '@/hooks/useSSE';

export default function SystemHealthWidget() {
  const { state } = useSSE();

  const hasData =
    state.device_mode ||
    state.inverter_temperature !== null ||
    state.battery_temperature !== null ||
    state.grid_voltage !== null ||
    state.grid_frequency !== null;

  if (!hasData) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[1.15rem] border border-sb-border/70 bg-sb-surface-muted/75 px-4 py-3">
      {state.device_mode && (
        <span className="text-xs text-sb-text-muted">
          Mode: <span className="font-semibold text-sb-text">{state.device_mode}</span>
        </span>
      )}
      {state.inverter_temperature !== null && (
        <span className={`text-xs ${state.inverter_temperature >= 45 ? 'text-sb-warning' : 'text-sb-text-muted'}`}>
          Inv: {state.inverter_temperature}&deg;C
        </span>
      )}
      {state.battery_temperature !== null && (
        <span className={`text-xs ${state.battery_temperature >= 40 ? 'text-sb-warning' : 'text-sb-text-muted'}`}>
          Batt: {state.battery_temperature}&deg;C
        </span>
      )}
      {state.grid_voltage !== null && (
        <span className="text-xs text-sb-text-muted">Grid: {state.grid_voltage}V</span>
      )}
      {state.grid_frequency !== null && (
        <span className="text-xs text-sb-text-muted">{state.grid_frequency}Hz</span>
      )}
    </div>
  );
}
