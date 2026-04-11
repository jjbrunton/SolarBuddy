/**
 * Single source of truth for every Home Assistant entity SolarBuddy publishes.
 *
 * Each entity owns:
 * - its HA component (sensor, binary_sensor, switch, select, button)
 * - a stable key used in topic paths and unique IDs
 * - a human-readable name (rendered in HA under the "SolarBuddy" device)
 * - optional device_class, state_class, unit, options (for selects), icon
 * - a state reader that converts SolarBuddy runtime state into an MQTT payload
 *   string (or `null` to publish "None" for unknown values)
 *
 * The command-handler module owns writable entity routing. It looks entities
 * up here by key, so the keys in READ_ONLY_ENTITIES and WRITABLE_ENTITIES
 * must stay unique across the whole catalog.
 */

import type { EntityComponent } from './topics';
import type { InverterState } from '../types';
import type { CurrentRateSummary } from '../octopus/current-rate-summary';
import type { ResolvedSlotAction, UpcomingEvents } from '../scheduler/resolve';

export interface PublishSnapshot {
  state: InverterState;
  rateSummary: CurrentRateSummary | null;
  resolvedAction: ResolvedSlotAction | null;
  upcomingEvents: UpcomingEvents | null;
}

export interface EntityDefinition {
  key: string;
  component: EntityComponent;
  name: string;
  deviceClass?: string;
  stateClass?: string;
  unit?: string;
  icon?: string;
  /** For select entities, the fixed list of allowed payloads. */
  options?: string[];
  /** Enumerated values for sensors (HA renders these as enum chips). */
  enumOptions?: string[];
  /** Return the state payload, or null to publish `None`. */
  readState?: (snap: PublishSnapshot) => string | null;
  /**
   * Numeric tolerance for change detection on float sensors. If the new and
   * previously-published numeric values differ by less than this, the publish
   * is suppressed. Applies only when readState returns a pure number string.
   */
  changeTolerance?: number;
  /** True if HA button (stateless). Buttons have no readState. */
  stateless?: boolean;
}

const POWER_TOLERANCE_W = 5;
const SOC_TOLERANCE_PCT = 1;
const TEMP_TOLERANCE_C = 0.5;
const VOLTAGE_TOLERANCE_V = 0.5;

function numOrNull(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return String(value);
}

function stringOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  return value;
}

/** Convert pence-per-kWh (Octopus native unit) to GBP/kWh for HA `monetary`. */
function pencePerKwhToGbp(valuePence: number): string {
  return (valuePence / 100).toFixed(4);
}

export const READ_ONLY_ENTITIES: EntityDefinition[] = [
  // --- Telemetry (debounced, high-frequency source) ---
  {
    key: 'battery_soc',
    component: 'sensor',
    name: 'Battery SOC',
    deviceClass: 'battery',
    stateClass: 'measurement',
    unit: '%',
    readState: (s) => numOrNull(s.state.battery_soc),
    changeTolerance: SOC_TOLERANCE_PCT,
  },
  {
    key: 'pv_power',
    component: 'sensor',
    name: 'PV Power',
    deviceClass: 'power',
    stateClass: 'measurement',
    unit: 'W',
    readState: (s) => numOrNull(s.state.pv_power),
    changeTolerance: POWER_TOLERANCE_W,
  },
  {
    key: 'grid_power',
    component: 'sensor',
    name: 'Grid Power',
    deviceClass: 'power',
    stateClass: 'measurement',
    unit: 'W',
    readState: (s) => numOrNull(s.state.grid_power),
    changeTolerance: POWER_TOLERANCE_W,
  },
  {
    key: 'load_power',
    component: 'sensor',
    name: 'Load Power',
    deviceClass: 'power',
    stateClass: 'measurement',
    unit: 'W',
    readState: (s) => numOrNull(s.state.load_power),
    changeTolerance: POWER_TOLERANCE_W,
  },
  {
    key: 'battery_power',
    component: 'sensor',
    name: 'Battery Power',
    deviceClass: 'power',
    stateClass: 'measurement',
    unit: 'W',
    readState: (s) => numOrNull(s.state.battery_power),
    changeTolerance: POWER_TOLERANCE_W,
  },
  {
    key: 'battery_temperature',
    component: 'sensor',
    name: 'Battery Temperature',
    deviceClass: 'temperature',
    stateClass: 'measurement',
    unit: '°C',
    readState: (s) => numOrNull(s.state.battery_temperature),
    changeTolerance: TEMP_TOLERANCE_C,
  },
  {
    key: 'battery_voltage',
    component: 'sensor',
    name: 'Battery Voltage',
    deviceClass: 'voltage',
    stateClass: 'measurement',
    unit: 'V',
    readState: (s) => numOrNull(s.state.battery_voltage),
    changeTolerance: VOLTAGE_TOLERANCE_V,
  },
  {
    key: 'inverter_temperature',
    component: 'sensor',
    name: 'Inverter Temperature',
    deviceClass: 'temperature',
    stateClass: 'measurement',
    unit: '°C',
    readState: (s) => numOrNull(s.state.inverter_temperature),
    changeTolerance: TEMP_TOLERANCE_C,
  },
  // --- Tariff (60s cadence) ---
  {
    key: 'current_rate',
    component: 'sensor',
    name: 'Current Rate',
    deviceClass: 'monetary',
    stateClass: 'measurement',
    unit: 'GBP/kWh',
    readState: (s) => (s.rateSummary ? pencePerKwhToGbp(s.rateSummary.current.price_inc_vat) : null),
  },
  {
    key: 'next_rate',
    component: 'sensor',
    name: 'Next Rate',
    deviceClass: 'monetary',
    stateClass: 'measurement',
    unit: 'GBP/kWh',
    readState: (s) =>
      s.rateSummary && s.rateSummary.next ? pencePerKwhToGbp(s.rateSummary.next.price_inc_vat) : null,
  },
  {
    key: 'rate_status',
    component: 'sensor',
    name: 'Rate Status',
    icon: 'mdi:chart-line',
    enumOptions: ['negative', 'best', 'cheap', 'average', 'expensive'],
    readState: (s) => s.rateSummary?.status ?? null,
  },
  // --- Plan / current action ---
  {
    key: 'current_action',
    component: 'sensor',
    name: 'Current Action',
    icon: 'mdi:battery-sync',
    enumOptions: ['charge', 'discharge', 'hold'],
    readState: (s) => s.resolvedAction?.action ?? null,
  },
  {
    key: 'current_action_reason',
    component: 'sensor',
    name: 'Current Action Reason',
    icon: 'mdi:information-outline',
    readState: (s) => stringOrNull(s.resolvedAction?.detail ?? null),
  },
  {
    key: 'next_action',
    component: 'sensor',
    name: 'Next Action',
    icon: 'mdi:battery-clock',
    enumOptions: ['charge', 'discharge', 'hold'],
    readState: (s) => s.upcomingEvents?.nextAction ?? null,
  },
  {
    key: 'next_action_start',
    component: 'sensor',
    name: 'Next Action Start',
    deviceClass: 'timestamp',
    icon: 'mdi:clock-start',
    readState: (s) => isoOrNull(s.upcomingEvents?.nextActionStart ?? null),
  },
  {
    key: 'next_charge_start',
    component: 'sensor',
    name: 'Next Charge Start',
    deviceClass: 'timestamp',
    icon: 'mdi:battery-plus',
    readState: (s) => isoOrNull(s.upcomingEvents?.nextChargeStart ?? null),
  },
  {
    key: 'next_discharge_start',
    component: 'sensor',
    name: 'Next Discharge Start',
    deviceClass: 'timestamp',
    icon: 'mdi:battery-minus',
    readState: (s) => isoOrNull(s.upcomingEvents?.nextDischargeStart ?? null),
  },
  {
    key: 'current_work_mode',
    component: 'sensor',
    name: 'Inverter Work Mode',
    icon: 'mdi:power-settings',
    readState: (s) => stringOrNull(s.state.work_mode),
  },
  {
    key: 'last_updated',
    component: 'sensor',
    name: 'Last Updated',
    deviceClass: 'timestamp',
    readState: (s) => isoOrNull(s.state.last_updated),
  },
  {
    key: 'runtime_mode',
    component: 'sensor',
    name: 'Runtime Mode',
    icon: 'mdi:test-tube',
    enumOptions: ['real', 'virtual'],
    readState: (s) => s.state.runtime_mode,
  },
  // --- Binary sensors ---
  {
    key: 'mqtt_connected',
    component: 'binary_sensor',
    name: 'Solar Assistant MQTT',
    deviceClass: 'connectivity',
    readState: (s) => (s.state.mqtt_connected ? 'ON' : 'OFF'),
  },
  {
    key: 'charging_active',
    component: 'binary_sensor',
    name: 'Charging Active',
    deviceClass: 'power',
    icon: 'mdi:battery-charging',
    readState: (s) => {
      const charging =
        typeof s.state.battery_power === 'number' &&
        s.state.battery_power > 50 &&
        s.state.work_mode === 'Battery first';
      return charging ? 'ON' : 'OFF';
    },
  },
  {
    key: 'discharging_active',
    component: 'binary_sensor',
    name: 'Discharging Active',
    deviceClass: 'power',
    icon: 'mdi:battery-minus',
    readState: (s) => {
      const discharging = typeof s.state.battery_power === 'number' && s.state.battery_power < -50;
      return discharging ? 'ON' : 'OFF';
    },
  },
];

export type WritableEntityKey =
  | 'auto_schedule'
  | 'watchdog_enabled'
  | 'smart_discharge'
  | 'charging_strategy'
  | 'current_slot_override'
  | 'replan_now'
  | 'fetch_rates'
  | 'clear_overrides'
  | 'reconcile_now';

export interface WritableEntityDefinition extends EntityDefinition {
  key: WritableEntityKey;
  /** Present on switches/selects so HA reflects the currently persisted setting. */
  readState?: (snap: PublishSnapshot) => string | null;
}

export const WRITABLE_ENTITIES: WritableEntityDefinition[] = [
  {
    key: 'auto_schedule',
    component: 'switch',
    name: 'Auto Schedule',
    icon: 'mdi:calendar-refresh',
  },
  {
    key: 'watchdog_enabled',
    component: 'switch',
    name: 'Inverter Watchdog',
    icon: 'mdi:shield-sync',
  },
  {
    key: 'smart_discharge',
    component: 'switch',
    name: 'Smart Discharge',
    icon: 'mdi:battery-arrow-up',
  },
  {
    key: 'charging_strategy',
    component: 'select',
    name: 'Charging Strategy',
    icon: 'mdi:strategy',
    options: ['night_fill', 'opportunistic_topup'],
  },
  {
    key: 'current_slot_override',
    component: 'select',
    name: 'Current Slot Override',
    icon: 'mdi:hand-back-right',
    options: ['none', 'charge', 'discharge', 'hold'],
  },
  {
    key: 'replan_now',
    component: 'button',
    name: 'Replan Now',
    icon: 'mdi:refresh',
    stateless: true,
  },
  {
    key: 'fetch_rates',
    component: 'button',
    name: 'Fetch Rates',
    icon: 'mdi:download',
    stateless: true,
  },
  {
    key: 'clear_overrides',
    component: 'button',
    name: 'Clear Overrides',
    icon: 'mdi:broom',
    stateless: true,
  },
  {
    key: 'reconcile_now',
    component: 'button',
    name: 'Reconcile Now',
    icon: 'mdi:sync',
    stateless: true,
  },
];

export const ALL_ENTITIES: EntityDefinition[] = [...READ_ONLY_ENTITIES, ...WRITABLE_ENTITIES];

export function findEntity(key: string): EntityDefinition | undefined {
  return ALL_ENTITIES.find((e) => e.key === key);
}
