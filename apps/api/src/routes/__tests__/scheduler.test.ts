import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { schedulerRoutes } from "../scheduler.js";

function createMockSchedulerService() {
  return {
    registerTrigger: vi.fn(async () => "trig-1"),
    cancelTrigger: vi.fn(async () => undefined),
    listPendingTriggers: vi.fn(async () => []),
    matchEvent: vi.fn(async () => []),
  };
}

describe("scheduler routes", () => {
  let app: ReturnType<typeof Fastify>;
  let scheduler: ReturnType<typeof createMockSchedulerService>;

  beforeEach(async () => {
    scheduler = createMockSchedulerService();
    app = Fastify();
    app.decorate("schedulerService", scheduler);
    await app.register(schedulerRoutes, { prefix: "/api/scheduler" });
    await app.ready();
  });

  describe("POST /api/scheduler/triggers", () => {
    it("creates a timer trigger", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/scheduler/triggers",
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

    it("returns 400 for invalid trigger type", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/scheduler/triggers",
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
    it("cancels a trigger", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/scheduler/triggers/trig-1",
      });

      expect(response.statusCode).toBe(204);
      expect(scheduler.cancelTrigger).toHaveBeenCalledWith("trig-1");
    });

    it("returns 404 when trigger not found", async () => {
      scheduler.cancelTrigger.mockRejectedValue(new Error("Trigger not found: trig-x"));

      const response = await app.inject({
        method: "DELETE",
        url: "/api/scheduler/triggers/trig-x",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/scheduler/triggers", () => {
    it("lists triggers with filters", async () => {
      scheduler.listPendingTriggers.mockResolvedValue([
        {
          id: "trig-1",
          organizationId: "org-1",
          type: "timer",
          status: "active",
          action: { type: "spawn_workflow", payload: {} },
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
        url: "/api/scheduler/triggers?organizationId=org-1&status=active",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.triggers).toHaveLength(1);
    });
  });
});
