import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";

describe("GET /api/dashboard/agents", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("returns Mira as coming_soon when no enablement rows exist", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-empty" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agents: Array<{ key: string; status: string }> };
    expect(body.agents.map((a) => a.key)).toEqual(["alex", "riley", "mira"]);
    const mira = body.agents.find((a) => a.key === "mira")!;
    expect(mira.status).toBe("coming_soon");
  });

  it("returns enabled status for agents that have rows", async () => {
    await ctx.app.orgAgentEnablementStore!.enable("org-1", "alex");
    await ctx.app.orgAgentEnablementStore!.enable("org-1", "riley");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { agents: Array<{ key: string; status: string }> };
    expect(body.agents.find((a) => a.key === "alex")!.status).toBe("enabled");
    expect(body.agents.find((a) => a.key === "riley")!.status).toBe("enabled");
    expect(body.agents.find((a) => a.key === "mira")!.status).toBe("coming_soon");
  });

  it("includes registry metadata (displayName, accent, slug, role, launchTier)", async () => {
    await ctx.app.orgAgentEnablementStore!.enable("org-1", "alex");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-1" },
    });
    const body = res.json() as { agents: Array<Record<string, unknown>> };
    const alex = body.agents.find((a) => a.key === "alex")!;
    expect(alex.displayName).toBe("Alex");
    expect(alex.accent).toMatch(/^hsl\(/);
    expect(alex.slug).toBe("alex");
    expect(alex.role).toBe("lead-to-speed");
    expect(alex.launchTier).toBe("day-one");
  });

  // PR6 pilot opt-in: mira visible for pilot org, hidden (coming_soon) for all others
  it("mira pilot org — shows status:enabled when explicitly seeded", async () => {
    await ctx.app.orgAgentEnablementStore!.enable("org-pilot", "mira");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-pilot" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agents: Array<{ key: string; status: string }> };
    const mira = body.agents.find((a) => a.key === "mira")!;
    expect(mira.status).toBe("enabled");
  });

  it("mira non-pilot org — shows status:coming_soon without an enablement row", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-non-pilot" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agents: Array<{ key: string; status: string }> };
    const mira = body.agents.find((a) => a.key === "mira")!;
    expect(mira.status).toBe("coming_soon");
  });
});

describe("cross-tenant isolation", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("does not leak enablement rows from another org", async () => {
    await ctx.app.orgAgentEnablementStore!.enable("org-A", "alex");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents",
      headers: { "x-org-id": "org-B" },
    });
    const body = res.json() as { agents: Array<{ key: string; status: string }> };
    expect(body.agents.find((a) => a.key === "alex")!.status).toBe("coming_soon");
  });
});
