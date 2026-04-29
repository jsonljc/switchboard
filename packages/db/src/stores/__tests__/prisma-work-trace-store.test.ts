import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";
import { AuditLedger, InMemoryLedgerStorage, NoopOperatorAlerter } from "@switchboard/core";

function makeTrace(overrides: Record<string, unknown> = {}) {
  return {
    workUnitId: "wu_test1",
    traceId: "tr_test1",
    intent: "digital-ads.campaign.pause",
    mode: "cartridge" as const,
    organizationId: "org_1",
    actor: { id: "user_1", type: "user" as const },
    trigger: "api" as const,
    governanceOutcome: "execute" as const,
    riskScore: 25,
    matchedPolicies: ["TRUST_BEHAVIOR"],
    outcome: "completed" as const,
    durationMs: 150,
    requestedAt: "2026-04-16T10:00:00.000Z",
    governanceCompletedAt: "2026-04-16T10:00:00.050Z",
    executionStartedAt: "2026-04-16T10:00:00.060Z",
    completedAt: "2026-04-16T10:00:00.200Z",
    ingressPath: "platform_ingress" as const,
    hashInputVersion: 2,
    ...overrides,
  };
}

describe("PrismaWorkTraceStore", () => {
  const mockPrisma = {
    workTrace: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma)),
  };

  let store: PrismaWorkTraceStore;

  beforeEach(() => {
    vi.clearAllMocks();
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    store = new PrismaWorkTraceStore(mockPrisma as never, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });
  });

  it("persists a work trace with all fields", async () => {
    const trace = makeTrace();
    await store.persist(trace);

    expect(mockPrisma.workTrace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workUnitId: "wu_test1",
        traceId: "tr_test1",
        intent: "digital-ads.campaign.pause",
        mode: "cartridge",
        organizationId: "org_1",
        actorId: "user_1",
        actorType: "user",
        trigger: "api",
        governanceOutcome: "execute",
        riskScore: 25,
        matchedPolicies: JSON.stringify(["TRUST_BEHAVIOR"]),
        outcome: "completed",
        durationMs: 150,
        requestedAt: new Date("2026-04-16T10:00:00.000Z"),
        governanceCompletedAt: new Date("2026-04-16T10:00:00.050Z"),
        executionStartedAt: new Date("2026-04-16T10:00:00.060Z"),
        completedAt: new Date("2026-04-16T10:00:00.200Z"),
      }),
    });
  });

  it("persists a trace with optional fields omitted", async () => {
    const trace = makeTrace({
      parentWorkUnitId: undefined,
      executionStartedAt: undefined,
      error: undefined,
      modeMetrics: undefined,
    });
    await store.persist(trace);

    const call = mockPrisma.workTrace.create.mock.calls[0]![0];
    expect(call.data.parentWorkUnitId).toBeNull();
    expect(call.data.executionStartedAt).toBeNull();
    expect(call.data.errorCode).toBeNull();
    expect(call.data.errorMessage).toBeNull();
    expect(call.data.modeMetrics).toBeNull();
  });

  it("persists error details when present", async () => {
    const trace = makeTrace({
      outcome: "failed",
      error: { code: "RATE_LIMIT", message: "Too many requests" },
    });
    await store.persist(trace);

    const call = mockPrisma.workTrace.create.mock.calls[0]![0];
    expect(call.data.errorCode).toBe("RATE_LIMIT");
    expect(call.data.errorMessage).toBe("Too many requests");
  });
});

describe("PrismaWorkTraceStore.persist — new columns", () => {
  it("writes ingressPath and hashInputVersion to the row", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const tx = { workTrace: { create } };
    const prisma = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[0];
    const store = new PrismaWorkTraceStore(prisma, {
      auditLedger: { record: vi.fn().mockResolvedValue(undefined) } as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) } as never,
    });

    await store.persist(
      makeTrace({ ingressPath: "store_recorded_operator_mutation", hashInputVersion: 2 }),
    );

    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0]![0].data;
    expect(data.ingressPath).toBe("store_recorded_operator_mutation");
    expect(data.hashInputVersion).toBe(2);
  });

  it("round-trips hashInputVersion=1 through the deserializer (pre-migration row)", async () => {
    // Critical-issue C2 from Task 4 review: pre-migration rows have hashInputVersion=1.
    // The deserializer MUST copy that value through so update()'s
    // `merged.hashInputVersion ?? LATEST` reads 1, not LATEST. Otherwise we silently
    // re-hash pre-migration rows at v2, breaking their integrity verification path.
    const requestedAt = new Date("2026-04-01T00:00:00.000Z"); // pre-cutoff to skip anchor lookup
    const row = {
      workUnitId: "wu_pre_v1",
      traceId: "tr_pre_v1",
      parentWorkUnitId: null,
      intent: "test.intent",
      mode: "cartridge",
      organizationId: "org_pre",
      actorId: "u",
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
      outcome: "completed",
      durationMs: 0,
      errorCode: null,
      errorMessage: null,
      executionSummary: null,
      executionOutputs: null,
      modeMetrics: null,
      requestedAt,
      governanceCompletedAt: requestedAt,
      executionStartedAt: null,
      completedAt: null,
      lockedAt: null,
      contentHash: null,
      traceVersion: 0,
      ingressPath: "platform_ingress",
      hashInputVersion: 1,
    };
    const findUnique = vi.fn().mockResolvedValue(row);
    const prisma = {
      workTrace: { findUnique },
    } as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[0];
    const ledger = new AuditLedger(new InMemoryLedgerStorage());
    const store = new PrismaWorkTraceStore(prisma, {
      auditLedger: ledger,
      operatorAlerter: new NoopOperatorAlerter(),
    });

    const result = await store.getByWorkUnitId("wu_pre_v1");
    expect(result).not.toBeNull();
    expect(result!.trace.hashInputVersion).toBe(1);
    expect(result!.trace.ingressPath).toBe("platform_ingress");
  });
});

describe("PrismaWorkTraceStore.recordOperatorMutation", () => {
  it("inserts via the provided tx client (not the outer prisma)", async () => {
    const txCreate = vi.fn().mockResolvedValue(undefined);
    const tx = { workTrace: { create: txCreate } };
    const outerCreate = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      workTrace: { create: outerCreate },
      $transaction: vi.fn(),
    } as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[0];
    const store = new PrismaWorkTraceStore(prisma, {
      auditLedger: { record: vi.fn().mockResolvedValue(undefined) } as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) } as never,
    });

    await store.recordOperatorMutation(
      makeTrace({
        ingressPath: "store_recorded_operator_mutation",
        mode: "operator_mutation",
      }),
      { tx: tx as never },
    );

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(outerCreate).not.toHaveBeenCalled();
    const data = txCreate.mock.calls[0]![0].data;
    expect(data.ingressPath).toBe("store_recorded_operator_mutation");
    expect(data.hashInputVersion).toBe(2);
    expect(data.traceVersion).toBe(1);
    expect(typeof data.contentHash).toBe("string");
    expect((data.contentHash as string).length).toBeGreaterThan(0);
  });

  it("rejects an explicitly missing ingressPath", async () => {
    const txCreate = vi.fn().mockResolvedValue(undefined);
    const tx = { workTrace: { create: txCreate } };
    const prisma = {
      workTrace: { create: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as ConstructorParameters<typeof PrismaWorkTraceStore>[0];
    const store = new PrismaWorkTraceStore(prisma, {
      auditLedger: { record: vi.fn().mockResolvedValue(undefined) } as never,
      operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) } as never,
    });

    const trace = makeTrace();
    // @ts-expect-error force-clear to ensure runtime guard catches it
    delete trace.ingressPath;

    await expect(store.recordOperatorMutation(trace as never, { tx: tx as never })).rejects.toThrow(
      /ingressPath/,
    );
    // Guard must run BEFORE any side effect — no tx.workTrace.create should fire.
    expect(txCreate).not.toHaveBeenCalled();
  });
});
