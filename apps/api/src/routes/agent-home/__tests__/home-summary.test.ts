import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { homeSummaryRoute } from "../home-summary.js";

async function buildApp(opts: { prisma?: import("@switchboard/db").PrismaClient | null }) {
  const app = Fastify({ logger: false });
  app.decorate("authDisabled", true);
  app.decorate("organizationIdFromAuth", undefined as string | undefined);
  app.decorate("principalIdFromAuth", undefined as string | undefined);
  app.decorate("prisma", opts.prisma ?? null);
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = undefined;
    (req as unknown as { principalIdFromAuth?: string }).principalIdFromAuth = undefined;
  });

  await app.register(homeSummaryRoute, { prefix: "/api/dashboard" });
  return app;
}

describe("GET /home/summary", () => {
  it("200 with unavailable summary when prisma is null", async () => {
    const app = await buildApp({ prisma: null });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/home/summary",
      headers: { "x-org-id": "org_1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      summary: { currency: string; attributedValueCents: { state: string } };
    };
    expect(body.summary.currency).toBe("SGD");
    expect(body.summary.attributedValueCents.state).toBe("unavailable");
  });

  it("200 with a schema-valid summary scoped to the session org", async () => {
    const mockPrisma = {
      organizationConfig: { findFirst: vi.fn(async () => null) },
      conversionRecord: {
        // sumAttributedBookedValueCentsForWindow uses aggregate; called twice (this + prev week)
        aggregate: vi.fn(async () => ({ _sum: { value: 50000 } })),
        // countBookedConversionsForWindow uses count; called twice (this + prev week)
        count: vi.fn(async () => 3),
      },
    } as unknown as import("@switchboard/db").PrismaClient;

    const app = await buildApp({ prisma: mockPrisma });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/home/summary",
      headers: { "x-org-id": "org_1" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      summary: { currency: string; attributedValueCents: { state: string } };
    };
    expect(body.summary.currency).toBe("SGD");
    expect(["ready", "empty"]).toContain(body.summary.attributedValueCents.state);
  });

  it("403 when x-org-id header is absent and authDisabled is false", async () => {
    const app = Fastify({ logger: false });
    app.decorate("authDisabled", false);
    app.decorate("organizationIdFromAuth", undefined as string | undefined);
    app.decorate("principalIdFromAuth", undefined as string | undefined);
    app.decorate("prisma", null);
    app.addHook("onRequest", async (req) => {
      (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = undefined;
    });
    await app.register(homeSummaryRoute, { prefix: "/api/dashboard" });
    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/home/summary",
    });
    expect(res.statusCode).toBe(403);
  });
});
