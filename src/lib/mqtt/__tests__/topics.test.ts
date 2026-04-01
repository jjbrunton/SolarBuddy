import { describe, expect, it } from 'vitest';
import { parseTopicKey } from '../topics';

describe('parseTopicKey', () => {
  it('maps the legacy max charge current topic', () => {
    expect(parseTopicKey('solar_assistant/inverter_1/max_charge_current/state')).toBe(
      'max_charge_current'
    );
  });

  it('maps the grid-specific max charge current topic to the same state key', () => {
    expect(parseTopicKey('solar_assistant/inverter_1/max_grid_charge_current/state')).toBe(
      'max_charge_current'
    );
  });

  it('returns null for unsupported topics', () => {
    expect(parseTopicKey('solar_assistant/inverter_1/not_a_real_setting/state')).toBeNull();
  });
});
