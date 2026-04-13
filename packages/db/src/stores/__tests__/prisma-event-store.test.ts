import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaEventStore } from "../prisma-event-store.js";

function createMockPrisma() {
  return {
    agentEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe("PrismaEventStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaEventStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaEventStore(prisma as never);
  });

  it("emits an event", async () => {
    prisma.agentEvent.create.mockResolvedValue({ id: "evt-1" });
    await store.emit({
      organizationId: "org-1",
      deploymentId: "dep-1",
      eventType: "conversation_end",
      payload: { messages: [] },
    });
    expect(prisma.agentEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        deploymentId: "dep-1",
        eventType: "conversation_end",
        status: "pending",
      }),
    });
  });

  it("polls pending events ordered by createdAt", async () => {
    prisma.agentEvent.findMany.mockResolvedValue([]);
    await store.pollPending(5);
    expect(prisma.agentEvent.findMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
  });

  it("marks event as processing", async () => {
    prisma.agentEvent.update.mockResolvedValue({ id: "evt-1" });
    await store.markProcessing("evt-1");
    expect(prisma.agentEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: { status: "processing" },
    });
  });

  it("marks event as done", async () => {
    prisma.agentEvent.update.mockResolvedValue({ id: "evt-1" });
    await store.markDone("evt-1");
    expect(prisma.agentEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: expect.objectContaining({ status: "done" }),
    });
  });

  it("marks event as failed and increments retryCount", async () => {
    prisma.agentEvent.update.mockResolvedValue({ id: "evt-1" });
    await store.markFailed("evt-1");
    expect(prisma.agentEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: expect.objectContaining({
        status: "failed",
        retryCount: { increment: 1 },
      }),
    });
  });

  it("marks dead letters for events with retryCount >= maxRetries", async () => {
    prisma.agentEvent.updateMany.mockResolvedValue({ count: 2 });
    const count = await store.markDeadLetters(3);
    expect(count).toBe(2);
    expect(prisma.agentEvent.updateMany).toHaveBeenCalledWith({
      where: { status: "failed", retryCount: { gte: 3 } },
      data: { status: "dead_letter" },
    });
  });

  it("cleans up old done events", async () => {
    const cutoff = new Date();
    prisma.agentEvent.deleteMany.mockResolvedValue({ count: 5 });
    const count = await store.cleanupDone(cutoff);
    expect(count).toBe(5);
    expect(prisma.agentEvent.deleteMany).toHaveBeenCalledWith({
      where: { status: "done", createdAt: { lt: cutoff } },
    });
  });

  it("resets stale processing events", async () => {
    const cutoff = new Date();
    prisma.agentEvent.updateMany.mockResolvedValue({ count: 1 });
    const count = await store.resetStaleProcessing(cutoff);
    expect(count).toBe(1);
    expect(prisma.agentEvent.updateMany).toHaveBeenCalledWith({
      where: { status: "processing", createdAt: { lt: cutoff } },
      data: { status: "failed", retryCount: { increment: 1 } },
    });
  });
});
