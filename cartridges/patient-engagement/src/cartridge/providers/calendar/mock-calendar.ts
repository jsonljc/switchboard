// ---------------------------------------------------------------------------
// Mock Calendar Provider
// ---------------------------------------------------------------------------

import type { CalendarProvider } from "../provider.js";
import type { AppointmentDetails, AppointmentSlot } from "../../../core/types.js";
import type { PlatformHealth } from "../../types.js";

export class MockCalendarProvider implements CalendarProvider {
  readonly platform = "mock" as const;
  private appointments = new Map<string, AppointmentDetails>();
  private nextId = 1;

  async bookAppointment(
    _calendarId: string,
    patientId: string,
    startTime: Date,
    endTime: Date,
    title: string,
    notes?: string,
  ): Promise<AppointmentDetails> {
    const appointmentId = `mock-appt-${this.nextId++}`;
    const details: AppointmentDetails = {
      appointmentId,
      patientId,
      providerId: "mock-provider",
      startTime,
      endTime,
      status: "scheduled",
      treatmentType: null,
      notes: notes ?? title,
    };
    this.appointments.set(appointmentId, details);
    return details;
  }

  async cancelAppointment(
    _calendarId: string,
    appointmentId: string,
  ): Promise<{ success: boolean; previousStatus: string }> {
    const appt = this.appointments.get(appointmentId);
    const previousStatus = appt?.status ?? "unknown";
    if (appt) {
      appt.status = "cancelled";
    }
    return { success: true, previousStatus };
  }

  async rescheduleAppointment(
    _calendarId: string,
    appointmentId: string,
    newStartTime: Date,
    newEndTime: Date,
  ): Promise<AppointmentDetails> {
    const existing = this.appointments.get(appointmentId);
    const updated: AppointmentDetails = {
      appointmentId,
      patientId: existing?.patientId ?? "unknown",
      providerId: existing?.providerId ?? "mock-provider",
      startTime: newStartTime,
      endTime: newEndTime,
      status: "rescheduled",
      treatmentType: existing?.treatmentType ?? null,
      notes: existing?.notes ?? null,
    };
    this.appointments.set(appointmentId, updated);
    return updated;
  }

  async getAvailableSlots(
    _calendarId: string,
    startDate: Date,
    _endDate: Date,
    durationMinutes: number,
  ): Promise<AppointmentSlot[]> {
    const slots: AppointmentSlot[] = [];
    // Generate 5 mock slots starting from startDate
    for (let i = 0; i < 5; i++) {
      const start = new Date(startDate.getTime() + i * 60 * 60 * 1000);
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      slots.push({
        startTime: start,
        endTime: end,
        providerId: "mock-provider",
        available: true,
      });
    }
    return slots;
  }

  async checkHealth(): Promise<PlatformHealth> {
    return { status: "connected", latencyMs: 1, error: null };
  }
}
