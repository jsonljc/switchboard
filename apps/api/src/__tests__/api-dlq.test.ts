import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { dlqRoutes } from "../routes/dlq.js";

function buildDlqTestServer() {
  const app = Fastify({ logger: false });
  const mockPrisma = {
    failedMessage: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  app.decorate("prisma", mockPrisma as unknown as never);
  app.register(dlqRoutes, { prefix: "/api/dlq" });
  return { app, mockPrisma };
}

function makeFailedMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "fm_1",
    channel: "telegram",
    webhookPath: "/webhook/managed/abc",
    organizationId: "org_1",
    rawPayload: { message: { text: "hello" } },
    stage: "unknown",
    errorMessage: "Something went wrong",
    errorStack: null,
    retryCount: 0,
    maxRetries: 5,
    status: "pending",
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("DLQ Routes", () => {
  let app: FastifyInstance;
  let mockPrisma: ReturnType<typeof buildDlqTestServer>["mockPrisma"];

  beforeEach(async () => {
    const ctx = buildDlqTestServer();
    app = ctx.app;
    mockPrisma = ctx.mockPrisma;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/dlq/messages", () => {
    it("returns pending messages by default", async () => {
      const msgs = [makeFailedMessage(), makeFailedMessage({ id: "fm_2" })];
      mockPrisma.failedMessage.findMany.mockResolvedValue(msgs);

      const res = await app.inject({ method: "GET", url: "/api/dlq/messages" });
      expect(res.statusCode).toBe(200);
      expect(res.json().messages).toHaveLength(2);
      expect(mockPrisma.failedMessage.findMany).toHaveBeenCalledWith({
        where: { status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    });

    it("filters by status query param", async () => {
      mockPrisma.failedMessage.findMany.mockResolvedValue([]);

      const res = await app.inject({ method: "GET", url: "/api/dlq/messages?status=exhausted" });
      expect(res.statusCode).toBe(200);
      expect(mockPrisma.failedMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "exhausted" } }),
      );
    });

    it("respects limit query param capped at 200", async () => {
      mockPrisma.failedMessage.findMany.mockResolvedValue([]);

      const res = await app.inject({ method: "GET", url: "/api/dlq/messages?limit=999" });
      expect(res.statusCode).toBe(200);
      expect(mockPrisma.failedMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it("returns 400 for invalid status", async () => {
      const res = await app.inject({ method: "GET", url: "/api/dlq/messages?status=invalid" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid status");
    });
  });

  describe("GET /api/dlq/stats", () => {
    it("returns aggregate counts by status", async () => {
      mockPrisma.failedMessage.count
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(1) // exhausted
        .mockResolvedValueOnce(7); // resolved

      const res = await app.inject({ method: "GET", url: "/api/dlq/stats" });
      expect(res.statusCode).toBe(200);
      const stats = res.json().stats;
      expect(stats.pending).toBe(3);
      expect(stats.exhausted).toBe(1);
      expect(stats.resolved).toBe(7);
      expect(stats.total).toBe(11);
    });
  });

  describe("POST /api/dlq/messages/:id/resolve", () => {
    it("marks a pending message as resolved", async () => {
      const msg = makeFailedMessage();
      mockPrisma.failedMessage.findUnique.mockResolvedValue(msg);
      mockPrisma.failedMessage.update.mockResolvedValue({
        ...msg,
        status: "resolved",
        resolvedAt: new Date(),
      });

      const res = await app.inject({ method: "POST", url: "/api/dlq/messages/fm_1/resolve" });
      expect(res.statusCode).toBe(200);
      expect(res.json().message.status).toBe("resolved");
      expect(mockPrisma.failedMessage.update).toHaveBeenCalledWith({
        where: { id: "fm_1" },
        data: { status: "resolved", resolvedAt: expect.any(Date) },
      });
    });

    it("returns 404 for nonexistent message", async () => {
      mockPrisma.failedMessage.findUnique.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/dlq/messages/nope/resolve" });
      expect(res.statusCode).toBe(404);
    });

    it("returns existing message if already resolved (idempotent)", async () => {
      const msg = makeFailedMessage({ status: "resolved" });
      mockPrisma.failedMessage.findUnique.mockResolvedValue(msg);

      const res = await app.inject({ method: "POST", url: "/api/dlq/messages/fm_1/resolve" });
      expect(res.statusCode).toBe(200);
      expect(mockPrisma.failedMessage.update).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/dlq/messages/:id/retry", () => {
    it("increments retryCount on a pending message", async () => {
      const msg = makeFailedMessage({ retryCount: 1, maxRetries: 5 });
      mockPrisma.failedMessage.findUnique.mockResolvedValue(msg);
      mockPrisma.failedMessage.update.mockResolvedValue({ ...msg, retryCount: 2 });

      const res = await app.inject({
        method: "POST",
        url: "/api/dlq/messages/fm_1/retry",
        payload: { errorMessage: "Still failing" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().exhausted).toBe(false);
      expect(mockPrisma.failedMessage.update).toHaveBeenCalledWith({
        where: { id: "fm_1" },
        data: {
          retryCount: 2,
          errorMessage: "Still failing",
          status: "pending",
        },
      });
    });

    it("transitions to exhausted when retryCount reaches maxRetries", async () => {
      const msg = makeFailedMessage({ retryCount: 4, maxRetries: 5 });
      mockPrisma.failedMessage.findUnique.mockResolvedValue(msg);
      mockPrisma.failedMessage.update.mockResolvedValue({
        ...msg,
        retryCount: 5,
        status: "exhausted",
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/dlq/messages/fm_1/retry",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().exhausted).toBe(true);
      expect(mockPrisma.failedMessage.update).toHaveBeenCalledWith({
        where: { id: "fm_1" },
        data: expect.objectContaining({ status: "exhausted", retryCount: 5 }),
      });
    });

    it("returns 404 for nonexistent message", async () => {
      mockPrisma.failedMessage.findUnique.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/dlq/messages/nope/retry" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 409 if message is not pending", async () => {
      const msg = makeFailedMessage({ status: "exhausted" });
      mockPrisma.failedMessage.findUnique.mockResolvedValue(msg);

      const res = await app.inject({ method: "POST", url: "/api/dlq/messages/fm_1/retry" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("exhausted");
    });
  });

  describe("POST /api/dlq/sweep", () => {
    it("transitions over-limit pending messages to exhausted", async () => {
      mockPrisma.failedMessage.findMany.mockResolvedValue([
        { id: "fm_1", retryCount: 5, maxRetries: 5 },
        { id: "fm_2", retryCount: 2, maxRetries: 5 },
        { id: "fm_3", retryCount: 10, maxRetries: 3 },
      ]);
      mockPrisma.failedMessage.updateMany.mockResolvedValue({ count: 2 });

      const res = await app.inject({ method: "POST", url: "/api/dlq/sweep" });
      expect(res.statusCode).toBe(200);
      expect(res.json().swept).toBe(2);
      expect(mockPrisma.failedMessage.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["fm_1", "fm_3"] } },
        data: { status: "exhausted" },
      });
    });

    it("returns 0 when no messages are over limit", async () => {
      mockPrisma.failedMessage.findMany.mockResolvedValue([
        { id: "fm_1", retryCount: 1, maxRetries: 5 },
      ]);

      const res = await app.inject({ method: "POST", url: "/api/dlq/sweep" });
      expect(res.statusCode).toBe(200);
      expect(res.json().swept).toBe(0);
      expect(mockPrisma.failedMessage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("database unavailable", () => {
    it("returns 503 when prisma is null", async () => {
      const nullApp = Fastify({ logger: false });
      nullApp.decorate("prisma", null);
      await nullApp.register(dlqRoutes, { prefix: "/api/dlq" });
      await nullApp.ready();

      const endpoints = [
        { method: "GET" as const, url: "/api/dlq/messages" },
        { method: "GET" as const, url: "/api/dlq/stats" },
        { method: "POST" as const, url: "/api/dlq/messages/fm_1/resolve" },
        { method: "POST" as const, url: "/api/dlq/messages/fm_1/retry" },
        { method: "POST" as const, url: "/api/dlq/sweep" },
      ];

      for (const ep of endpoints) {
        const res = await nullApp.inject(ep);
        expect(res.statusCode).toBe(503);
      }

      await nullApp.close();
    });
  });

  describe("Cross-org access control", () => {
    let scopedApp: FastifyInstance;
    let scopedMockPrisma: ReturnType<typeof buildDlqTestServer>["mockPrisma"];

    beforeEach(async () => {
      scopedApp = Fastify({ logger: false });
      scopedMockPrisma = {
        failedMessage: {
          findMany: vi.fn(),
          findUnique: vi.fn(),
          count: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
        },
      };
      scopedApp.decorate("prisma", scopedMockPrisma as unknown as never);
      scopedApp.decorateRequest("organizationIdFromAuth", undefined);
      scopedApp.addHook("onRequest", async (request) => {
        request.organizationIdFromAuth = "org_A";
      });
      await scopedApp.register(dlqRoutes, { prefix: "/api/dlq" });
      await scopedApp.ready();
    });

    afterEach(async () => {
      await scopedApp.close();
    });

    it("GET messages filters by org", async () => {
      scopedMockPrisma.failedMessage.findMany.mockResolvedValue([]);

      await scopedApp.inject({ method: "GET", url: "/api/dlq/messages" });
      expect(scopedMockPrisma.failedMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: "org_A" }),
        }),
      );
    });

    it("GET stats filters by org", async () => {
      scopedMockPrisma.failedMessage.count.mockResolvedValue(0);

      await scopedApp.inject({ method: "GET", url: "/api/dlq/stats" });
      for (const call of scopedMockPrisma.failedMessage.count.mock.calls) {
        expect(call[0].where).toHaveProperty("organizationId", "org_A");
      }
    });

    it("POST resolve returns 403 for cross-org message", async () => {
      scopedMockPrisma.failedMessage.findUnique.mockResolvedValue(
        makeFailedMessage({ organizationId: "org_B" }),
      );

      const res = await scopedApp.inject({
        method: "POST",
        url: "/api/dlq/messages/fm_1/resolve",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });

    it("POST retry returns 403 for cross-org message", async () => {
      scopedMockPrisma.failedMessage.findUnique.mockResolvedValue(
        makeFailedMessage({ organizationId: "org_B" }),
      );

      const res = await scopedApp.inject({
        method: "POST",
        url: "/api/dlq/messages/fm_1/retry",
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("organization mismatch");
    });

    it("POST sweep filters by org", async () => {
      scopedMockPrisma.failedMessage.findMany.mockResolvedValue([]);

      await scopedApp.inject({ method: "POST", url: "/api/dlq/sweep" });
      expect(scopedMockPrisma.failedMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: "org_A" }),
        }),
      );
    });
  });
});
