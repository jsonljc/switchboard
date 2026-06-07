import { describe, expect, it, vi } from "vitest";
import { PrismaRecommendationStore } from "../recommendation-store.js";
import type { PrismaClient } from "@prisma/client";

/**
 * Slice 4f: markActedByExecution, the MACHINE sibling of applyAct.
 * Mocked Prisma per repo doctrine (CI has no Postgres); mirrors
 * recommendation-store.test.ts's interactive-$transaction pattern.
 */

const ROW = {
  id: "rec_1",
  organizationId: "org-1",
  sourceAgent: "riley",
  intent: "recommendation.pause",
  humanSummary: "Pause Campaign A",
  confidence: 0.9,
  dollarsAtRisk: 120,
  riskLevel: "high",
  surface: "queue",
  status: "pending",
  parameters: {
    source: "audit",
    __recommendation: {
      action: "pause",
      note: "operator note that must survive",
      riskContract: { riskLevel: "high", externalEffect: true },
    },
  },
  targetEntities: { campaignId: "camp_1", campaignName: "Campaign A" },
  sourceWorkflow: "audit_run_1",
  resolvedBy: null,
  resolvedAt: null,
  createdAt: new Date("2026-06-06T00:00:00Z"),
  expiresAt: new Date("2026-06-06T08:00:00Z"),
  undoableUntil: null,
};

function mockPrisma(opts?: { row?: typeof ROW | null; updateCount?: number }) {
  const prisma = {
    pendingActionRecord: {
      findFirst: vi.fn(async (_args: { where: Record<string, unknown> }) =>
        opts?.row === undefined ? ROW : opts.row,
      ),
      updateMany: vi.fn(
        async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
          count: opts?.updateCount ?? 1,
        }),
      ),
    },
    auditEntry: {
      create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(prisma),
  );
  return prisma;
}

const ARGS = {
  id: "rec_1",
  organizationId: "org-1",
  executableWorkUnitId: "wu_99",
  resolvedBy: "riley_self_execution",
  executedAt: new Date("2026-06-07T03:30:00Z"),
};

describe("PrismaRecommendationStore.markActedByExecution", () => {
  it("transitions pending -> acted conditionally and stashes the work-unit id (sibling keys preserved)", async () => {
    const prisma = mockPrisma();
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    const result = await store.markActedByExecution(ARGS);
    expect(result).toEqual({ transitioned: true });

    const update = prisma.pendingActionRecord.updateMany.mock.calls[0]![0];
    // The serialization point: id + org + status pending + recommendation intent only.
    expect(update.where).toEqual({
      id: "rec_1",
      organizationId: "org-1",
      status: "pending",
      intent: { startsWith: "recommendation." },
    });
    expect(update.data).toMatchObject({
      status: "acted",
      resolvedAt: ARGS.executedAt,
      resolvedBy: "riley_self_execution",
    });
    const params = update.data.parameters as {
      source: string;
      __recommendation: Record<string, unknown>;
    };
    // Review-requested pin: TOP-LEVEL parameter siblings survive the merge
    // (exactly the kind of thing future refactors break).
    expect(params.source).toBe("audit");
    expect(params.__recommendation).toEqual({
      action: "pause",
      note: "operator note that must survive",
      riskContract: { riskLevel: "high", externalEffect: true },
      executedWorkUnitId: "wu_99",
    });
  });

  it("cannot touch non-recommendation or cross-org rows: both WHEREs carry org + the intent prefix", async () => {
    // Mocked Prisma cannot evaluate predicates, so the WHERE shapes ARE the
    // pins: PendingActionRecord also hosts workflow approval rows, and a
    // forged id from another org must resolve to nothing. Both the existence
    // read and the conditional write carry organizationId AND the
    // recommendation intent prefix.
    const prisma = mockPrisma();
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    await store.markActedByExecution({ ...ARGS, organizationId: "org-OTHER" });
    const read = prisma.pendingActionRecord.findFirst.mock.calls[0]![0];
    expect(read.where).toMatchObject({
      organizationId: "org-OTHER",
      intent: { startsWith: "recommendation." },
    });
    const update = prisma.pendingActionRecord.updateMany.mock.calls[0]![0];
    expect(update.where).toMatchObject({
      organizationId: "org-OTHER",
      status: "pending",
      intent: { startsWith: "recommendation." },
    });
  });

  it("writes one audit entry on success, mirroring applyAct's shape with machine actor", async () => {
    const prisma = mockPrisma();
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    await store.markActedByExecution(ARGS);
    expect(prisma.auditEntry.create).toHaveBeenCalledTimes(1);
    const audit = prisma.auditEntry.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(audit).toMatchObject({
      eventType: "recommendation.act",
      actorType: "system",
      actorId: "riley_self_execution",
      entityType: "recommendation",
      entityId: "rec_1",
      riskCategory: "high",
      summary: "Pause Campaign A",
      organizationId: "org-1",
      snapshot: { from: "pending", to: "acted", note: null, executableWorkUnitId: "wu_99" },
    });
    expect(typeof audit.entryHash).toBe("string");
    expect((audit.entryHash as string).length).toBe(64);
  });

  it("count===0 is a benign first-writer-wins no-op: not_pending, NO audit row, no throw", async () => {
    const prisma = mockPrisma({ updateCount: 0 });
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    const result = await store.markActedByExecution(ARGS);
    expect(result).toEqual({ transitioned: false, reason: "not_pending" });
    expect(prisma.auditEntry.create).not.toHaveBeenCalled();
  });

  it("missing row (or cross-org id) is not_found, no update attempted", async () => {
    const prisma = mockPrisma({ row: null });
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    const result = await store.markActedByExecution(ARGS);
    expect(result).toEqual({ transitioned: false, reason: "not_found" });
    expect(prisma.pendingActionRecord.updateMany).not.toHaveBeenCalled();
    // The existence read itself must be org-scoped and recommendation-only.
    const read = prisma.pendingActionRecord.findFirst.mock.calls[0]![0];
    expect(read.where).toEqual({
      id: "rec_1",
      organizationId: "org-1",
      intent: { startsWith: "recommendation." },
    });
  });

  it("infra errors propagate (the executor catches them, never this method)", async () => {
    const prisma = mockPrisma();
    prisma.pendingActionRecord.updateMany.mockRejectedValueOnce(new Error("db down"));
    const store = new PrismaRecommendationStore(prisma as unknown as PrismaClient);
    await expect(store.markActedByExecution(ARGS)).rejects.toThrow("db down");
  });
});
