import { appendEvent } from '../events';
import { appendMqttLog } from './logs';
import type { MqttLogLevel } from './logs';
import type { EventLevel } from '../events';

/**
 * Log an MQTT lifecycle event to both the event log and the MQTT log in one call.
 * Eliminates the duplicated appendEvent + appendMqttLog pattern throughout client.ts.
 */
export function logMqttEvent(level: MqttLogLevel & EventLevel, message: string) {
  appendEvent({
    level,
    category: 'mqtt',
    message,
  });
  appendMqttLog({
    level,
    direction: 'system',
    topic: null,
    payload: message,
  });
}

/**
 * Log to the MQTT log only (no event log entry).
 * Use for operational messages that don't warrant an event log entry (e.g. subscribe success).
 */
export function logMqttSystem(level: MqttLogLevel, message: string) {
  appendMqttLog({
    level,
    direction: 'system',
    topic: null,
    payload: message,
  });
}
