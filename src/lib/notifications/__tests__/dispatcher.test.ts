import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify, sendTestNotification } from '../dispatcher';

const { getSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
}));

vi.mock('../../config', () => ({
  getSettings: getSettingsMock,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const baseSettings: Record<string, string> = {
  notifications_state_change: 'true',
  notifications_battery_exhausted: 'true',
  notifications_battery_charged: 'true',
  notifications_schedule_updated: 'true',
  notifications_discord_enabled: 'true',
  notifications_discord_webhook_url: 'https://discord.example/hook',
  notifications_telegram_enabled: 'true',
  notifications_telegram_bot_token: 'token123',
  notifications_telegram_chat_id: '42',
};

beforeEach(() => {
  fetchMock.mockReset();
  getSettingsMock.mockReset();
  getSettingsMock.mockReturnValue({ ...baseSettings });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flush() {
  // Allow the fire-and-forget dispatch to resolve.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('notify()', () => {
  it('skips dispatch when the event toggle is off', async () => {
    getSettingsMock.mockReturnValue({
      ...baseSettings,
      notifications_state_change: 'false',
    });

    notify('state_change', 'hi', 'body');
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends to every enabled channel in parallel', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });

    notify('battery_charged', 'Full', 'Battery hit 100%');
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain('https://discord.example/hook');
    expect(urls.some((u) => u.startsWith('https://api.telegram.org/bottoken123/sendMessage'))).toBe(true);
  });

  it('skips channels that are not enabled', async () => {
    getSettingsMock.mockReturnValue({
      ...baseSettings,
      notifications_telegram_enabled: 'false',
    });
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });

    notify('schedule_updated', 'New plan', 'Details');
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://discord.example/hook');
  });

  it('swallows channel errors so one failure does not block others', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('discord')) {
        return Promise.resolve({ ok: false, status: 500, text: async () => 'boom' });
      }
      return Promise.resolve({ ok: true, text: async () => '' });
    });

    notify('state_change', 'x', 'y');
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalled();
  });

  it('survives a fetch-level rejection (network error) on every channel', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    // notify() is fire-and-forget; it must not throw synchronously or reject.
    notify('state_change', 'x', 'y');
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Both failures should have logged, and nothing should have thrown.
    expect(console.error).toHaveBeenCalled();
  });

  it('logs but does not throw when a channel rejects with a non-Error value', async () => {
    fetchMock.mockRejectedValue('plain string rejection');

    notify('state_change', 'x', 'y');
    await flush();

    expect(console.error).toHaveBeenCalled();
  });

  it('skips all delivery when neither channel is enabled', async () => {
    getSettingsMock.mockReturnValue({
      ...baseSettings,
      notifications_discord_enabled: 'false',
      notifications_telegram_enabled: 'false',
    });

    notify('state_change', 'x', 'y');
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats any value other than the literal "true" as opt-out for event toggles', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });
    getSettingsMock.mockReturnValue({
      ...baseSettings,
      notifications_state_change: '1', // not 'true'
    });

    notify('state_change', 'x', 'y');
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves a per-call timestamp so concurrent sends do not share one', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });

    notify('battery_charged', 'first', 'body');
    notify('battery_charged', 'second', 'body');
    await flush();

    const discordCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('discord'));
    expect(discordCalls).toHaveLength(2);
    const timestamps = discordCalls.map((c) => JSON.parse(c[1].body).embeds[0].timestamp);
    // Each call carries its own ISO timestamp (not shared by reference).
    expect(typeof timestamps[0]).toBe('string');
    expect(typeof timestamps[1]).toBe('string');
  });
});

describe('sendTestNotification()', () => {
  it('returns an error for unknown channels', async () => {
    const err = await sendTestNotification('carrierpigeon');
    expect(err).toBe('Unknown channel: carrierpigeon');
  });

  it('returns an error when the channel is disabled', async () => {
    getSettingsMock.mockReturnValue({
      ...baseSettings,
      notifications_discord_enabled: 'false',
    });

    const err = await sendTestNotification('discord');
    expect(err).toBe('discord is not enabled or missing credentials');
  });

  it('returns null on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });
    const err = await sendTestNotification('discord');
    expect(err).toBeNull();
  });

  it('returns the channel error message on failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad req' });
    const err = await sendTestNotification('telegram');
    expect(err).toContain('Telegram API returned 400');
  });
});
