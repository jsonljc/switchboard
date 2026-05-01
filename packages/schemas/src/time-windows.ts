/**
 * Returns a [from, to) half-open window covering the day that contains `at`.
 * `from` is the local-midnight of `at`; `to` is the next day's local-midnight.
 * UTC timezone is assumed for C1; pass an explicit timezone in a future iteration.
 */
export function dayWindow(at: Date): { from: Date; to: Date } {
  const from = new Date(at);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

/** Returns the day-window for the day before `at`. */
export function previousDayWindow(at: Date): { from: Date; to: Date } {
  const today = dayWindow(at);
  const from = new Date(today.from);
  from.setDate(from.getDate() - 1);
  return { from, to: today.from };
}
