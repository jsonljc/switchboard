import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";
import type { agentHome } from "@switchboard/core";

describe("GET /api/dashboard/agents/:agentKey/greeting", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("returns 200 with valid greeting for alex", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/greeting",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: agentHome.GreetingProjection };
    expect(body.data.variant).toBeDefined();
    expect(body.data.segments).toBeInstanceOf(Array);
    expect(body.data.signal).toBeDefined();
    expect(body.data.freshness).toBeDefined();
  });

  it("returns 200 for riley", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/greeting",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: agentHome.GreetingProjection };
    expect(body.data.variant).toBeDefined();
  });

  it("returns 404 for mira when the org has NOT enabled it (no data leak)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/greeting",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string };
    expect(body.error).toContain("not available for greeting");
  });

  it("returns 200 for mira when the org enabled it", async () => {
    await ctx.app.orgAgentEnablementStore!.enable("org-1", "mira");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/mira/greeting",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: agentHome.GreetingProjection };
    expect(body.data.variant).toBeDefined();
    expect(body.data.signal).toBeDefined();
  });

  it("returns 400 for unknown agent key", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/unknown/greeting",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain("Unknown agent key");
  });

  it("wraps response in { data: ... } shape", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/greeting",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body).not.toHaveProperty("variant");
  });

  it("uses seeded signal data when store is populated", async () => {
    // Seed signal data — busy variant (inboxCount >= busyThreshold)
    const store = ctx.app.greetingSignalStore as agentHome.InMemoryGreetingSignalStore;
    store.setSignal("org-1", "alex", {
      inboxCount: 8,
      oldestOpenItemAgeHours: 12,
      hoursSinceLastOperatorAction: 2,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/greeting",
      headers: { "x-org-id": "org-1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: agentHome.GreetingProjection };
    expect(body.data.variant).toBe("busy");
    expect(body.data.signal.inboxCount).toBe(8);
    expect(body.data.signal.oldestOpenItemAgeHours).toBe(12);
    expect(body.data.signal.hoursSinceLastOperatorAction).toBe(2);
  });
});
