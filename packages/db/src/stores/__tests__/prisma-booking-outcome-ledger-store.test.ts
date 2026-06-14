import { describe, it, expect, vi, beforeEach } from "vitest";
import { deriveLinkedOutcome } from "@switchboard/core/skill-runtime";
import type { ToolCallRecord } from "@switchboard/core/skill-runtime";
import { PrismaBookingOutcomeLedgerStore } from "../prisma-booking-outcome-ledger-store.js";

// A successful Alex booking tool call — the real producer input.
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

function makePrisma() {
  return {
    executionTrace: { findMany: vi.fn().mockResolvedValue([]) },
    booking: { findMany: vi.fn().mockResolvedValue([]) },
    conversionRecord: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

describe("PrismaBookingOutcomeLedgerStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaBookingOutcomeLedgerStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaBookingOutcomeLedgerStore(prisma as never);
  });

  it("joins a producer-written booking outcome to its trace and revenue", async () => {
    // PRODUCER: derive the outcome exactly as TracePersistenceHook would.
    const outcome = deriveLinkedOutcome([bookingCall("bk_1")], "trace_1");
    expect(outcome).toEqual({ id: "bk_1", type: "booking", result: "booked" });

    // The persisted trace carries that producer output.
    prisma.executionTrace.findMany.mockResolvedValue([
      {
        id: "trace_1",
        deploymentId: "dep_alex",
        skillSlug: "alex",
        linkedOutcomeId: outcome!.id,
      },
    ]);
    prisma.booking.findMany.mockResolvedValue([
      {
        id: "bk_1",
        contactId: "c_1",
        service: "botox",
        status: "confirmed",
        startsAt: new Date("2026-06-12T03:00:00Z"),
      },
    ]);
    prisma.conversionRecord.findMany.mockResolvedValue([
      {
        bookingId: "bk_1",
        value: 45000,
        sourceCampaignId: "camp_9",
        sourceAdId: "ad_3",
        occurredAt: new Date("2026-06-12T03:00:00Z"),
      },
    ]);

    const rows = await store.listForOrg({ orgId: "org_1", limit: 50 });

    expect(rows).toEqual([
      {
        traceId: "trace_1",
        deploymentId: "dep_alex",
        skillSlug: "alex",
        outcome: "booked",
        bookingId: "bk_1",
        contactId: "c_1",
        service: "botox",
        bookingStatus: "confirmed",
        bookedAt: new Date("2026-06-12T03:00:00Z"),
        value: 45000,
        sourceCampaignId: "camp_9",
        sourceAdId: "ad_3",
        occurredAt: new Date("2026-06-12T03:00:00Z"),
      },
    ]);
    // org-scoped on every leg
    expect(prisma.executionTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", linkedOutcomeType: "booking" },
      }),
    );
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", id: { in: ["bk_1"] } },
      }),
    );
    expect(prisma.conversionRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", bookingId: { in: ["bk_1"] }, type: "booked" },
      }),
    );
  });

  it("returns the booking outcome with null revenue until the conversion settles", async () => {
    prisma.executionTrace.findMany.mockResolvedValue([
      { id: "trace_2", deploymentId: "dep_alex", skillSlug: "alex", linkedOutcomeId: "bk_2" },
    ]);
    prisma.booking.findMany.mockResolvedValue([
      {
        id: "bk_2",
        contactId: "c_2",
        service: "filler",
        status: "confirmed",
        startsAt: new Date("2026-06-13T03:00:00Z"),
      },
    ]);
    // conversionRecord.findMany stays [] (async, not settled yet)

    const rows = await store.listForOrg({ orgId: "org_1", limit: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBeNull();
    expect(rows[0]!.sourceCampaignId).toBeNull();
    expect(rows[0]!.occurredAt).toBeNull();
    expect(rows[0]!.bookingId).toBe("bk_2");
  });

  it("returns empty when no traces carry a booking outcome (today's state)", async () => {
    const rows = await store.listForOrg({ orgId: "org_1", limit: 50 });
    expect(rows).toEqual([]);
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it("skips a trace whose booking is absent in the org", async () => {
    prisma.executionTrace.findMany.mockResolvedValue([
      { id: "trace_3", deploymentId: "dep_alex", skillSlug: "alex", linkedOutcomeId: "bk_gone" },
    ]);
    prisma.booking.findMany.mockResolvedValue([]); // not found / other org
    const rows = await store.listForOrg({ orgId: "org_1", limit: 50 });
    expect(rows).toEqual([]);
  });
});
