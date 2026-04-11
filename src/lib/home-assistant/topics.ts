/**
 * Home Assistant topic helpers.
 *
 * All topics are composed from two settings-driven strings:
 * - base_topic — owns SolarBuddy's state and command topics (default `solarbuddy`)
 * - discovery_prefix — owns HA's discovery config topics (default `homeassistant`)
 *
 * These helpers are the only place in the home-assistant module allowed to
 * build topic strings directly. Everything else receives composed topics
 * through the TopicComposer passed at runtime.
 */

export type EntityComponent = 'sensor' | 'binary_sensor' | 'switch' | 'select' | 'button';

export interface TopicComposer {
  baseTopic: string;
  discoveryPrefix: string;
  /** Availability (LWT + birth) topic. Retained. */
  statusTopic: string;
  /** HA birth topic SolarBuddy subscribes to for discovery republishing. */
  homeAssistantStatusTopic: string;
  /** Wildcards used to subscribe to all command topics. */
  commandSubscriptions: string[];
  /** Per-entity topic builders. */
  stateTopic: (component: EntityComponent, key: string) => string;
  commandTopic: (component: EntityComponent, key: string) => string;
  discoveryConfigTopic: (component: EntityComponent, key: string) => string;
  /** Parses an inbound command topic. Returns null if the topic is not a command topic. */
  parseCommandTopic: (topic: string) => ParsedCommandTopic | null;
}

export interface ParsedCommandTopic {
  component: EntityComponent;
  entityKey: string;
  verb: 'set' | 'press';
}

const VALID_COMPONENTS: ReadonlySet<EntityComponent> = new Set([
  'sensor',
  'binary_sensor',
  'switch',
  'select',
  'button',
]);

/**
 * Sanitize a base topic. Rejects the literal `homeassistant` (would collide
 * with the discovery prefix) and strips leading/trailing slashes and spaces.
 * Returns null on invalid input so callers can surface a clear error.
 */
export function sanitizeBaseTopic(raw: string): string | null {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'homeassistant') return null;
  if (/\s/.test(trimmed)) return null;
  if (trimmed.includes('+') || trimmed.includes('#')) return null;
  return trimmed;
}

export function sanitizeDiscoveryPrefix(raw: string): string | null {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  if (/\s/.test(trimmed)) return null;
  if (trimmed.includes('+') || trimmed.includes('#')) return null;
  return trimmed;
}

export function createTopicComposer(baseTopic: string, discoveryPrefix: string): TopicComposer {
  const base = baseTopic;
  const discovery = discoveryPrefix;
  const statusTopic = `${base}/status`;
  const homeAssistantStatusTopic = `${discovery}/status`;

  return {
    baseTopic: base,
    discoveryPrefix: discovery,
    statusTopic,
    homeAssistantStatusTopic,
    commandSubscriptions: [`${base}/+/+/set`, `${base}/+/+/press`],
    stateTopic: (component, key) => `${base}/${component}/${key}/state`,
    commandTopic: (component, key) => {
      const verb = component === 'button' ? 'press' : 'set';
      return `${base}/${component}/${key}/${verb}`;
    },
    discoveryConfigTopic: (component, key) => `${discovery}/${component}/solarbuddy/${key}/config`,
    parseCommandTopic: (topic: string) => {
      if (!topic.startsWith(`${base}/`)) return null;
      const segments = topic.slice(base.length + 1).split('/');
      if (segments.length !== 3) return null;
      const [component, entityKey, verb] = segments;
      if (!VALID_COMPONENTS.has(component as EntityComponent)) return null;
      if (verb !== 'set' && verb !== 'press') return null;
      return {
        component: component as EntityComponent,
        entityKey,
        verb: verb as 'set' | 'press',
      };
    },
  };
}
