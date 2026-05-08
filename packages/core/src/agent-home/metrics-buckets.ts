import { computeWindowStart } from "./window.js";

export interface BucketRange {
  from: Date;
  to: Date;
  label: string;
}

export interface DailyBucketRange extends BucketRange {
  isToday: boolean;
}

export interface WeekContext {
  now: Date;
  timezone: string;
  weekStart: Date;
  weekEnd: Date;
  prevWeekStart: Date;
  prevWeekEnd: Date;
  weeklyBuckets: readonly BucketRange[];
  dailyBuckets: readonly DailyBucketRange[];
  folioRange: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function buildWeekContext(now: Date, timezone: string): WeekContext {
  const weekStart = computeWindowStart("week", now, timezone);
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
  const prevWeekStart = new Date(weekStart.getTime() - WEEK_MS);
  const prevWeekEnd = weekStart;

  const weeklyBuckets: BucketRange[] = [];
  for (let i = 4; i >= 1; i--) {
    const from = new Date(weekStart.getTime() - i * WEEK_MS);
    const to = new Date(weekStart.getTime() - (i - 1) * WEEK_MS);
    weeklyBuckets.push({ from, to, label: weeklyLabel(i) });
  }

  const dailyBuckets = buildDailyBuckets(weekStart, now, timezone);
  const folioRange = formatFolioRange(dailyBuckets);

  return {
    now,
    timezone,
    weekStart,
    weekEnd,
    prevWeekStart,
    prevWeekEnd,
    weeklyBuckets,
    dailyBuckets,
    folioRange,
  };
}

function weeklyLabel(weeksBack: number): string {
  if (weeksBack === 1) return "last week";
  return `${weeksBack} wks ago`;
}

function buildDailyBuckets(
  weekStart: Date,
  now: Date,
  timezone: string,
): readonly DailyBucketRange[] {
  const todayStart = computeWindowStart("today", now, timezone);
  const todayDayIndex = Math.round((todayStart.getTime() - weekStart.getTime()) / DAY_MS);
  const buckets: DailyBucketRange[] = [];
  for (let i = 0; i <= todayDayIndex; i++) {
    const from = new Date(weekStart.getTime() + i * DAY_MS);
    const isToday = i === todayDayIndex;
    const to = isToday ? now : new Date(from.getTime() + DAY_MS);
    buckets.push({ from, to, label: WEEKDAY_SHORT[i] ?? "?", isToday });
  }
  return buckets;
}

function formatFolioRange(daily: readonly DailyBucketRange[]): string {
  if (daily.length === 0) return "";
  if (daily.length === 1) return daily[0]!.label;
  return `${daily[0]!.label} — ${daily[daily.length - 1]!.label}`;
}
