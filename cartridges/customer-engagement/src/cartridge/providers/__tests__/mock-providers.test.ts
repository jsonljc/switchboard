import { describe, it, expect } from "vitest";
import { MockCalendarProvider } from "../calendar/mock-calendar.js";
import { MockSMSProvider } from "../sms/mock-sms.js";
import { MockReviewProvider } from "../review/mock-review.js";

describe("MockCalendarProvider", () => {
  it("books an appointment and returns details", async () => {
    const cal = new MockCalendarProvider();
    const start = new Date("2025-06-01T10:00:00Z");
    const end = new Date("2025-06-01T11:00:00Z");
    const result = await cal.bookAppointment("cal-1", "patient-1", start, end, "Cleaning");
    expect(result.appointmentId).toMatch(/^mock-appt-/);
    expect(result.contactId).toBe("patient-1");
    expect(result.startTime).toEqual(start);
    expect(result.endTime).toEqual(end);
    expect(result.status).toBe("scheduled");
    expect(result.notes).toBe("Cleaning");
  });

  it("uses notes when provided", async () => {
    const cal = new MockCalendarProvider();
    const result = await cal.bookAppointment(
      "cal-1",
      "p1",
      new Date(),
      new Date(),
      "Title",
      "Custom notes",
    );
    expect(result.notes).toBe("Custom notes");
  });

  it("cancels an appointment", async () => {
    const cal = new MockCalendarProvider();
    const booked = await cal.bookAppointment("cal-1", "p1", new Date(), new Date(), "Test");
    const cancelResult = await cal.cancelAppointment("cal-1", booked.appointmentId);
    expect(cancelResult.success).toBe(true);
    expect(cancelResult.previousStatus).toBe("scheduled");
  });

  it("cancel returns unknown for non-existent appointment", async () => {
    const cal = new MockCalendarProvider();
    const result = await cal.cancelAppointment("cal-1", "no-such-appt");
    expect(result.success).toBe(true);
    expect(result.previousStatus).toBe("unknown");
  });

  it("reschedules an appointment", async () => {
    const cal = new MockCalendarProvider();
    const booked = await cal.bookAppointment(
      "cal-1",
      "p1",
      new Date("2025-06-01T10:00:00Z"),
      new Date("2025-06-01T11:00:00Z"),
      "Test",
    );
    const newStart = new Date("2025-06-02T14:00:00Z");
    const newEnd = new Date("2025-06-02T15:00:00Z");
    const result = await cal.rescheduleAppointment("cal-1", booked.appointmentId, newStart, newEnd);
    expect(result.status).toBe("rescheduled");
    expect(result.startTime).toEqual(newStart);
    expect(result.endTime).toEqual(newEnd);
    expect(result.contactId).toBe("p1");
  });

  it("reschedule handles non-existent appointment", async () => {
    const cal = new MockCalendarProvider();
    const result = await cal.rescheduleAppointment("cal-1", "no-appt", new Date(), new Date());
    expect(result.status).toBe("rescheduled");
    expect(result.contactId).toBe("unknown");
  });

  it("generates available slots", async () => {
    const cal = new MockCalendarProvider();
    const start = new Date("2025-06-01T09:00:00Z");
    const end = new Date("2025-06-01T17:00:00Z");
    const slots = await cal.getAvailableSlots("cal-1", start, end, 30);
    expect(slots).toHaveLength(5);
    for (const slot of slots) {
      expect(slot.available).toBe(true);
      expect(slot.providerId).toBe("mock-provider");
      // Each slot is 30 minutes
      expect(slot.endTime.getTime() - slot.startTime.getTime()).toBe(30 * 60 * 1000);
    }
    // Slots are 1 hour apart
    expect(slots[1]!.startTime.getTime() - slots[0]!.startTime.getTime()).toBe(60 * 60 * 1000);
  });

  it("reports healthy status", async () => {
    const cal = new MockCalendarProvider();
    const health = await cal.checkHealth();
    expect(health.status).toBe("connected");
    expect(health.latencyMs).toBe(1);
    expect(health.error).toBeNull();
  });

  it("increments appointment IDs", async () => {
    const cal = new MockCalendarProvider();
    const a1 = await cal.bookAppointment("c", "p", new Date(), new Date(), "T");
    const a2 = await cal.bookAppointment("c", "p", new Date(), new Date(), "T");
    expect(a1.appointmentId).not.toBe(a2.appointmentId);
  });
});

describe("MockSMSProvider", () => {
  it("sends a message and tracks it", async () => {
    const sms = new MockSMSProvider();
    const result = await sms.sendMessage("+15551234567", "+15559999999", "Hello!");
    expect(result.messageId).toMatch(/^mock-sms-/);
    expect(result.status).toBe("sent");
    expect(sms.sentMessages).toHaveLength(1);
    expect(sms.sentMessages[0]!.to).toBe("+15551234567");
    expect(sms.sentMessages[0]!.body).toBe("Hello!");
  });

  it("increments message IDs", async () => {
    const sms = new MockSMSProvider();
    const r1 = await sms.sendMessage("+1", "+2", "A");
    const r2 = await sms.sendMessage("+1", "+2", "B");
    expect(r1.messageId).toBe("mock-sms-1");
    expect(r2.messageId).toBe("mock-sms-2");
  });

  it("reports healthy status", async () => {
    const sms = new MockSMSProvider();
    const health = await sms.checkHealth();
    expect(health.status).toBe("connected");
    expect(health.error).toBeNull();
  });
});

describe("MockReviewProvider", () => {
  it("sends a review request", async () => {
    const provider = new MockReviewProvider();
    const result = await provider.sendReviewRequest("p1", "loc1", "Please review us!");
    expect(result.requestId).toMatch(/^mock-review-req-/);
    expect(result.status).toBe("sent");
    expect(provider.sentRequests).toHaveLength(1);
    expect(provider.sentRequests[0]!.contactId).toBe("p1");
  });

  it("responds to a review", async () => {
    const provider = new MockReviewProvider();
    const result = await provider.respondToReview("review-1", "loc1", "Thank you!");
    expect(result.success).toBe(true);
    expect(provider.responses).toHaveLength(1);
    expect(provider.responses[0]!.reviewId).toBe("review-1");
    expect(provider.responses[0]!.responseText).toBe("Thank you!");
  });

  it("gets mock reviews", async () => {
    const provider = new MockReviewProvider();
    const reviews = await provider.getReviews("loc1", 5);
    // Max 3 mock reviews
    expect(reviews).toHaveLength(3);
    expect(reviews[0]!.platform).toBe("google");
    expect(reviews[0]!.rating).toBeGreaterThanOrEqual(4);
    expect(reviews[0]!.rating).toBeLessThanOrEqual(5);
    expect(reviews[0]!.text).toBe("Great experience!");
  });

  it("limits reviews to requested count", async () => {
    const provider = new MockReviewProvider();
    const reviews = await provider.getReviews("loc1", 2);
    expect(reviews).toHaveLength(2);
  });

  it("reports healthy status", async () => {
    const provider = new MockReviewProvider();
    const health = await provider.checkHealth();
    expect(health.status).toBe("connected");
    expect(health.error).toBeNull();
  });

  it("increments request IDs", async () => {
    const provider = new MockReviewProvider();
    const r1 = await provider.sendReviewRequest("p1", "l1", "msg1");
    const r2 = await provider.sendReviewRequest("p2", "l1", "msg2");
    expect(r1.requestId).not.toBe(r2.requestId);
  });
});
