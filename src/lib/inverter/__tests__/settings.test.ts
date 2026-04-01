import { describe, expect, it } from 'vitest';
import { resolveMaxChargeCurrentDisplay, resolveOutputSourcePriority } from '../settings';

describe('resolveOutputSourcePriority', () => {
  it('returns the dedicated output source priority when present', () => {
    expect(
      resolveOutputSourcePriority({
        output_source_priority: 'Solar first',
        work_mode: 'Battery first',
      })
    ).toBe('Solar first');
  });

  it('falls back to work mode when output source priority is unavailable', () => {
    expect(
      resolveOutputSourcePriority({
        output_source_priority: null,
        work_mode: 'Battery first',
      })
    ).toBe('Battery first');
  });

  it('treats blank strings as unavailable', () => {
    expect(
      resolveOutputSourcePriority({
        output_source_priority: '   ',
        work_mode: 'Load first',
      })
    ).toBe('Load first');
  });

  it('returns null when neither field has a usable value', () => {
    expect(
      resolveOutputSourcePriority({
        output_source_priority: null,
        work_mode: '',
      })
    ).toBeNull();
  });
});

describe('resolveMaxChargeCurrentDisplay', () => {
  it('returns the reported charge current with amps when available', () => {
    expect(
      resolveMaxChargeCurrentDisplay({
        max_charge_current: 20,
        mqtt_connected: true,
        battery_first_charge_rate: 100,
        battery_first_grid_charge: 'Enabled',
        battery_first_stop_charge: 100,
      })
    ).toEqual({ value: 20, unit: 'A' });
  });

  it('explains when the inverter does not publish the setting but other config read-back is live', () => {
    expect(
      resolveMaxChargeCurrentDisplay({
        max_charge_current: null,
        mqtt_connected: true,
        battery_first_charge_rate: 100,
        battery_first_grid_charge: 'Enabled',
        battery_first_stop_charge: 100,
      })
    ).toEqual({ value: 'Not reported by inverter' });
  });

  it('stays empty before MQTT config read-back is available', () => {
    expect(
      resolveMaxChargeCurrentDisplay({
        max_charge_current: null,
        mqtt_connected: false,
        battery_first_charge_rate: null,
        battery_first_grid_charge: null,
        battery_first_stop_charge: null,
      })
    ).toEqual({ value: null });
  });
});
