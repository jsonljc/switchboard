// ---------------------------------------------------------------------------
// Tests for handoff trigger — POST /api/organizations/:orgId/handoff
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the PrismaAdsOperatorConfigStore
const mockGetByOrg = vi.fn();
vi.mock("@switchboard/db", () => ({
  PrismaAdsOperatorConfigStore: class {
    getByOrg = mockGetByOrg;
  },
}));

// Mock the StrategistAgent
const mockTick = vi.fn();
vi.mock("@switchboard/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    StrategistAgent: class {
      id = "strategist";
      name = "Strategist Agent";
      tick = mockTick;
    },
  };
});

import Fastify from "fastify";
import { organizationsRoutes } from "../routes/organizations.js";
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

  // Decorate with required Fastify properties
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate("prisma", {} as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate("orchestrator", {
    resolveAndPropose: vi.fn(),
    executeApproved: vi.fn(),
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate("storageContext", {} as any);
  app.decorate("resolvedSkin", null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.decorate("agentNotifier", {
    sendProactive: vi.fn().mockResolvedValue(undefined),
  } as any);

  app.register(organizationsRoutes, { prefix: "/api/organizations" });

  return app;
}

describe("POST /api/organizations/:orgId/handoff", () => {
  beforeEach(() => {
    mockGetByOrg.mockReset();
    mockTick.mockReset();
    mockTick.mockResolvedValue({ agentId: "strategist", actions: [], summary: "analysis done" });
  });

  it("returns 400 when no operator config exists", async () => {
    mockGetByOrg.mockResolvedValue(null);
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/organizations/org-1/handoff",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("No operator config found");
  });

  it("triggers strategist tick and returns 200", async () => {
    mockGetByOrg.mockResolvedValue(TEST_CONFIG);
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/organizations/org-1/handoff",
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.triggered).toBe(true);

    // Give the fire-and-forget tick a moment to be called
    await new Promise((r) => setTimeout(r, 50));
    expect(mockTick).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when database is not available", async () => {
    const app = Fastify({ logger: false });
    app.decorate("prisma", null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("orchestrator", {} as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("storageContext", {} as any);
    app.decorate("resolvedSkin", null);
    app.decorate("agentNotifier", null);
    app.register(organizationsRoutes, { prefix: "/api/organizations" });

    const res = await app.inject({
      method: "POST",
      url: "/api/organizations/org-1/handoff",
      payload: {},
    });

    expect(res.statusCode).toBe(503);
  });

  it("returns 200 even if tick fails (fire-and-forget)", async () => {
    mockGetByOrg.mockResolvedValue(TEST_CONFIG);
    mockTick.mockRejectedValue(new Error("tick failed"));
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/organizations/org-1/handoff",
      payload: {},
    });

    // Should still return 200 since tick is fire-and-forget
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.triggered).toBe(true);
  });
});
