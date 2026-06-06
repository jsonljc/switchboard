import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { toPaidVisitRow } from "../revenue.js";

// ─── Minimal test app for the GET /:orgId/revenue/by-campaign route ─────────

const mockPaidVisitsByCampaign = vi.fn();
const mockSumByCampaign = vi.fn();

vi.mock("@switchboard/db", () => ({
  PrismaRevenueStore: vi.fn().mockImplementation(() => ({
    paidVisitsByCampaign: mockPaidVisitsByCampaign,
    sumByCampaign: mockSumByCampaign,
  })),
}));

import Fastify from "fastify";
import { revenueRoutes } from "../revenue.js";

async function buildRouteApp() {
  const app = Fastify();
  app.decorateRequest("organizationIdFromAuth", undefined);
  app.decorateRequest("principalIdFromAuth", undefined);
  // orgId / actorId are typed as non-nullable string in the FastifyRequest interface
  // (set by requireOrg preHandlers at runtime). Provide string defaults here.
  app.decorateRequest("orgId", "");
  app.decorateRequest("actorId", "");
  app.addHook("onRequest", async (request) => {
    request.organizationIdFromAuth = (request.headers["x-org-id"] as string) ?? "org-test";
  });
  app.decorate("prisma", {} as unknown as typeof app.prisma);
  app.decorate("platformIngress", undefined as unknown as typeof app.platformIngress);
  await app.register(revenueRoutes, { prefix: "/api" });
  return app;
}

describe("GET /:orgId/revenue/by-campaign?detail=paid-visits — window params", () => {
  it("uses provided from/to when both are valid ISO strings", async () => {
    mockPaidVisitsByCampaign.mockResolvedValue([]);
    const app = await buildRouteApp();
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-01-31T00:00:00.000Z";
    const res = await app.inject({
      method: "GET",
      url: `/api/org-test/revenue/by-campaign?detail=paid-visits&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPaidVisitsByCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date(from),
        to: new Date(to),
      }),
    );
  });

  it("falls back to a 90-day window when from/to are absent", async () => {
    mockPaidVisitsByCampaign.mockResolvedValue([]);
    const before = Date.now();
    const app = await buildRouteApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/org-test/revenue/by-campaign?detail=paid-visits`,
      headers: { "x-org-id": "org-test" },
    });
    const after = Date.now();
    expect(res.statusCode).toBe(200);
    const call = (mockPaidVisitsByCampaign as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      from: Date;
      to: Date;
    };
    const windowMs = call.to.getTime() - call.from.getTime();
    // Should be approximately 90 days (allow ±1 second for test runtime)
    expect(windowMs).toBeGreaterThanOrEqual(89 * 24 * 60 * 60 * 1000);
    expect(windowMs).toBeLessThanOrEqual(90 * 24 * 60 * 60 * 1000 + 1000);
    expect(call.to.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.to.getTime()).toBeLessThanOrEqual(after + 100);
  });

  it("falls back to 90-day window when from/to are unparseable", async () => {
    mockPaidVisitsByCampaign.mockResolvedValue([]);
    const app = await buildRouteApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/org-test/revenue/by-campaign?detail=paid-visits&from=not-a-date&to=also-not-a-date`,
      headers: { "x-org-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const call = (mockPaidVisitsByCampaign as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      from: Date;
      to: Date;
    };
    const windowMs = call.to.getTime() - call.from.getTime();
    expect(windowMs).toBeGreaterThanOrEqual(89 * 24 * 60 * 60 * 1000);
    expect(windowMs).toBeLessThanOrEqual(90 * 24 * 60 * 60 * 1000 + 1000);
  });
});

const RecordRevenueInputSchema = z.object({
  contactId: z.string(),
  opportunityId: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default("SGD"),
  type: z.enum(["payment", "deposit", "invoice", "refund"]).default("payment"),
  recordedBy: z.enum(["owner", "staff", "stripe", "integration"]).default("owner"),
  externalReference: z.string().nullable().optional(),
  sourceCampaignId: z.string().nullable().optional(),
  sourceAdId: z.string().nullable().optional(),
});

describe("RecordRevenueInputSchema", () => {
  it("validates valid input with defaults", () => {
    const result = RecordRevenueInputSchema.safeParse({
      contactId: "c-1",
      amount: 388,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("SGD");
      expect(result.data.type).toBe("payment");
      expect(result.data.recordedBy).toBe("owner");
    }
  });

  it("rejects negative amount", () => {
    const result = RecordRevenueInputSchema.safeParse({ contactId: "c-1", amount: -100 });
    expect(result.success).toBe(false);
  });

  it("rejects missing contactId", () => {
    const result = RecordRevenueInputSchema.safeParse({ amount: 100 });
    expect(result.success).toBe(false);
  });

  it("accepts all fields", () => {
    const result = RecordRevenueInputSchema.safeParse({
      contactId: "c-1",
      opportunityId: "opp-1",
      amount: 500,
      currency: "USD",
      type: "deposit",
      recordedBy: "staff",
      externalReference: "stripe-pi-123",
      sourceCampaignId: "camp-1",
      sourceAdId: "ad-1",
    });
    expect(result.success).toBe(true);
  });
});

describe("toPaidVisitRow — cents→major conversion (1A-6 unit boundary)", () => {
  it("converts 50000 cents to S$500.00 major units exactly once (not 100x)", () => {
    const row = toPaidVisitRow({
      bookingId: "bk-1",
      amountCents: 50000,
      currency: "SGD",
      sourceCampaignId: "camp-1",
      attributionBasis: "ctwa_captured",
      paidAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(row.amountMajor).toBe(500);
    expect(row.amountMajor).not.toBe(5_000_000);
    expect(row.amountMajor).not.toBe(500_000);
    expect(row.currency).toBe("SGD");
    expect(row.campaignId).toBe("camp-1");
    expect(row.campaignName).toBe("camp-1");
    expect(row.attributionBasis).toBe("ctwa_captured");
    expect(row.paidAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("keeps campaign_missing honest: null campaign id/name, never 0", () => {
    const row = toPaidVisitRow({
      bookingId: "bk-2",
      amountCents: 12050,
      currency: "SGD",
      sourceCampaignId: null,
      attributionBasis: "campaign_missing",
      paidAt: new Date("2026-06-02T00:00:00.000Z"),
    });
    expect(row.amountMajor).toBe(120.5);
    expect(row.campaignId).toBeNull();
    expect(row.campaignName).toBeNull();
    expect(row.attributionBasis).toBe("campaign_missing");
  });
});
