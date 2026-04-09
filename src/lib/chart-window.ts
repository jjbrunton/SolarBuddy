export function findCurrentOrNextTimeWindowIndex<T>(
  entries: T[],
  getStart: (entry: T) => string | Date,
  getEnd: (entry: T) => string | Date,
  now: Date = new Date(),
): number {
  return entries.findIndex((entry) => {
    const start = getStart(entry);
    const end = getEnd(entry);
    const startDate = start instanceof Date ? start : new Date(start);
    const endDate = end instanceof Date ? end : new Date(end);

    return now >= startDate ? now < endDate : true;
  });
}

export function sliceTimeWindowsFromCurrentPeriod<T>(
  entries: T[],
  getStart: (entry: T) => string | Date,
  getEnd: (entry: T) => string | Date,
  now: Date = new Date(),
): T[] {
  const startIndex = findCurrentOrNextTimeWindowIndex(entries, getStart, getEnd, now);
  return startIndex >= 0 ? entries.slice(startIndex) : entries;
}
