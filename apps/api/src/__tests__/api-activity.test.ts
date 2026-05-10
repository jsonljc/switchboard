/**
 * Tests for GET /api/dashboard/activity — spec §7.3.
 *
 * Uses buildTestServer (mocked Prisma pattern per feedback_api_test_mocked_prisma.md).
 * The test server creates an InMemoryLedgerStorage + AuditLedger and decorates
 * app.auditLedger — entries are seeded via ledger.record().
 *
 * 13 cases covering §7.3 (cases 1–12) + the visibility safety test (case 13).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await buildTestServer();
});

afterEach(async () => {
  await ctx.app.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedEntry(
  orgId: string,
  overrides: {
    eventType?: string;
    actorType?: "user" | "agent" | "service_account" | "system";
    entityType?: string;
    entityId?: string;
    visibilityLevel?: "public" | "org" | "admin" | "system";
    timestamp?: Date;
  } = {},
) {
  return ctx.app.auditLedger.record({
    eventType: (overrides.eventType ?? "action.executed") as Parameters<
      typeof ctx.app.auditLedger.record
    >[0]["eventType"],
    actorType: overrides.actorType ?? "agent",
    actorId: "agent_test",
    entityType: overrides.entityType ?? "campaign",
    entityId: overrides.entityId ?? "camp_1",
    riskCategory: "low",
    summary: "Test audit entry",
    snapshot: { id: "camp_1" },
    organizationId: orgId,
    visibilityLevel: overrides.visibilityLevel ?? "public",
  });
}

// ---------------------------------------------------------------------------
// §7.3 test cases
// ---------------------------------------------------------------------------

describe("GET /api/dashboard/activity", () => {
  // Case 1: requires org context (401 without)
  it("1. returns 401 without org context", async () => {
    // Build a test server with authDisabled=false behaviour by not setting x-org-id header.
    // In the test server authDisabled=true, but the route itself checks organizationIdFromAuth.
    // We need a fresh app where authDisabled is false so the preHandler doesn't inject a default.
    const Fastify = (await import("fastify")).default;
    const { dashboardActivityRoutes } = await import("../routes/dashboard-activity.js");
    const { AuditLedger, InMemoryLedgerStorage } = await import("@switchboard/core");

    const app = Fastify({ logger: false });
    app.decorate("authDisabled", false);
    app.decorate("auditLedger", new AuditLedger(new InMemoryLedgerStorage()));
    await app.register(dashboardActivityRoutes, { prefix: "/api/dashboard/activity" });

    const res = await app.inject({ method: "GET", url: "/api/dashboard/activity" });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toContain("Org context");

    await app.close();
  });

  // Case 2: returns 200 with rows for valid org
  it("2. returns 200 with rows for valid org", async () => {
    await seedEntry("org-test");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(typeof body.scope).toBe("string");
    expect(body.nextCursor === null || typeof body.nextCursor === "string").toBe(true);
  });

  // Case 3: passes scope=all to ledger
  it("3. passes scope=all to ledger — returns all event types", async () => {
    // Seed an operational entry + a non-operational entry
    await seedEntry("org-test", { eventType: "action.executed" }); // operational
    await seedEntry("org-test", { eventType: "action.proposed" }); // not in OPERATIONAL list

    const resAll = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?scope=all",
      headers: { "x-org-id": "org-test" },
    });
    expect(resAll.statusCode).toBe(200);
    const bodyAll = resAll.json();
    expect(bodyAll.scope).toBe("all");
    expect(bodyAll.rows).toHaveLength(2);

    const resOp = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?scope=operational",
      headers: { "x-org-id": "org-test" },
    });
    expect(resOp.statusCode).toBe(200);
    const bodyOp = resOp.json();
    expect(bodyOp.scope).toBe("operational");
    // Only operational events should be returned
    expect(bodyOp.rows.every((r: { eventType: string }) => r.eventType === "action.executed")).toBe(
      true,
    );
  });

  // Case 4: passes URL-param filters to ledger
  it("4. passes eventType and actorType filters to ledger", async () => {
    await seedEntry("org-test", { actorType: "agent", eventType: "action.executed" });
    await seedEntry("org-test", { actorType: "user", eventType: "action.approved" });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?scope=all&actorType=user",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].actorType).toBe("user");
  });

  // Case 5: passes cursor through
  it("5. passes cursor through — page 2 contains next slice", async () => {
    for (let i = 0; i < 3; i++) {
      await seedEntry("org-test", { entityId: `ent_${i}` });
    }

    const page1 = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?limit=2&scope=all",
      headers: { "x-org-id": "org-test" },
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.rows).toHaveLength(2);
    expect(typeof body1.nextCursor).toBe("string");

    const page2 = await ctx.app.inject({
      method: "GET",
      url: `/api/dashboard/activity?limit=2&scope=all&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: { "x-org-id": "org-test" },
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    expect(body2.rows).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
  });

  // Case 6: 400 on invalid scope
  it("6. returns 400 on invalid scope value", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?scope=banana",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  // Case 7: 400 on invalid limit
  it("7. returns 400 on limit > 100", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?limit=999",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  // Case 8: 400 on invalid date format
  it("8. returns 400 on invalid date format", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?after=not-a-date",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  // Case 9: 400 on malformed cursor (CursorDecodeError → 400, never silent fallback)
  it("9. returns 400 on malformed cursor", async () => {
    // Encode garbage that decodes to bad JSON
    const garbage = Buffer.from("not-valid-json!!!").toString("base64url");
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/dashboard/activity?cursor=${garbage}`,
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("cursor");
  });

  // Case 10: 400 when client sends ?scope=custom (server-derived, rejected as input)
  it("10. returns 400 when client sends ?scope=custom", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?scope=custom",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  // Case 11: scope='custom' when ?eventType is set (no explicit scope param)
  it("11. response carries scope=custom when eventType filter is set without explicit scope", async () => {
    await seedEntry("org-test", { eventType: "action.executed" });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?eventType=action.executed",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scope).toBe("custom");
  });

  // Case 12: 500 on ledger throw (unrelated error — not CursorDecodeError or ZodError)
  it("12. returns 500 on unexpected ledger error", async () => {
    const originalListForBrowse = ctx.app.auditLedger.listForBrowse.bind(ctx.app.auditLedger);
    ctx.app.auditLedger.listForBrowse = async () => {
      throw new Error("Unexpected DB error");
    };

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("Internal error");

    // Restore
    ctx.app.auditLedger.listForBrowse = originalListForBrowse;
  });

  // Case 13: admin/system rows in storage are NOT returned
  it("13. admin and system visibility entries are not returned by /api/dashboard/activity", async () => {
    await seedEntry("org-test", { visibilityLevel: "public", entityId: "ent_public" });
    await seedEntry("org-test", { visibilityLevel: "org", entityId: "ent_org" });
    await seedEntry("org-test", { visibilityLevel: "admin", entityId: "ent_admin" });
    await seedEntry("org-test", { visibilityLevel: "system", entityId: "ent_system" });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/activity?scope=all",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const entityIds = body.rows.map((r: { entityId: string }) => r.entityId);
    // Only public + org entries returned
    expect(entityIds).toContain("ent_public");
    expect(entityIds).toContain("ent_org");
    // admin + system must not be present
    expect(entityIds).not.toContain("ent_admin");
    expect(entityIds).not.toContain("ent_system");
  });
});
