const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function relativeAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const delta = now.getTime() - then;
  if (delta < MIN) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MIN)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < MONTH) return `${Math.floor(delta / DAY)}d ago`;
  if (delta < YEAR) return `${Math.floor(delta / MONTH)}mo ago`;
  return `${Math.floor(delta / YEAR)}y ago`;
}

export function channelLabel(c: "whatsapp" | "telegram" | "dashboard"): string {
  return c === "whatsapp" ? "WhatsApp" : c === "telegram" ? "Telegram" : "Dashboard";
}

export function stageLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatMoney(amount: number | null, currency = "SGD"): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatConsent(c: {
  optedIn: boolean;
  optedInAt: string | null;
  source: string | null;
  optedOutAt: string | null;
}): string {
  if (c.optedOutAt) return `opted out · ${relativeAge(c.optedOutAt)}`;
  if (c.optedIn) {
    const when = c.optedInAt ? relativeAge(c.optedInAt) : "";
    const src = c.source ? ` (${c.source})` : "";
    return `opted in · ${when}${src}`.trim();
  }
  return "no consent on file";
}
