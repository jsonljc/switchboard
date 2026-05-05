// packages/core/src/reports/period-helpers.ts
import type { PeriodRange } from "./types.js";
import type { ReportWindow } from "@switchboard/schemas";

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay();
  const offset = (day + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - offset);
  return startOfDayUTC(monday);
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfQuarterUTC(d: Date): Date {
  const quarter = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), quarter * 3, 1));
}

export function windowToRange(window: ReportWindow, now: Date): PeriodRange {
  switch (window) {
    case "THIS WEEK": {
      const start = startOfWeekUTC(now);
      const end = new Date(start);
      end.setUTCDate(start.getUTCDate() + 7);
      return { start, end, window };
    }
    case "THIS MONTH": {
      const start = startOfMonthUTC(now);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      return { start, end, window };
    }
    case "THIS QUARTER": {
      const start = startOfQuarterUTC(now);
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1));
      return { start, end, window };
    }
  }
}

export function priorPeriodRange(current: PeriodRange): PeriodRange {
  const span = current.end.getTime() - current.start.getTime();
  if (current.window === "THIS MONTH") {
    const start = new Date(
      Date.UTC(current.start.getUTCFullYear(), current.start.getUTCMonth() - 1, 1),
    );
    const end = new Date(current.start);
    return { start, end, window: null };
  }
  if (current.window === "THIS QUARTER") {
    const start = new Date(
      Date.UTC(current.start.getUTCFullYear(), current.start.getUTCMonth() - 3, 1),
    );
    const end = new Date(current.start);
    return { start, end, window: null };
  }
  const end = new Date(current.start);
  const start = new Date(end.getTime() - span);
  return { start, end, window: null };
}

export function formatCurrencyUSD(value: number): string {
  if (value === 0) return "$0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const whole = Math.round(abs);
    return `${sign}$${whole.toLocaleString("en-US")}`;
  }
  if (Number.isInteger(abs)) {
    return `${sign}$${abs.toLocaleString("en-US")}`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatDateFolio(range: PeriodRange): string {
  const startMonth = MONTH_NAMES[range.start.getUTCMonth()];
  const startDay = range.start.getUTCDate();
  const lastIncluded = new Date(range.end.getTime() - 24 * 60 * 60 * 1000);
  const endMonth = MONTH_NAMES[lastIncluded.getUTCMonth()];
  const endDay = lastIncluded.getUTCDate();
  return `${startMonth} ${startDay} — ${endMonth} ${endDay}`;
}
