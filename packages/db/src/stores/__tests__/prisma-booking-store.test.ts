import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaBookingStore } from "../prisma-booking-store.js";

function makePrisma() {
  return {
    booking: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
}

describe("PrismaBookingStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaBookingStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaBookingStore(prisma as never);
  });

  it("creates a booking with pending_confirmation status", async () => {
    const input = {
      organizationId: "org_1",
      contactId: "ct_1",
      service: "consultation",
      startsAt: new Date("2026-04-20T10:00:00Z"),
      endsAt: new Date("2026-04-20T10:30:00Z"),
      timezone: "Asia/Singapore",
      createdByType: "agent" as const,
    };
    (prisma.booking.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      status: "pending_confirmation",
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await store.create(input);
    expect(result.status).toBe("pending_confirmation");
    expect(prisma.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ service: "consultation", status: "pending_confirmation" }),
    });
  });

  it("confirms a booking by id", async () => {
    (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      status: "confirmed",
      calendarEventId: "gcal_abc",
    });

    const result = await store.confirm("bk_1", "gcal_abc");
    expect(result.status).toBe("confirmed");
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "bk_1" },
      data: { status: "confirmed", calendarEventId: "gcal_abc" },
    });
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

  it("marks a booking as failed", async () => {
    (prisma.booking.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "bk_1",
      status: "failed",
    });

    const result = await store.markFailed("bk_1");
    expect(result.status).toBe("failed");
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: "bk_1" },
      data: { status: "failed" },
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
      expect(result[0].service).toBe("Whitening");
      expect(result[0].status).toBe("confirmed");

      const call = (prisma.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.where.organizationId).toBe("org-1");
      expect(call.where.status).toEqual({ notIn: ["cancelled", "failed"] });
      expect(call.orderBy).toEqual({ startsAt: "asc" });
      expect(call.include.contact).toEqual({ select: { name: true } });
    });

    it("limits results to 10 by default", async () => {
      (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await store.listByDate("org-1", new Date("2026-04-20"));

      const call = (prisma.booking.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.take).toBe(10);
    });
  });
});
