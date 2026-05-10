import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import type { ScheduledTrigger } from "@switchboard/schemas";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await buildTestServer();
});

afterEach(async () => {
  await ctx.app.close();
});

function trigger(overrides: Partial<ScheduledTrigger> & { id: string }): ScheduledTrigger {
  const defaults: ScheduledTrigger = {
    id: overrides.id,
    organizationId: "org-test",
    type: "cron",
    fireAt: null,
    cronExpression: "0 7 * * *",
    eventPattern: null,
    action: { type: "spawn_workflow", payload: {} },
    sourceWorkflowId: null,
    status: "active",
    createdAt: new Date("2026-05-01T00:00:00Z"),
    expiresAt: null,
  };
  return { ...defaults, ...overrides };
}

describe("GET /api/dashboard/automations", () => {
  it("returns 200 + projected shape on happy path", async () => {
    await ctx.app.triggerStore!.save(trigger({ id: "t1" }));

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
    expect(body.statusCounts).toEqual({
      all: 1,
      active: 1,
      fired: 0,
      cancelled: 0,
      expired: 0,
    });
    expect(body.rows[0]?.id).toBe("t1");
    expect(body.rows[0]?.scheduleLabel).toBe("0 7 * * *");
    expect(body.rows[0]?.drawer).toBeDefined();
  });

  it("returns 400 for invalid status", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?status=banana",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for limit > 100", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?limit=101",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for limit < 1", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?limit=0",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for malformed cursor", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?cursor=not-base64-json",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_CURSOR");
  });

  it("cross-org isolation: another org's triggers never returned", async () => {
    await ctx.app.triggerStore!.save(trigger({ id: "mine", organizationId: "org-test" }));
    await ctx.app.triggerStore!.save(trigger({ id: "theirs", organizationId: "org-other" }));
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r: { id: string }) => r.id)).toEqual(["mine"]);
    expect(res.json().statusCounts.all).toBe(1);
  });

  it("status filter passes through", async () => {
    await ctx.app.triggerStore!.save(trigger({ id: "a", status: "active" }));
    await ctx.app.triggerStore!.save(trigger({ id: "f", status: "fired" }));
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations?status=fired",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows.map((r: { id: string }) => r.id)).toEqual(["f"]);
  });

  it("returns 503 when triggerStore is missing", async () => {
    const otherCtx = await buildTestServer();
    Object.defineProperty(otherCtx.app, "triggerStore", { value: undefined, writable: true });
    const res = await otherCtx.app.inject({
      method: "GET",
      url: "/api/dashboard/automations",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(503);
    await otherCtx.app.close();
  });
});
