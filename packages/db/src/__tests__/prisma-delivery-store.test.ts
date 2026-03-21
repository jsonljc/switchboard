import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaDeliveryStore } from "../stores/prisma-delivery-store.js";

function createMockPrisma() {
  return {
    agentDeliveryAttempt: {
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe("PrismaDeliveryStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaDeliveryStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaDeliveryStore(
      prisma as unknown as ConstructorParameters<typeof PrismaDeliveryStore>[0],
    );
  });

  it("records a delivery attempt via upsert", async () => {
    await store.record({
      eventId: "evt-1",
      destinationId: "agent-1",
      status: "pending",
      attempts: 0,
    });

    expect(prisma.agentDeliveryAttempt.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_destinationId: { eventId: "evt-1", destinationId: "agent-1" },
        },
        create: expect.objectContaining({
          eventId: "evt-1",
          destinationId: "agent-1",
          status: "pending",
        }),
        update: expect.objectContaining({ status: "pending" }),
      }),
    );
  });

  it("updates a delivery attempt", async () => {
    await store.update("evt-1", "agent-1", {
      status: "succeeded",
      attempts: 1,
    });

    expect(prisma.agentDeliveryAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId_destinationId: { eventId: "evt-1", destinationId: "agent-1" },
        },
        data: expect.objectContaining({ status: "succeeded", attempts: 1 }),
      }),
    );
  });

  it("lists retryable attempts (failed or retrying)", async () => {
    const mockAttempts = [
      {
        id: "1",
        eventId: "evt-1",
        destinationId: "a-1",
        status: "failed",
        attempts: 1,
        lastAttemptAt: null,
        error: "boom",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    prisma.agentDeliveryAttempt.findMany.mockResolvedValue(mockAttempts);

    const results = await store.listRetryable();
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe("failed");
    expect(prisma.agentDeliveryAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["failed", "retrying"] } },
      }),
    );
  });

  it("sweeps dead letters by updating attempts exceeding maxRetries", async () => {
    prisma.agentDeliveryAttempt.updateMany.mockResolvedValue({ count: 2 });

    const count = await store.sweepDeadLetters(3);
    expect(count).toBe(2);
    expect(prisma.agentDeliveryAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ["failed", "retrying"] },
          attempts: { gte: 3 },
        },
        data: { status: "dead_letter" },
      }),
    );
  });

  it("getByEvent returns attempts for an event", async () => {
    prisma.agentDeliveryAttempt.findMany.mockResolvedValue([]);
    const results = await store.getByEvent("evt-1");
    expect(results).toEqual([]);
    expect(prisma.agentDeliveryAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: "evt-1" } }),
    );
  });
});
