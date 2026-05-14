// apps/dashboard/src/lib/cockpit/relative-age.ts
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function relativeAge(then: Date, now: Date = new Date()): string {
  const deltaMs = now.getTime() - then.getTime();
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return "Yesterday";
  if (days < 7) return WEEKDAYS[then.getUTCDay()]!;
  return then.toISOString().slice(0, 10);
}
