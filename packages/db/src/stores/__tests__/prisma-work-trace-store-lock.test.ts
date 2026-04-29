import { describe, it, expect, vi, afterEach } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { WorkTraceLockedError } from "@switchboard/core/platform";
import { AuditLedger, InMemoryLedgerStorage, NoopOperatorAlerter } from "@switchboard/core";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
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

describe("PrismaWorkTraceStore.update — lock enforcement", () => {
  it("returns ok and stamps lockedAt on terminal transition", async () => {
    const prisma = makePrismaMock(makeRow({ outcome: "running", lockedAt: null }));
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    const store = new PrismaWorkTraceStore(prisma as never, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });
    const result = await store.update("wu_1", {
      outcome: "completed",
      executionOutputs: { ok: true },
      durationMs: 123,
      completedAt: "2026-04-28T00:00:02.000Z",
    });
    expect(result.ok).toBe(true);
    const args = prisma._updateFn.mock.calls[0]![0];
    expect(args.data.outcome).toBe("completed");
    expect(args.data.lockedAt).toBeInstanceOf(Date);
  });

  it("returns typed conflict (production) on locked-trace mutation; row unchanged", async () => {
    process.env.NODE_ENV = "production";
    const locked = makeRow({
      outcome: "completed",
      lockedAt: new Date("2026-04-28T00:00:02Z"),
    });
    const prisma = makePrismaMock(locked);
    const auditLedger = { record: vi.fn().mockResolvedValue(undefined) };
    const alerter = { alert: vi.fn().mockResolvedValue(undefined) };
    const store = new PrismaWorkTraceStore(prisma as never, {
      auditLedger: auditLedger as never,
      operatorAlerter: alerter,
    });

    const result = await store.update("wu_1", { executionOutputs: { tampered: true } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("WORK_TRACE_LOCKED");
    expect(result.traceUnchanged).toBe(true);
    expect(typeof result.reason).toBe("string");
    expect(prisma._updateFn).not.toHaveBeenCalled();
    expect(auditLedger.record).toHaveBeenCalledTimes(1);
    expect(auditLedger.record.mock.calls[0]![0].snapshot).toMatchObject({
      errorType: "work_trace_locked_violation",
      failureClass: "infrastructure",
    });
    expect(alerter.alert).toHaveBeenCalledTimes(1);
    expect(alerter.alert.mock.calls[0]![0]).toMatchObject({
      errorType: "work_trace_locked_violation",
    });
  });

  it("throws WorkTraceLockedError in non-production env", async () => {
    process.env.NODE_ENV = "test";
    const locked = makeRow({
      outcome: "completed",
      lockedAt: new Date("2026-04-28T00:00:02Z"),
    });
    const prisma = makePrismaMock(locked);
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    const store = new PrismaWorkTraceStore(prisma as never, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });

    await expect(
      store.update("wu_1", { executionOutputs: { tampered: true } }),
    ).rejects.toBeInstanceOf(WorkTraceLockedError);
    expect(prisma._updateFn).not.toHaveBeenCalled();
  });

  it("typed conflict in prod (noop alerter + real ledger, never silently drops)", async () => {
    process.env.NODE_ENV = "production";
    const locked = makeRow({
      outcome: "completed",
      lockedAt: new Date("2026-04-28T00:00:02Z"),
    });
    const prisma = makePrismaMock(locked);
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    const store = new PrismaWorkTraceStore(prisma as never, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });

    const result = await store.update("wu_1", { executionOutputs: { tampered: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.traceUnchanged).toBe(true);
    expect(prisma._updateFn).not.toHaveBeenCalled();
  });

  it("read-modify-write inside a single transaction", async () => {
    const prisma = makePrismaMock(makeRow({ outcome: "running" }));
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    const store = new PrismaWorkTraceStore(prisma as never, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });
    await store.update("wu_1", { outcome: "running", durationMs: 50 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
