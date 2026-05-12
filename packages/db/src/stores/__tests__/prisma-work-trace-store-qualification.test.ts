import { describe, expect, it, vi } from "vitest";
import type { WorkTraceQualificationSignals } from "@switchboard/schemas";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";

// Minimal base WorkTrace fields required by persist() and buildWorkTraceCreateData()
function makeTrace(overrides: Record<string, unknown> = {}) {
  return {
    workUnitId: "wu_1",
    traceId: "tr_1",
    intent: "skill.execute",
    mode: "skill" as const,
    organizationId: "org_1",
    actor: { id: "alex", type: "agent" as const },
    trigger: "chat" as const,
    governanceOutcome: "execute" as const,
    riskScore: 0,
    matchedPolicies: [] as string[],
    outcome: "completed" as const,
    durationMs: 0,
    requestedAt: "2026-05-12T00:00:00.000Z",
    governanceCompletedAt: "2026-05-12T00:00:00.010Z",
    ingressPath: "platform_ingress" as const,
    hashInputVersion: 2,
    ...overrides,
  };
}

// Minimal DB row shape required by mapRowToTrace() — mirrors the existing test fixtures
function makeRow(overrides: Record<string, unknown> = {}) {
  const requestedAt = new Date("2026-05-12T00:00:00.000Z");
  return {
    id: "wt_1",
    workUnitId: "wu_1",
    traceId: "tr_1",
    parentWorkUnitId: null,
    intent: "skill.execute",
    mode: "skill",
    organizationId: "org_1",
    actorId: "alex",
    actorType: "agent",
    trigger: "chat",
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
    qualificationSignals: null,
    requestedAt,
    governanceCompletedAt: requestedAt,
    executionStartedAt: null,
    completedAt: null,
    lockedAt: null,
    contentHash: null,
    traceVersion: 0,
    ingressPath: "platform_ingress",
    hashInputVersion: 2,
    ...overrides,
  };
}

function buildMockPrisma() {
  return {
    workTrace: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "wt_1", ...data })),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (cb: (tx: any) => unknown, ...args: unknown[]) => {
        void args;
        return cb({
          workTrace: {
            create: vi.fn().mockResolvedValue(undefined),
          },
        });
      },
    ),
  };
}

function buildStore(prisma: ReturnType<typeof buildMockPrisma>) {
  return new PrismaWorkTraceStore(prisma as never, {
    auditLedger: { record: vi.fn().mockResolvedValue(undefined) } as never,
    operatorAlerter: { alert: vi.fn().mockResolvedValue(undefined) } as never,
  });
}

describe("PrismaWorkTraceStore — qualificationSignals", () => {
  it("persists an 'ok' payload as JSON", async () => {
    const sig: WorkTraceQualificationSignals = {
      validationStatus: "ok",
      payload: {
        treatmentInterest: "HIFU",
        preferredTimeWindow: null,
        serviceableMarket: "SG",
        buyingIntent: "soft",
        budgetAcknowledged: null,
        explicitDecline: false,
        disqualifierCandidates: [],
      },
    };
    const prisma = buildMockPrisma();
    let capturedData: Record<string, unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => {
      const txCreate = vi.fn().mockResolvedValue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { workTrace: { create: txCreate } } as any;
      const result = await cb(tx);
      capturedData = txCreate.mock.calls[0]?.[0]?.data;
      return result;
    });
    const store = buildStore(prisma);
    await store.persist(makeTrace({ qualificationSignals: sig }));
    expect(capturedData?.qualificationSignals).toBe(JSON.stringify(sig));
  });

  it("persists multiple_blocks shape", async () => {
    const sig: WorkTraceQualificationSignals = {
      validationStatus: "multiple_blocks",
      raw: "<tag>a</tag><tag>b</tag>",
    };
    const prisma = buildMockPrisma();
    let capturedData: Record<string, unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => {
      const txCreate = vi.fn().mockResolvedValue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { workTrace: { create: txCreate } } as any;
      const result = await cb(tx);
      capturedData = txCreate.mock.calls[0]?.[0]?.data;
      return result;
    });
    const store = buildStore(prisma);
    await store.persist(
      makeTrace({ workUnitId: "wu_2", traceId: "tr_2", qualificationSignals: sig }),
    );
    expect(JSON.parse(capturedData?.qualificationSignals as string)).toEqual(sig);
  });

  it("omits the column (null) when qualificationSignals is absent", async () => {
    const prisma = buildMockPrisma();
    let capturedData: Record<string, unknown> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => {
      const txCreate = vi.fn().mockResolvedValue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { workTrace: { create: txCreate } } as any;
      const result = await cb(tx);
      capturedData = txCreate.mock.calls[0]?.[0]?.data;
      return result;
    });
    const store = buildStore(prisma);
    await store.persist(makeTrace({ workUnitId: "wu_3", traceId: "tr_3" }));
    expect(capturedData?.qualificationSignals).toBeNull();
  });

  it("read path returns the parsed WorkTraceQualificationSignals for valid stored JSON", async () => {
    const sig: WorkTraceQualificationSignals = {
      validationStatus: "ok",
      payload: {
        treatmentInterest: "HIFU",
        preferredTimeWindow: null,
        serviceableMarket: "SG",
        buyingIntent: "soft",
        budgetAcknowledged: null,
        explicitDecline: false,
        disqualifierCandidates: [],
      },
    };
    const prisma = buildMockPrisma();
    prisma.workTrace.findUnique.mockResolvedValueOnce(
      makeRow({ workUnitId: "wu_42", qualificationSignals: JSON.stringify(sig) }),
    );
    const store = buildStore(prisma);
    const result = await store.getByWorkUnitId("wu_42");
    expect(result?.trace.qualificationSignals).toEqual(sig);
  });

  it("read path returns null and logs warn when stored JSON is corrupt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prisma = buildMockPrisma();
    prisma.workTrace.findUnique.mockResolvedValueOnce(
      makeRow({ workUnitId: "wu_43", qualificationSignals: "{not json" }),
    );
    const store = buildStore(prisma);
    const result = await store.getByWorkUnitId("wu_43");
    expect(result?.trace.qualificationSignals).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("read path returns null and logs warn when stored JSON fails schema validation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const prisma = buildMockPrisma();
    prisma.workTrace.findUnique.mockResolvedValueOnce(
      makeRow({ workUnitId: "wu_44", qualificationSignals: JSON.stringify({ foo: "bar" }) }),
    );
    const store = buildStore(prisma);
    const result = await store.getByWorkUnitId("wu_44");
    expect(result?.trace.qualificationSignals).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
