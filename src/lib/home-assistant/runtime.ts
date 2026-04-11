/**
 * Public API for the Home Assistant integration.
 *
 * Called from:
 *   - src/instrumentation.ts (once at boot)
 *   - src/app/api/settings/route.ts (when any homeassistant_* setting changes)
 *   - src/app/api/home-assistant/test/route.ts (test connection endpoint)
 *   - src/app/api/home-assistant/status/route.ts (status endpoint for UI)
 */

import mqtt from 'mqtt';
import { getSettings } from '../config';
import {
  computeSignature,
  connectHomeAssistant,
  disconnectHomeAssistant,
  getHomeAssistantClientInternals,
  isHomeAssistantConnected,
  type HomeAssistantConnectConfig,
} from './client';
import { createTopicComposer, sanitizeBaseTopic, sanitizeDiscoveryPrefix } from './topics';
import { buildDeviceBlock } from './discovery';
import pkg from '../../../package.json';

const SOFTWARE_VERSION = (pkg as { version: string }).version;

function parsePort(raw: string): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 1883;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return null;
  return n;
}

export interface HomeAssistantValidationError {
  field: 'host' | 'port' | 'base_topic' | 'discovery_prefix';
  message: string;
}

function buildConfigFromSettings(): HomeAssistantConnectConfig | HomeAssistantValidationError {
  const settings = getSettings();
  const host = settings.homeassistant_host?.trim() ?? '';
  if (!host) return { field: 'host', message: 'Host is required' };

  const port = parsePort(settings.homeassistant_port);
  if (port === null) return { field: 'port', message: 'Port must be an integer between 1 and 65535' };

  const baseTopic = sanitizeBaseTopic(settings.homeassistant_base_topic);
  if (!baseTopic) {
    return { field: 'base_topic', message: 'Base topic cannot be empty, contain spaces or wildcards, or equal "homeassistant"' };
  }

  const discoveryPrefix = sanitizeDiscoveryPrefix(settings.homeassistant_discovery_prefix);
  if (!discoveryPrefix) {
    return { field: 'discovery_prefix', message: 'Discovery prefix cannot be empty or contain spaces/wildcards' };
  }

  return {
    host,
    port,
    username: settings.homeassistant_username || undefined,
    password: settings.homeassistant_password || undefined,
    baseTopic,
    discoveryPrefix,
    softwareVersion: SOFTWARE_VERSION,
  };
}

/**
 * Idempotent sync entry point. Called on startup and whenever the operator
 * saves HA-related settings.
 *
 * - If enabled=false or host empty: disconnects any existing client.
 * - If enabled=true and settings unchanged from the currently-connected
 *   client: no-op (critical for Next.js dev-mode HMR).
 * - Otherwise: disconnects and reconnects with the new config.
 */
export async function syncHomeAssistantSetting(): Promise<void> {
  const settings = getSettings();
  if (settings.homeassistant_enabled !== 'true') {
    disconnectHomeAssistant();
    return;
  }

  const cfgOrError = buildConfigFromSettings();
  if ('field' in cfgOrError) {
    console.warn(`[HA] Invalid config: ${cfgOrError.field} — ${cfgOrError.message}`);
    disconnectHomeAssistant();
    return;
  }

  const existing = getHomeAssistantClientInternals();
  const signature = computeSignature(cfgOrError);
  if (existing && existing.signature === signature) {
    return;
  }

  connectHomeAssistant(cfgOrError);
}

export interface HomeAssistantStatus {
  enabled: boolean;
  connected: boolean;
  host: string | null;
  lastError: string | null;
  publishedEntities: number;
  connectAttemptedAt: string | null;
  connectedAt: string | null;
  /** True when settings say enabled but no connect has been attempted yet. */
  awaitingConnect: boolean;
}

export function getHomeAssistantStatus(): HomeAssistantStatus {
  const settings = getSettings();
  const enabled = settings.homeassistant_enabled === 'true';
  const handle = getHomeAssistantClientInternals();
  const connected = isHomeAssistantConnected();
  return {
    enabled,
    connected,
    host: handle?.host ?? (settings.homeassistant_host || null),
    lastError: handle?.lastError ?? null,
    publishedEntities: handle?.publishedEntityCount ?? 0,
    connectAttemptedAt: handle?.connectAttemptedAt ?? null,
    connectedAt: handle?.connectedAt ?? null,
    awaitingConnect: enabled && !!handle && !connected && handle.lastError === null,
  };
}

/**
 * Open a throwaway MQTT connection using the current settings, publish a
 * single test discovery config + retract it, and return success/error.
 *
 * Does NOT touch the live publisher singleton. Used by
 * POST /api/home-assistant/test.
 */
export async function testHomeAssistantConnection(): Promise<{ ok: boolean; error?: string }> {
  const cfgOrError = buildConfigFromSettings();
  if ('field' in cfgOrError) {
    return { ok: false, error: `${cfgOrError.field}: ${cfgOrError.message}` };
  }

  const url = `mqtt://${cfgOrError.host}:${cfgOrError.port}`;
  const topics = createTopicComposer(cfgOrError.baseTopic, cfgOrError.discoveryPrefix);
  const testTopic = topics.discoveryConfigTopic('sensor', 'connection_test');

  return new Promise((resolve) => {
    let settled = false;
    const client = mqtt.connect(url, {
      clientId: `solarbuddy_test_${Math.random().toString(16).slice(2, 10)}`,
      username: cfgOrError.username || undefined,
      password: cfgOrError.password || undefined,
      reconnectPeriod: 0,
      connectTimeout: 5000,
    });

    const finish = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      try {
        client.end(true);
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timeout = setTimeout(() => finish({ ok: false, error: 'Connection timed out after 5s' }), 5000);

    client.on('connect', () => {
      const device = buildDeviceBlock(SOFTWARE_VERSION);
      const payload = {
        name: 'SolarBuddy Connection Test',
        unique_id: 'solarbuddy_connection_test',
        state_topic: `${cfgOrError.baseTopic}/sensor/connection_test/state`,
        device,
      };
      client.publish(testTopic, JSON.stringify(payload), { retain: true, qos: 1 }, (publishErr) => {
        if (publishErr) {
          clearTimeout(timeout);
          finish({ ok: false, error: `Publish failed: ${publishErr.message}` });
          return;
        }
        // Retract the test entry immediately
        client.publish(testTopic, '', { retain: true, qos: 1 }, (retractErr) => {
          clearTimeout(timeout);
          if (retractErr) {
            finish({ ok: false, error: `Retract failed: ${retractErr.message}` });
            return;
          }
          finish({ ok: true });
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      finish({ ok: false, error: err.message });
    });
  });
}
