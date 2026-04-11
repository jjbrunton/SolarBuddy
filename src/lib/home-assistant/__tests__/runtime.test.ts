import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSettingsMock,
  connectHomeAssistantMock,
  disconnectHomeAssistantMock,
  getHomeAssistantClientInternalsMock,
  isHomeAssistantConnectedMock,
  computeSignatureMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  connectHomeAssistantMock: vi.fn(),
  disconnectHomeAssistantMock: vi.fn(),
  getHomeAssistantClientInternalsMock: vi.fn(),
  isHomeAssistantConnectedMock: vi.fn(() => false),
  computeSignatureMock: vi.fn(() => 'sig'),
}));

vi.mock('../../config', () => ({
  getSettings: getSettingsMock,
}));

vi.mock('../client', () => ({
  connectHomeAssistant: connectHomeAssistantMock,
  disconnectHomeAssistant: disconnectHomeAssistantMock,
  getHomeAssistantClientInternals: getHomeAssistantClientInternalsMock,
  isHomeAssistantConnected: isHomeAssistantConnectedMock,
  computeSignature: computeSignatureMock,
}));

import { getHomeAssistantStatus, syncHomeAssistantSetting } from '../runtime';

function baseSettings(overrides: Record<string, string> = {}) {
  return {
    homeassistant_enabled: 'true',
    homeassistant_host: 'mosquitto.local',
    homeassistant_port: '1883',
    homeassistant_username: '',
    homeassistant_password: '',
    homeassistant_discovery_prefix: 'homeassistant',
    homeassistant_base_topic: 'solarbuddy',
    ...overrides,
  };
}

describe('syncHomeAssistantSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    computeSignatureMock.mockReturnValue('sig-default');
  });

  it('disconnects when the integration is disabled', async () => {
    getSettingsMock.mockReturnValue(baseSettings({ homeassistant_enabled: 'false' }));
    await syncHomeAssistantSetting();
    expect(disconnectHomeAssistantMock).toHaveBeenCalled();
    expect(connectHomeAssistantMock).not.toHaveBeenCalled();
  });

  it('disconnects when host is empty', async () => {
    getSettingsMock.mockReturnValue(baseSettings({ homeassistant_host: '' }));
    await syncHomeAssistantSetting();
    expect(disconnectHomeAssistantMock).toHaveBeenCalled();
    expect(connectHomeAssistantMock).not.toHaveBeenCalled();
  });

  it('rejects the reserved base topic "homeassistant" and disconnects', async () => {
    getSettingsMock.mockReturnValue(baseSettings({ homeassistant_base_topic: 'homeassistant' }));
    await syncHomeAssistantSetting();
    expect(disconnectHomeAssistantMock).toHaveBeenCalled();
    expect(connectHomeAssistantMock).not.toHaveBeenCalled();
  });

  it('connects with the parsed config when enabled and host is set', async () => {
    getSettingsMock.mockReturnValue(baseSettings());
    getHomeAssistantClientInternalsMock.mockReturnValue(null);
    await syncHomeAssistantSetting();
    expect(connectHomeAssistantMock).toHaveBeenCalledTimes(1);
    const cfg = connectHomeAssistantMock.mock.calls[0][0] as { host: string; port: number; baseTopic: string };
    expect(cfg.host).toBe('mosquitto.local');
    expect(cfg.port).toBe(1883);
    expect(cfg.baseTopic).toBe('solarbuddy');
  });

  it('is a no-op when the signature matches the existing client', async () => {
    getSettingsMock.mockReturnValue(baseSettings());
    computeSignatureMock.mockReturnValue('stable-sig');
    getHomeAssistantClientInternalsMock.mockReturnValue({ signature: 'stable-sig' } as unknown);

    await syncHomeAssistantSetting();

    expect(connectHomeAssistantMock).not.toHaveBeenCalled();
    expect(disconnectHomeAssistantMock).not.toHaveBeenCalled();
  });

  it('reconnects when the signature differs', async () => {
    getSettingsMock.mockReturnValue(baseSettings({ homeassistant_host: 'new-host.local' }));
    computeSignatureMock.mockReturnValue('new-sig');
    getHomeAssistantClientInternalsMock.mockReturnValue({ signature: 'old-sig' } as unknown);

    await syncHomeAssistantSetting();

    expect(connectHomeAssistantMock).toHaveBeenCalled();
  });
});

describe('getHomeAssistantStatus', () => {
  it('reports disabled + not connected when the setting is off', () => {
    getSettingsMock.mockReturnValue(baseSettings({ homeassistant_enabled: 'false' }));
    isHomeAssistantConnectedMock.mockReturnValue(false);
    getHomeAssistantClientInternalsMock.mockReturnValue(null);

    const status = getHomeAssistantStatus();
    expect(status.enabled).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.publishedEntities).toBe(0);
  });

  it('reflects an active client handle when connected', () => {
    getSettingsMock.mockReturnValue(baseSettings());
    isHomeAssistantConnectedMock.mockReturnValue(true);
    getHomeAssistantClientInternalsMock.mockReturnValue({
      host: 'mosquitto.local',
      lastError: null,
      publishedEntityCount: 19,
    } as unknown);

    const status = getHomeAssistantStatus();
    expect(status.enabled).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.host).toBe('mosquitto.local');
    expect(status.publishedEntities).toBe(19);
  });
});
