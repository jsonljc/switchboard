import type { BusinessHoursConfig, TimeSlot } from "@switchboard/schemas";

interface SlotGeneratorInput {
  dateFrom: string;
  dateTo: string;
  durationMinutes: number;
  bufferMinutes: number;
  businessHours: BusinessHoursConfig;
  busyPeriods: Array<{ start: string; end: string }>;
  calendarId: string;
}

export function generateAvailableSlots(input: SlotGeneratorInput): TimeSlot[] {
  const {
    dateFrom,
    dateTo,
    durationMinutes,
    bufferMinutes,
    businessHours,
    busyPeriods,
    calendarId,
  } = input;
  const slots: TimeSlot[] = [];
  const from = new Date(dateFrom);
  const to = new Date(dateTo);

  // Iterate day by day
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);

  while (current <= to) {
    const dayOfWeek = getDayInTimezone(current, businessHours.timezone);
    const dayConfig = businessHours.days.find((d) => d.day === dayOfWeek);

    if (dayConfig) {
      const dayStart = setTimeInTimezone(current, dayConfig.open, businessHours.timezone);
      const dayEnd = setTimeInTimezone(current, dayConfig.close, businessHours.timezone);
      const slotCursor = new Date(Math.max(dayStart.getTime(), from.getTime()));

      while (
        slotCursor.getTime() + durationMinutes * 60_000 <= dayEnd.getTime() &&
        slotCursor <= to
      ) {
        const slotEnd = new Date(slotCursor.getTime() + durationMinutes * 60_000);

        if (!overlapsAny(slotCursor, slotEnd, busyPeriods)) {
          slots.push({
            start: slotCursor.toISOString(),
            end: slotEnd.toISOString(),
            calendarId,
            available: true,
          });
        }

        slotCursor.setTime(slotCursor.getTime() + (durationMinutes + bufferMinutes) * 60_000);
      }
    }

    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
  }

  return slots;
}

function overlapsAny(start: Date, end: Date, busy: Array<{ start: string; end: string }>): boolean {
  return busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return start.getTime() < be && end.getTime() > bs;
  });
}

function getDayInTimezone(date: Date, tz: string): number {
  return new Date(date.toLocaleString("en-US", { timeZone: tz })).getDay();
}

function setTimeInTimezone(date: Date, time: string, tz: string): Date {
  const hours = Number(time.split(":")[0]) || 0;
  const minutes = Number(time.split(":")[1]) || 0;
  const localized = new Date(date.toLocaleString("en-US", { timeZone: tz }));
  localized.setHours(hours, minutes, 0, 0);
  const offset =
    date.getTime() - new Date(date.toLocaleString("en-US", { timeZone: tz })).getTime();
  return new Date(localized.getTime() + offset);
}
