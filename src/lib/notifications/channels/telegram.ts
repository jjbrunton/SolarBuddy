import type { NotificationChannel, NotificationMessage } from '../types';

export const telegram: NotificationChannel = {
  name: 'telegram',

  isEnabled(settings) {
    return (
      settings.notifications_telegram_enabled === 'true' &&
      !!settings.notifications_telegram_bot_token &&
      !!settings.notifications_telegram_chat_id
    );
  },

  async send(message: NotificationMessage, settings: Record<string, string>) {
    const token = settings.notifications_telegram_bot_token;
    const chatId = settings.notifications_telegram_chat_id;
    if (!token || !chatId) return;

    const text = `<b>${escapeHtml(message.title)}</b>\n${escapeHtml(message.body)}`;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram API returned ${res.status}: ${body}`);
    }
  },
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
