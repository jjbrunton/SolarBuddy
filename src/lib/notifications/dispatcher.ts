import { getSettings } from '../config';
import type { NotificationEvent, NotificationChannel, NotificationMessage } from './types';
import { EVENT_SETTING_KEYS } from './types';
import { discord } from './channels/discord';
import { telegram } from './channels/telegram';

const channels: NotificationChannel[] = [discord, telegram];

/**
 * Send a notification to all enabled channels for the given event type.
 * Fire-and-forget — never blocks the caller or throws.
 */
export function notify(event: NotificationEvent, title: string, body: string) {
  dispatch(event, title, body).catch((err) => {
    console.error('[Notifications] Unexpected dispatch error:', err);
  });
}

async function dispatch(event: NotificationEvent, title: string, body: string) {
  const settings = getSettings() as unknown as Record<string, string>;

  const eventKey = EVENT_SETTING_KEYS[event];
  if (settings[eventKey] !== 'true') return;

  const message: NotificationMessage = {
    event,
    title,
    body,
    timestamp: new Date().toISOString(),
  };

  const results = await Promise.allSettled(
    channels
      .filter((ch) => ch.isEnabled(settings))
      .map((ch) =>
        ch.send(message, settings).catch((err) => {
          console.error(`[Notifications] ${ch.name} delivery failed:`, err);
        }),
      ),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[Notifications] Channel send rejected:', result.reason);
    }
  }
}

/**
 * Send a test message to a specific channel. Returns an error string on failure.
 */
export async function sendTestNotification(channel: string): Promise<string | null> {
  const settings = getSettings() as unknown as Record<string, string>;

  const target = channels.find((ch) => ch.name === channel);
  if (!target) return `Unknown channel: ${channel}`;
  if (!target.isEnabled(settings)) return `${channel} is not enabled or missing credentials`;

  const message: NotificationMessage = {
    event: 'state_change',
    title: 'Test Notification',
    body: 'This is a test message from SolarBuddy.',
    timestamp: new Date().toISOString(),
  };

  try {
    await target.send(message, settings);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
