import type { NotificationChannel, NotificationMessage } from '../types';

const EVENT_COLORS: Record<string, number> = {
  state_change: 0x3498db,       // blue
  battery_exhausted: 0xe67e22,  // orange
  battery_charged: 0x2ecc71,    // green
  schedule_updated: 0x2ecc71,   // green
};

export const discord: NotificationChannel = {
  name: 'discord',

  isEnabled(settings) {
    return (
      settings.notifications_discord_enabled === 'true' &&
      !!settings.notifications_discord_webhook_url
    );
  },

  async send(message: NotificationMessage, settings: Record<string, string>) {
    const url = settings.notifications_discord_webhook_url;
    if (!url) return;

    const color = EVENT_COLORS[message.event] ?? 0x95a5a6;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: message.title,
            description: message.body,
            color,
            timestamp: message.timestamp,
            footer: { text: 'SolarBuddy' },
          },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Discord webhook returned ${res.status}: ${await res.text()}`);
    }
  },
};
