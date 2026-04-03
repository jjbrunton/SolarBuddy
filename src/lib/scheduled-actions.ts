import { getDb } from './db';
import type { PlanAction } from './plan-actions';

export interface ScheduledAction {
  id: number;
  name: string;
  action: PlanAction;
  time: string;        // HH:MM
  days: string;        // 'daily' | 'weekdays' | 'weekends' | 'mon,tue,...'
  soc_condition: 'above' | 'below' | 'any';
  soc_threshold: number;
  duration_minutes: number;
  enabled: boolean;
  created_at: string;
}

interface ScheduledActionRow {
  id: number;
  name: string;
  action: string;
  time: string;
  days: string;
  soc_condition: string;
  soc_threshold: number;
  duration_minutes: number;
  enabled: number;
  created_at: string;
}

export function getScheduledActions(): ScheduledAction[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM scheduled_actions ORDER BY time ASC').all() as ScheduledActionRow[];
  return rows.map(rowToAction);
}

export function getEnabledScheduledActions(): ScheduledAction[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM scheduled_actions WHERE enabled = 1 ORDER BY time ASC').all() as ScheduledActionRow[];
  return rows.map(rowToAction);
}

export function upsertScheduledAction(action: Omit<ScheduledAction, 'id' | 'created_at'> & { id?: number }): ScheduledAction {
  const db = getDb();

  if (action.id) {
    db.prepare(`
      UPDATE scheduled_actions
      SET name = ?, action = ?, time = ?, days = ?, soc_condition = ?,
          soc_threshold = ?, duration_minutes = ?, enabled = ?
      WHERE id = ?
    `).run(
      action.name, action.action, action.time, action.days,
      action.soc_condition, action.soc_threshold, action.duration_minutes,
      action.enabled ? 1 : 0, action.id,
    );
    return { ...action, id: action.id, created_at: '' } as ScheduledAction;
  }

  const result = db.prepare(`
    INSERT INTO scheduled_actions (name, action, time, days, soc_condition, soc_threshold, duration_minutes, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    action.name, action.action, action.time, action.days,
    action.soc_condition, action.soc_threshold, action.duration_minutes,
    action.enabled ? 1 : 0,
  );

  return { ...action, id: result.lastInsertRowid as number, created_at: new Date().toISOString() } as ScheduledAction;
}

export function deleteScheduledAction(id: number) {
  const db = getDb();
  db.prepare('DELETE FROM scheduled_actions WHERE id = ?').run(id);
}

/**
 * Evaluate all enabled scheduled actions against the current time and SOC.
 * Returns the matching action with highest priority (earliest defined), or null.
 */
export function evaluateScheduledActions(
  now: Date,
  currentSoc: number | null,
): { action: PlanAction; reason: string } | null {
  const actions = getEnabledScheduledActions();
  if (actions.length === 0) return null;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDayName = dayNames[dayOfWeek];

  for (const sa of actions) {
    // Check day-of-week match
    if (!matchesDay(sa.days, currentDayName, dayOfWeek)) continue;

    // Check time window: [time, time + duration_minutes)
    const [h, m] = sa.time.split(':').map(Number);
    const startMinutes = h * 60 + m;
    const endMinutes = startMinutes + sa.duration_minutes;

    if (currentMinutes < startMinutes || currentMinutes >= endMinutes) continue;

    // Check SOC condition
    if (currentSoc !== null && sa.soc_condition !== 'any') {
      if (sa.soc_condition === 'above' && currentSoc <= sa.soc_threshold) continue;
      if (sa.soc_condition === 'below' && currentSoc >= sa.soc_threshold) continue;
    }

    return {
      action: sa.action as PlanAction,
      reason: `Scheduled action "${sa.name}": ${sa.action} (${sa.soc_condition !== 'any' ? `SOC ${sa.soc_condition} ${sa.soc_threshold}%` : 'unconditional'})`,
    };
  }

  return null;
}

function matchesDay(days: string, dayName: string, dayOfWeek: number): boolean {
  if (days === 'daily') return true;
  if (days === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
  if (days === 'weekends') return dayOfWeek === 0 || dayOfWeek === 6;
  // Comma-separated day names: 'mon,tue,fri'
  return days.split(',').map((d) => d.trim().toLowerCase()).includes(dayName);
}

function rowToAction(row: ScheduledActionRow): ScheduledAction {
  return {
    ...row,
    action: row.action as PlanAction,
    soc_condition: row.soc_condition as 'above' | 'below' | 'any',
    enabled: row.enabled === 1,
  };
}
