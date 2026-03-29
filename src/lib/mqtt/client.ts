import mqtt, { MqttClient } from 'mqtt';
import { getSettings } from '../config';
import { updateState } from '../state';
import { SUBSCRIBE_TOPICS, parseTopicKey, STRING_KEYS } from './topics';

// Use globalThis to share MQTT client across Next.js workers
const g = globalThis as unknown as {
  __solarbuddy_mqtt?: MqttClient | null;
};

export function getMqttClient(): MqttClient | null {
  return g.__solarbuddy_mqtt ?? null;
}

export function connectMqtt() {
  const settings = getSettings();
  if (!settings.mqtt_host) {
    console.log('[MQTT] No host configured, skipping connection');
    return;
  }

  if (g.__solarbuddy_mqtt) {
    g.__solarbuddy_mqtt.end(true);
    g.__solarbuddy_mqtt = null;
  }

  const url = `mqtt://${settings.mqtt_host}:${settings.mqtt_port}`;
  const options: mqtt.IClientOptions = {
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  };

  if (settings.mqtt_username) {
    options.username = settings.mqtt_username;
    options.password = settings.mqtt_password;
  }

  console.log(`[MQTT] Connecting to ${url}...`);
  const client = mqtt.connect(url, options);
  g.__solarbuddy_mqtt = client;

  client.on('connect', () => {
    console.log('[MQTT] Connected');
    updateState({ mqtt_connected: true });
    client.subscribe(SUBSCRIBE_TOPICS as unknown as string[], (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error:', err.message);
      } else {
        console.log('[MQTT] Subscribed to', SUBSCRIBE_TOPICS.length, 'topics');
      }
    });
  });

  client.on('message', (topic: string, payload: Buffer) => {
    const value = payload.toString();
    const key = parseTopicKey(topic);
    if (!key) return;

    if (key === 'response') {
      console.log('[MQTT] Command response:', value);
    } else if (STRING_KEYS.has(key)) {
      updateState({ [key]: value });
    } else {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        updateState({ [key]: num });
      }
    }
  });

  client.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
  });

  client.on('close', () => {
    console.log('[MQTT] Connection closed');
    updateState({ mqtt_connected: false });
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Reconnecting...');
  });
}

export function disconnectMqtt() {
  if (g.__solarbuddy_mqtt) {
    g.__solarbuddy_mqtt.end(true);
    g.__solarbuddy_mqtt = null;
    updateState({ mqtt_connected: false });
  }
}
