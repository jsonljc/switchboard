// ---------------------------------------------------------------------------
// Tests for operator-config API routes (CRUD)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the PrismaAdsOperatorConfigStore
const mockCreate = vi.fn();
const mockGetByOrg = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@switchboard/db", () => ({
  PrismaAdsOperatorConfigStore: class {
    create = mockCreate;
    getByOrg = mockGetByOrg;
    update = mockUpdate;
  },
}));

import Fastify from "fastify";
import { operatorConfigRoutes } from "../routes/operator-config.js";
import type { AdsOperatorConfig } from "@switchboard/schemas";

const TEST_CONFIG: AdsOperatorConfig = {
  id: "config-1",
  organizationId: "org-1",
  adAccountIds: ["act_123"],
  platforms: ["meta"],
  automationLevel: "copilot",
  targets: { cpa: 25 },
  schedule: { optimizerCronHour: 6, reportCronHour: 9, timezone: "UTC" },
  notificationChannel: { type: "telegram", chatId: "12345" },
  principalId: "user-1",
  active: true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

function buildApp() {
  const app = Fastify({ logger: false });

  // Simulate Prisma being available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate("prisma", {} as any);
  app.register(operatorConfigRoutes, { prefix: "/api/operator-config" });

  return app;
}

describe("operator-config routes", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockGetByOrg.mockReset();
    mockUpdate.mockReset();
  });

  describe("POST /api/operator-config", () => {
    it("creates a config and returns 201", async () => {
      mockCreate.mockResolvedValue(TEST_CONFIG);
      const app = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/operator-config",
        payload: {
          organizationId: "org-1",
          adAccountIds: ["act_123"],
          platforms: ["meta"],
          automationLevel: "copilot",
          targets: { cpa: 25 },
          schedule: { optimizerCronHour: 6, reportCronHour: 9, timezone: "UTC" },
          notificationChannel: { type: "telegram", chatId: "12345" },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.config.organizationId).toBe("org-1");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when organizationId is missing", async () => {
      const app = buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/operator-config",
        payload: {
          adAccountIds: ["act_123"],
          platforms: ["meta"],
          automationLevel: "copilot",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/operator-config/:orgId", () => {
    it("returns config when found", async () => {
      mockGetByOrg.mockResolvedValue(TEST_CONFIG);
      const app = buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/api/operator-config/org-1",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.config.id).toBe("config-1");
    });

    it("returns 404 when not found", async () => {
      mockGetByOrg.mockResolvedValue(null);
      const app = buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/api/operator-config/org-missing",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /api/operator-config/:orgId", () => {
    it("updates config and returns 200", async () => {
      mockGetByOrg.mockResolvedValue(TEST_CONFIG);
      mockUpdate.mockResolvedValue({ ...TEST_CONFIG, automationLevel: "autonomous" });
      const app = buildApp();

      const res = await app.inject({
        method: "PUT",
        url: "/api/operator-config/org-1",
        payload: { automationLevel: "autonomous" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.config.automationLevel).toBe("autonomous");
    });

    it("returns 404 when config does not exist", async () => {
      mockGetByOrg.mockResolvedValue(null);
      const app = buildApp();

      const res = await app.inject({
        method: "PUT",
        url: "/api/operator-config/org-missing",
        payload: { automationLevel: "autonomous" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("when database is not available", () => {
    it("returns 503 for all endpoints", async () => {
      const app = Fastify({ logger: false });
      app.decorate("prisma", null);
      app.register(operatorConfigRoutes, { prefix: "/api/operator-config" });

      const postRes = await app.inject({
        method: "POST",
        url: "/api/operator-config",
        payload: { organizationId: "org-1" },
      });
      expect(postRes.statusCode).toBe(503);

      const getRes = await app.inject({
        method: "GET",
        url: "/api/operator-config/org-1",
      });
      expect(getRes.statusCode).toBe(503);

      const putRes = await app.inject({
        method: "PUT",
        url: "/api/operator-config/org-1",
        payload: {},
      });
      expect(putRes.statusCode).toBe(503);
    });
  });
});
