import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await buildTestServer();
});

afterEach(async () => {
  await ctx.app.close();
});

describe("GET /api/dashboard/reports", () => {
  it("returns 400 for invalid window", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=INVALID",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns ReportDataV1 for valid window", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20MONTH",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.label).toBe("THIS MONTH");
    expect(body.funnel).toHaveLength(6);
    expect(body.attribution).toBeDefined();
    expect(body.cost).toBeDefined();
    expect(body.campaigns).toEqual([]);
    expect(body.managedComparison).toBeNull();
  });

  it("returns cached payload on second request", async () => {
    const res1 = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20MONTH",
      headers: { "x-org-id": "org-test" },
    });
    const res2 = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20MONTH",
      headers: { "x-org-id": "org-test" },
    });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.json().label).toBe(res2.json().label);
  });
});

describe("POST /api/dashboard/reports/refresh", () => {
  it("returns fresh data after cache bust", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/reports/refresh?window=THIS%20MONTH",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.label).toBe("THIS MONTH");
    expect(body.funnel).toHaveLength(6);
  });

  it("returns 400 for invalid window", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/reports/refresh?window=NOPE",
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });
});
