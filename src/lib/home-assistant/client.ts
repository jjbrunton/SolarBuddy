/**
 * Home Assistant MQTT client.
 *
 * Second MQTT connection, fully independent from the Solar Assistant broker
 * client in src/lib/mqtt/client.ts. Uses a separate globalThis singleton key
 * so Next.js dev-mode HMR cannot conflate the two.
 *
 * Lifecycle:
 *   connectHomeAssistant(config) — opens the connection, publishes discovery
 *     configs (retained), birth, and a full initial state snapshot.
 *   disconnectHomeAssistant() — sends `offline` status before ending the client.
 *   isHomeAssistantConnected() — synchronous probe for the status endpoint.
 *   getHomeAssistantClientInternals() — escape hatch for runtime.ts.
 */

import mqtt, { MqttClient } from 'mqtt';
import { appendEvent } from '../events';
import { createTopicComposer, type TopicComposer } from './topics';
import { buildAllDiscoveryConfigs, buildDeviceBlock } from './discovery';
import { startStatePublisher, type StatePublisherControl } from './state-publisher';
import { createCommandDispatcher } from './command-handler';

export interface HomeAssistantConnectConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  baseTopic: string;
  discoveryPrefix: string;
  softwareVersion: string;
}

interface HomeAssistantClientHandle {
  client: MqttClient;
  topics: TopicComposer;
  publisher: StatePublisherControl;
  host: string;
  signature: string;
  publishedEntityCount: number;
  lastError: string | null;
  connected: boolean;
  connectAttemptedAt: string | null;
  connectedAt: string | null;
}

const g = globalThis as typeof globalThis & {
  __solarbuddy_ha_mqtt?: HomeAssistantClientHandle | null;
};

function logEvent(level: 'info' | 'success' | 'warning' | 'error', message: string): void {
  try {
    appendEvent({ level, category: 'home-assistant', message });
  } catch {
    // event log failures must never take the client down
  }
  (level === 'error' ? console.error : console.log)(`[HA] ${message}`);
}

export function getHomeAssistantClientInternals(): HomeAssistantClientHandle | null {
  return g.__solarbuddy_ha_mqtt ?? null;
}

export function isHomeAssistantConnected(): boolean {
  return !!g.__solarbuddy_ha_mqtt?.connected;
}

export function computeSignature(cfg: HomeAssistantConnectConfig): string {
  return JSON.stringify({
    host: cfg.host,
    port: cfg.port,
    username: cfg.username ?? '',
    password: cfg.password ?? '',
    baseTopic: cfg.baseTopic,
    discoveryPrefix: cfg.discoveryPrefix,
  });
}

/**
 * Publishes a birth message, all discovery configs, and a full state snapshot.
 * Extracted so both on('connect') and on HA birth reuse the same code path.
 */
function publishInitialBurst(handle: HomeAssistantClientHandle, softwareVersion: string): void {
  const { client, topics } = handle;
  const device = buildDeviceBlock(softwareVersion);
  const configs = buildAllDiscoveryConfigs({ topics, device });

  for (const cfg of configs) {
    client.publish(cfg.topic, JSON.stringify(cfg.payload), { retain: true, qos: 1 });
  }
  client.publish(topics.statusTopic, 'online', { retain: true, qos: 1 });
  handle.publisher.publishFullSnapshot();
  handle.publishedEntityCount = configs.length;
}

export function disconnectHomeAssistant(): void {
  const handle = g.__solarbuddy_ha_mqtt;
  if (!handle) return;
  try {
    handle.publisher.stop();
  } catch {
    // publisher stop never throws, but belt & braces
  }
  try {
    // Send a final offline (overrides LWT for graceful shutdown)
    handle.client.publish(handle.topics.statusTopic, 'offline', { retain: true, qos: 1 });
  } catch {
    // If publishing fails, the LWT will kick in shortly anyway
  }
  try {
    handle.client.end(true);
  } catch {
    // ignore
  }
  g.__solarbuddy_ha_mqtt = null;
  logEvent('info', 'Home Assistant publisher disconnected');
}

export function connectHomeAssistant(cfg: HomeAssistantConnectConfig): void {
  // Idempotency: if an existing client matches this config, no-op.
  const existing = g.__solarbuddy_ha_mqtt;
  const signature = computeSignature(cfg);
  if (existing && existing.signature === signature) {
    logEvent('info', `Home Assistant publisher config unchanged (${cfg.host}:${cfg.port}) — reusing existing connection`);
    return;
  }
  if (existing) disconnectHomeAssistant();

  const url = `mqtt://${cfg.host}:${cfg.port}`;
  const topics = createTopicComposer(cfg.baseTopic, cfg.discoveryPrefix);
  const clientId = `solarbuddy_${Math.random().toString(16).slice(2, 10)}`;

  logEvent('info', `Connecting Home Assistant publisher to ${url} (clientId=${clientId}, base=${cfg.baseTopic}, discovery=${cfg.discoveryPrefix})`);

  let client: MqttClient;
  try {
    client = mqtt.connect(url, {
      clientId,
      username: cfg.username || undefined,
      password: cfg.password || undefined,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
      will: {
        topic: topics.statusTopic,
        // String payload is more broadly compatible than Buffer.
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('error', `Home Assistant publisher: mqtt.connect threw synchronously — ${message}`);
    // Stash a minimal handle so the status endpoint can surface the error.
    g.__solarbuddy_ha_mqtt = {
      client: null as unknown as MqttClient,
      topics,
      publisher: {
        publishFullSnapshot: () => {},
        publishWritableEntity: () => {},
        getPublishedEntityCount: () => 0,
        stop: () => {},
      },
      host: cfg.host,
      signature,
      publishedEntityCount: 0,
      lastError: message,
      connected: false,
      connectAttemptedAt: new Date().toISOString(),
      connectedAt: null,
    };
    return;
  }

  const publisher = startStatePublisher(
    {
      publish: (topic, payload, opts) => {
        if (!client.connected) return;
        client.publish(topic, payload, { retain: opts?.retain ?? false, qos: opts?.qos ?? 0 });
      },
    },
    topics,
  );

  const handle: HomeAssistantClientHandle = {
    client,
    topics,
    publisher,
    host: cfg.host,
    signature,
    publishedEntityCount: 0,
    lastError: null,
    connected: false,
    connectAttemptedAt: new Date().toISOString(),
    connectedAt: null,
  };
  g.__solarbuddy_ha_mqtt = handle;

  const dispatch = createCommandDispatcher({
    topics,
    publisher,
    mqttPublish: (topic, payload, opts) => {
      if (!client.connected) return;
      client.publish(topic, payload, { retain: opts?.retain ?? false, qos: opts?.qos ?? 0 });
    },
  });

  client.on('connect', () => {
    handle.connected = true;
    handle.connectedAt = new Date().toISOString();
    handle.lastError = null;
    logEvent('success', `Home Assistant publisher connected to ${cfg.host}:${cfg.port}`);

    try {
      publishInitialBurst(handle, cfg.softwareVersion);
      logEvent('info', `Home Assistant publisher published ${handle.publishedEntityCount} discovery configs`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent('error', `Initial discovery burst failed: ${message}`);
      handle.lastError = message;
    }

    const subs = [...topics.commandSubscriptions, topics.homeAssistantStatusTopic];
    client.subscribe(subs, (err) => {
      if (err) {
        handle.lastError = err.message;
        logEvent('error', `Home Assistant subscribe error: ${err.message}`);
      } else {
        logEvent('info', `Subscribed to ${subs.length} Home Assistant topics`);
      }
    });
  });

  client.on('message', (topic, payload) => {
    // HA birth handling: republish discovery configs + full snapshot.
    if (topic === topics.homeAssistantStatusTopic) {
      const value = payload.toString().trim().toLowerCase();
      if (value === 'online') {
        logEvent('info', 'Home Assistant birth received — republishing discovery configs');
        try {
          publishInitialBurst(handle, cfg.softwareVersion);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logEvent('error', `HA-birth republish failed: ${message}`);
        }
      }
      return;
    }

    // Fire-and-forget: the dispatcher catches its own errors.
    void dispatch(topic, payload);
  });

  client.on('error', (err) => {
    handle.lastError = err.message;
    logEvent('error', `Home Assistant client error: ${err.message}`);
  });

  client.on('close', () => {
    if (handle.connected) {
      logEvent('warning', 'Home Assistant publisher connection closed');
    }
    handle.connected = false;
  });

  client.on('offline', () => {
    logEvent('warning', `Home Assistant publisher went offline (will retry every 5s)`);
    handle.connected = false;
  });

  client.on('reconnect', () => {
    logEvent('info', 'Reconnecting Home Assistant publisher...');
  });
}
