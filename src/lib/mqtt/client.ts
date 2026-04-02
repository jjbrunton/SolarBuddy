import mqtt, { MqttClient } from 'mqtt';
import { getSettings } from '../config';
import { updateState } from '../state';
import { appendEvent } from '../events';
import { appendMqttLog } from './logs';
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
    appendEvent({
      level: 'warning',
      category: 'mqtt',
      message: 'Connection skipped because no MQTT host is configured.',
    });
    appendMqttLog({
      level: 'warning',
      direction: 'system',
      topic: null,
      payload: 'Connection skipped because no MQTT host is configured',
    });
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
  appendMqttLog({
    level: 'info',
    direction: 'system',
    topic: null,
    payload: `Connecting to ${url}`,
  });
  const client = mqtt.connect(url, options);
  g.__solarbuddy_mqtt = client;

  client.on('connect', () => {
    console.log('[MQTT] Connected');
    appendEvent({
      level: 'success',
      category: 'mqtt',
      message: `Connected to ${url}.`,
    });
    appendMqttLog({
      level: 'success',
      direction: 'system',
      topic: null,
      payload: `Connected to ${url}`,
    });
    updateState({ mqtt_connected: true });
    client.subscribe(SUBSCRIBE_TOPICS as unknown as string[], (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error:', err.message);
        appendEvent({
          level: 'error',
          category: 'mqtt',
          message: `Subscribe error: ${err.message}`,
        });
        appendMqttLog({
          level: 'error',
          direction: 'system',
          topic: null,
          payload: `Subscribe error: ${err.message}`,
        });
      } else {
        console.log('[MQTT] Subscribed to', SUBSCRIBE_TOPICS.length, 'topics');
        appendMqttLog({
          level: 'success',
          direction: 'system',
          topic: null,
          payload: `Subscribed to ${SUBSCRIBE_TOPICS.length} topics`,
        });
      }
    });
  });

  client.on('message', (topic: string, payload: Buffer) => {
    const value = payload.toString();
    appendMqttLog({
      level: 'info',
      direction: 'inbound',
      topic,
      payload: value,
    });
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
    appendEvent({
      level: 'error',
      category: 'mqtt',
      message: `MQTT error: ${err.message}`,
    });
    appendMqttLog({
      level: 'error',
      direction: 'system',
      topic: null,
      payload: `MQTT error: ${err.message}`,
    });
  });

  client.on('close', () => {
    console.log('[MQTT] Connection closed');
    appendEvent({
      level: 'warning',
      category: 'mqtt',
      message: 'Connection closed.',
    });
    appendMqttLog({
      level: 'warning',
      direction: 'system',
      topic: null,
      payload: 'Connection closed',
    });
    updateState({ mqtt_connected: false });
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Reconnecting...');
    appendEvent({
      level: 'info',
      category: 'mqtt',
      message: 'Reconnecting to broker.',
    });
    appendMqttLog({
      level: 'info',
      direction: 'system',
      topic: null,
      payload: 'Reconnecting to broker',
    });
  });
}

export function disconnectMqtt() {
  if (g.__solarbuddy_mqtt) {
    g.__solarbuddy_mqtt.end(true);
    g.__solarbuddy_mqtt = null;
    appendEvent({
      level: 'info',
      category: 'mqtt',
      message: 'Disconnected by application.',
    });
    appendMqttLog({
      level: 'info',
      direction: 'system',
      topic: null,
      payload: 'Disconnected by application',
    });
    updateState({ mqtt_connected: false });
  }
}
