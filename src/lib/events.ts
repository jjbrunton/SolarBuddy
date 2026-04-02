import { getDb } from './db';
import { getRecentMqttLogs } from './mqtt/logs';

export type EventLevel = 'info' | 'success' | 'warning' | 'error';

export interface EventLogEntry {
  id: number;
  timestamp: string;
  level: EventLevel;
  category: string;
  message: string;
}

interface ScheduleFallbackRow {
  id: number;
  timestamp: string;
  slot_start: string;
  slot_end: string;
  avg_price: number | null;
  status: string;
  type: string | null;
  notes: string | null;
}

const DEFAULT_EVENT_LIMIT = 100;

function formatWindow(slotStart: string, slotEnd: string) {
  const start = new Date(slotStart);
  const end = new Date(slotEnd);

  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${formatter.format(start)} to ${formatter.format(end)}`;
}

function describeSchedule(row: ScheduleFallbackRow) {
  const action = row.type === 'discharge' ? 'discharge' : 'charge';
  const windowLabel = formatWindow(row.slot_start, row.slot_end);
  const priceLabel = row.avg_price === null ? '' : ` at ${row.avg_price.toFixed(2)}p/kWh`;

  switch (row.status) {
    case 'completed':
      return row.notes
        ? `${action} window ${windowLabel} completed: ${row.notes}.`
        : `${action} window ${windowLabel} completed${priceLabel}.`;
    case 'failed':
      return row.notes
        ? `${action} window ${windowLabel} failed: ${row.notes}.`
        : `${action} window ${windowLabel} failed.`;
    case 'active':
      return `${action} window ${windowLabel} is active${priceLabel}.`;
    default:
      return `${action} window ${windowLabel} was scheduled${priceLabel}.`;
  }
}

function levelForScheduleStatus(status: string): EventLevel {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    default:
      return 'info';
  }
}

export function appendEvent(entry: Omit<EventLogEntry, 'id' | 'timestamp'> & { timestamp?: string }) {
  const db = getDb();
  const timestamp = entry.timestamp ?? new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO events (timestamp, level, category, message)
       VALUES (?, ?, ?, ?)`
    )
    .run(timestamp, entry.level, entry.category, entry.message);

  return {
    id: Number(result.lastInsertRowid),
    timestamp,
    level: entry.level,
    category: entry.category,
    message: entry.message,
  } satisfies EventLogEntry;
}

export function getRecordedEvents(limit = DEFAULT_EVENT_LIMIT): EventLogEntry[] {
  const db = getDb();

  return db
    .prepare(
      `SELECT id, timestamp, level, category, message
       FROM events
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(limit) as EventLogEntry[];
}

function getFallbackEvents(limit = DEFAULT_EVENT_LIMIT): EventLogEntry[] {
  const db = getDb();
  const scheduleRows = db
    .prepare(
      `SELECT
         id,
         COALESCE(executed_at, created_at, slot_start) as timestamp,
         slot_start,
         slot_end,
         avg_price,
         status,
         type,
         notes
       FROM schedules
       ORDER BY COALESCE(executed_at, created_at, slot_start) DESC
       LIMIT ?`
    )
    .all(limit) as ScheduleFallbackRow[];

  const scheduleEntries: EventLogEntry[] = scheduleRows.map((row) => ({
    id: -1_000_000 - row.id,
    timestamp: row.timestamp,
    level: levelForScheduleStatus(row.status),
    category: 'scheduler',
    message: describeSchedule(row),
  }));

  const mqttEntries: EventLogEntry[] = getRecentMqttLogs(limit)
    .filter((entry) => entry.direction === 'system')
    .map((entry) => ({
      id: -2_000_000 - entry.id,
      timestamp: entry.timestamp,
      level: entry.level,
      category: 'mqtt',
      message: entry.payload,
    }));

  return [...scheduleEntries, ...mqttEntries]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export function getEventsLog(limit = DEFAULT_EVENT_LIMIT): EventLogEntry[] {
  const recorded = getRecordedEvents(limit);
  if (recorded.length > 0) {
    return recorded;
  }

  return getFallbackEvents(limit);
}

export function resetEventsForTests() {
  const db = getDb();
  db.prepare('DELETE FROM events').run();
}
