import { describe, expect, it } from 'vitest';
import {
  createTopicComposer,
  sanitizeBaseTopic,
  sanitizeDiscoveryPrefix,
} from '../topics';

describe('sanitizeBaseTopic', () => {
  it('trims whitespace and slashes', () => {
    expect(sanitizeBaseTopic('  /solarbuddy/ ')).toBe('solarbuddy');
    expect(sanitizeBaseTopic('solarbuddy/')).toBe('solarbuddy');
    expect(sanitizeBaseTopic('/solarbuddy')).toBe('solarbuddy');
  });

  it('rejects the reserved word "homeassistant"', () => {
    expect(sanitizeBaseTopic('homeassistant')).toBeNull();
    expect(sanitizeBaseTopic('HomeAssistant')).toBeNull();
    expect(sanitizeBaseTopic('  HOMEASSISTANT ')).toBeNull();
  });

  it('rejects empty, whitespace, or MQTT wildcard input', () => {
    expect(sanitizeBaseTopic('')).toBeNull();
    expect(sanitizeBaseTopic('   ')).toBeNull();
    expect(sanitizeBaseTopic('my topic')).toBeNull();
    expect(sanitizeBaseTopic('my+topic')).toBeNull();
    expect(sanitizeBaseTopic('my#topic')).toBeNull();
  });

  it('keeps nested paths intact', () => {
    expect(sanitizeBaseTopic('home/solarbuddy')).toBe('home/solarbuddy');
  });
});

describe('sanitizeDiscoveryPrefix', () => {
  it('allows "homeassistant" (it is the canonical value)', () => {
    expect(sanitizeDiscoveryPrefix('homeassistant')).toBe('homeassistant');
  });

  it('applies the same trim + wildcard rules as base topic', () => {
    expect(sanitizeDiscoveryPrefix('/homeassistant/')).toBe('homeassistant');
    expect(sanitizeDiscoveryPrefix('')).toBeNull();
    expect(sanitizeDiscoveryPrefix('ha +')).toBeNull();
    expect(sanitizeDiscoveryPrefix('ha#')).toBeNull();
  });
});

describe('TopicComposer', () => {
  const topics = createTopicComposer('solarbuddy', 'homeassistant');

  it('builds state and command topics for switchable components', () => {
    expect(topics.stateTopic('switch', 'charge_enable')).toBe('solarbuddy/switch/charge_enable/state');
    expect(topics.commandTopic('switch', 'charge_enable')).toBe('solarbuddy/switch/charge_enable/set');
  });

  it('uses the "press" verb for button components', () => {
    expect(topics.commandTopic('button', 'replan_now')).toBe('solarbuddy/button/replan_now/press');
  });

  it('builds discovery config topics under the discovery prefix', () => {
    expect(topics.discoveryConfigTopic('sensor', 'battery_soc')).toBe(
      'homeassistant/sensor/solarbuddy/battery_soc/config',
    );
  });

  it('exposes subscription wildcards for both set and press verbs', () => {
    expect(topics.commandSubscriptions).toEqual(['solarbuddy/+/+/set', 'solarbuddy/+/+/press']);
  });

  it('parses a valid set command topic', () => {
    expect(topics.parseCommandTopic('solarbuddy/switch/charge_enable/set')).toEqual({
      component: 'switch',
      entityKey: 'charge_enable',
      verb: 'set',
    });
  });

  it('parses a valid press command topic', () => {
    expect(topics.parseCommandTopic('solarbuddy/button/replan/press')).toEqual({
      component: 'button',
      entityKey: 'replan',
      verb: 'press',
    });
  });

  it('returns null for topics outside the base namespace', () => {
    expect(topics.parseCommandTopic('other/switch/x/set')).toBeNull();
  });

  it('returns null for unknown components', () => {
    expect(topics.parseCommandTopic('solarbuddy/camera/x/set')).toBeNull();
  });

  it('returns null for unknown verbs', () => {
    expect(topics.parseCommandTopic('solarbuddy/switch/x/update')).toBeNull();
  });

  it('returns null when the topic has the wrong segment count', () => {
    expect(topics.parseCommandTopic('solarbuddy/switch/x/y/set')).toBeNull();
    expect(topics.parseCommandTopic('solarbuddy/switch/x')).toBeNull();
  });
});
