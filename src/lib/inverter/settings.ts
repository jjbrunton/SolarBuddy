import type { InverterState } from '@/lib/types';

function getNonEmptyString(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return value.trim() ? value : null;
}

export function resolveOutputSourcePriority(
  state: Pick<InverterState, 'output_source_priority' | 'work_mode'>
): string | null {
  return getNonEmptyString(state.output_source_priority) ?? getNonEmptyString(state.work_mode);
}

export function resolveMaxChargeCurrentDisplay(
  state: Pick<
    InverterState,
    | 'max_charge_current'
    | 'mqtt_connected'
    | 'battery_first_charge_rate'
    | 'battery_first_grid_charge'
    | 'battery_first_stop_charge'
  >
): { value: number | string | null; unit?: string } {
  if (state.max_charge_current != null) {
    return { value: state.max_charge_current, unit: 'A' };
  }

  const hasOtherChargeReadback =
    state.battery_first_charge_rate != null ||
    getNonEmptyString(state.battery_first_grid_charge) != null ||
    state.battery_first_stop_charge != null;

  if (state.mqtt_connected && hasOtherChargeReadback) {
    return { value: 'Not reported by inverter' };
  }

  return { value: null };
}
