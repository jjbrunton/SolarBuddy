export const SUBSCRIBE_TOPICS = [
  'solar_assistant/total/battery_state_of_charge/state',
  'solar_assistant/inverter_1/pv_power/state',
  'solar_assistant/total/grid_power/state',
  'solar_assistant/inverter_1/load_power/state',
  'solar_assistant/total/battery_power/state',
  'solar_assistant/inverter_1/work_mode_priority/state',
  'solar_assistant/set/response_message/state',
] as const;

export const COMMAND_TOPICS = {
  workMode: 'solar_assistant/inverter_1/work_mode_priority/set',
  batterySlot1Enabled: 'solar_assistant/inverter_1/battery_first_slot_1_enabled/set',
  gridChargeRate: 'solar_assistant/inverter_1/grid_charge_rate/set',
  batteryChargeRate: 'solar_assistant/inverter_1/battery_first_charge_rate/set',
} as const;

export type TopicKey =
  | 'battery_soc'
  | 'pv_power'
  | 'grid_power'
  | 'load_power'
  | 'battery_power'
  | 'work_mode'
  | 'response';

const TOPIC_MAP: Record<string, TopicKey> = {
  'solar_assistant/total/battery_state_of_charge/state': 'battery_soc',
  'solar_assistant/inverter_1/pv_power/state': 'pv_power',
  'solar_assistant/total/grid_power/state': 'grid_power',
  'solar_assistant/inverter_1/load_power/state': 'load_power',
  'solar_assistant/total/battery_power/state': 'battery_power',
  'solar_assistant/inverter_1/work_mode_priority/state': 'work_mode',
  'solar_assistant/set/response_message/state': 'response',
};

export function parseTopicKey(topic: string): TopicKey | null {
  return TOPIC_MAP[topic] ?? null;
}
