import { describe, it, expect, vi } from "vitest";
import { executeBookAppointment } from "../book-appointment.js";
import { executeCancelAppointment } from "../cancel-appointment.js";
import { executeRescheduleAppointment } from "../reschedule-appointment.js";
import type { CalendarProvider } from "../../providers/provider.js";

function mockCalendar(): CalendarProvider {
  return {
    platform: "mock",
    bookAppointment: vi.fn().mockResolvedValue({
      appointmentId: "apt-100",
      startTime: "2025-06-01T10:00:00Z",
      endTime: "2025-06-01T11:00:00Z",
      status: "confirmed",
    }),
    cancelAppointment: vi.fn().mockResolvedValue({
      success: true,
      previousStatus: "confirmed",
    }),
    rescheduleAppointment: vi.fn().mockResolvedValue({
      appointmentId: "apt-100",
      startTime: "2025-06-02T10:00:00Z",
      endTime: "2025-06-02T11:00:00Z",
      status: "confirmed",
    }),
    getAvailableSlots: vi.fn().mockResolvedValue([]),
    checkHealth: vi.fn().mockResolvedValue({ status: "healthy" }),
  };
}

describe("executeBookAppointment", () => {
  it("should book via calendar provider", async () => {
    const cal = mockCalendar();
    const result = await executeBookAppointment(
      {
        contactId: "c-1",
        serviceType: "cleaning",
        startTime: "2025-06-01T10:00:00Z",
        durationMinutes: 60,
      },
      cal,
      "cal-1",
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("cleaning");
    expect(result.undoRecipe).not.toBeNull();
    expect(cal.bookAppointment).toHaveBeenCalled();
  });

  it("should generate booking link when bookingUrl is provided", async () => {
    const cal = mockCalendar();
    const result = await executeBookAppointment(
      {
        contactId: "c-1",
        bookingUrl: "https://booking.example.com/schedule",
      },
      cal,
      "cal-1",
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Booking link");
    expect(result.externalRefs["bookingUrl"]).toContain("patient_id=c-1");
    expect(cal.bookAppointment).not.toHaveBeenCalled();
  });

  it("should handle calendar failure", async () => {
    const cal = mockCalendar();
    (cal.bookAppointment as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Calendar unavailable"),
    );
    const result = await executeBookAppointment(
      { contactId: "c-1", startTime: "2025-06-01T10:00:00Z" },
      cal,
      "cal-1",
    );
    expect(result.success).toBe(false);
    expect(result.partialFailures[0]?.error).toBe("Calendar unavailable");
  });

  it("should emit conversion event when conversionBus is provided", async () => {
    const cal = mockCalendar();
    const emit = vi.fn();
    const result = await executeBookAppointment(
      { contactId: "c-1", startTime: "2025-06-01T10:00:00Z" },
      cal,
      "cal-1",
      { conversionBus: { emit } as never, organizationId: "org-1" },
    );
    expect(result.success).toBe(true);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "booked", contactId: "c-1" }),
    );
  });
});

describe("executeCancelAppointment", () => {
  it("should cancel via calendar provider", async () => {
    const cal = mockCalendar();
    const result = await executeCancelAppointment(
      { appointmentId: "apt-1", reason: "patient request" },
      cal,
      "cal-1",
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("apt-1");
    expect(result.summary).toContain("patient request");
    expect(result.undoRecipe).not.toBeNull();
  });

  it("should handle cancel failure", async () => {
    const cal = mockCalendar();
    (cal.cancelAppointment as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Not found"));
    const result = await executeCancelAppointment({ appointmentId: "apt-1" }, cal, "cal-1");
    expect(result.success).toBe(false);
    expect(result.partialFailures[0]?.error).toBe("Not found");
  });
});

describe("executeRescheduleAppointment", () => {
  it("should reschedule via calendar provider", async () => {
    const cal = mockCalendar();
    const result = await executeRescheduleAppointment(
      {
        appointmentId: "apt-1",
        newStartTime: "2025-06-02T10:00:00Z",
        durationMinutes: 60,
      },
      cal,
      "cal-1",
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Rescheduled");
    expect(result.undoRecipe).not.toBeNull();
  });

  it("should handle reschedule failure", async () => {
    const cal = mockCalendar();
    (cal.rescheduleAppointment as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Conflict"),
    );
    const result = await executeRescheduleAppointment(
      { appointmentId: "apt-1", newStartTime: "2025-06-02T10:00:00Z" },
      cal,
      "cal-1",
    );
    expect(result.success).toBe(false);
    expect(result.partialFailures[0]?.error).toBe("Conflict");
  });
});
