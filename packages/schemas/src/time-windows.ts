/**
 * Returns a [from, to) half-open window covering the UTC day that contains `at`.
 * `from` is UTC midnight of `at`; `to` is the next day's UTC midnight.
 */
export function dayWindow(at: Date): { from: Date; to: Date } {
  const from = new Date(at);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

/** Returns the UTC day-window for the day before `at`. */
export function previousDayWindow(at: Date): { from: Date; to: Date } {
  const today = dayWindow(at);
  const from = new Date(today.from);
  from.setUTCDate(from.getUTCDate() - 1);
  return { from, to: today.from };
}
