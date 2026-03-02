// ---------------------------------------------------------------------------
// Availability — Slot computation
// ---------------------------------------------------------------------------

import type { AppointmentSlot } from "../../core/types.js";
import type { CalendarProvider } from "../../cartridge/providers/provider.js";

/**
 * Find available slots that match patient preferences.
 */
export async function findAvailableSlots(
  calendar: CalendarProvider,
  calendarId: string,
  startDate: Date,
  endDate: Date,
  durationMinutes: number,
  preferences?: {
    preferredDayOfWeek?: number; // 0=Sun, 6=Sat
    preferMorning?: boolean;
  },
): Promise<AppointmentSlot[]> {
  const allSlots = await calendar.getAvailableSlots(
    calendarId,
    startDate,
    endDate,
    durationMinutes,
  );

  if (!preferences) return allSlots;

  return allSlots.filter((slot) => {
    if (preferences.preferredDayOfWeek !== undefined) {
      if (slot.startTime.getDay() !== preferences.preferredDayOfWeek) return false;
    }
    if (preferences.preferMorning !== undefined) {
      const hour = slot.startTime.getHours();
      if (preferences.preferMorning && hour >= 12) return false;
      if (!preferences.preferMorning && hour < 12) return false;
    }
    return true;
  });
}
