// Shared types between server and client (no Node.js dependencies)

export interface InverterState {
  // === Core (existing) ===
  battery_soc: number | null;
  pv_power: number | null;
  grid_power: number | null;
  load_power: number | null;
  battery_power: number | null;
  work_mode: string | null;
  mqtt_connected: boolean;
  last_updated: string | null;

  // === Tier 1: Core monitoring ===
  battery_voltage: number | null;
  battery_temperature: number | null;
  inverter_temperature: number | null;
  grid_voltage: number | null;
  device_mode: string | null;

  // === Tier 2: Per-MPPT solar detail ===
  pv_voltage_1: number | null;
  pv_voltage_2: number | null;
  pv_current_1: number | null;
  pv_current_2: number | null;
  pv_power_1: number | null;
  pv_power_2: number | null;
  grid_frequency: number | null;

  // === Tier 3: Charge config read-back ===
  battery_first_charge_rate: number | null;
  battery_first_grid_charge: string | null;
  battery_first_stop_charge: number | null;
  load_first_stop_discharge: number | null;
  grid_first_discharge_rate: number | null;
  max_charge_current: number | null;
  battery_absorption_charge_voltage: number | null;
  battery_float_charge_voltage: number | null;
  output_source_priority: string | null;
  bus_voltage: number | null;
}

export const INITIAL_STATE: InverterState = {
  // Core
  battery_soc: null,
  pv_power: null,
  grid_power: null,
  load_power: null,
  battery_power: null,
  work_mode: null,
  mqtt_connected: false,
  last_updated: null,

  // Tier 1
  battery_voltage: null,
  battery_temperature: null,
  inverter_temperature: null,
  grid_voltage: null,
  device_mode: null,

  // Tier 2
  pv_voltage_1: null,
  pv_voltage_2: null,
  pv_current_1: null,
  pv_current_2: null,
  pv_power_1: null,
  pv_power_2: null,
  grid_frequency: null,

  // Tier 3
  battery_first_charge_rate: null,
  battery_first_grid_charge: null,
  battery_first_stop_charge: null,
  load_first_stop_discharge: null,
  grid_first_discharge_rate: null,
  max_charge_current: null,
  battery_absorption_charge_voltage: null,
  battery_float_charge_voltage: null,
  output_source_priority: null,
  bus_voltage: null,
};
