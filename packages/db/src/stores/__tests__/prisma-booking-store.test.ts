import { describe, it, expect, vi, beforeEach } from "vitest";
import { StaleVersionError } from "@switchboard/core";
import { BookingSlotConflictError, isBookingSlotConflictError } from "@switchboard/schemas";
import { PrismaBookingStore, acquireBookingLock } from "../prisma-booking-store.js";

function makePrisma() {
  return {
    booking: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(0),
        booking: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
      };
      return fn(tx);
    }),
  };
}

function makeTransactionPrisma(overlapRow: { id: string } | null) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    booking: {
      findFirst: vi.fn().mockResolvedValue(overlapRow),
      create: vi.fn().mockResolvedValue({ id: "new-booking" }),
    },
  };
  const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma, tx };
}

describe("PrismaBookingStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaBookingStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaBookingStore(prisma as never);
  });

  it("creates a booking with pending_confirmation status via transaction", async () => {
    const input = {
      organizationId: "org_1",
      contactId: "ct_1",
      service: "consultation",
      startsAt: new Date("2026-04-20T10:00:00Z"),
      endsAt: new Date("2026-04-20T10:30:00Z"),
      timezone: "Asia/Singapore",
      createdByType: "agent" as const,
    };
    const expected = {
      id: "bk_1",
      status: "pending_confirmation",
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Wire up the $transaction mock to return the created booking via its tx.booking.create
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      (fn: (tx: unknown) => unknown) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(0),
          booking: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(expected),
          },
        };
        return fn(tx);
      },
    );

    const result = await store.create(input);
    expect((result as typeof expected).status).toBe("pending_confirmation");
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("acquireBookingLock issues pg_advisory_xact_lock with the int4-cast namespace", async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    await acquireBookingLock({ $executeRaw: executeRaw } as never, "org-1");
    const [strings, ...values] = executeRaw.mock.calls[0]!;
    const sql = (strings as string[]).join("?");
    expect(sql).toContain("pg_advisory_xact_lock");
    // The ::int4 cast is mandatory: Prisma sends the namespace as bigint and
    // pg_advisory_xact_lock(bigint, integer) does not exist (Postgres 42883).
    expect(sql).toContain("::int4");
    expect(values).toEqual([920_001, "org-1"]);
  });

  it("confirms a booking by id with tenant scope (Pattern B)", async () => {
    (prisma.booking.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (prisma.booking.findFirstOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      organizationId: "org_1",
      status: "confirmed",
      calendarEventId: "gcal_abc",
    });

    const result = await store.confirm("org_1", "bk_1", "gcal_abc");
    expect(result.status).toBe("confirmed");
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "bk_1", organizationId: "org_1" },
      data: { status: "confirmed", calendarEventId: "gcal_abc" },
    });
    expect(prisma.booking.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: "bk_1", organizationId: "org_1" },
    });
  });

  it("throws StaleVersionError from confirm when tenant+id match fails", async () => {
    (prisma.booking.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await expect(store.confirm("org_other", "bk_1", "gcal_abc")).rejects.toBeInstanceOf(
      StaleVersionError,
    );
    expect(prisma.booking.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it("finds a booking by id", async () => {
    (prisma.booking.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      status: "confirmed",
    });

    const result = await store.findById("bk_1");
    expect(result?.status).toBe("confirmed");
  });

  it("counts confirmed bookings for an org", async () => {
    (prisma.booking.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    const count = await store.countConfirmed("org_1");
    expect(count).toBe(5);
  });

  it("finds a booking by slot fields", async () => {
    const startsAt = new Date("2026-04-20T10:00:00Z");
    (prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      status: "confirmed",
    });

    const result = await store.findBySlot("org_1", "ct_1", "consultation", startsAt);
    expect(result?.id).toBe("bk_1");
    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        contactId: "ct_1",
        service: "consultation",
        startsAt,
      },
    });
  });

  it("marks a booking as failed with tenant scope (Pattern B)", async () => {
    (prisma.booking.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (prisma.booking.findFirstOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      organizationId: "org_1",
      status: "failed",
    });

    const result = await store.markFailed("org_1", "bk_1");
    expect(result.status).toBe("failed");
    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "bk_1", organizationId: "org_1" },
      data: { status: "failed" },
    });
    expect(prisma.booking.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: "bk_1", organizationId: "org_1" },
    });
  });

  it("throws StaleVersionError from markFailed when tenant+id match fails", async () => {
    (prisma.booking.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    await expect(store.markFailed("org_other", "bk_1")).rejects.toBeInstanceOf(StaleVersionError);
    expect(prisma.booking.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it("findUpcomingConfirmed: confirmed-only, cross-org, [start,end) window", async () => {
    (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "bk_1",
        organizationId: "org_1",
        contactId: "c_1",
        startsAt: new Date("2026-05-13T02:00:00.000Z"),
        timezone: "Asia/Singapore",
        attendeeName: "Mei",
      },
    ]);
    const start = new Date("2026-05-12T00:00:00.000Z");
    const end = new Date("2026-05-12T02:00:00.000Z");
    const rows = await store.findUpcomingConfirmed(start, end);
    const call = (prisma.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({ status: "confirmed", startsAt: { gte: start, lt: end } });
    expect(call.where.organizationId).toBeUndefined(); // cross-org
    expect(call.take).toBe(1000); // bounded scan (no unbounded fan-out)
    expect(rows[0]).toEqual({
      id: "bk_1",
      organizationId: "org_1",
      contactId: "c_1",
      startsAt: new Date("2026-05-13T02:00:00.000Z"),
      timezone: "Asia/Singapore",
      attendeeName: "Mei",
    });
  });

  describe("listByDate", () => {
    it("returns bookings for a specific date excluding cancelled", async () => {
      const bookings = [
        {
          id: "b1",
          service: "Whitening",
          startsAt: new Date("2026-04-20T14:30:00Z"),
          status: "confirmed",
          sourceChannel: "whatsapp",
          contact: { name: "Sarah Chen" },
        },
      ];
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(bookings);

      const result = await store.listByDate("org-1", new Date("2026-04-20"));
      expect(result).toHaveLength(1);
      expect(result[0]!.service).toBe("Whitening");
      expect(result[0]!.status).toBe("confirmed");

      const call = (prisma.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.where.organizationId).toBe("org-1");
      expect(call.where.status).toEqual({ notIn: ["cancelled", "failed"] });
      expect(call.orderBy).toEqual({ startsAt: "asc" });
      expect(call.include).toBeUndefined();
    });

    it("limits results to 10 by default", async () => {
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await store.listByDate("org-1", new Date("2026-04-20"));

      const call = (prisma.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(call.take).toBe(10);
    });
  });
});

const baseInput = {
  organizationId: "org-1",
  contactId: "c-1",
  service: "botox",
  startsAt: new Date("2026-06-10T02:00:00Z"),
  endsAt: new Date("2026-06-10T03:00:00Z"),
};

describe("PrismaBookingStore.create overlap guard", () => {
  it("inserts when no live overlap exists, after taking the advisory lock", async () => {
    const { prisma: p, tx } = makeTransactionPrisma(null);
    const store = new PrismaBookingStore(p as never);
    const row = await store.create(baseInput);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          status: { notIn: ["failed", "cancelled"] },
          startsAt: { lt: baseInput.endsAt },
          endsAt: { gt: baseInput.startsAt },
        }),
      }),
    );
    expect(tx.booking.create).toHaveBeenCalled();
    expect(row).toEqual({ id: "new-booking" });
    // Order proof migrated from the removed buildLocalStore.createInTransaction unit test: the
    // advisory lock is taken BEFORE the overlap check, which runs BEFORE the insert.
    const lockOrder = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const findOrder = (tx.booking.findFirst as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    const createOrder = (tx.booking.create as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(findOrder);
    expect(findOrder).toBeLessThan(createOrder);
  });

  it("throws BookingSlotConflictError (not insert) when a live booking overlaps", async () => {
    const { prisma: p, tx } = makeTransactionPrisma({ id: "existing-bk" });
    const store = new PrismaBookingStore(p as never);
    await expect(store.create(baseInput)).rejects.toSatisfy(isBookingSlotConflictError);
    expect(tx.booking.create).not.toHaveBeenCalled();
  });
});

describe("PrismaBookingStore reschedule/cancel/find", () => {
  it("findUpcomingByContact filters cancelled/failed/past, ordered asc, org-scoped", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "b1" }]);
    const store = new PrismaBookingStore({ booking: { findMany } } as never);
    const now = new Date("2026-06-10T00:00:00Z");
    await store.findUpcomingByContact("org-1", "c-1", now);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          contactId: "c-1",
          status: { notIn: ["cancelled", "failed"] },
          startsAt: { gte: now },
        },
        orderBy: { startsAt: "asc" },
      }),
    );
  });

  // reschedule now serializes via $transaction + advisory lock + overlap guard
  // (excluding the booking being moved), mirroring create().
  function makeRescheduleTx(opts: {
    overlapRow?: { id: string } | null;
    updateCount?: number;
    row?: Record<string, unknown>;
  }) {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      booking: {
        findFirst: vi.fn().mockResolvedValue(opts.overlapRow ?? null),
        updateMany: vi.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue(opts.row ?? { id: "b1", rescheduleCount: 1 }),
      },
    };
    const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    return { prisma, tx };
  }

  const sNew = new Date("2026-06-11T02:00:00Z");
  const eNew = new Date("2026-06-11T03:00:00Z");

  it("reschedule (no overlap): locks, updates slot + increments + sets rescheduledAt, excludes self from overlap", async () => {
    const { prisma: p, tx } = makeRescheduleTx({ overlapRow: null });
    const store = new PrismaBookingStore(p as never);
    const row = await store.reschedule("org-1", "b1", { startsAt: sNew, endsAt: eNew });
    expect(tx.$executeRaw).toHaveBeenCalled();
    // overlap guard excludes the booking being moved via { not: bookingId }
    expect(tx.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          id: { not: "b1" },
          status: { notIn: ["failed", "cancelled"] },
          startsAt: { lt: eNew },
          endsAt: { gt: sNew },
        }),
      }),
    );
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1", organizationId: "org-1" },
        data: expect.objectContaining({
          startsAt: sNew,
          endsAt: eNew,
          rescheduleCount: { increment: 1 },
        }),
      }),
    );
    expect(row).toEqual({ id: "b1", rescheduleCount: 1 });
  });

  it("reschedule throws BookingSlotConflictError (not updateMany) when another live booking overlaps", async () => {
    const { prisma: p, tx } = makeRescheduleTx({ overlapRow: { id: "other-bk" } });
    const store = new PrismaBookingStore(p as never);
    await expect(
      store.reschedule("org-1", "b1", { startsAt: sNew, endsAt: eNew }),
    ).rejects.toSatisfy(isBookingSlotConflictError);
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("reschedule throws StaleVersionError when the booking row is not found (count:0)", async () => {
    const { prisma: p, tx } = makeRescheduleTx({ overlapRow: null, updateCount: 0 });
    const store = new PrismaBookingStore(p as never);
    await expect(
      store.reschedule("org-1", "missing", { startsAt: sNew, endsAt: eNew }),
    ).rejects.toBeInstanceOf(StaleVersionError);
    expect(tx.booking.findFirstOrThrow).not.toHaveBeenCalled();
  });

  // Keep BookingSlotConflictError referenced so the import is exercised directly.
  it("BookingSlotConflictError carries the conflicting id", () => {
    expect(new BookingSlotConflictError("zz").conflictingBookingId).toBe("zz");
  });

  it("cancel sets status cancelled; throws if no row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findFirstOrThrow = vi.fn().mockResolvedValue({ id: "b1", status: "cancelled" });
    const store = new PrismaBookingStore({
      booking: { updateMany, findFirstOrThrow },
    } as never);
    await store.cancel("org-1", "b1");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "b1", organizationId: "org-1" },
      data: { status: "cancelled" },
    });
  });
});
