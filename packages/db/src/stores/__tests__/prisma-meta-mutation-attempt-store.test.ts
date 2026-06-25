import { describe, it, expect, vi } from "vitest";
import { PrismaMetaMutationAttemptStore } from "../prisma-meta-mutation-attempt-store.js";
import type { PrismaClient } from "@prisma/client";

/**
 * Spec-1B PR 1B-1.4: the at-most-once marker + lease store. Mocked Prisma per repo doctrine
 * (CI has no Postgres); the real executionWorkUnitId @unique enforcement is the DB constraint the
 * migration creates + the drift check validates. These tests pin the store contract: create
 * persists the full payload, findByExecutionWorkUnitId replays by the unique key, and a duplicate
 * (P2002) is NEVER swallowed so the PR 1B-1.5 executor can replay instead of double-writing.
 */

const INPUT = {
  organizationId: "org-1",
  adAccountId: "act_123",
  campaignId: "camp_1",
  executionWorkUnitId: "wu_1",
  status: "pending" as const,
  heldUntil: new Date("2026-06-07T04:00:00Z"),
  observedPriorCents: 5000,
  requestedToCents: 6000,
  workTraceId: "trace_1",
};

const ROW = {
  id: "mma_1",
  createdAt: new Date("2026-06-07T03:30:00Z"),
  updatedAt: new Date("2026-06-07T03:30:00Z"),
  ...INPUT,
};

function mockPrisma(over?: {
  create?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  findUnique?: (args: { where: Record<string, unknown> }) => Promise<unknown>;
  findFirst?: (args: { where: Record<string, unknown> }) => Promise<unknown>;
  findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
  updateMany?: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<{
    count: number;
  }>;
}) {
  const prisma = {
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
    metaMutationAttempt: {
      create: vi.fn(over?.create ?? (async () => ROW)),
      findUnique: vi.fn(over?.findUnique ?? (async () => null)),
      findFirst: vi.fn(over?.findFirst ?? (async () => null)),
      findMany: vi.fn(over?.findMany ?? (async () => [])),
      updateMany: vi.fn(over?.updateMany ?? (async () => ({ count: 1 }))),
    },
  };
  // The interactive $transaction passes the same client as the tx (mirrors the repo's other
  // store tests); raw advisory-lock + findFirst + create all run on it.
  prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb(prisma),
  );
  return prisma;
}

describe("PrismaMetaMutationAttemptStore (Spec-1B at-most-once marker + lease)", () => {
  it("create persists the full marker payload and round-trips the row", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const row = await store.create(INPUT);
    expect(row).toBe(ROW);
    expect(prisma.metaMutationAttempt.create.mock.calls[0]![0]).toEqual({
      data: {
        organizationId: "org-1",
        adAccountId: "act_123",
        campaignId: "camp_1",
        executionWorkUnitId: "wu_1",
        status: "pending",
        heldUntil: INPUT.heldUntil,
        observedPriorCents: 5000,
        requestedToCents: 6000,
        workTraceId: "trace_1",
        deploymentId: null,
      },
    });
  });

  it("defaults workTraceId to null when omitted (no trace yet at marker time)", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const { workTraceId: _omit, ...without } = INPUT;
    await store.create(without);
    const data = (
      prisma.metaMutationAttempt.create.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;
    expect(data.workTraceId).toBeNull();
  });

  it("findByExecutionWorkUnitId replays by the unique key", async () => {
    const prisma = mockPrisma({ findUnique: async () => ROW });
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const found = await store.findByExecutionWorkUnitId("wu_1");
    expect(found).toBe(ROW);
    expect(prisma.metaMutationAttempt.findUnique.mock.calls[0]![0]).toEqual({
      where: { executionWorkUnitId: "wu_1" },
    });
  });

  it("findByExecutionWorkUnitId returns null when no marker exists (no prior attempt)", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    expect(await store.findByExecutionWorkUnitId("wu_absent")).toBeNull();
  });

  it("a duplicate executionWorkUnitId (P2002) PROPAGATES, never swallowed - the caller replays instead of double-writing", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const prisma = mockPrisma({
      create: async () => {
        throw p2002;
      },
    });
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    await expect(store.create(INPUT)).rejects.toMatchObject({ code: "P2002" });
  });
});

const CLAIM = {
  organizationId: "org-1",
  adAccountId: "act_123",
  campaignId: "camp_1",
  executionWorkUnitId: "wu_1",
  observedPriorCents: 5000,
  requestedToCents: 6000,
  workTraceId: "trace_1",
  now: new Date("2026-06-07T03:30:00Z"),
};

describe("PrismaMetaMutationAttemptStore.claimLeaseAndMark (advisory-locked conditional claim)", () => {
  it("with no active competing marker: advisory-locks the campaign, then creates a pending marker", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const result = await store.claimLeaseAndMark(CLAIM);
    expect(result).toEqual({ claimed: true, row: ROW });
    // The advisory lock is taken (serializes concurrent claims on the same campaign) inside the tx.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The competing-marker probe is scoped to the campaign + only ACTIVE (unresolved, unexpired) rows.
    const probe = prisma.metaMutationAttempt.findFirst.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(probe.where).toMatchObject({
      organizationId: "org-1",
      adAccountId: "act_123",
      campaignId: "camp_1",
      status: { in: ["pending", "recovery_required"] },
      heldUntil: { gt: CLAIM.now },
    });
    const created = prisma.metaMutationAttempt.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(created.data).toMatchObject({
      organizationId: "org-1",
      adAccountId: "act_123",
      campaignId: "camp_1",
      executionWorkUnitId: "wu_1",
      status: "pending",
      observedPriorCents: 5000,
      requestedToCents: 6000,
      workTraceId: "trace_1",
    });
    // heldUntil is now + the lease TTL (a future instant), so the row is an active lease.
    expect((created.data.heldUntil as Date).getTime()).toBeGreaterThan(CLAIM.now.getTime());
  });

  it("contention: an active competing marker on the campaign -> claimed:false, NO create (LEASE_CONTENDED upstream)", async () => {
    const prisma = mockPrisma({
      findFirst: async () => ({ ...ROW, executionWorkUnitId: "wu_other" }),
    });
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const result = await store.claimLeaseAndMark(CLAIM);
    expect(result).toEqual({ claimed: false });
    expect(prisma.metaMutationAttempt.create).not.toHaveBeenCalled();
    // The lock is still taken before the probe (the probe is only meaningful under the lock).
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe("PrismaMetaMutationAttemptStore status transitions", () => {
  it("markApplied flips a pending marker to applied (org+pending scoped) and reports transitioned", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const res = await store.markApplied({ executionWorkUnitId: "wu_1", organizationId: "org-1" });
    expect(res).toEqual({ transitioned: true });
    const call = prisma.metaMutationAttempt.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({
      executionWorkUnitId: "wu_1",
      organizationId: "org-1",
      status: "pending",
    });
    expect(call.data).toMatchObject({ status: "applied" });
  });

  it("markApplied on a non-pending marker is a benign no-op (count 0 -> transitioned:false, no throw)", async () => {
    const prisma = mockPrisma({ updateMany: async () => ({ count: 0 }) });
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    expect(
      await store.markApplied({ executionWorkUnitId: "wu_1", organizationId: "org-1" }),
    ).toEqual({ transitioned: false });
  });

  it("markRecoveryRequired flips a pending marker to recovery_required (blocks auto-replay)", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const res = await store.markRecoveryRequired({
      executionWorkUnitId: "wu_1",
      organizationId: "org-1",
    });
    expect(res).toEqual({ transitioned: true });
    const call = prisma.metaMutationAttempt.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({
      executionWorkUnitId: "wu_1",
      organizationId: "org-1",
      status: "pending",
    });
    expect(call.data).toMatchObject({ status: "recovery_required" });
  });
});

describe("PrismaMetaMutationAttemptStore guardrail-monitoring (PR-3)", () => {
  it("claimLeaseAndMark stamps the deploymentId on the pending marker", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    await store.claimLeaseAndMark({ ...CLAIM, deploymentId: "dep_riley" });
    const created = prisma.metaMutationAttempt.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.deploymentId).toBe("dep_riley");
  });

  it("claimLeaseAndMark defaults deploymentId to null when omitted", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    await store.claimLeaseAndMark(CLAIM);
    const created = prisma.metaMutationAttempt.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.deploymentId).toBeNull();
  });

  it("listOrgsWithPendingGuardrail returns distinct orgs with applied, un-monitored, window-elapsed rows", async () => {
    const NOW = new Date("2026-06-25T12:00:00Z");
    const prisma = mockPrisma({
      findMany: async () => [{ organizationId: "org-a" }, { organizationId: "org-b" }],
    });
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const orgs = await store.listOrgsWithPendingGuardrail(NOW, 72 * 60 * 60 * 1000);
    expect(orgs).toEqual(["org-a", "org-b"]);
    const call = prisma.metaMutationAttempt.findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      distinct?: string[];
      select?: Record<string, unknown>;
    };
    expect(call.where).toEqual({
      status: "applied",
      guardrailOutcome: null,
      updatedAt: { lte: new Date(NOW.getTime() - 72 * 60 * 60 * 1000) },
    });
    expect(call.distinct).toEqual(["organizationId"]);
    expect(call.select).toEqual({ organizationId: true });
  });

  it("listPendingGuardrailForOrg returns the monitor's fields with appliedAt = updatedAt", async () => {
    const NOW = new Date("2026-06-25T12:00:00Z");
    const updatedAt = new Date("2026-06-22T09:00:00Z");
    const prisma = mockPrisma({
      findMany: async () => [
        {
          executionWorkUnitId: "wu_1",
          organizationId: "org-a",
          deploymentId: "dep_riley",
          adAccountId: "act_1",
          campaignId: "camp_1",
          observedPriorCents: 5000,
          updatedAt,
        },
      ],
    });
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const rows = await store.listPendingGuardrailForOrg("org-a", NOW, 72 * 60 * 60 * 1000);
    expect(rows).toEqual([
      {
        executionWorkUnitId: "wu_1",
        organizationId: "org-a",
        deploymentId: "dep_riley",
        adAccountId: "act_1",
        campaignId: "camp_1",
        observedPriorCents: 5000,
        appliedAt: updatedAt,
      },
    ]);
    const call = prisma.metaMutationAttempt.findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toEqual({
      organizationId: "org-a",
      status: "applied",
      guardrailOutcome: null,
      updatedAt: { lte: new Date(NOW.getTime() - 72 * 60 * 60 * 1000) },
    });
  });

  it("markGuardrailOutcome is first-writer-wins (applied + guardrailOutcome IS NULL scoped)", async () => {
    const prisma = mockPrisma();
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    const res = await store.markGuardrailOutcome({
      executionWorkUnitId: "wu_1",
      organizationId: "org-a",
      outcome: "rolled_back",
    });
    expect(res).toEqual({ transitioned: true });
    const call = prisma.metaMutationAttempt.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({
      executionWorkUnitId: "wu_1",
      organizationId: "org-a",
      status: "applied",
      guardrailOutcome: null,
    });
    expect(call.data).toEqual({ guardrailOutcome: "rolled_back" });
  });

  it("markGuardrailOutcome on an already-resolved row is a benign no-op (count 0)", async () => {
    const prisma = mockPrisma({ updateMany: async () => ({ count: 0 }) });
    const store = new PrismaMetaMutationAttemptStore(prisma as unknown as PrismaClient);
    expect(
      await store.markGuardrailOutcome({
        executionWorkUnitId: "wu_1",
        organizationId: "org-a",
        outcome: "held",
      }),
    ).toEqual({ transitioned: false });
  });
});
