import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { schedulerRoutes } from "../scheduler.js";

import type { ScheduledTrigger } from "@switchboard/schemas";

function createMockSchedulerService() {
  return {
    registerTrigger: vi.fn(async () => "trig-1"),
    cancelTrigger: vi.fn(async () => undefined),
    listPendingTriggers: vi.fn(async (): Promise<ScheduledTrigger[]> => []),
    matchEvent: vi.fn(async (): Promise<ScheduledTrigger[]> => []),
  };
}

describe("scheduler routes", () => {
  let app: ReturnType<typeof Fastify>;
  let scheduler: ReturnType<typeof createMockSchedulerService>;

  beforeEach(async () => {
    scheduler = createMockSchedulerService();
    app = Fastify();
    app.decorate("schedulerService", scheduler);

    // Simulate auth middleware setting organizationIdFromAuth from header
    app.addHook("onRequest", async (request: import("fastify").FastifyRequest) => {
      const orgId = request.headers["x-org-id"] as string | undefined;
      if (orgId) {
        request.organizationIdFromAuth = orgId;
      }
    });

    await app.register(schedulerRoutes, { prefix: "/api/scheduler" });
    await app.ready();
  });

  describe("POST /api/scheduler/triggers", () => {
    it("returns 401 without org context", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/scheduler/triggers",
        payload: {
          organizationId: "org-1",
          type: "timer",
          fireAt: "2026-04-01T10:00:00Z",
          action: { type: "spawn_workflow", payload: {} },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("creates a timer trigger", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/scheduler/triggers",
        headers: { "x-org-id": "org-1" },
        payload: {
          organizationId: "org-1",
          type: "timer",
          fireAt: "2026-04-01T10:00:00Z",
          cronExpression: null,
          eventPattern: null,
          action: { type: "spawn_workflow", payload: {} },
          sourceWorkflowId: null,
          expiresAt: null,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.triggerId).toBe("trig-1");
    });

    it("returns 403 when creating trigger for another org", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/scheduler/triggers",
        headers: { "x-org-id": "org-1" },
        payload: {
          organizationId: "org-other",
          type: "timer",
          fireAt: "2026-04-01T10:00:00Z",
          action: { type: "spawn_workflow", payload: {} },
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("returns 400 for invalid trigger type", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/scheduler/triggers",
        headers: { "x-org-id": "org-1" },
        payload: {
          organizationId: "org-1",
          type: "invalid",
          action: { type: "spawn_workflow", payload: {} },
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /api/scheduler/triggers/:id", () => {
    it("returns 401 without org context", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/scheduler/triggers/trig-1",
      });

      expect(response.statusCode).toBe(401);
    });

    it("cancels a trigger belonging to the org", async () => {
      scheduler.listPendingTriggers.mockResolvedValue([
        {
          id: "trig-1",
          organizationId: "org-1",
          type: "timer" as const,
          status: "active" as const,
          action: { type: "spawn_workflow" as const, payload: {} },
          fireAt: new Date(),
          cronExpression: null,
          eventPattern: null,
          sourceWorkflowId: null,
          createdAt: new Date(),
          expiresAt: null,
        },
      ]);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/scheduler/triggers/trig-1",
        headers: { "x-org-id": "org-1" },
      });

      expect(response.statusCode).toBe(204);
      expect(scheduler.cancelTrigger).toHaveBeenCalledWith("trig-1");
    });

    it("returns 404 when trigger not in org", async () => {
      scheduler.listPendingTriggers.mockResolvedValue([]);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/scheduler/triggers/trig-1",
        headers: { "x-org-id": "org-other" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/scheduler/triggers", () => {
    it("returns 401 without org context", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/scheduler/triggers",
      });

      expect(response.statusCode).toBe(401);
    });

    it("lists triggers scoped to authenticated org", async () => {
      scheduler.listPendingTriggers.mockResolvedValue([
        {
          id: "trig-1",
          organizationId: "org-1",
          type: "timer" as const,
          status: "active" as const,
          action: { type: "spawn_workflow" as const, payload: {} },
          fireAt: new Date(),
          cronExpression: null,
          eventPattern: null,
          sourceWorkflowId: null,
          createdAt: new Date(),
          expiresAt: null,
        },
      ]);

      const response = await app.inject({
        method: "GET",
        url: "/api/scheduler/triggers",
        headers: { "x-org-id": "org-1" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.triggers).toHaveLength(1);
      // Verify org scoping was enforced
      expect(scheduler.listPendingTriggers).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
      );
    });
  });
});
