import { getDb } from '../db';

export type MqttLogLevel = 'info' | 'success' | 'warning' | 'error';
export type MqttLogDirection = 'inbound' | 'outbound' | 'system';

export interface MqttLogEntry {
  id: number;
  timestamp: string;
  level: MqttLogLevel;
  direction: MqttLogDirection;
  topic: string | null;
  payload: string;
}

const MAX_MQTT_LOG_ENTRIES = 500;
const DEFAULT_RECENT_ENTRY_LIMIT = 200;

function clampPayload(payload: string) {
  if (payload.length <= 240) return payload;
  return `${payload.slice(0, 237)}...`;
}

export function appendMqttLog(entry: Omit<MqttLogEntry, 'id' | 'timestamp'>) {
  const db = getDb();
  const timestamp = new Date().toISOString();
  const payload = clampPayload(entry.payload);

  const result = db
    .prepare(
      `INSERT INTO mqtt_logs (timestamp, level, direction, topic, payload)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(timestamp, entry.level, entry.direction, entry.topic, payload);

  db.prepare(
    `DELETE FROM mqtt_logs
     WHERE id NOT IN (
       SELECT id FROM mqtt_logs ORDER BY id DESC LIMIT ?
     )`
  ).run(MAX_MQTT_LOG_ENTRIES);

  const next: MqttLogEntry = {
    id: Number(result.lastInsertRowid),
    timestamp,
    ...entry,
    payload,
  };

  return next;
}

export function getRecentMqttLogs(limit = DEFAULT_RECENT_ENTRY_LIMIT) {
  const db = getDb();

  return db
    .prepare(
      `SELECT id, timestamp, level, direction, topic, payload
       FROM (
         SELECT id, timestamp, level, direction, topic, payload
         FROM mqtt_logs
         ORDER BY id DESC
         LIMIT ?
       )
       ORDER BY id ASC`
    )
    .all(limit) as MqttLogEntry[];
}

export function getMqttLogsAfter(id: number, limit = DEFAULT_RECENT_ENTRY_LIMIT) {
  const db = getDb();

  return db
    .prepare(
      `SELECT id, timestamp, level, direction, topic, payload
       FROM mqtt_logs
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .all(id, limit) as MqttLogEntry[];
}

export function resetMqttLogsForTests() {
  const db = getDb();
  db.prepare('DELETE FROM mqtt_logs').run();
}
