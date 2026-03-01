import { describe, it, expect, beforeEach, vi } from "vitest";
import { FailedMessageStore } from "../dlq/failed-message-store.js";

function makeMockPrisma() {
  return {
    failedMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  } as any;
}

describe("FailedMessageStore", () => {
  let prisma: ReturnType<typeof makeMockPrisma>;
  let store: FailedMessageStore;

  beforeEach(() => {
    prisma = makeMockPrisma();
    store = new FailedMessageStore(prisma);
  });

  describe("record", () => {
    it("creates a failed message with defaults", async () => {
      prisma.failedMessage.create.mockResolvedValue({});

      await store.record({
        channel: "telegram",
        rawPayload: { text: "hello" },
        stage: "propose",
        errorMessage: "Something failed",
      });

      expect(prisma.failedMessage.create).toHaveBeenCalledWith({
        data: {
          channel: "telegram",
          webhookPath: null,
          organizationId: null,
          rawPayload: { text: "hello" },
          stage: "propose",
          errorMessage: "Something failed",
          errorStack: null,
          retryCount: 0,
          maxRetries: 5,
          status: "pending",
        },
      });
    });

    it("passes optional fields when provided", async () => {
      prisma.failedMessage.create.mockResolvedValue({});

      await store.record({
        channel: "slack",
        webhookPath: "/webhook/managed/abc",
        organizationId: "org_1",
        rawPayload: {},
        stage: "execute",
        errorMessage: "Timeout",
        errorStack: "Error: Timeout\n  at ...",
      });

      expect(prisma.failedMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          webhookPath: "/webhook/managed/abc",
          organizationId: "org_1",
          errorStack: "Error: Timeout\n  at ...",
        }),
      });
    });
  });

  describe("listPending", () => {
    it("returns pending messages by default", async () => {
      const msgs = [{ id: "1" }, { id: "2" }];
      prisma.failedMessage.findMany.mockResolvedValue(msgs);

      const result = await store.listPending();

      expect(result).toEqual(msgs);
      expect(prisma.failedMessage.findMany).toHaveBeenCalledWith({
        where: { status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    });

    it("accepts custom limit and status", async () => {
      prisma.failedMessage.findMany.mockResolvedValue([]);

      await store.listPending(10, "exhausted");

      expect(prisma.failedMessage.findMany).toHaveBeenCalledWith({
        where: { status: "exhausted" },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    });
  });

  describe("markResolved", () => {
    it("updates status to resolved with timestamp", async () => {
      prisma.failedMessage.update.mockResolvedValue({});

      await store.markResolved("fm_1");

      expect(prisma.failedMessage.update).toHaveBeenCalledWith({
        where: { id: "fm_1" },
        data: { status: "resolved", resolvedAt: expect.any(Date) },
      });
    });
  });

  describe("incrementRetry", () => {
    it("increments retryCount and keeps pending when below maxRetries", async () => {
      prisma.failedMessage.findUnique.mockResolvedValue({
        id: "fm_1",
        retryCount: 1,
        maxRetries: 5,
        status: "pending",
      });
      prisma.failedMessage.update.mockResolvedValue({});

      const result = await store.incrementRetry("fm_1", "Still failing");

      expect(result.exhausted).toBe(false);
      expect(prisma.failedMessage.update).toHaveBeenCalledWith({
        where: { id: "fm_1" },
        data: {
          retryCount: 2,
          errorMessage: "Still failing",
          status: "pending",
        },
      });
    });

    it("transitions to exhausted when retryCount reaches maxRetries", async () => {
      prisma.failedMessage.findUnique.mockResolvedValue({
        id: "fm_1",
        retryCount: 4,
        maxRetries: 5,
        status: "pending",
      });
      prisma.failedMessage.update.mockResolvedValue({});

      const result = await store.incrementRetry("fm_1", "Final failure");

      expect(result.exhausted).toBe(true);
      expect(prisma.failedMessage.update).toHaveBeenCalledWith({
        where: { id: "fm_1" },
        data: {
          retryCount: 5,
          errorMessage: "Final failure",
          status: "exhausted",
        },
      });
    });

    it("returns exhausted=true for nonexistent message", async () => {
      prisma.failedMessage.findUnique.mockResolvedValue(null);

      const result = await store.incrementRetry("nope", "error");

      expect(result.exhausted).toBe(true);
      expect(prisma.failedMessage.update).not.toHaveBeenCalled();
    });

    it("returns exhausted=true for non-pending message", async () => {
      prisma.failedMessage.findUnique.mockResolvedValue({
        id: "fm_1",
        retryCount: 3,
        maxRetries: 5,
        status: "exhausted",
      });

      const result = await store.incrementRetry("fm_1", "error");

      expect(result.exhausted).toBe(true);
      expect(prisma.failedMessage.update).not.toHaveBeenCalled();
    });
  });

  describe("sweepExhausted", () => {
    it("transitions over-limit pending messages to exhausted", async () => {
      prisma.failedMessage.findMany.mockResolvedValue([
        { id: "fm_1", retryCount: 5, maxRetries: 5 },
        { id: "fm_2", retryCount: 2, maxRetries: 5 },
        { id: "fm_3", retryCount: 10, maxRetries: 3 },
      ]);
      prisma.failedMessage.updateMany.mockResolvedValue({ count: 2 });

      const swept = await store.sweepExhausted();

      expect(swept).toBe(2);
      expect(prisma.failedMessage.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["fm_1", "fm_3"] } },
        data: { status: "exhausted" },
      });
    });

    it("returns 0 when no messages are over limit", async () => {
      prisma.failedMessage.findMany.mockResolvedValue([
        { id: "fm_1", retryCount: 1, maxRetries: 5 },
      ]);

      const swept = await store.sweepExhausted();

      expect(swept).toBe(0);
      expect(prisma.failedMessage.updateMany).not.toHaveBeenCalled();
    });

    it("returns 0 when no pending messages exist", async () => {
      prisma.failedMessage.findMany.mockResolvedValue([]);

      const swept = await store.sweepExhausted();

      expect(swept).toBe(0);
      expect(prisma.failedMessage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("returns aggregate counts by status", async () => {
      prisma.failedMessage.count
        .mockResolvedValueOnce(5)   // pending
        .mockResolvedValueOnce(2)   // exhausted
        .mockResolvedValueOnce(10); // resolved

      const stats = await store.getStats();

      expect(stats).toEqual({
        pending: 5,
        exhausted: 2,
        resolved: 10,
        total: 17,
      });
    });

    it("returns zeros when no messages exist", async () => {
      prisma.failedMessage.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const stats = await store.getStats();

      expect(stats).toEqual({
        pending: 0,
        exhausted: 0,
        resolved: 0,
        total: 0,
      });
    });
  });
});
