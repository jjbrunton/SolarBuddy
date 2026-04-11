/**
 * Home Assistant MQTT Discovery payload builders.
 *
 * Each entity's config is composed from:
 * - the entity definition in `entities.ts`
 * - a topic composer (to build state/command topic strings)
 * - a shared "device" block that ties every entity to one "SolarBuddy" device
 *
 * Every discovery payload carries:
 *  - a stable `unique_id` of `solarbuddy_<entity_key>` (never include volatile
 *    values — changing this strands the old HA entity forever)
 *  - `availability` pointing at `<base_topic>/status`
 *  - the shared device block
 *
 * Discovery configs are published retained (see client.ts) so HA caches them
 * across broker restarts.
 */

import {
  READ_ONLY_ENTITIES,
  WRITABLE_ENTITIES,
  type EntityDefinition,
} from './entities';
import type { TopicComposer } from './topics';

interface DeviceBlock {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
  sw_version: string;
}

export function buildDeviceBlock(swVersion: string): DeviceBlock {
  return {
    identifiers: ['solarbuddy'],
    name: 'SolarBuddy',
    manufacturer: 'SolarBuddy',
    model: 'Battery scheduler',
    sw_version: swVersion,
  };
}

export interface DiscoveryConfig {
  topic: string;
  payload: Record<string, unknown>;
}

interface BuildOptions {
  topics: TopicComposer;
  device: DeviceBlock;
}

/**
 * Build the discovery payload for a single entity. Exported so tests and the
 * test endpoint can validate/preview payloads independently of the client.
 */
export function buildEntityDiscoveryPayload(
  entity: EntityDefinition,
  { topics, device }: BuildOptions,
): Record<string, unknown> {
  const uniqueId = `solarbuddy_${entity.key}`;
  const base: Record<string, unknown> = {
    unique_id: uniqueId,
    object_id: uniqueId,
    name: entity.name,
    device,
    availability: [
      {
        topic: topics.statusTopic,
        payload_available: 'online',
        payload_not_available: 'offline',
      },
    ],
    availability_mode: 'latest',
  };

  if (entity.icon) base.icon = entity.icon;
  if (entity.deviceClass) base.device_class = entity.deviceClass;
  if (entity.stateClass) base.state_class = entity.stateClass;
  if (entity.unit) base.unit_of_measurement = entity.unit;
  if (entity.enumOptions) {
    base.device_class = 'enum';
    base.options = entity.enumOptions;
  }

  switch (entity.component) {
    case 'sensor':
    case 'binary_sensor': {
      base.state_topic = topics.stateTopic(entity.component, entity.key);
      if (entity.component === 'binary_sensor') {
        base.payload_on = 'ON';
        base.payload_off = 'OFF';
      }
      break;
    }
    case 'switch': {
      base.state_topic = topics.stateTopic(entity.component, entity.key);
      base.command_topic = topics.commandTopic(entity.component, entity.key);
      base.payload_on = 'ON';
      base.payload_off = 'OFF';
      base.optimistic = false;
      break;
    }
    case 'select': {
      base.state_topic = topics.stateTopic(entity.component, entity.key);
      base.command_topic = topics.commandTopic(entity.component, entity.key);
      base.options = entity.options ?? [];
      base.optimistic = false;
      break;
    }
    case 'button': {
      base.command_topic = topics.commandTopic(entity.component, entity.key);
      base.payload_press = 'PRESS';
      break;
    }
  }

  return base;
}

/** Build discovery configs for every entity in the catalog. */
export function buildAllDiscoveryConfigs(opts: BuildOptions): DiscoveryConfig[] {
  const configs: DiscoveryConfig[] = [];
  for (const entity of [...READ_ONLY_ENTITIES, ...WRITABLE_ENTITIES]) {
    configs.push({
      topic: opts.topics.discoveryConfigTopic(entity.component, entity.key),
      payload: buildEntityDiscoveryPayload(entity, opts),
    });
  }
  return configs;
}
