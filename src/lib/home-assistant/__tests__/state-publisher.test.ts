import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  onStateChangeMock,
  getStateMock,
  getSettingsMock,
  getResolvedSlotActionMock,
  getUpcomingEventsMock,
  summarizeCurrentRateMock,
  getStoredRatesMock,
  getVirtualNowMock,
  getVirtualRatesMock,
  isVirtualModeEnabledMock,
  listTodayOverridesMock,
} = vi.hoisted(() => ({
  onStateChangeMock: vi.fn(),
  getStateMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getResolvedSlotActionMock: vi.fn(),
  getUpcomingEventsMock: vi.fn(),
  summarizeCurrentRateMock: vi.fn(),
  getStoredRatesMock: vi.fn(() => [] as unknown[]),
  getVirtualNowMock: vi.fn(() => new Date('2026-04-10T12:00:00.000Z')),
  getVirtualRatesMock: vi.fn(() => [] as unknown[]),
  isVirtualModeEnabledMock: vi.fn(() => false),
  listTodayOverridesMock: vi.fn(() => [] as unknown[]),
}));

vi.mock('../../state', () => ({
  onStateChange: onStateChangeMock,
  getState: getStateMock,
}));

vi.mock('../../config', () => ({
  getSettings: getSettingsMock,
}));

vi.mock('../../scheduler/watchdog', () => ({
  getResolvedSlotAction: getResolvedSlotActionMock,
  getUpcomingEvents: getUpcomingEventsMock,
}));

vi.mock('../../octopus/current-rate-summary', () => ({
  summarizeCurrentRate: summarizeCurrentRateMock,
}));

vi.mock('../../octopus/rates', () => ({
  getStoredRates: getStoredRatesMock,
}));

vi.mock('../../virtual-inverter/runtime', () => ({
  getVirtualNow: getVirtualNowMock,
  getVirtualRates: getVirtualRatesMock,
  isVirtualModeEnabled: isVirtualModeEnabledMock,
}));

vi.mock('../../db/override-repository', () => ({
  listTodayOverrides: listTodayOverridesMock,
}));

import { startStatePublisher } from '../state-publisher';
import { createTopicComposer } from '../topics';

const topics = createTopicComposer('solarbuddy', 'homeassistant');

type PublishCall = { topic: string; payload: string };

function makePublisher(): { publisher: { publish: (t: string, p: string) => void }; calls: PublishCall[] } {
  const calls: PublishCall[] = [];
  return {
    publisher: {
      publish: (topic: string, payload: string) => {
        calls.push({ topic, payload });
      },
    },
    calls,
  };
}

const DEFAULT_STATE = {
  runtime_mode: 'real',
  virtual_scenario_id: null,
  virtual_scenario_name: null,
  virtual_playback_state: null,
  virtual_time: null,
  battery_soc: 55,
  pv_power: 1200,
  grid_power: -400,
  load_power: 800,
  battery_power: 600,
  work_mode: 'Battery first',
  mqtt_connected: true,
  last_updated: '2026-04-10T12:00:00.000Z',
  battery_voltage: 52.1,
  battery_temperature: 24.5,
  inverter_temperature: 31.0,
  grid_voltage: 240,
  device_mode: null,
  pv_voltage_1: null,
  pv_voltage_2: null,
  pv_current_1: null,
  pv_current_2: null,
  pv_power_1: null,
  pv_power_2: null,
  grid_frequency: null,
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

const DEFAULT_SETTINGS = {
  auto_schedule: 'true',
  watchdog_enabled: 'true',
  smart_discharge: 'false',
  charging_strategy: 'night_fill',
};

describe('home-assistant state publisher', () => {
  let listeners: Array<(state: typeof DEFAULT_STATE) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = [];
    onStateChangeMock.mockImplementation((listener) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    });
    getStateMock.mockReturnValue({ ...DEFAULT_STATE });
    getSettingsMock.mockReturnValue({ ...DEFAULT_SETTINGS });
    getResolvedSlotActionMock.mockReturnValue({
      action: 'charge',
      source: 'plan',
      reason: 'cheapest slot',
      detail: 'Cheapest slot in the overnight window',
      slotStart: '2026-04-10T12:00:00.000Z',
      slotEnd: '2026-04-10T12:30:00.000Z',
    });
    getUpcomingEventsMock.mockReturnValue({
      nextAction: 'hold',
      nextActionStart: '2026-04-10T13:00:00.000Z',
      nextChargeStart: '2026-04-10T23:30:00.000Z',
      nextDischargeStart: '2026-04-10T17:00:00.000Z',
    });
    summarizeCurrentRateMock.mockReturnValue({
      current: { valid_from: '2026-04-10T12:00:00.000Z', valid_to: '2026-04-10T12:30:00.000Z', price_inc_vat: 21.5 },
      next: { valid_from: '2026-04-10T12:30:00.000Z', valid_to: '2026-04-10T13:00:00.000Z', price_inc_vat: 18.0 },
      minPrice: 10,
      maxPrice: 30,
      averagePrice: 20,
      status: 'average',
    });
    getStoredRatesMock.mockReturnValue([
      { valid_from: '2026-04-10T12:00:00.000Z', valid_to: '2026-04-10T12:30:00.000Z', price_inc_vat: 21.5, price_exc_vat: 20.5 },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes a full snapshot on publishFullSnapshot() including switch state from settings', () => {
    const { publisher, calls } = makePublisher();
    const control = startStatePublisher(publisher, topics);
    control.publishFullSnapshot();

    const topicsPublished = calls.map((c) => c.topic);
    expect(topicsPublished).toContain('solarbuddy/sensor/battery_soc/state');
    expect(topicsPublished).toContain('solarbuddy/sensor/current_rate/state');
    expect(topicsPublished).toContain('solarbuddy/sensor/current_action/state');
    expect(topicsPublished).toContain('solarbuddy/switch/auto_schedule/state');

    const autoSchedule = calls.find((c) => c.topic === 'solarbuddy/switch/auto_schedule/state');
    expect(autoSchedule?.payload).toBe('ON');
    const watchdog = calls.find((c) => c.topic === 'solarbuddy/switch/watchdog_enabled/state');
    expect(watchdog?.payload).toBe('ON');
    const strategy = calls.find((c) => c.topic === 'solarbuddy/select/charging_strategy/state');
    expect(strategy?.payload).toBe('night_fill');

    control.stop();
  });

  it('publishes upcoming-event sensors and forwards the current action to the resolver', () => {
    const { publisher, calls } = makePublisher();
    const control = startStatePublisher(publisher, topics);
    control.publishFullSnapshot();

    const nextAction = calls.find((c) => c.topic === 'solarbuddy/sensor/next_action/state');
    expect(nextAction?.payload).toBe('hold');
    const nextActionStart = calls.find((c) => c.topic === 'solarbuddy/sensor/next_action_start/state');
    expect(nextActionStart?.payload).toBe('2026-04-10T13:00:00.000Z');
    const nextCharge = calls.find((c) => c.topic === 'solarbuddy/sensor/next_charge_start/state');
    expect(nextCharge?.payload).toBe('2026-04-10T23:30:00.000Z');
    const nextDischarge = calls.find((c) => c.topic === 'solarbuddy/sensor/next_discharge_start/state');
    expect(nextDischarge?.payload).toBe('2026-04-10T17:00:00.000Z');

    // The publisher must pass the resolved current action through so the
    // walker can skip the current contiguous run.
    expect(getUpcomingEventsMock).toHaveBeenCalledWith(expect.any(Date), 'charge');

    control.stop();
  });

  it('publishes None for upcoming-event sensors when the resolver throws', () => {
    const { publisher, calls } = makePublisher();
    getUpcomingEventsMock.mockImplementationOnce(() => {
      throw new Error('no plan');
    });
    const control = startStatePublisher(publisher, topics);
    control.publishFullSnapshot();

    const nextCharge = calls.find((c) => c.topic === 'solarbuddy/sensor/next_charge_start/state');
    expect(nextCharge?.payload).toBe('None');

    control.stop();
  });

  it('converts Octopus pence/kWh rates to GBP/kWh in the current_rate sensor', () => {
    const { publisher, calls } = makePublisher();
    const control = startStatePublisher(publisher, topics);
    control.publishFullSnapshot();

    const currentRate = calls.find((c) => c.topic === 'solarbuddy/sensor/current_rate/state');
    expect(currentRate?.payload).toBe('0.2150');

    control.stop();
  });

  it('coalesces multiple onStateChange events into one flush after the debounce', () => {
    const { publisher, calls } = makePublisher();
    const control = startStatePublisher(publisher, topics);
    control.publishFullSnapshot();
    const initialCount = calls.length;

    // Fire 5 state changes in quick succession with a larger battery_soc jump
    // so change detection passes.
    for (let i = 0; i < 5; i++) {
      getStateMock.mockReturnValue({ ...DEFAULT_STATE, battery_soc: 60 + i });
      listeners.forEach((l) => l({ ...DEFAULT_STATE, battery_soc: 60 + i }));
    }

    // Before the debounce window elapses, no extra publishes.
    expect(calls.length).toBe(initialCount);

    vi.advanceTimersByTime(1001);

    // Exactly one flush happened; battery_soc was republished once (not 5 times).
    const socCalls = calls.filter((c) => c.topic === 'solarbuddy/sensor/battery_soc/state');
    expect(socCalls.length).toBe(2); // once from snapshot, once from flush
    expect(socCalls[1].payload).toBe('64');

    control.stop();
  });

  it('suppresses pv_power deltas below the 5W tolerance', () => {
    const { publisher, calls } = makePublisher();
    const control = startStatePublisher(publisher, topics);
    control.publishFullSnapshot();

    getStateMock.mockReturnValue({ ...DEFAULT_STATE, pv_power: 1202 }); // +2W
    listeners.forEach((l) => l({ ...DEFAULT_STATE, pv_power: 1202 }));

    vi.advanceTimersByTime(1001);

    const pvCalls = calls.filter((c) => c.topic === 'solarbuddy/sensor/pv_power/state');
    expect(pvCalls.length).toBe(1); // only the initial snapshot, no flush publish

    control.stop();
  });

  it('publishes pv_power deltas above the 5W tolerance', () => {
    const { publisher, calls } = makePublisher();
    const control = startStatePublisher(publisher, topics);
    control.publishFullSnapshot();

    getStateMock.mockReturnValue({ ...DEFAULT_STATE, pv_power: 1250 }); // +50W
    listeners.forEach((l) => l({ ...DEFAULT_STATE, pv_power: 1250 }));

    vi.advanceTimersByTime(1001);

    const pvCalls = calls.filter((c) => c.topic === 'solarbuddy/sensor/pv_power/state');
    expect(pvCalls.length).toBe(2);
    expect(pvCalls[1].payload).toBe('1250');

    control.stop();
  });

  it('publishWritableEntity publishes the requested single entity', () => {
    const { publisher, calls } = makePublisher();
    const control = startStatePublisher(publisher, topics);

    getSettingsMock.mockReturnValue({ ...DEFAULT_SETTINGS, auto_schedule: 'false' });
    control.publishWritableEntity('auto_schedule');

    const autoSchedule = calls.find((c) => c.topic === 'solarbuddy/switch/auto_schedule/state');
    expect(autoSchedule?.payload).toBe('OFF');

    control.stop();
  });

  it('stop() clears timers and unsubscribes so no further flushes happen', () => {
    const { publisher, calls } = makePublisher();
    const control = startStatePublisher(publisher, topics);
    control.publishFullSnapshot();
    const initialCount = calls.length;

    control.stop();

    listeners.forEach((l) => l({ ...DEFAULT_STATE, battery_soc: 80 }));
    vi.advanceTimersByTime(5000);

    expect(calls.length).toBe(initialCount);
  });
});
