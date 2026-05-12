import { describe, expect, it, vi } from "vitest";
import { onBookingCreated } from "../../event-hooks/booking-created-hook.js";

describe("onBookingCreated", () => {
  it("transitions thread to booked with booking evidence", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onBookingCreated(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      bookingId: "book-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: "booked",
        trigger: "booking_event_received",
        actor: "integration",
        evidence: { booking_id: "book-1", calendar_event_id: "cal-1", service_id: "svc-1" },
      }),
    );
  });

  it("no-ops when booking is not associated with a conversation thread", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onBookingCreated(writer, async () => "on", {
      organizationId: "org-1",
      conversationThreadId: null,
      contactId: "contact-1",
      bookingId: "book-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });

  it("no-ops when flag mode is off", async () => {
    const recordTransition = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = { recordTransition } as any;
    await onBookingCreated(writer, async () => "off", {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      bookingId: "book-1",
      calendarEventId: "cal-1",
      serviceId: "svc-1",
    });
    expect(recordTransition).not.toHaveBeenCalled();
  });
});
