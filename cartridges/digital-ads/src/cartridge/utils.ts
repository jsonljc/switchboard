// ---------------------------------------------------------------------------
// Shared utility helpers for the cartridge layer
// ---------------------------------------------------------------------------

/** Return yesterday's date */
export function getYesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

/** Return today's date as ISO string (YYYY-MM-DD) */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
