import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "../../../__tests__/test-server.js";
import { deriveLinkedOutcome } from "@switchboard/core/skill-runtime";
import type { ToolCallRecord } from "@switchboard/core/skill-runtime";

// A successful Alex booking tool call — the real producer input (mirrors the F5
// ledger store test). deriveLinkedOutcome turns this into the trace's
// linkedOutcome, exactly as TracePersistenceHook does in production.
function bookingCall(bookingId: string): ToolCallRecord {
  return {
    toolId: "calendar-book",
    operation: "booking.create",
    params: { service: "botox" },
    result: {
      status: "success",
      data: { bookingId },
      entityState: { bookingId, status: "confirmed" },
    },
    durationMs: 20,
    governanceDecision: "auto-approved",
  };
}

// Reassign the harness's decorated `prisma` (default null) with a mock that the
// route's PrismaBookingOutcomeLedgerStore + getOrgTimezone read.
function setPrisma(ctx: TestContext, prisma: unknown) {
  (ctx.app as unknown as { prisma: unknown }).prisma = prisma;
}

describe("GET /api/dashboard/agents/:agentId/booking-wins", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await buildTestServer();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("surfaces a real Alex booking as a win with its trace and revenue", async () => {
    // PRODUCER: derive the outcome exactly as TracePersistenceHook would.
    const outcome = deriveLinkedOutcome([bookingCall("bk_1")], "trace_1");
    expect(outcome).toEqual({ id: "bk_1", type: "booking", result: "booked" });

    setPrisma(ctx, {
      organizationConfig: { findFirst: async () => null },
      executionTrace: {
        findMany: async () => [
          {
            id: "trace_1",
            deploymentId: "dep_alex",
            skillSlug: "alex",
            linkedOutcomeId: outcome!.id,
          },
        ],
      },
      booking: {
        findMany: async () => [
          {
            id: "bk_1",
            contactId: "c_1",
            service: "botox",
            status: "confirmed",
            startsAt: new Date("2026-06-12T03:00:00Z"),
          },
        ],
      },
      conversionRecord: {
        findMany: async () => [
          {
            bookingId: "bk_1",
            value: 45000,
            sourceCampaignId: "camp_9",
            sourceAdId: "ad_3",
            occurredAt: new Date("2026-06-12T03:00:00Z"),
          },
        ],
      },
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/booking-wins",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      vm: {
        wins: Array<{
          traceId: string;
          service: string;
          valueCents: number | null;
          revenuePending: boolean;
        }>;
      };
    };
    expect(body.vm.wins).toHaveLength(1);
    expect(body.vm.wins[0]!.traceId).toBe("trace_1");
    expect(body.vm.wins[0]!.service).toBe("botox");
    expect(body.vm.wins[0]!.valueCents).toBe(45000);
    expect(body.vm.wins[0]!.revenuePending).toBe(false);
  });

  it("returns an empty vm when the org has no booking outcomes yet", async () => {
    setPrisma(ctx, {
      organizationConfig: { findFirst: async () => null },
      executionTrace: { findMany: async () => [] },
      booking: { findMany: async () => [] },
      conversionRecord: { findMany: async () => [] },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/booking-wins",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { vm: { wins: unknown[] } }).vm.wins).toEqual([]);
  });

  it("returns 404 for non-alex agents (booking is Alex-exclusive)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/riley/booking-wins",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 503 when the database is unavailable", async () => {
    // harness decorates prisma:null by default → DB unavailable
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/agents/alex/booking-wins",
      headers: { "x-org-id": "org-A" },
    });
    expect(res.statusCode).toBe(503);
  });
});
