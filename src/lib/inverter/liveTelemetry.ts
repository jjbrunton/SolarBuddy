import type { InverterState } from '@/lib/types';

const TELEMETRY_KEYS: (keyof InverterState)[] = [
  'battery_soc',
  'pv_power',
  'grid_power',
  'load_power',
  'battery_power',
  'work_mode',
  'battery_voltage',
  'battery_temperature',
  'inverter_temperature',
  'grid_voltage',
  'device_mode',
  'pv_voltage_1',
  'pv_voltage_2',
  'pv_current_1',
  'pv_current_2',
  'pv_power_1',
  'pv_power_2',
  'grid_frequency',
  'battery_first_charge_rate',
  'battery_first_grid_charge',
  'battery_first_stop_charge',
  'load_first_stop_discharge',
  'grid_first_discharge_rate',
  'max_charge_current',
  'battery_absorption_charge_voltage',
  'battery_float_charge_voltage',
  'output_source_priority',
  'bus_voltage',
];

export interface CachedTelemetryPayload {
  savedAt: string;
  state: InverterState;
}

function hasValue(value: InverterState[keyof InverterState]) {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return value !== null;
}

export function hasTelemetryData(state: InverterState) {
  return TELEMETRY_KEYS.some((key) => hasValue(state[key]));
}

export function mergeIncomingTelemetryState(previous: InverterState, incoming: InverterState) {
  const incomingHasTelemetry = hasTelemetryData(incoming);

  if (incomingHasTelemetry || !hasTelemetryData(previous)) {
    return {
      state: incoming,
      showingCachedTelemetry: false,
    };
  }

  return {
    state: {
      ...previous,
      mqtt_connected: incoming.mqtt_connected,
    },
    showingCachedTelemetry: true,
  };
}

export function parseCachedTelemetryPayload(raw: string | null): CachedTelemetryPayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CachedTelemetryPayload> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (typeof parsed.savedAt !== 'string' || !parsed.state || typeof parsed.state !== 'object') {
      return null;
    }

    return parsed as CachedTelemetryPayload;
  } catch {
    return null;
  }
}
