import { describe, expect, it } from 'vitest';
import { buildAllDiscoveryConfigs, buildDeviceBlock, buildEntityDiscoveryPayload } from '../discovery';
import { READ_ONLY_ENTITIES, WRITABLE_ENTITIES } from '../entities';
import { createTopicComposer } from '../topics';

const topics = createTopicComposer('solarbuddy', 'homeassistant');
const device = buildDeviceBlock('1.2.3');

describe('home-assistant discovery payloads', () => {
  it('uses stable unique_ids of the form solarbuddy_<entity_key>', () => {
    const configs = buildAllDiscoveryConfigs({ topics, device });
    for (const cfg of configs) {
      const payload = cfg.payload as { unique_id: string };
      expect(payload.unique_id).toMatch(/^solarbuddy_[a-z0-9_]+$/);
    }
  });

  it('attaches the shared device block to every discovery config', () => {
    const configs = buildAllDiscoveryConfigs({ topics, device });
    for (const cfg of configs) {
      const payload = cfg.payload as { device: typeof device };
      expect(payload.device).toEqual(device);
    }
  });

  it('routes discovery topics under <discovery_prefix>/<component>/solarbuddy/<key>/config', () => {
    const configs = buildAllDiscoveryConfigs({ topics, device });
    const expectedTopic = (component: string, key: string) =>
      `homeassistant/${component}/solarbuddy/${key}/config`;
    for (const entity of READ_ONLY_ENTITIES) {
      const match = configs.find((c) => c.topic === expectedTopic(entity.component, entity.key));
      expect(match, `discovery config for ${entity.key}`).toBeDefined();
    }
    for (const entity of WRITABLE_ENTITIES) {
      const match = configs.find((c) => c.topic === expectedTopic(entity.component, entity.key));
      expect(match, `discovery config for ${entity.key}`).toBeDefined();
    }
  });

  it('attaches availability entries pointing at the status topic', () => {
    const configs = buildAllDiscoveryConfigs({ topics, device });
    for (const cfg of configs) {
      const payload = cfg.payload as { availability: Array<{ topic: string }> };
      expect(payload.availability[0].topic).toBe('solarbuddy/status');
    }
  });

  it('omits state_topic on buttons but includes command_topic and payload_press', () => {
    const button = WRITABLE_ENTITIES.find((e) => e.key === 'replan_now')!;
    const payload = buildEntityDiscoveryPayload(button, { topics, device }) as Record<string, unknown>;
    expect(payload.state_topic).toBeUndefined();
    expect(payload.command_topic).toBe('solarbuddy/button/replan_now/press');
    expect(payload.payload_press).toBe('PRESS');
  });

  it('publishes selects with their options array', () => {
    const strategy = WRITABLE_ENTITIES.find((e) => e.key === 'charging_strategy')!;
    const payload = buildEntityDiscoveryPayload(strategy, { topics, device }) as Record<string, unknown>;
    expect(payload.command_topic).toBe('solarbuddy/select/charging_strategy/set');
    expect(payload.options).toEqual(['night_fill', 'opportunistic_topup']);
    expect(payload.optimistic).toBe(false);
  });

  it('publishes binary sensors with payload_on/payload_off', () => {
    const mqtt = READ_ONLY_ENTITIES.find((e) => e.key === 'mqtt_connected')!;
    const payload = buildEntityDiscoveryPayload(mqtt, { topics, device }) as Record<string, unknown>;
    expect(payload.state_topic).toBe('solarbuddy/binary_sensor/mqtt_connected/state');
    expect(payload.payload_on).toBe('ON');
    expect(payload.payload_off).toBe('OFF');
    expect(payload.device_class).toBe('connectivity');
  });

  it('marks enum sensors with device_class=enum and an options list', () => {
    const action = READ_ONLY_ENTITIES.find((e) => e.key === 'current_action')!;
    const payload = buildEntityDiscoveryPayload(action, { topics, device }) as Record<string, unknown>;
    expect(payload.device_class).toBe('enum');
    expect(payload.options).toEqual(['charge', 'discharge', 'hold']);
  });

  it('publishes switches with ON/OFF payloads and a command topic', () => {
    const autoSchedule = WRITABLE_ENTITIES.find((e) => e.key === 'auto_schedule')!;
    const payload = buildEntityDiscoveryPayload(autoSchedule, { topics, device }) as Record<string, unknown>;
    expect(payload.state_topic).toBe('solarbuddy/switch/auto_schedule/state');
    expect(payload.command_topic).toBe('solarbuddy/switch/auto_schedule/set');
    expect(payload.payload_on).toBe('ON');
    expect(payload.payload_off).toBe('OFF');
  });
});

describe('topic composer', () => {
  it('parses command topics back into { component, entityKey, verb }', () => {
    expect(topics.parseCommandTopic('solarbuddy/switch/auto_schedule/set')).toEqual({
      component: 'switch',
      entityKey: 'auto_schedule',
      verb: 'set',
    });
    expect(topics.parseCommandTopic('solarbuddy/button/replan_now/press')).toEqual({
      component: 'button',
      entityKey: 'replan_now',
      verb: 'press',
    });
  });

  it('rejects topics outside the base prefix or with invalid components', () => {
    expect(topics.parseCommandTopic('other/switch/foo/set')).toBeNull();
    expect(topics.parseCommandTopic('solarbuddy/bogus/foo/set')).toBeNull();
    expect(topics.parseCommandTopic('solarbuddy/switch/foo/write')).toBeNull();
    expect(topics.parseCommandTopic('solarbuddy/switch/foo')).toBeNull();
  });
});
