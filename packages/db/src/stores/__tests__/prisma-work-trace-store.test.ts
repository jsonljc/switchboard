import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaWorkTraceStore } from "../prisma-work-trace-store.js";

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
    ...overrides,
  };
}

describe("PrismaWorkTraceStore", () => {
  const mockPrisma = {
    workTrace: {
      create: vi.fn().mockResolvedValue({}),
    },
  };

  let store: PrismaWorkTraceStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PrismaWorkTraceStore(mockPrisma as never);
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

    const call = mockPrisma.workTrace.create.mock.calls[0][0];
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

    const call = mockPrisma.workTrace.create.mock.calls[0][0];
    expect(call.data.errorCode).toBe("RATE_LIMIT");
    expect(call.data.errorMessage).toBe("Too many requests");
  });
});
