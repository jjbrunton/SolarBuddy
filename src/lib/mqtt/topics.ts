export const SUBSCRIBE_TOPICS = [
  // === Core (existing) ===
  'solar_assistant/total/battery_state_of_charge/state',
  'solar_assistant/inverter_1/pv_power/state',
  'solar_assistant/total/grid_power/state',
  'solar_assistant/inverter_1/load_power/state',
  'solar_assistant/total/battery_power/state',
  'solar_assistant/inverter_1/work_mode_priority/state',
  'solar_assistant/set/response_message/state',

  // === Tier 1: Core monitoring ===
  'solar_assistant/inverter_1/battery_voltage/state',
  'solar_assistant/total/battery_temperature/state',
  'solar_assistant/inverter_1/temperature/state',
  'solar_assistant/total/grid_voltage/state',
  'solar_assistant/inverter_1/device_mode/state',

  // === Fallbacks: some setups publish grid data under inverter_1 instead of total ===
  'solar_assistant/inverter_1/grid_power/state',
  'solar_assistant/inverter_1/grid_voltage/state',

  // === Tier 2: Per-MPPT solar detail ===
  'solar_assistant/inverter_1/pv_voltage_1/state',
  'solar_assistant/inverter_1/pv_voltage_2/state',
  'solar_assistant/inverter_1/pv_current_1/state',
  'solar_assistant/inverter_1/pv_current_2/state',
  'solar_assistant/inverter_1/pv_power_1/state',
  'solar_assistant/inverter_1/pv_power_2/state',
  'solar_assistant/inverter_1/grid_frequency/state',

  // === Tier 3: Charge config read-back ===
  'solar_assistant/inverter_1/battery_first_charge_rate/state',
  'solar_assistant/inverter_1/battery_first_grid_charge/state',
  'solar_assistant/inverter_1/battery_first_stop_charge/state',
  'solar_assistant/inverter_1/load_first_stop_discharge/state',
  'solar_assistant/inverter_1/grid_first_discharge_rate/state',
  'solar_assistant/inverter_1/max_charge_current/state',
  'solar_assistant/inverter_1/max_grid_charge_current/state',
  'solar_assistant/inverter_1/battery_absorption_charge_voltage/state',
  'solar_assistant/inverter_1/battery_float_charge_voltage/state',
  'solar_assistant/inverter_1/output_source_priority/state',
  'solar_assistant/total/bus_voltage/state',
] as const;

export const COMMAND_TOPICS = {
  workMode: 'solar_assistant/inverter_1/work_mode_priority/set',
  batterySlot1Enabled: 'solar_assistant/inverter_1/battery_first_slot_1_enabled/set',
  gridChargeRate: 'solar_assistant/inverter_1/grid_charge_rate/set',
  batteryChargeRate: 'solar_assistant/inverter_1/battery_first_charge_rate/set',
  outputSourcePriority: 'solar_assistant/inverter_1/output_source_priority/set',
  chargerSourcePriority: 'solar_assistant/inverter_1/charger_source_priority/set',
  maxGridChargeCurrent: 'solar_assistant/inverter_1/max_grid_charge_current/set',
  shutdownBatteryVoltage: 'solar_assistant/inverter_1/shutdown_battery_voltage/set',
} as const;

export type TopicKey =
  // Core
  | 'battery_soc'
  | 'pv_power'
  | 'grid_power'
  | 'load_power'
  | 'battery_power'
  | 'work_mode'
  | 'response'
  // Tier 1
  | 'battery_voltage'
  | 'battery_temperature'
  | 'inverter_temperature'
  | 'grid_voltage'
  | 'device_mode'
  // Tier 2
  | 'pv_voltage_1'
  | 'pv_voltage_2'
  | 'pv_current_1'
  | 'pv_current_2'
  | 'pv_power_1'
  | 'pv_power_2'
  | 'grid_frequency'
  // Tier 3
  | 'battery_first_charge_rate'
  | 'battery_first_grid_charge'
  | 'battery_first_stop_charge'
  | 'load_first_stop_discharge'
  | 'grid_first_discharge_rate'
  | 'max_charge_current'
  | 'battery_absorption_charge_voltage'
  | 'battery_float_charge_voltage'
  | 'output_source_priority'
  | 'bus_voltage';

const TOPIC_MAP: Record<string, TopicKey> = {
  // Core
  'solar_assistant/total/battery_state_of_charge/state': 'battery_soc',
  'solar_assistant/inverter_1/pv_power/state': 'pv_power',
  'solar_assistant/total/grid_power/state': 'grid_power',
  'solar_assistant/inverter_1/load_power/state': 'load_power',
  'solar_assistant/total/battery_power/state': 'battery_power',
  'solar_assistant/inverter_1/work_mode_priority/state': 'work_mode',
  'solar_assistant/set/response_message/state': 'response',

  // Tier 1
  'solar_assistant/inverter_1/battery_voltage/state': 'battery_voltage',
  'solar_assistant/total/battery_temperature/state': 'battery_temperature',
  'solar_assistant/inverter_1/temperature/state': 'inverter_temperature',
  'solar_assistant/total/grid_voltage/state': 'grid_voltage',
  'solar_assistant/inverter_1/device_mode/state': 'device_mode',

  // Fallbacks (inverter_1 variants of total/ topics)
  'solar_assistant/inverter_1/grid_power/state': 'grid_power',
  'solar_assistant/inverter_1/grid_voltage/state': 'grid_voltage',

  // Tier 2
  'solar_assistant/inverter_1/pv_voltage_1/state': 'pv_voltage_1',
  'solar_assistant/inverter_1/pv_voltage_2/state': 'pv_voltage_2',
  'solar_assistant/inverter_1/pv_current_1/state': 'pv_current_1',
  'solar_assistant/inverter_1/pv_current_2/state': 'pv_current_2',
  'solar_assistant/inverter_1/pv_power_1/state': 'pv_power_1',
  'solar_assistant/inverter_1/pv_power_2/state': 'pv_power_2',
  'solar_assistant/inverter_1/grid_frequency/state': 'grid_frequency',

  // Tier 3
  'solar_assistant/inverter_1/battery_first_charge_rate/state': 'battery_first_charge_rate',
  'solar_assistant/inverter_1/battery_first_grid_charge/state': 'battery_first_grid_charge',
  'solar_assistant/inverter_1/battery_first_stop_charge/state': 'battery_first_stop_charge',
  'solar_assistant/inverter_1/load_first_stop_discharge/state': 'load_first_stop_discharge',
  'solar_assistant/inverter_1/grid_first_discharge_rate/state': 'grid_first_discharge_rate',
  'solar_assistant/inverter_1/max_charge_current/state': 'max_charge_current',
  'solar_assistant/inverter_1/max_grid_charge_current/state': 'max_charge_current',
  'solar_assistant/inverter_1/battery_absorption_charge_voltage/state': 'battery_absorption_charge_voltage',
  'solar_assistant/inverter_1/battery_float_charge_voltage/state': 'battery_float_charge_voltage',
  'solar_assistant/inverter_1/output_source_priority/state': 'output_source_priority',
  'solar_assistant/total/bus_voltage/state': 'bus_voltage',
};

/** Keys whose MQTT payloads are text strings rather than numbers */
export const STRING_KEYS = new Set<TopicKey>([
  'work_mode',
  'device_mode',
  'battery_first_grid_charge',
  'output_source_priority',
]);

export function parseTopicKey(topic: string): TopicKey | null {
  return TOPIC_MAP[topic] ?? null;
}
