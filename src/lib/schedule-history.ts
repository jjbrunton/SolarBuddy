import { type PlanAction } from './plan-actions';
import { expandHalfHourSlotKeys, toSlotKey } from './slot-key';

const scheduleDayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const scheduleDayLabelFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export interface ScheduleHistoryRate {
  valid_from: string;
  valid_to: string;
  price_inc_vat: number;
}

export interface ScheduleHistoryWindow {
  slot_start: string;
  slot_end: string;
  status: string;
  type?: string | null;
}

export interface ScheduleHistoryPlannedSlot {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
  reason?: string | null;
}

export interface ScheduleHistoryOverride {
  slot_start: string;
  slot_end: string;
  action: PlanAction;
}

export interface ScheduleHistorySlot {
  dayKey: string;
  time: string;
  price: number;
  validFrom: string;
  validTo: string;
  isCurrent: boolean;
  isPast: boolean;
  plannedAction: PlanAction;
  overrideAction: PlanAction | null;
  effectiveAction: PlanAction;
  reason: string;
}

export function toScheduleDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return scheduleDayKeyFormatter.format(date);
}

export function getTodayScheduleDayKey(now: Date = new Date()): string {
  return toScheduleDayKey(now);
}

export function formatScheduleDayLabel(dayKey: string): string {
  return scheduleDayLabelFormatter.format(new Date(`${dayKey}T12:00:00Z`));
}

export function selectScheduleDay(
  availableDays: string[],
  preferredDay: string | null,
  todayDay: string = getTodayScheduleDayKey(),
): string | null {
  if (availableDays.length === 0) {
    return null;
  }

  if (preferredDay && availableDays.includes(preferredDay)) {
    return preferredDay;
  }

  if (availableDays.includes(todayDay)) {
    return todayDay;
  }

  return availableDays[availableDays.length - 1] ?? null;
}

export function collectScheduleDays(
  rates: ScheduleHistoryRate[],
  schedules: ScheduleHistoryWindow[] = [],
): string[] {
  return [...new Set([
    ...rates.map((rate) => toScheduleDayKey(rate.valid_from)),
    ...schedules.map((schedule) => toScheduleDayKey(schedule.slot_start)),
  ])].sort((a, b) => a.localeCompare(b));
}

export function buildSchedulePlanSlots(
  rates: ScheduleHistoryRate[],
  schedules: ScheduleHistoryWindow[],
  plannedSlots: ScheduleHistoryPlannedSlot[],
  overrides: ScheduleHistoryOverride[],
  now: Date = new Date(),
): ScheduleHistorySlot[] {
  const plannedSlotMap = new Map<string, ScheduleHistoryPlannedSlot>();
  for (const plannedSlot of plannedSlots) {
    plannedSlotMap.set(toSlotKey(plannedSlot.slot_start), plannedSlot);
  }

  const scheduledActions = new Map<string, PlanAction>();

  for (const schedule of schedules) {
    const action: PlanAction = schedule.type === 'discharge' ? 'discharge' : 'charge';
    for (const slotKey of expandHalfHourSlotKeys(schedule.slot_start, schedule.slot_end)) {
      scheduledActions.set(slotKey, action);
    }
  }

  const overrideMap = new Map<string, PlanAction>();
  for (const override of overrides) {
    overrideMap.set(toSlotKey(override.slot_start), override.action || 'charge');
  }

  return rates.map((rate) => {
    const validFrom = new Date(rate.valid_from);
    const validTo = new Date(rate.valid_to);
    const slotKey = toSlotKey(rate.valid_from);
    const plannedSlot = plannedSlotMap.get(slotKey);
    const plannedAction = plannedSlot?.action ?? scheduledActions.get(slotKey) ?? 'do_nothing';
    const overrideAction = overrideMap.get(slotKey) ?? null;

    return {
      dayKey: toScheduleDayKey(rate.valid_from),
      time: formatSlotTime(rate.valid_from),
      price: Math.round(rate.price_inc_vat * 100) / 100,
      validFrom: rate.valid_from,
      validTo: rate.valid_to,
      isCurrent: now >= validFrom && now < validTo,
      isPast: now >= validTo,
      plannedAction,
      overrideAction,
      effectiveAction: overrideAction ?? plannedAction,
      reason: plannedSlot?.reason ?? getDefaultReason(plannedAction),
    };
  });
}

function getDefaultReason(action: PlanAction): string {
  switch (action) {
    case 'charge':
      return 'This slot is part of a planned battery charge window.';
    case 'discharge':
      return 'This slot is part of a planned battery discharge window.';
    case 'hold':
      return 'SolarBuddy is actively holding the battery to prevent discharge in this slot.';
    default:
      return 'No forced battery action planned for this slot.';
  }
}

function formatSlotTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}
