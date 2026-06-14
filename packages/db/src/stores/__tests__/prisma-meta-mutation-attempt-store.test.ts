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
}) {
  return {
    metaMutationAttempt: {
      create: vi.fn(over?.create ?? (async () => ROW)),
      findUnique: vi.fn(over?.findUnique ?? (async () => null)),
    },
  };
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
