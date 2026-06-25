import { describe, it, expect, vi } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { AuditLedger, InMemoryLedgerStorage, NoopOperatorAlerter } from "@switchboard/core";

// EV-2 / SPINE-2: findStuckRunning is the bounded scan the stranded-claim reaper runs.
// It must target ONLY keyed `running` ingress claims older than the cutoff — never the
// keyless `running` rows that conversation/lifecycle turns persist (which would break
// live conversations if reaped).
function makeStore(findMany: ReturnType<typeof vi.fn>): PrismaWorkTraceStore {
  const prisma = { workTrace: { findMany }, $transaction: vi.fn() };
  return new PrismaWorkTraceStore(prisma as never, {
    auditLedger: new AuditLedger(new InMemoryLedgerStorage()),
    operatorAlerter: new NoopOperatorAlerter(),
  });
}

describe("PrismaWorkTraceStore.findStuckRunning", () => {
  it("scans only KEYED running claims older than the cutoff, oldest-first, bounded by limit", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const store = makeStore(findMany);
    const olderThan = new Date("2026-06-25T11:30:00.000Z");

    await store.findStuckRunning(olderThan, 250);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        outcome: "running",
        // idempotencyKey IS NOT NULL excludes keyless conversation/lifecycle running rows.
        idempotencyKey: { not: null },
        executionStartedAt: { lt: olderThan },
      },
      orderBy: { executionStartedAt: "asc" },
      take: 250,
      select: {
        workUnitId: true,
        organizationId: true,
        idempotencyKey: true,
        intent: true,
        traceId: true,
        executionStartedAt: true,
      },
    });
  });

  it("maps rows to StrandedRunningClaim with executionStartedAt as an ISO string", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        workUnitId: "wu_a",
        organizationId: "org_1",
        idempotencyKey: "pay:org_1:wk26",
        intent: "payment.record_verified",
        traceId: "tr_a",
        executionStartedAt: new Date("2026-06-25T11:00:00.000Z"),
      },
    ]);
    const store = makeStore(findMany);

    const out = await store.findStuckRunning(new Date("2026-06-25T11:30:00.000Z"), 500);

    expect(out).toEqual([
      {
        workUnitId: "wu_a",
        organizationId: "org_1",
        idempotencyKey: "pay:org_1:wk26",
        intent: "payment.record_verified",
        traceId: "tr_a",
        executionStartedAt: "2026-06-25T11:00:00.000Z",
      },
    ]);
  });

  it("coerces a null executionStartedAt to null (defensive; keyed claims normally set it)", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        workUnitId: "wu_b",
        organizationId: "org_2",
        idempotencyKey: "k_b",
        intent: "revenue.record",
        traceId: "tr_b",
        executionStartedAt: null,
      },
    ]);
    const store = makeStore(findMany);

    const out = await store.findStuckRunning(new Date(), 500);

    expect(out[0]!.executionStartedAt).toBeNull();
  });
});

// A full running-claim row + a mock that runs the REAL update() path (real validateUpdate
// + hash bump + audit anchor + data builder) so the reaper's exact write contract is
// pinned against the actual store, mocked Prisma (no Postgres). Mirrors the lock test's
// makePrismaMock harness.
function makeClaimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row_1",
    workUnitId: "wu_stranded",
    traceId: "t_stranded",
    parentWorkUnitId: null,
    intent: "payment.record_verified",
    mode: "operator_mutation",
    organizationId: "org_1",
    actorId: "system",
    actorType: "system",
    trigger: "api",
    idempotencyKey: "pay:org_1:wk26",
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
    injectedPatternIds: [],
    contactId: null,
    conversationThreadId: null,
    qualificationSignals: null,
    modeMetrics: null,
    requestedAt: new Date("2026-06-25T11:00:00.000Z"),
    governanceCompletedAt: new Date("2026-06-25T11:00:00.050Z"),
    executionStartedAt: new Date("2026-06-25T11:00:00.060Z"),
    completedAt: null,
    lockedAt: null,
    contentHash: "hash_v1",
    traceVersion: 1,
    ingressPath: "platform_ingress",
    hashInputVersion: 2,
    ...overrides,
  };
}

function makeUpdateStore(currentRow: Record<string, unknown>) {
  const update = vi
    .fn()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...currentRow,
      ...data,
    }));
  const findUnique = vi.fn().mockResolvedValue(currentRow);
  const txClient = { workTrace: { findUnique, update } };
  const prisma = {
    workTrace: { findUnique, update },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(txClient)),
    _update: update,
  };
  const store = new PrismaWorkTraceStore(prisma as never, {
    auditLedger: new AuditLedger(new InMemoryLedgerStorage()),
    operatorAlerter: new NoopOperatorAlerter(),
  });
  return { store, prisma };
}

describe("PrismaWorkTraceStore.update — reaper running -> needs_reconciliation (real update path)", () => {
  it("accepts the reaper payload, seals the row, maps the fields, and bumps the hash/version", async () => {
    const { store, prisma } = makeUpdateStore(makeClaimRow());

    // The exact write reapStrandedClaims issues.
    const result = await store.update(
      "wu_stranded",
      {
        outcome: "needs_reconciliation",
        completedAt: "2026-06-25T12:00:00.000Z",
        error: { code: "STRANDED_CLAIM_REAPED", message: "stranded; aged to needs_reconciliation" },
        executionSummary: "Stranded idempotency claim reaped to needs_reconciliation (EV-2)",
      },
      { caller: "stranded_claim_reaper", organizationId: "org_1" },
    );

    expect(result.ok).toBe(true); // running -> needs_reconciliation allowed by the REAL validateUpdate
    const data = prisma._update.mock.calls[0]![0].data;
    expect(data.outcome).toBe("needs_reconciliation");
    expect(data.errorCode).toBe("STRANDED_CLAIM_REAPED");
    expect(data.errorMessage).toContain("needs_reconciliation");
    expect(data.executionSummary).toContain("EV-2");
    expect(data.completedAt).toBeInstanceOf(Date);
    // needs_reconciliation is terminal -> the real store stamps lockedAt (seals the row).
    expect(data.lockedAt).toBeInstanceOf(Date);
    // A hash-relevant change bumps the version + recomputes the content hash.
    expect(data.traceVersion).toBe(2);
    expect(typeof data.contentHash).toBe("string");
    expect(data.contentHash).not.toBe("hash_v1");
  });
});
