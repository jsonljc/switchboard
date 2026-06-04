/**
 * Tests for GET /api/cockpit/riley/outcomes — Task 8.
 *
 * Uses a standalone Fastify instance with registerRileyOutcomesRoute() +
 * a stubbed listRenderable dep, mirroring the pattern from
 * api-cockpit-activity.test.ts. The global buildTestServer harness does not
 * support outcome dep injection, so we bypass it here and wire the route
 * directly — the same approach used by cockpit activity route tests.
 *
 * Auth: the route uses requireOrganizationScope() — organizationIdFromAuth must
 * be present on the request. In dev/test mode (authDisabled=true) the preHandler
 * hook reads the `x-org-id` header. Tests decorate authDisabled=true and pass
 * the header to exercise the full auth path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerRileyOutcomesRoute } from "../routes/cockpit/riley/outcomes.js";
import type { OutcomesRouteDeps } from "../routes/cockpit/riley/outcomes.js";
import type { RecommendationOutcomeReadModel } from "@switchboard/db";

const SAMPLE_ROWS: RecommendationOutcomeReadModel[] = [
  {
    id: "outcome-1",
    recommendationId: "rec-1",
    actionKind: "pause",
    windowEndedAt: new Date("2026-05-08T12:00:00Z"),
    copyTemplate: "pause.spend.fell",
    copyValues: { deltaPct: -92, windowDays: 7 },
    campaignId: "camp-A",
    campaignName: "Campaign A",
    causalStrength: "directional",
    businessContextStable: "unknown",
    trustDelta: "up",
  },
  {
    id: "outcome-2",
    recommendationId: "rec-2",
    actionKind: "refresh_creative",
    windowEndedAt: new Date("2026-05-09T12:00:00Z"),
    copyTemplate: "refresh.ctr.rose",
    copyValues: { deltaPct: 12.3, windowDays: 14 },
    campaignId: "camp-B",
    campaignName: null,
    causalStrength: "directional",
    businessContextStable: "unknown",
    trustDelta: null,
  },
];

async function buildApp(deps: OutcomesRouteDeps) {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true);
  app.setErrorHandler((error, _req, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(statusCode).send({ error: message, statusCode });
  });
  await registerRileyOutcomesRoute(app, deps);
  return app;
}

describe("GET /api/cockpit/riley/outcomes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns translated ActivityRow[] with kind='observed'", async () => {
    const listRenderable = vi.fn().mockResolvedValue(SAMPLE_ROWS);
    const app = await buildApp({ listRenderable });
    const res = await app.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: {
        kind: string;
        head: string;
        body: string;
        id: string;
        time: string;
        timestampIso: string;
      }[];
    };
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({
      id: "outcome:outcome-1",
      kind: "observed",
      head: "Spend fell 92.0% in 7d after pause. This outcome is a positive signal for this action.",
      body: "after pause · Campaign A",
    });
    // SAMPLE_ROWS[1] keeps trustDelta: null — the legacy-row pin at the
    // route level: pre-slice-3 rows render byte-identically to before.
    expect(body.rows[1]).toMatchObject({
      id: "outcome:outcome-2",
      kind: "observed",
      head: "CTR rose 12.3% in 14d after refresh.",
      body: "after creative refresh",
    });
    // time and timestampIso are present
    expect(body.rows[0]!.time).toBe("12:00");
    expect(body.rows[0]!.timestampIso).toBe("2026-05-08T12:00:00.000Z");
  });

  it("drops rows with unknown copyTemplate (fail-closed)", async () => {
    const badRow: RecommendationOutcomeReadModel = {
      ...SAMPLE_ROWS[0]!,
      copyTemplate: "pause.spend.exploded", // not allowlisted
    };
    const listRenderable = vi.fn().mockResolvedValue([badRow]);
    const app = await buildApp({ listRenderable });
    const res = await app.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: unknown[] };
    expect(body.rows).toHaveLength(0);
  });

  it("requires org context — returns 403 when no x-org-id header and no auth", async () => {
    // Build with authDisabled=false so the preHandler does NOT inject a default org.
    // requireOrganizationScope() then returns null and sends 403.
    const listRenderable = vi.fn().mockResolvedValue([]);
    const app = Fastify({ logger: false });
    app.decorate("authDisabled", false);
    app.setErrorHandler((error, _req, reply) => {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(statusCode).send({ error: message, statusCode });
    });
    await registerRileyOutcomesRoute(app, { listRenderable });

    const res = await app.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes",
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("returns 200 when authenticated org matches (happy path auth)", async () => {
    const listRenderable = vi.fn().mockResolvedValue([]);
    const app = await buildApp({ listRenderable });
    const res = await app.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    // Verify the org was forwarded to the store
    expect(listRenderable).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-A" }));
  });

  it("invokes the store's renderable-only list (contract — hidden rows never reach the wire)", async () => {
    // The route's contract: it calls listRenderable; the store filters
    // cockpitRenderable=true at the SQL layer. We verify the route honors
    // that contract regardless of what the store returns.
    const listRenderable = vi.fn().mockResolvedValue([]);
    const app = await buildApp({ listRenderable });
    await app.inject({
      method: "GET",
      url: "/api/cockpit/riley/outcomes",
      headers: { "x-org-id": "org-1" },
    });
    expect(listRenderable).toHaveBeenCalledTimes(1);
    expect(listRenderable).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1" }));
  });
});
