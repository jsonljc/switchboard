import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { scheduledReportsRoutes } from "../routes/scheduled-reports.js";

describe("Scheduled Reports API", () => {
  let app: FastifyInstance;

  const mockScheduledReport = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const mockPrisma = {
    scheduledReport: mockScheduledReport,
  };

  const mockCartridges = {
    get: vi.fn(),
    list: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify({ logger: false });

    app.decorate("prisma", mockPrisma as any);
    app.decorate("storageContext", { cartridges: mockCartridges } as any);

    app.decorateRequest("organizationIdFromAuth", undefined);
    app.addHook("onRequest", async (request) => {
      request.organizationIdFromAuth = "org_test";
    });

    await app.register(scheduledReportsRoutes, { prefix: "/api/scheduled-reports" });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/scheduled-reports", () => {
    it("returns reports for the organization", async () => {
      const reports = [{ id: "rep_1", name: "Daily Funnel", organizationId: "org_test" }];
      mockScheduledReport.findMany.mockResolvedValue(reports);

      const res = await app.inject({
        method: "GET",
        url: "/api/scheduled-reports",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().reports).toHaveLength(1);
    });

    it("returns 503 when prisma is unavailable", async () => {
      await app.close();

      app = Fastify({ logger: false });
      app.decorate("prisma", null);
      app.decorate("storageContext", { cartridges: mockCartridges } as any);
      app.decorateRequest("organizationIdFromAuth", undefined);
      await app.register(scheduledReportsRoutes, { prefix: "/api/scheduled-reports" });

      const res = await app.inject({
        method: "GET",
        url: "/api/scheduled-reports",
      });

      expect(res.statusCode).toBe(503);
    });
  });

  describe("POST /api/scheduled-reports", () => {
    it("creates a scheduled report", async () => {
      const created = {
        id: "rep_new",
        name: "Weekly Report",
        cronExpression: "0 9 * * 1",
        reportType: "funnel",
        organizationId: "org_test",
      };
      mockScheduledReport.create.mockResolvedValue(created);

      const res = await app.inject({
        method: "POST",
        url: "/api/scheduled-reports",
        payload: {
          name: "Weekly Report",
          cronExpression: "0 9 * * 1",
          reportType: "funnel",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().report.name).toBe("Weekly Report");
    });

    it("returns 400 on invalid cron expression", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/scheduled-reports",
        payload: {
          name: "Bad Cron",
          cronExpression: "not-valid",
          reportType: "funnel",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Validation failed");
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/scheduled-reports",
        payload: { name: "Missing Fields" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("PUT /api/scheduled-reports/:id", () => {
    it("updates a scheduled report", async () => {
      mockScheduledReport.findFirst.mockResolvedValue({
        id: "rep_1",
        organizationId: "org_test",
        cronExpression: "0 9 * * 1",
        timezone: "UTC",
      });
      mockScheduledReport.update.mockResolvedValue({
        id: "rep_1",
        name: "Updated Report",
      });

      const res = await app.inject({
        method: "PUT",
        url: "/api/scheduled-reports/rep_1",
        payload: { name: "Updated Report" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().report.name).toBe("Updated Report");
    });

    it("returns 404 if report not found", async () => {
      mockScheduledReport.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: "PUT",
        url: "/api/scheduled-reports/nonexistent",
        payload: { name: "New Name" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/scheduled-reports/:id", () => {
    it("deletes a scheduled report", async () => {
      mockScheduledReport.findFirst.mockResolvedValue({
        id: "rep_1",
        organizationId: "org_test",
      });
      mockScheduledReport.delete.mockResolvedValue({});

      const res = await app.inject({
        method: "DELETE",
        url: "/api/scheduled-reports/rep_1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(true);
    });

    it("returns 404 if report not found", async () => {
      mockScheduledReport.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/scheduled-reports/nonexistent",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/scheduled-reports/:id/run", () => {
    it("manually runs a report", async () => {
      mockScheduledReport.findFirst.mockResolvedValue({
        id: "rep_1",
        organizationId: "org_test",
        reportType: "funnel",
        platform: "meta",
        vertical: "commerce",
        cronExpression: "0 9 * * 1",
        timezone: "UTC",
      });
      mockCartridges.get.mockReturnValue({
        execute: vi.fn().mockResolvedValue({ data: { summary: "ok" } }),
      });
      mockScheduledReport.update.mockResolvedValue({});

      const res = await app.inject({
        method: "POST",
        url: "/api/scheduled-reports/rep_1/run",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it("returns 400 when cartridge is unavailable", async () => {
      mockScheduledReport.findFirst.mockResolvedValue({
        id: "rep_1",
        organizationId: "org_test",
        reportType: "funnel",
      });
      mockCartridges.get.mockReturnValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/scheduled-reports/rep_1/run",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("not registered");
    });
  });
});
