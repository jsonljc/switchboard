import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, type TestContext } from "./test-server.js";
import { emitRecommendation } from "@switchboard/core";

let seedCounter = 0;

interface SeedArgs {
  orgId: string;
  surface: "queue" | "shadow_action";
  ageHours?: number;
  targetSuffix?: string;
}

async function seedRecommendation(app: FastifyInstance, args: SeedArgs) {
  const confidence = args.surface === "shadow_action" ? 0.95 : 0.6;
  const dollarsAtRisk = args.surface === "shadow_action" ? 10 : 100;
  const suffix = args.targetSuffix ?? `${args.orgId}-${args.surface}-${++seedCounter}`;
  const result = await emitRecommendation(app.recommendationStore!, {
    orgId: args.orgId,
    agentKey: "alex",
    intent: "recommendation.ad_set_pause",
    action: "pause",
    humanSummary: `Test rec for ${args.orgId}`,
    confidence,
    dollarsAtRisk,
    riskLevel: "low",
    parameters: {},
    presentation: {
      primaryLabel: "Pause",
      secondaryLabel: "Reduce 50%",
      dismissLabel: "Dismiss",
      dataLines: [],
    },
    targetEntities: { campaignId: `c-${suffix}` },
  });
  if (result.surface === "dropped") throw new Error("seed must not drop");

  if (args.ageHours) {
    // Backdate via the in-memory store's exposed rows for since-filter tests.
    // Cast through the in-memory shape; PrismaRecommendationStore (prod) wouldn't expose this
    // but the test server registers createInMemoryRecommendationStore.
    const store = app.recommendationStore as unknown as {
      rows: Array<{ id: string; createdAt: Date }>;
    };
    const row = store.rows.find((r) => r.id === result.id);
    if (row) row.createdAt = new Date(Date.now() - args.ageHours * 60 * 60 * 1000);
  }
  return { id: result.id, surface: result.surface };
}

describe("Recommendations API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const ctx: TestContext = await buildTestServer();
    app = ctx.app;
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/recommendations", () => {
    it("lists queue-surface pending recommendations for the org", async () => {
      await seedRecommendation(app, { orgId: "default", surface: "queue" });
      await seedRecommendation(app, { orgId: "default", surface: "shadow_action" });
      const res = await app.inject({
        method: "GET",
        url: "/api/recommendations?surface=queue",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recommendations).toHaveLength(1);
      expect(body.recommendations[0].surface).toBe("queue");
    });

    it("lists shadow-surface with since-filter", async () => {
      await seedRecommendation(app, {
        orgId: "default",
        surface: "shadow_action",
        ageHours: 1,
      });
      await seedRecommendation(app, {
        orgId: "default",
        surface: "shadow_action",
        ageHours: 48,
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/recommendations?surface=shadow_action&since=24h",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().recommendations).toHaveLength(1);
    });

    it("400 on missing surface", async () => {
      const res = await app.inject({ method: "GET", url: "/api/recommendations" });
      expect(res.statusCode).toBe(400);
    });

    it("400 on invalid surface value", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/recommendations?surface=nope",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/recommendations/:id/act", () => {
    it("primary on queue card returns 200 and acted row", async () => {
      const rec = await seedRecommendation(app, { orgId: "default", surface: "queue" });
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "primary" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().recommendation.status).toBe("acted");
    });

    it("dismiss returns 200 and dismissed row", async () => {
      const rec = await seedRecommendation(app, { orgId: "default", surface: "queue" });
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "dismiss" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().recommendation.status).toBe("dismissed");
    });

    it("confirm on shadow card returns 200 and confirmed row", async () => {
      const rec = await seedRecommendation(app, {
        orgId: "default",
        surface: "shadow_action",
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "confirm" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().recommendation.status).toBe("confirmed");
    });

    it("undo on shadow card returns 200 and dismissed_by_undo", async () => {
      const rec = await seedRecommendation(app, {
        orgId: "default",
        surface: "shadow_action",
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "undo" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().recommendation.status).toBe("dismissed_by_undo");
    });

    it("400 on confirm against queue card", async () => {
      const rec = await seedRecommendation(app, { orgId: "default", surface: "queue" });
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "confirm" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("400 on primary against shadow card", async () => {
      const rec = await seedRecommendation(app, {
        orgId: "default",
        surface: "shadow_action",
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "primary" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("409 on already-terminal second act", async () => {
      const rec = await seedRecommendation(app, { orgId: "default", surface: "queue" });
      await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "primary" },
      });
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "dismiss" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().recommendation.status).toBe("acted");
    });

    it("404 on missing id", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/missing-id/act`,
        payload: { action: "primary" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("400 on invalid action value", async () => {
      const rec = await seedRecommendation(app, { orgId: "default", surface: "queue" });
      const res = await app.inject({
        method: "POST",
        url: `/api/recommendations/${rec.id}/act`,
        payload: { action: "nope" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
