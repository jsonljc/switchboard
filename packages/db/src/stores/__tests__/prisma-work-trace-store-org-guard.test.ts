import { describe, it, expect, vi, afterEach } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { AuditLedger, InMemoryLedgerStorage, NoopOperatorAlerter } from "@switchboard/core";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row_1",
    workUnitId: "wu_1",
    traceId: "t_1",
    parentWorkUnitId: null,
    intent: "test.intent",
    mode: "skill",
    organizationId: "org_1",
    actorId: "actor_1",
    actorType: "user",
    trigger: "api",
    idempotencyKey: null,
    parameters: null,
    deploymentContext: null,
    governanceOutcome: "execute",
    riskScore: 0,
    matchedPolicies: "[]",
    governanceConstraints: null,
    approvalId: null,
    approvalOutcome: null,
    approvalRespondedBy: null,
    approvalRespondedAt: null,
    outcome: "running",
    durationMs: 0,
    errorCode: null,
    errorMessage: null,
    executionSummary: null,
    executionOutputs: null,
    modeMetrics: null,
    requestedAt: new Date("2026-04-28T00:00:00Z"),
    governanceCompletedAt: new Date("2026-04-28T00:00:01Z"),
    executionStartedAt: null,
    completedAt: null,
    lockedAt: null,
    ...overrides,
  };
}

function makePrismaMock(currentRow: Record<string, unknown>) {
  const updateFn = vi
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...currentRow,
      ...data,
    }));
  const findUnique = vi.fn().mockResolvedValue(currentRow);
  const txClient = { workTrace: { findUnique, update: updateFn } };
  return {
    workTrace: { findUnique, update: updateFn },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(txClient)),
    _updateFn: updateFn,
    _findUnique: findUnique,
  };
}

function makeStore(prisma: ReturnType<typeof makePrismaMock>) {
  return new PrismaWorkTraceStore(prisma as never, {
    auditLedger: new AuditLedger(new InMemoryLedgerStorage()),
    operatorAlerter: new NoopOperatorAlerter(),
  });
}

describe("PrismaWorkTraceStore.update — opt-in organizationId tripwire (#643)", () => {
  it("proceeds when expected organizationId matches the fetched row", async () => {
    const prisma = makePrismaMock(makeRow({ organizationId: "org_1" }));
    const store = makeStore(prisma);

    const result = await store.update(
      "wu_1",
      { outcome: "completed", durationMs: 5, completedAt: "2026-04-28T00:00:02.000Z" },
      { caller: "test", organizationId: "org_1" },
    );

    expect(result.ok).toBe(true);
    expect(prisma._updateFn).toHaveBeenCalledTimes(1);
  });

  it("throws and never writes when expected organizationId mismatches the row", async () => {
    const prisma = makePrismaMock(makeRow({ organizationId: "org_1" }));
    const store = makeStore(prisma);

    await expect(
      store.update(
        "wu_1",
        { outcome: "completed", durationMs: 5 },
        { caller: "test", organizationId: "org_2" },
      ),
    ).rejects.toThrow(/WorkTrace not found: wu_1/);
    expect(prisma._updateFn).not.toHaveBeenCalled();
  });

  it("does not guard when no expected organizationId is supplied (back-compat)", async () => {
    const prisma = makePrismaMock(makeRow({ organizationId: "org_1" }));
    const store = makeStore(prisma);

    const result = await store.update(
      "wu_1",
      { outcome: "completed", durationMs: 5, completedAt: "2026-04-28T00:00:02.000Z" },
      { caller: "test" },
    );

    expect(result.ok).toBe(true);
    expect(prisma._updateFn).toHaveBeenCalledTimes(1);
  });
});
