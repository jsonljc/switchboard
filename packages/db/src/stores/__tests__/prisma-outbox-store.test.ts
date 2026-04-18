import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOutboxStore } from "../prisma-outbox-store.js";

function makePrisma() {
  return {
    outboxEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaOutboxStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaOutboxStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaOutboxStore(prisma as never);
  });

  it("writes a pending outbox event", async () => {
    const payload = { type: "booked", contactId: "ct_1", organizationId: "org_1", value: 100 };
    (prisma.outboxEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ob_1",
      eventId: "evt_1",
      type: "booked",
      payload,
      status: "pending",
      attempts: 0,
    });

    const result = await store.write("evt_1", "booked", payload);
    expect(result.status).toBe("pending");
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventId: "evt_1", type: "booked", status: "pending" }),
    });
  });

  it("fetches pending events ordered by createdAt", async () => {
    (prisma.outboxEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ob_1", eventId: "evt_1", status: "pending" },
    ]);

    const results = await store.fetchPending(10);
    expect(results).toHaveLength(1);
    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
  });

  it("marks an event as published", async () => {
    (prisma.outboxEvent.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ob_1",
      status: "published",
    });

    await store.markPublished("ob_1");
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "ob_1" },
      data: { status: "published" },
    });
  });

  it("increments attempts and marks failed after 10", async () => {
    (prisma.outboxEvent.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ob_1",
      status: "failed",
      attempts: 10,
    });

    await store.recordFailure("ob_1", 10);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "ob_1" },
      data: {
        attempts: 10,
        lastAttemptAt: expect.any(Date),
        status: "failed",
      },
    });
  });

  it("keeps status as pending when attempts < 10", async () => {
    (prisma.outboxEvent.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ob_1",
      status: "pending",
      attempts: 3,
    });

    await store.recordFailure("ob_1", 3);
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "ob_1" },
      data: {
        attempts: 3,
        lastAttemptAt: expect.any(Date),
        status: "pending",
      },
    });
  });
});
