import { getDb } from './connection';

export interface RetentionTarget {
  table: string;
  timestampColumn: string;
  retentionDays: number;
}

// Display-only / diagnostic tables that grow unbounded. Calculations
// (accounting, forecasts, scheduler, bill estimates) read from rates,
// readings, schedules, plan_slots, usage_* — none are pruned here.
export const RETENTION_TARGETS: readonly RetentionTarget[] = [
  { table: 'events', timestampColumn: 'timestamp', retentionDays: 30 },
  { table: 'mqtt_logs', timestampColumn: 'timestamp', retentionDays: 30 },
];

export interface PruneResult {
  table: string;
  deleted: number;
}

// Table and column names come from the hardcoded RETENTION_TARGETS constant,
// not user input, so interpolating them into the SQL is safe. datetime()
// normalises both `YYYY-MM-DDTHH:MM:SS.sssZ` (Date.toISOString) and
// `YYYY-MM-DD HH:MM:SS` (SQLite default) so the comparison works regardless
// of how the row was inserted.
export function pruneTableByAge(target: RetentionTarget): PruneResult {
  const db = getDb();
  const stmt = db.prepare(
    `DELETE FROM ${target.table}
     WHERE datetime(${target.timestampColumn}) < datetime('now', ?)`
  );
  const result = stmt.run(`-${target.retentionDays} days`);
  return { table: target.table, deleted: result.changes };
}

export function runRetentionPrune(): PruneResult[] {
  return RETENTION_TARGETS.map(pruneTableByAge);
}
