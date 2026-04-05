import type { DayType } from './types';

/**
 * Time-bucketing helpers for the usage profile.
 *
 * All functions here operate on LOCAL time via the native Date accessors
 * (getHours / getMinutes / getDay). This is the single chokepoint for
 * local-time semantics in the usage module — do not use UTC accessors
 * elsewhere in src/lib/usage.
 *
 * DST behaviour:
 *  - Spring-forward (23h local day): slots 2..3 (01:00–01:59) simply
 *    receive no samples for that day; other days are unaffected.
 *  - Fall-back (25h local day): slot 2 receives two hours of samples
 *    from that one day. This is acceptable — both "clock hours" share
 *    the same HVAC / lighting load shape at local 01:00.
 */

/** Returns the 0..47 half-hour bucket for the given moment in local time. */
export function localHalfHourIndex(d: Date): number {
  const hours = d.getHours();
  const minutes = d.getMinutes();
  return hours * 2 + (minutes >= 30 ? 1 : 0);
}

/** Returns 'weekday' or 'weekend' based on local-time day-of-week. */
export function localDayType(d: Date): DayType {
  const dow = d.getDay(); // 0 = Sunday, 6 = Saturday
  return dow === 0 || dow === 6 ? 'weekend' : 'weekday';
}

/** Render a slot_index (0..47) as local "HH:MM". Display only. */
export function slotIndexToLocalTime(slotIndex: number): string {
  const clamped = Math.max(0, Math.min(47, Math.floor(slotIndex)));
  const hours = Math.floor(clamped / 2);
  const minutes = clamped % 2 === 0 ? '00' : '30';
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}
