import { it, expect, vi } from "vitest";
import { buildRescheduleOperations } from "./calendar-reschedule.js";

const ctx = { orgId: "org-1", contactId: "c-1" } as never;
const upcoming = [
  {
    id: "b1",
    calendarEventId: "evt-1",
    service: "botox",
    startsAt: new Date("2026-06-12T02:00:00Z"),
    endsAt: new Date("2026-06-12T03:00:00Z"),
    status: "confirmed",
  },
];

function deps(over: Record<string, unknown> = {}) {
  return {
    calendarProviderFactory: vi.fn().mockResolvedValue({
      rescheduleBooking: vi.fn().mockResolvedValue({}),
      cancelBooking: vi.fn().mockResolvedValue(undefined),
    }),
    isCalendarProviderConfigured: () => true,
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(upcoming),
      reschedule: vi.fn().mockResolvedValue({ id: "b1" }),
      cancel: vi.fn().mockResolvedValue({ id: "b1" }),
    },
    ...over,
  };
}

it("reschedule resolves the soonest booking from ctx.contactId and ignores a model contactId", async () => {
  const d = deps();
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-13T02:00:00Z",
    slotEnd: "2026-06-13T03:00:00Z",
    calendarId: "primary",
    contactId: "ATTACKER",
  });
  expect(d.bookingStore.findUpcomingByContact).toHaveBeenCalledWith("org-1", "c-1");
  expect(res.status).toBe("success");
});

it("returns NO_UPCOMING_BOOKING when the contact has none", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue([]),
      reschedule: vi.fn(),
      cancel: vi.fn(),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({});
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("NO_UPCOMING_BOOKING");
});

it("cancel calls the provider with the calendarEventId then the store cancel", async () => {
  const d = deps();
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({});
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const provider = await d.calendarProviderFactory.mock.results[0]!.value;
  expect(provider.cancelBooking).toHaveBeenCalledWith("evt-1");
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b1");
  expect(res.status).toBe("success");
});

it("reschedule increments via store after the provider patch", async () => {
  const d = deps();
  await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-13T02:00:00Z",
    slotEnd: "2026-06-13T03:00:00Z",
    calendarId: "primary",
  });
  expect(d.bookingStore.reschedule).toHaveBeenCalledWith(
    "org-1",
    "b1",
    expect.objectContaining({ startsAt: expect.any(Date), endsAt: expect.any(Date) }),
  );
});
