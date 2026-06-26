import { it, expect, vi } from "vitest";
import { BookingSlotConflictError } from "@switchboard/schemas";
import { buildRescheduleOperations } from "./calendar-reschedule.js";
import { getToolGovernanceDecision } from "../governance.js";

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

const twoBookings = [
  {
    id: "b1",
    calendarEventId: "evt-1",
    service: "filler",
    startsAt: new Date("2026-06-12T02:00:00Z"),
    endsAt: new Date("2026-06-12T03:00:00Z"),
    status: "confirmed",
  },
  {
    id: "b2",
    calendarEventId: "evt-2",
    service: "dysport",
    startsAt: new Date("2026-06-15T02:00:00Z"),
    endsAt: new Date("2026-06-15T03:00:00Z"),
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

// P1-A / P3-3: reschedule + cancel act on an ALREADY-confirmed booking. They
// previously auto-approved only at "guided" and gated at "supervised". But the
// in-skill GovernanceHook cannot park a pending_approval, so a gate at supervised
// is not a human-review checkpoint — it is a SILENT DEAD-END: execute() never
// runs, the change never persists, and Alex still tells the lead "I've
// moved/cancelled your appointment". Bring them to parity with booking.create:
// auto-approve at supervised AND guided so Alex never confirms a change that did
// not happen. (Operator-park-for-review at supervised is the deferred F2 posture.)
it("booking.reschedule auto-approves at supervised AND guided (parity with booking.create — a gate dead-ends)", () => {
  const ops = buildRescheduleOperations(ctx, deps() as never);
  expect(getToolGovernanceDecision(ops["booking.reschedule"]!, "supervised")).toBe("auto-approve");
  expect(getToolGovernanceDecision(ops["booking.reschedule"]!, "guided")).toBe("auto-approve");
});

it("booking.cancel auto-approves at supervised AND guided (parity with booking.create — a gate dead-ends)", () => {
  const ops = buildRescheduleOperations(ctx, deps() as never);
  expect(getToolGovernanceDecision(ops["booking.cancel"]!, "supervised")).toBe("auto-approve");
  expect(getToolGovernanceDecision(ops["booking.cancel"]!, "guided")).toBe("auto-approve");
});

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

it("cancel cancels the booking in the DB and deletes the calendar event", async () => {
  const d = deps();
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({});
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const provider = await d.calendarProviderFactory.mock.results[0]!.value;
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b1");
  expect(provider.cancelBooking).toHaveBeenCalledWith("evt-1");
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

it("reschedule onto a held slot surfaces SLOT_TAKEN (retryable) not a raw failure", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(upcoming),
      reschedule: vi.fn().mockRejectedValue(new BookingSlotConflictError("x")),
      cancel: vi.fn(),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-13T02:00:00Z",
    slotEnd: "2026-06-13T03:00:00Z",
    calendarId: "primary",
  });
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("SLOT_TAKEN");
  expect(res.error?.retryable).toBe(true);
});

it("reschedule fails gracefully when the provider factory throws", async () => {
  const d = deps({
    calendarProviderFactory: vi.fn().mockRejectedValue(new Error("provider boom")),
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-13T02:00:00Z",
    slotEnd: "2026-06-13T03:00:00Z",
    calendarId: "primary",
  });
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("CALENDAR_PROVIDER_ERROR");
});

it("cancel fails gracefully when the provider factory throws", async () => {
  const d = deps({
    calendarProviderFactory: vi.fn().mockRejectedValue(new Error("provider boom")),
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({});
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("CALENDAR_PROVIDER_ERROR");
});

it("reschedule reverts the calendar event to the original slot when the durable write rejects", async () => {
  // The provider moves the event to the new slot, THEN the store overlap-guard rejects:
  // the event must be reverted to the original slot so calendar and DB don't diverge.
  const rescheduleBooking = vi.fn().mockResolvedValue({});
  const d = deps({
    calendarProviderFactory: vi.fn().mockResolvedValue({
      rescheduleBooking,
      cancelBooking: vi.fn().mockResolvedValue(undefined),
    }),
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(upcoming),
      reschedule: vi.fn().mockRejectedValue(new BookingSlotConflictError("x")),
      cancel: vi.fn(),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-13T02:00:00Z",
    slotEnd: "2026-06-13T03:00:00Z",
    calendarId: "primary",
  });
  expect(res.error?.code).toBe("SLOT_TAKEN");
  // moved to the new slot, then reverted to the ORIGINAL slot (b1: 2026-06-12T02:00→03:00Z)
  expect(rescheduleBooking).toHaveBeenCalledTimes(2);
  expect(rescheduleBooking).toHaveBeenLastCalledWith(
    "evt-1",
    expect.objectContaining({ start: "2026-06-12T02:00:00.000Z", end: "2026-06-12T03:00:00.000Z" }),
  );
});

it("cancel still succeeds (booking cancelled in DB) when the calendar event delete fails", async () => {
  const d = deps({
    calendarProviderFactory: vi.fn().mockResolvedValue({
      rescheduleBooking: vi.fn(),
      cancelBooking: vi.fn().mockRejectedValue(new Error("calendar down")),
    }),
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({});
  expect(res.status).toBe("success");
  expect((res.data as { status?: string }).status).toBe("cancelled");
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b1");
});

it("cancel returns CANCEL_FAILURE and does NOT delete the calendar event when the DB cancel fails", async () => {
  const cancelBooking = vi.fn().mockResolvedValue(undefined);
  const d = deps({
    calendarProviderFactory: vi.fn().mockResolvedValue({
      rescheduleBooking: vi.fn(),
      cancelBooking,
    }),
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(upcoming),
      reschedule: vi.fn(),
      cancel: vi.fn().mockRejectedValue(new Error("db down")),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({});
  expect(res.error?.code).toBe("CANCEL_FAILURE");
  expect(cancelBooking).not.toHaveBeenCalled();
});

it("cancel does NOT cancel an unrelated booking when the requested service matches none", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ id: "b1" }),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({
    service: "botox",
  });
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("NO_MATCHING_BOOKING");
  expect(d.bookingStore.cancel).not.toHaveBeenCalled();
  expect((res.data as { availableServices?: string[] }).availableServices).toEqual([
    "filler",
    "dysport",
  ]);
});

it("reschedule does NOT move an unrelated booking when the requested service matches none", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn().mockResolvedValue({ id: "b1" }),
      cancel: vi.fn(),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-20T02:00:00Z",
    slotEnd: "2026-06-20T03:00:00Z",
    calendarId: "primary",
    service: "botox",
  });
  expect(res.error?.code).toBe("NO_MATCHING_BOOKING");
  expect(d.bookingStore.reschedule).not.toHaveBeenCalled();
});

it("cancel selects the booking matching the requested service, not the soonest", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ id: "b2" }),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({
    service: "dysport",
  });
  expect(res.status).toBe("success");
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b2");
});

it("cancel with no service still targets the soonest booking (unchanged)", async () => {
  const d = deps({
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn(),
      cancel: vi.fn().mockResolvedValue({ id: "b1" }),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({});
  expect(res.status).toBe("success");
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b1");
});

it("reschedule selects the service-matched booking among several, not the soonest", async () => {
  const rescheduleBooking = vi.fn().mockResolvedValue({});
  const d = deps({
    calendarProviderFactory: vi.fn().mockResolvedValue({
      rescheduleBooking,
      cancelBooking: vi.fn().mockResolvedValue(undefined),
    }),
    bookingStore: {
      findUpcomingByContact: vi.fn().mockResolvedValue(twoBookings),
      reschedule: vi.fn().mockResolvedValue({ id: "b2" }),
      cancel: vi.fn(),
    },
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "2026-06-20T02:00:00Z",
    slotEnd: "2026-06-20T03:00:00Z",
    calendarId: "primary",
    service: "dysport",
  });
  expect(res.status).toBe("success");
  expect(d.bookingStore.reschedule).toHaveBeenCalledWith("org-1", "b2", expect.any(Object));
  expect(rescheduleBooking).toHaveBeenCalledWith("evt-2", expect.any(Object));
});

it("cancel matches the requested service case-insensitively and trims surrounding whitespace", async () => {
  const d = deps(); // `upcoming` holds a single "botox" booking (b1)
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({
    service: "  Botox ",
  });
  expect(res.status).toBe("success");
  expect(d.bookingStore.cancel).toHaveBeenCalledWith("org-1", "b1");
});

it("cancel fails closed for a whitespace-only service rather than acting on a booking", async () => {
  // Guards the edge case: a non-empty-but-blank service must NOT degrade to the soonest
  // booking. It normalizes to "" which matches nothing, so it surfaces NO_MATCHING_BOOKING.
  const d = deps(); // `upcoming` holds a single "botox" booking (b1)
  const res = await buildRescheduleOperations(ctx, d as never)["booking.cancel"]!.execute({
    service: "   ",
  });
  expect(res.error?.code).toBe("NO_MATCHING_BOOKING");
  expect(d.bookingStore.cancel).not.toHaveBeenCalled();
});

// P2-2: a malformed LLM slotStart on a reschedule previously reached
// provider.rescheduleBooking (a spurious calendar move) and bookingStore.reschedule
// (an Invalid Date), where the Prisma throw was mis-classified as RESCHEDULE_FAILURE
// (retryable:false, "escalate to a human") AFTER moving the live event. Validate the
// window first and return a recoverable, retryable fail with no side effect.
it("reschedule returns a recoverable fail and performs no calendar or store mutation when slotStart is malformed", async () => {
  const rescheduleBooking = vi.fn().mockResolvedValue({});
  const d = deps({
    calendarProviderFactory: vi.fn().mockResolvedValue({
      rescheduleBooking,
      cancelBooking: vi.fn().mockResolvedValue(undefined),
    }),
  });
  const res = await buildRescheduleOperations(ctx, d as never)["booking.reschedule"]!.execute({
    slotStart: "not-a-date",
    slotEnd: "2026-06-13T03:00:00Z",
    calendarId: "primary",
  });
  expect(res.status).toBe("error");
  expect(res.error?.code).toBe("INVALID_SLOT");
  expect(res.error?.retryable).toBe(true);
  expect(res.error?.modelRemediation).toBeTruthy();
  // no spurious calendar move and no mis-classified human-escalate
  expect(rescheduleBooking).not.toHaveBeenCalled();
  expect(d.bookingStore.reschedule).not.toHaveBeenCalled();
});
