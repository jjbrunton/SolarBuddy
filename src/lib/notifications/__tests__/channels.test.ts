import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discord } from '../channels/discord';
import { telegram } from '../channels/telegram';
import type { NotificationMessage } from '../types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

const message: NotificationMessage = {
  event: 'battery_charged',
  title: 'Battery full',
  body: 'SOC reached 100%',
  timestamp: '2026-04-16T10:00:00.000Z',
};

describe('discord channel', () => {
  it('is enabled only when flag is true and URL is set', () => {
    expect(discord.isEnabled({ notifications_discord_enabled: 'true', notifications_discord_webhook_url: 'x' })).toBe(true);
    expect(discord.isEnabled({ notifications_discord_enabled: 'false', notifications_discord_webhook_url: 'x' })).toBe(false);
    expect(discord.isEnabled({ notifications_discord_enabled: 'true' })).toBe(false);
  });

  it('posts an embed with the event colour', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });

    await discord.send(message, { notifications_discord_webhook_url: 'https://hook' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hook',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].title).toBe('Battery full');
    expect(body.embeds[0].description).toBe('SOC reached 100%');
    expect(body.embeds[0].color).toBe(0x2ecc71); // battery_charged = green
    expect(body.embeds[0].footer.text).toBe('SolarBuddy');
  });

  it('falls back to neutral colour for unknown events', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });
    await discord.send(
      { ...message, event: 'unknown' as NotificationMessage['event'] },
      { notifications_discord_webhook_url: 'https://hook' },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].color).toBe(0x95a5a6);
  });

  it('throws when the webhook returns non-ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    await expect(discord.send(message, { notifications_discord_webhook_url: 'https://hook' })).rejects.toThrow(
      /Discord webhook returned 429/,
    );
  });

  it('is a no-op when no URL configured', async () => {
    await discord.send(message, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('telegram channel', () => {
  it('requires both token and chat id', () => {
    expect(
      telegram.isEnabled({
        notifications_telegram_enabled: 'true',
        notifications_telegram_bot_token: 't',
        notifications_telegram_chat_id: 'c',
      }),
    ).toBe(true);
    expect(
      telegram.isEnabled({
        notifications_telegram_enabled: 'true',
        notifications_telegram_bot_token: 't',
      }),
    ).toBe(false);
    expect(
      telegram.isEnabled({
        notifications_telegram_enabled: 'false',
        notifications_telegram_bot_token: 't',
        notifications_telegram_chat_id: 'c',
      }),
    ).toBe(false);
  });

  it('escapes HTML in title and body', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });

    await telegram.send(
      { ...message, title: '<b>Danger & co</b>', body: 'x > y < z & done' },
      { notifications_telegram_bot_token: 'T', notifications_telegram_chat_id: '42' },
    );

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/botT/sendMessage');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_id).toBe('42');
    expect(body.parse_mode).toBe('HTML');
    expect(body.text).toBe(
      '<b>&lt;b&gt;Danger &amp; co&lt;/b&gt;</b>\nx &gt; y &lt; z &amp; done',
    );
  });

  it('throws when the API returns non-ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    await expect(
      telegram.send(message, {
        notifications_telegram_bot_token: 'T',
        notifications_telegram_chat_id: '42',
      }),
    ).rejects.toThrow(/Telegram API returned 401/);
  });

  it('is a no-op when credentials missing', async () => {
    await telegram.send(message, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
