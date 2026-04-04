import { getMqttClient } from './client';
import { appendMqttLog } from './logs';
import { COMMAND_TOPICS } from './topics';

function publish(topic: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = getMqttClient();
    if (!client || !client.connected) {
      appendMqttLog({
        level: 'error',
        direction: 'outbound',
        topic,
        payload: value,
      });
      reject(new Error('MQTT not connected'));
      return;
    }
    client.publish(topic, value, { qos: 1 }, (err) => {
      if (err) {
        appendMqttLog({
          level: 'error',
          direction: 'outbound',
          topic,
          payload: value,
        });
        reject(err);
      } else {
        appendMqttLog({
          level: 'success',
          direction: 'outbound',
          topic,
          payload: value,
        });
        resolve();
      }
    });
  });
}

export async function setWorkMode(mode: 'Grid first' | 'Battery first' | 'Load first') {
  console.log(`[CMD] Setting work mode to: ${mode}`);
  await publish(COMMAND_TOPICS.workMode, mode);
}

export async function setBatteryChargeRate(rate: number) {
  console.log(`[CMD] Battery charge rate: ${rate}%`);
  await publish(COMMAND_TOPICS.batteryChargeRate, String(rate));
}

const COMMAND_GAP_MS = 1_500;

export async function startGridCharging(chargeRate: number) {
  await setBatteryChargeRate(chargeRate);
  await setWorkMode('Battery first');
}

export async function stopGridCharging(defaultMode: 'Battery first' | 'Load first' = 'Load first') {
  await setWorkMode(defaultMode);
}

export async function startGridDischarge(defaultMode: 'Battery first' | 'Load first' = 'Load first') {
  console.log('[CMD] Starting discharge');
  await setWorkMode('Load first');
}

export async function stopGridDischarge(defaultMode: 'Battery first' | 'Load first' = 'Load first') {
  console.log('[CMD] Stopping discharge');
  await setWorkMode(defaultMode);
}

export async function startBatteryHold(currentSoc: number) {
  console.log(`[CMD] Holding battery at ${currentSoc}%`);
  await setWorkMode('Load first');
  await setLoadFirstStopDischarge(currentSoc);
}

export async function setLoadFirstStopDischarge(soc: number) {
  console.log(`[CMD] Load first stop discharge: ${soc}%`);
  await publish(COMMAND_TOPICS.loadFirstStopDischarge, String(soc));
}

export async function setOutputSourcePriority(priority: string) {
  console.log(`[CMD] Output source priority: ${priority}`);
  await publish(COMMAND_TOPICS.outputSourcePriority, priority);
}

export async function setChargerSourcePriority(priority: string) {
  console.log(`[CMD] Charger source priority: ${priority}`);
  await publish(COMMAND_TOPICS.chargerSourcePriority, priority);
}

export async function setMaxGridChargeCurrent(amps: number) {
  console.log(`[CMD] Max grid charge current: ${amps}A`);
  await publish(COMMAND_TOPICS.maxGridChargeCurrent, String(amps));
}

export async function setShutdownBatteryVoltage(voltage: number) {
  console.log(`[CMD] Shutdown battery voltage: ${voltage}V`);
  await publish(COMMAND_TOPICS.shutdownBatteryVoltage, String(voltage));
}

export async function syncDateTime(formatted: string) {
  console.log(`[CMD] Syncing inverter date/time: ${formatted}`);
  await publish(COMMAND_TOPICS.dateTime, formatted);
}
