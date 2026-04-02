const HALF_HOUR_MS = 30 * 60 * 1000;
const slotTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
});
const slotTooltipFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function toSlotKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace('.000Z', 'Z');
}

export function expandHalfHourSlotKeys(slotStart: string | Date, slotEnd: string | Date): string[] {
  const keys: string[] = [];
  const end = slotEnd instanceof Date ? slotEnd : new Date(slotEnd);

  for (let cursor = slotStart instanceof Date ? new Date(slotStart) : new Date(slotStart); cursor < end; cursor = new Date(cursor.getTime() + HALF_HOUR_MS)) {
    keys.push(toSlotKey(cursor));
  }

  return keys;
}

export function formatSlotTimeLabel(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return slotTimeFormatter.format(date);
}

export function formatSlotTooltipLabel(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return slotTooltipFormatter.format(date);
}
