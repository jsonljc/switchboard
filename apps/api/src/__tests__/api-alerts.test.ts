import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { alertsRoutes } from "../routes/alerts.js";

describe("Alerts API", () => {
  let app: FastifyInstance;

  const mockAlertRule = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const mockAlertHistory = {
    findMany: vi.fn(),
  };

  const mockPrisma = {
    alertRule: mockAlertRule,
    alertHistory: mockAlertHistory,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("prisma", mockPrisma as unknown as never);
    app.decorate("storageContext", {
      cartridges: { get: vi.fn(), list: vi.fn() },
    } as unknown as never);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(alertsRoutes, { prefix: "/api/alerts" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/alerts", () => {
    it("returns alert rules for the organization", async () => {
      const rules = [
        { id: "rule_1", name: "High Spend", organizationId: "org_test" },
        { id: "rule_2", name: "Low ROAS", organizationId: "org_test" },
      ];
      mockAlertRule.findMany.mockResolvedValue(rules);

      const res = await app.inject({
        method: "GET",
        url: "/api/alerts",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rules).toHaveLength(2);
      expect(mockAlertRule.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org_test" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns 503 when prisma is unavailable", async () => {
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("prisma", null);
      app.decorate("storageContext", { cartridges: { get: vi.fn() } } as unknown as never);
      app.decorateRequest("organizationIdFromAuth", undefined);
      await app.register(alertsRoutes, { prefix: "/api/alerts" });

      const res = await app.inject({
        method: "GET",
        url: "/api/alerts",
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("unavailable");
    });
  });

  describe("POST /api/alerts", () => {
    it("creates an alert rule", async () => {
      const created = {
        id: "rule_new",
        name: "Test Alert",
        metricPath: "primaryKPI.current",
        operator: "gt",
        threshold: 100,
        organizationId: "org_test",
      };
      mockAlertRule.create.mockResolvedValue(created);

      const res = await app.inject({
        method: "POST",
        url: "/api/alerts",
        payload: {
          name: "Test Alert",
          metricPath: "primaryKPI.current",
          operator: "gt",
          threshold: 100,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().rule.name).toBe("Test Alert");
    });

    it("returns 400 on validation failure", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/alerts",
        payload: {
          name: "", // too short
          metricPath: "invalid.path",
          operator: "gt",
          threshold: 100,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Validation failed");
    });
  });

  describe("PUT /api/alerts/:id", () => {
    it("updates an alert rule", async () => {
      mockAlertRule.findFirst.mockResolvedValue({ id: "rule_1", organizationId: "org_test" });
      mockAlertRule.update.mockResolvedValue({
        id: "rule_1",
        name: "Updated Alert",
        threshold: 200,
      });

      const res = await app.inject({
        method: "PUT",
        url: "/api/alerts/rule_1",
        payload: { name: "Updated Alert", threshold: 200 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().rule.name).toBe("Updated Alert");
    });

    it("returns 404 if rule not found", async () => {
      mockAlertRule.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: "PUT",
        url: "/api/alerts/nonexistent",
        payload: { name: "New Name" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not found");
    });
  });

  describe("DELETE /api/alerts/:id", () => {
    it("deletes an alert rule", async () => {
      mockAlertRule.findFirst.mockResolvedValue({ id: "rule_1", organizationId: "org_test" });
      mockAlertRule.delete.mockResolvedValue({});

      const res = await app.inject({
        method: "DELETE",
        url: "/api/alerts/rule_1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(true);
    });

    it("returns 404 if rule not found", async () => {
      mockAlertRule.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/alerts/nonexistent",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/alerts/:id/history", () => {
    it("returns alert history", async () => {
      mockAlertRule.findFirst.mockResolvedValue({ id: "rule_1", organizationId: "org_test" });
      mockAlertHistory.findMany.mockResolvedValue([
        { id: "hist_1", alertRuleId: "rule_1", triggeredAt: "2024-01-01" },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/alerts/rule_1/history",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().history).toHaveLength(1);
    });

    it("returns 404 if rule not found", async () => {
      mockAlertRule.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/alerts/nonexistent/history",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/alerts/:id/snooze", () => {
    it("snoozes an alert rule", async () => {
      mockAlertRule.findFirst.mockResolvedValue({ id: "rule_1", organizationId: "org_test" });
      mockAlertRule.update.mockImplementation(({ data }: { data: { snoozedUntil: string } }) => ({
        id: "rule_1",
        snoozedUntil: data.snoozedUntil,
      }));

      const res = await app.inject({
        method: "POST",
        url: "/api/alerts/rule_1/snooze",
        payload: { durationMinutes: 120 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rule.snoozedUntil).toBeDefined();
    });
  });
});
