export function formatRemaining(ms: number): string {
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m`;
  if (m >= 1) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export type TimerLevel = "expired" | "critical" | "warn" | "normal";

export function timerLevel(ms: number): TimerLevel {
  // Boundaries: (-inf, 0] = expired, (0, 5m) = critical, [5m, 1h) = warn, [1h, +inf) = normal.
  // Strict `<` is deliberate — exactly 5m promotes to warn, exactly 1h promotes to normal.
  if (ms <= 0) return "expired";
  if (ms < 5 * 60_000) return "critical";
  if (ms < 60 * 60_000) return "warn";
  return "normal";
}
