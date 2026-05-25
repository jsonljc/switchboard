import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaOutboxStore } from "../prisma-outbox-store.js";

function makePrisma() {
  return {
    outboxEvent: {
      create: vi.fn(),
      createMany: vi.fn(),
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

  describe("write — tx threading", () => {
    it("uses tx client instead of this.prisma when tx is provided", async () => {
      const txClient = {
        outboxEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      const payload = { type: "purchased", contactId: "ct_1" };
      await store.write("evt_tx", "purchased", payload, txClient as never);
      expect(txClient.outboxEvent.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ eventId: "evt_tx", type: "purchased", status: "pending" }),
        ],
        skipDuplicates: true,
      });
      expect(prisma.outboxEvent.createMany).not.toHaveBeenCalled();
    });

    it("falls back to this.prisma when no tx is provided", async () => {
      const payload = { type: "purchased", contactId: "ct_1" };
      (prisma.outboxEvent.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      await store.write("evt_1", "purchased", payload);
      expect(prisma.outboxEvent.createMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("write — idempotency (ignore-on-conflict, #697)", () => {
    it("inserts via createMany with skipDuplicates so a duplicate eventId is a no-op", async () => {
      (prisma.outboxEvent.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
      const payload = { type: "purchased", contactId: "ct_1", organizationId: "org_1", value: 100 };

      await store.write("evt_rev_dup", "purchased", payload);

      // Idempotent insert: ON CONFLICT DO NOTHING at the SQL level (skipDuplicates),
      // NOT a bare create() that throws on the @unique eventId constraint.
      expect(prisma.outboxEvent.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ eventId: "evt_rev_dup", type: "purchased", status: "pending" }),
        ],
        skipDuplicates: true,
      });
      expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
    });

    it("does not throw when the eventId already exists (skipDuplicates returns count 0)", async () => {
      // Models a re-record of the same external payment: the row already exists,
      // so the unique-constrained insert is skipped instead of throwing P2002.
      (prisma.outboxEvent.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

      await expect(
        store.write("evt_rev_existing", "purchased", { value: 1 }),
      ).resolves.not.toThrow();
    });
  });

  it("writes a pending outbox event", async () => {
    const payload = { type: "booked", contactId: "ct_1", organizationId: "org_1", value: 100 };
    (prisma.outboxEvent.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    await store.write("evt_1", "booked", payload);
    expect(prisma.outboxEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ eventId: "evt_1", type: "booked", status: "pending" })],
      skipDuplicates: true,
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
