import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@switchboard/db";
import type { CalendarProvider } from "@switchboard/schemas";
import { eraseContactFully } from "../lib/erase-contact.js";

function makePrismaWithBookings(bookings: Array<{ calendarEventId: string | null }>): {
  prisma: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(bookings);
  const prisma = { booking: { findMany } } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe("eraseContactFully (F5 part c — external calendar cancel)", () => {
  it("cancels each booked calendar event BEFORE deleting the contact graph", async () => {
    const order: string[] = [];
    const cancelBooking = vi.fn(async (id: string) => {
      order.push(`cancel:${id}`);
    });
    const provider = { cancelBooking } as unknown as CalendarProvider;
    const calendarProviderFactory = vi.fn(async () => provider);
    const contactStore = {
      delete: vi.fn(async () => {
        order.push("delete");
      }),
    };
    const { prisma, findMany } = makePrismaWithBookings([
      { calendarEventId: "evt-1" },
      { calendarEventId: "evt-2" },
      { calendarEventId: null }, // no external event — skipped, never cancelled
    ]);

    const result = await eraseContactFully(
      { prisma, contactStore, calendarProviderFactory },
      "org-1",
      "contact-1",
    );

    // Reads the booking event ids scoped to the contact + org, before deletion.
    expect(findMany).toHaveBeenCalledWith({
      where: { contactId: "contact-1", organizationId: "org-1" },
      select: { calendarEventId: true },
    });
    // Cancels each non-null event id exactly once...
    expect(cancelBooking).toHaveBeenCalledTimes(2);
    expect(cancelBooking).toHaveBeenCalledWith("evt-1", expect.any(String));
    expect(cancelBooking).toHaveBeenCalledWith("evt-2", expect.any(String));
    // ...strictly BEFORE the DB delete (so the cascade hasn't removed the rows yet).
    expect(order).toEqual(["cancel:evt-1", "cancel:evt-2", "delete"]);
    expect(contactStore.delete).toHaveBeenCalledWith("org-1", "contact-1");
    // All events cancelled -> the reported outcome is honest "completed".
    expect(result).toEqual({
      contactErased: true,
      calendar: "completed",
      calendarEventsFound: 2,
      calendarEventsCancelled: 2,
    });
  });

  it("returns failed but still deletes the contact when the only calendar cancel throws", async () => {
    const cancelBooking = vi.fn(async () => {
      throw new Error("google boom");
    });
    const provider = { cancelBooking } as unknown as CalendarProvider;
    const contactStore = { delete: vi.fn(async () => undefined) };
    const { prisma } = makePrismaWithBookings([{ calendarEventId: "evt-1" }]);
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await eraseContactFully(
      { prisma, contactStore, calendarProviderFactory: vi.fn(async () => provider), logger },
      "org-1",
      "contact-1",
    );

    expect(cancelBooking).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
    // DB erasure is never blocked by a calendar failure...
    expect(contactStore.delete).toHaveBeenCalledWith("org-1", "contact-1");
    // ...but the outcome is honest: the lone event was not cancelled.
    expect(result.calendar).toBe("failed");
    expect(result.calendarEventsFound).toBe(1);
    expect(result.calendarEventsCancelled).toBe(0);
  });

  it("returns partial when some calendar cancels succeed and some fail", async () => {
    const cancelBooking = vi.fn(async (id: string) => {
      if (id === "evt-2") throw new Error("google boom");
    });
    const provider = { cancelBooking } as unknown as CalendarProvider;
    const contactStore = { delete: vi.fn(async () => undefined) };
    const { prisma } = makePrismaWithBookings([
      { calendarEventId: "evt-1" },
      { calendarEventId: "evt-2" },
    ]);
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await eraseContactFully(
      { prisma, contactStore, calendarProviderFactory: vi.fn(async () => provider), logger },
      "org-1",
      "contact-1",
    );

    expect(contactStore.delete).toHaveBeenCalledWith("org-1", "contact-1");
    expect(result.calendar).toBe("partial");
    expect(result.calendarEventsFound).toBe(2);
    expect(result.calendarEventsCancelled).toBe(1);
  });

  it("still deletes the contact when the calendar provider cannot be resolved", async () => {
    const contactStore = { delete: vi.fn(async () => undefined) };
    const { prisma } = makePrismaWithBookings([{ calendarEventId: "evt-1" }]);
    const calendarProviderFactory = vi.fn(async () => {
      throw new Error("no creds");
    });
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await eraseContactFully(
      { prisma, contactStore, calendarProviderFactory, logger },
      "org-1",
      "contact-1",
    );

    expect(logger.error).toHaveBeenCalled();
    expect(contactStore.delete).toHaveBeenCalledWith("org-1", "contact-1");
    // Events exist but none could be cancelled (no provider) -> honest "failed".
    expect(result.calendar).toBe("failed");
    expect(result.calendarEventsFound).toBe(1);
    expect(result.calendarEventsCancelled).toBe(0);
  });

  it("returns skipped (clean) when the contact has no booked events", async () => {
    const calendarProviderFactory = vi.fn(async () => {
      throw new Error("provider should not be resolved");
    });
    const contactStore = { delete: vi.fn(async () => undefined) };
    const { prisma } = makePrismaWithBookings([{ calendarEventId: null }]);

    const result = await eraseContactFully(
      { prisma, contactStore, calendarProviderFactory },
      "org-1",
      "contact-1",
    );

    expect(calendarProviderFactory).not.toHaveBeenCalled();
    expect(contactStore.delete).toHaveBeenCalledWith("org-1", "contact-1");
    expect(result.calendar).toBe("skipped");
    expect(result.calendarEventsFound).toBe(0);
  });
});
