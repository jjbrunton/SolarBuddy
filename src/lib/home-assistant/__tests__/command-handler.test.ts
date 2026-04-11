import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  saveSettingsMock,
  requestReplanMock,
  reconcileInverterStateMock,
  syncInverterWatchdogSettingMock,
  fetchAndStoreRatesMock,
  clearTodayOverridesMock,
  upsertTodayOverrideMock,
  deleteTodayOverrideSlotMock,
  isVirtualModeEnabledMock,
  getVirtualNowMock,
  appendEventMock,
} = vi.hoisted(() => ({
  saveSettingsMock: vi.fn(),
  requestReplanMock: vi.fn(),
  reconcileInverterStateMock: vi.fn(async () => undefined),
  syncInverterWatchdogSettingMock: vi.fn(),
  fetchAndStoreRatesMock: vi.fn(async () => [] as unknown[]),
  clearTodayOverridesMock: vi.fn(),
  upsertTodayOverrideMock: vi.fn(),
  deleteTodayOverrideSlotMock: vi.fn(),
  isVirtualModeEnabledMock: vi.fn(() => false),
  getVirtualNowMock: vi.fn(() => new Date('2026-04-10T13:17:00.000Z')),
  appendEventMock: vi.fn(),
}));

vi.mock('../../config', () => ({
  saveSettings: saveSettingsMock,
  getSettings: vi.fn(() => ({})),
}));

vi.mock('../../scheduler/reevaluate', () => ({
  requestReplan: requestReplanMock,
}));

vi.mock('../../scheduler/watchdog', () => ({
  reconcileInverterState: reconcileInverterStateMock,
  syncInverterWatchdogSetting: syncInverterWatchdogSettingMock,
}));

vi.mock('../../octopus/rates', () => ({
  fetchAndStoreRates: fetchAndStoreRatesMock,
}));

vi.mock('../../db/override-repository', () => ({
  clearTodayOverrides: clearTodayOverridesMock,
  upsertTodayOverride: upsertTodayOverrideMock,
  deleteTodayOverrideSlot: deleteTodayOverrideSlotMock,
  currentSlotBoundsUtc: (now: Date) => ({
    slot_start: new Date(Math.floor(now.getTime() / (30 * 60 * 1000)) * 30 * 60 * 1000).toISOString(),
    slot_end: new Date(Math.floor(now.getTime() / (30 * 60 * 1000)) * 30 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
  }),
}));

vi.mock('../../virtual-inverter/runtime', () => ({
  isVirtualModeEnabled: isVirtualModeEnabledMock,
  getVirtualNow: getVirtualNowMock,
}));

vi.mock('../../events', () => ({
  appendEvent: appendEventMock,
}));

import { createCommandDispatcher } from '../command-handler';
import { createTopicComposer } from '../topics';

const topics = createTopicComposer('solarbuddy', 'homeassistant');

function buildDeps() {
  const publishWritableEntity = vi.fn();
  const deps = {
    topics,
    publisher: {
      publishFullSnapshot: vi.fn(),
      publishWritableEntity,
      getPublishedEntityCount: () => 0,
      stop: vi.fn(),
    },
    mqttPublish: vi.fn(),
  };
  return { deps, publishWritableEntity };
}

describe('home-assistant command handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isVirtualModeEnabledMock.mockReturnValue(false);
  });

  it('ignores topics outside the command subscriptions', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);
    await dispatch('other/system/topic', Buffer.from('hello'));
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it('ignores the HA birth topic (client handles republish)', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);
    await dispatch('homeassistant/status', Buffer.from('online'));
    expect(saveSettingsMock).not.toHaveBeenCalled();
  });

  it('routes switch.auto_schedule=ON to saveSettings + requestReplan + optimistic state publish', async () => {
    const { deps, publishWritableEntity } = buildDeps();
    const dispatch = createCommandDispatcher(deps);

    await dispatch('solarbuddy/switch/auto_schedule/set', Buffer.from('ON'));

    expect(saveSettingsMock).toHaveBeenCalledWith({ auto_schedule: 'true' });
    expect(requestReplanMock).toHaveBeenCalledWith('home-assistant auto_schedule');
    expect(publishWritableEntity).toHaveBeenCalledWith('auto_schedule');
  });

  it('routes switch.watchdog_enabled through syncInverterWatchdogSetting (no replan)', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);

    await dispatch('solarbuddy/switch/watchdog_enabled/set', Buffer.from('OFF'));

    expect(saveSettingsMock).toHaveBeenCalledWith({ watchdog_enabled: 'false' });
    expect(syncInverterWatchdogSettingMock).toHaveBeenCalledTimes(1);
    expect(requestReplanMock).not.toHaveBeenCalled();
  });

  it('validates select payloads and silently drops invalid ones', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);

    await dispatch('solarbuddy/select/charging_strategy/set', Buffer.from('rocket_fuel'));
    expect(saveSettingsMock).not.toHaveBeenCalled();

    await dispatch('solarbuddy/select/charging_strategy/set', Buffer.from('night_fill'));
    expect(saveSettingsMock).toHaveBeenCalledWith({ charging_strategy: 'night_fill' });
    expect(requestReplanMock).toHaveBeenCalledWith('home-assistant charging_strategy');
  });

  it('writes an override when current_slot_override=charge', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);

    await dispatch('solarbuddy/select/current_slot_override/set', Buffer.from('charge'));

    expect(upsertTodayOverrideMock).toHaveBeenCalledTimes(1);
    const [slotStart, slotEnd, action] = upsertTodayOverrideMock.mock.calls[0];
    expect(slotStart).toBe('2026-04-10T13:00:00.000Z');
    expect(slotEnd).toBe('2026-04-10T13:30:00.000Z');
    expect(action).toBe('charge');
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('home-assistant slot override');
  });

  it('clears the current slot override when payload is none', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);

    await dispatch('solarbuddy/select/current_slot_override/set', Buffer.from('none'));

    expect(deleteTodayOverrideSlotMock).toHaveBeenCalledTimes(1);
    expect(upsertTodayOverrideMock).not.toHaveBeenCalled();
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('home-assistant slot override');
  });

  it('presses replan_now → requestReplan', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);
    await dispatch('solarbuddy/button/replan_now/press', Buffer.from('PRESS'));
    expect(requestReplanMock).toHaveBeenCalledWith('home-assistant button');
  });

  it('presses fetch_rates → fetchAndStoreRates in real mode', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);
    await dispatch('solarbuddy/button/fetch_rates/press', Buffer.from('PRESS'));
    expect(fetchAndStoreRatesMock).toHaveBeenCalledTimes(1);
  });

  it('skips fetch_rates in virtual mode and never calls Octopus', async () => {
    isVirtualModeEnabledMock.mockReturnValue(true);
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);
    await dispatch('solarbuddy/button/fetch_rates/press', Buffer.from('PRESS'));
    expect(fetchAndStoreRatesMock).not.toHaveBeenCalled();
  });

  it('presses clear_overrides → clearTodayOverrides + reconcile', async () => {
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);
    await dispatch('solarbuddy/button/clear_overrides/press', Buffer.from('PRESS'));
    expect(clearTodayOverridesMock).toHaveBeenCalledTimes(1);
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('home-assistant clear overrides');
  });

  it('swallows reconcile errors so the handler stays responsive', async () => {
    reconcileInverterStateMock.mockRejectedValueOnce(new Error('Solar Assistant MQTT not connected'));
    const { deps } = buildDeps();
    const dispatch = createCommandDispatcher(deps);

    await expect(
      dispatch('solarbuddy/button/reconcile_now/press', Buffer.from('PRESS')),
    ).resolves.toBeUndefined();
    expect(reconcileInverterStateMock).toHaveBeenCalledWith('home-assistant reconcile');
    // appendEvent should have been called with an error entry
    expect(appendEventMock).toHaveBeenCalled();
  });
});
