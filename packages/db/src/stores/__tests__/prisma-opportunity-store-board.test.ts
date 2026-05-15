import { describe, it, expect, vi } from "vitest";
import { PrismaOpportunityStore } from "../prisma-opportunity-store.js";
import type { PrismaDbClient } from "../../prisma-db.js";
import { OpportunityNotFoundError } from "@switchboard/core/lifecycle";

function mkPrismaMock() {
  return {
    opportunity: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        opportunity: { findFirst: vi.fn(), update: vi.fn() },
      }),
    ),
  } as unknown as PrismaDbClient;
}

function mkTxClient(opts: { existing?: Record<string, unknown> | null }) {
  return {
    opportunity: {
      findFirst: vi.fn().mockResolvedValue(opts.existing ?? null),
      update: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...(opts.existing ?? {}),
          ...data,
          contact: (opts.existing as { contact?: unknown })?.contact ?? {
            id: "c_1",
            name: "Felicia",
            primaryChannel: "whatsapp",
          },
        }),
      ),
    },
  };
}

function mkPrismaWithTx(txClient: ReturnType<typeof mkTxClient>) {
  return {
    opportunity: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient)),
  } as unknown as PrismaDbClient;
}

describe("PrismaOpportunityStore.findOrgBoard", () => {
  it("filters by organizationId and includes the contact projection", async () => {
    const prisma = mkPrismaMock();
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const store = new PrismaOpportunityStore(prisma);
    await store.findOrgBoard("org_acme");
    const call = (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({ organizationId: "org_acme" });
    expect(call.include).toEqual({
      contact: { select: { id: true, name: true, primaryChannel: true } },
    });
    expect(call.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("maps rows to OpportunityBoardRow shape with Date fields preserved", async () => {
    const prisma = mkPrismaMock();
    const opened = new Date("2026-05-06T05:00:00Z");
    const updated = new Date("2026-05-13T07:19:00Z");
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "opp_1",
        organizationId: "org_acme",
        contactId: "c_1",
        serviceId: "svc",
        serviceName: "Service",
        stage: "quoted",
        timeline: "soon",
        priceReadiness: "flexible",
        objections: [],
        qualificationComplete: true,
        estimatedValue: 168000,
        revenueTotal: 0,
        assignedAgent: "alex",
        assignedStaff: null,
        lostReason: null,
        notes: null,
        openedAt: opened,
        closedAt: null,
        updatedAt: updated,
        contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
      },
    ]);
    const store = new PrismaOpportunityStore(prisma);
    const rows = await store.findOrgBoard("org_acme");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("opp_1");
    expect(rows[0]!.openedAt).toBeInstanceOf(Date);
    expect(rows[0]!.openedAt.toISOString()).toBe("2026-05-06T05:00:00.000Z");
    expect(rows[0]!.contact.name).toBe("Felicia");
  });

  it("returns [] for an org with no rows", async () => {
    const prisma = mkPrismaMock();
    (prisma.opportunity.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const store = new PrismaOpportunityStore(prisma);
    const rows = await store.findOrgBoard("org_empty");
    expect(rows).toEqual([]);
  });
});

describe("PrismaOpportunityStore.transitionStage", () => {
  // Post-Phase-1b.1 cleanup: the store mutates only the opportunity row.
  // WorkTrace persistence is owned by PlatformIngress.persistTrace upstream —
  // one operator stage transition emits exactly one WorkTrace (the ingress
  // one). The legacy store_recorded_operator_mutation write is gone.

  const existing = {
    id: "opp_1",
    organizationId: "org_acme",
    contactId: "c_1",
    serviceId: "svc",
    serviceName: "Service",
    stage: "quoted",
    timeline: "soon",
    priceReadiness: "flexible",
    objections: [],
    qualificationComplete: true,
    estimatedValue: 168000,
    revenueTotal: 0,
    assignedAgent: "alex",
    assignedStaff: null,
    lostReason: null,
    notes: null,
    openedAt: new Date("2026-05-06T05:00:00Z"),
    closedAt: null,
    updatedAt: new Date("2026-05-13T07:19:00Z"),
    contact: { id: "c_1", name: "Felicia", primaryChannel: "whatsapp" },
  };

  it("updates the row inside a single transaction and returns the board-row projection", async () => {
    const tx = mkTxClient({ existing });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma);

    const result = await store.transitionStage({
      orgId: "org_acme",
      id: "opp_1",
      stage: "booked",
      actor: { id: "user_42", type: "user" },
    });

    expect((prisma as unknown as { $transaction: unknown }).$transaction).toHaveBeenCalledTimes(1);
    expect(tx.opportunity.update).toHaveBeenCalledTimes(1);
    expect(result.opportunity.stage).toBe("booked");
  });

  it("sets closedAt when transitioning to a terminal stage", async () => {
    const tx = mkTxClient({ existing });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma);
    await store.transitionStage({
      orgId: "org_acme",
      id: "opp_1",
      stage: "won",
      actor: { id: "u", type: "user" },
    });
    const updateCall = tx.opportunity.update.mock.calls[0]![0];
    expect(updateCall.data.closedAt).toBeInstanceOf(Date);
  });

  it("clears closedAt when transitioning away from terminal", async () => {
    const tx = mkTxClient({ existing: { ...existing, stage: "won", closedAt: new Date() } });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma);
    await store.transitionStage({
      orgId: "org_acme",
      id: "opp_1",
      stage: "quoted",
      actor: { id: "u", type: "user" },
    });
    const updateCall = tx.opportunity.update.mock.calls[0]![0];
    expect(updateCall.data.closedAt).toBeNull();
  });

  it("throws OpportunityNotFoundError when the id is missing", async () => {
    const tx = mkTxClient({ existing: null });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma);
    await expect(
      store.transitionStage({
        orgId: "org_acme",
        id: "opp_missing",
        stage: "booked",
        actor: { id: "u", type: "user" },
      }),
    ).rejects.toBeInstanceOf(OpportunityNotFoundError);
  });

  it("throws OpportunityNotFoundError for cross-tenant id (findFirst with org filter returns null)", async () => {
    const tx = mkTxClient({ existing: null });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma);
    await expect(
      store.transitionStage({
        orgId: "org_other",
        id: "opp_1",
        stage: "booked",
        actor: { id: "u", type: "user" },
      }),
    ).rejects.toBeInstanceOf(OpportunityNotFoundError);

    expect(tx.opportunity.findFirst).toHaveBeenCalledWith({
      where: { id: "opp_1", organizationId: "org_other" },
      include: { contact: { select: { id: true, name: true, primaryChannel: true } } },
    });
  });

  it("does NOT call any WorkTrace store API (canonical persistence is owned by PlatformIngress)", async () => {
    // Regression guard: the only consumer of WorkTrace persistence for
    // operator stage transitions is PlatformIngress.persistTrace. If a
    // future change re-introduces a store-side WorkTrace write, this
    // assertion (combined with the absence of a constructor workTraceStore
    // parameter) gives a static-typing wall against duplication.
    const tx = mkTxClient({ existing });
    const prisma = mkPrismaWithTx(tx);
    const store = new PrismaOpportunityStore(prisma);
    await store.transitionStage({
      orgId: "org_acme",
      id: "opp_1",
      stage: "quoted",
      actor: { id: "u", type: "user" },
    });
    // No workTrace.create call in the transaction (the tx mock has no
    // workTrace field — would crash if the store reached for one).
    expect(tx.opportunity.update).toHaveBeenCalledTimes(1);
  });
});
