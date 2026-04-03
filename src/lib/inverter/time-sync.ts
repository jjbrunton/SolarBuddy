import { syncDateTime } from '../mqtt/commands';
import { appendEvent } from '../events';

/**
 * Sync the inverter clock to the current system time via MQTT.
 * Solar Assistant accepts the format YYYY-MM-DD HH:MM:SS.
 */
export async function syncInverterTime(): Promise<{ synced: boolean; message: string }> {
  try {
    const now = new Date();
    const formatted = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-') + ' ' + [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join(':');

    await syncDateTime(formatted);

    const message = `Inverter clock synced to ${formatted}`;
    appendEvent({ level: 'info', category: 'time-sync', message });
    console.log(`[TimeSync] ${message}`);
    return { synced: true, message };
  } catch (err) {
    const message = `Time sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
    appendEvent({ level: 'error', category: 'time-sync', message });
    return { synced: false, message };
  }
}
