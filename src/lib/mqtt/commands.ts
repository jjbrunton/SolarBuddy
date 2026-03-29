import { getMqttClient } from './client';
import { COMMAND_TOPICS } from './topics';

function publish(topic: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = getMqttClient();
    if (!client || !client.connected) {
      reject(new Error('MQTT not connected'));
      return;
    }
    client.publish(topic, value, { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function setWorkMode(mode: 'Grid first' | 'Battery first' | 'Load first') {
  console.log(`[CMD] Setting work mode to: ${mode}`);
  await publish(COMMAND_TOPICS.workMode, mode);
}

export async function setBatterySlot1(enabled: boolean) {
  console.log(`[CMD] Battery slot 1: ${enabled ? 'enabled' : 'disabled'}`);
  await publish(COMMAND_TOPICS.batterySlot1Enabled, enabled ? '1' : '0');
}

export async function setGridChargeRate(rate: number) {
  console.log(`[CMD] Grid charge rate: ${rate}%`);
  await publish(COMMAND_TOPICS.gridChargeRate, String(rate));
}

export async function startGridCharging(chargeRate: number) {
  await setWorkMode('Grid first');
  await setBatterySlot1(true);
  await setGridChargeRate(chargeRate);
}

export async function stopGridCharging(defaultMode: 'Battery first' | 'Load first' = 'Battery first') {
  await setBatterySlot1(false);
  await setWorkMode(defaultMode);
}
