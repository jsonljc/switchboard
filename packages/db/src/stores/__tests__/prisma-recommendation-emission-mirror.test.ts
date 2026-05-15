import { describe, expect, it, vi } from "vitest";
import { buildRileyEmissionWorkTrace, type PersistRecommendationInput } from "@switchboard/core";
import { computeWorkTraceContentHash } from "@switchboard/core/platform";
import { PrismaRecommendationEmissionMirror } from "../prisma-recommendation-emission-mirror.js";

const baseInsert: PersistRecommendationInput = {
  orgId: "org-1",
  agentKey: "riley",
  intent: "recommendation.pause_adset",
  action: "pause",
  humanSummary: "Pause Cold Interests adset",
  confidence: 0.82,
  dollarsAtRisk: 240,
  riskLevel: "high",
  parameters: { cronId: "ad-optimizer-weekly-audit" },
  targetEntities: { campaignId: "camp-1" },
  sourceWorkflow: "ad-optimizer.weekly_audit",
  surface: "queue",
  idempotencyKey: "deadbeef".repeat(4),
  undoableUntil: null,
  expiresAt: new Date("2026-05-23T00:00:00Z"),
};

const wt = buildRileyEmissionWorkTrace({
  insert: baseInsert,
  now: new Date("2026-05-16T12:00:00Z"),
  cronId: "ad-optimizer-weekly-audit",
});

interface MockOpts {
  recCreate?: () => Promise<unknown>;
  workTraceCreate?: () => Promise<unknown>;
  recFindUnique?: () => Promise<unknown>;
}

function makeRecRow() {
  return {
    id: "rec-1",
    organizationId: baseInsert.orgId,
    sourceAgent: baseInsert.agentKey,
    intent: baseInsert.intent,
    humanSummary: baseInsert.humanSummary,
    confidence: baseInsert.confidence,
    dollarsAtRisk: baseInsert.dollarsAtRisk,
    riskLevel: baseInsert.riskLevel,
    surface: baseInsert.surface,
    status: "pending",
    parameters: { __recommendation: { action: baseInsert.action } },
    targetEntities: baseInsert.targetEntities,
    sourceWorkflow: baseInsert.sourceWorkflow,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date("2026-05-16T12:00:00Z"),
    expiresAt: baseInsert.expiresAt,
    undoableUntil: baseInsert.undoableUntil,
  };
}

function makeMockPrisma(opts: MockOpts) {
  const tx = {
    pendingActionRecord: {
      create: vi.fn(opts.recCreate ?? (async () => makeRecRow())),
      findUnique: vi.fn(opts.recFindUnique ?? (async () => null)),
    },
    workTrace: {
      create: vi.fn(opts.workTraceCreate ?? (async () => ({}))),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
}

describe("PrismaRecommendationEmissionMirror", () => {
  it("writes the recommendation + work trace inside one $transaction", async () => {
    const { prisma, tx } = makeMockPrisma({});
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    const result = await mirror.recordEmission({
      recommendationInsert: baseInsert,
      workTrace: wt,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.pendingActionRecord.create).toHaveBeenCalledTimes(1);
    expect(tx.workTrace.create).toHaveBeenCalledTimes(1);
    expect(result.idempotent).toBe(false);
    expect(result.row.id).toBe("rec-1");
  });

  it("returns idempotent=true and skips the work-trace insert on duplicate idempotencyKey", async () => {
    const { prisma, tx } = makeMockPrisma({
      recCreate: async () => {
        const err = new Error("unique constraint") as Error & { code: string };
        err.code = "P2002";
        throw err;
      },
      recFindUnique: async () => ({ ...makeRecRow(), id: "rec-existing" }),
    });
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    const result = await mirror.recordEmission({
      recommendationInsert: baseInsert,
      workTrace: wt,
    });

    expect(result.idempotent).toBe(true);
    expect(result.row.id).toBe("rec-existing");
    expect(tx.workTrace.create).not.toHaveBeenCalled();
  });

  it("propagates errors from the work-trace insert (caller-owned transaction will roll back)", async () => {
    const { prisma } = makeMockPrisma({
      workTraceCreate: async () => {
        throw new Error("simulated workTrace.create failure");
      },
    });
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    await expect(
      mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt }),
    ).rejects.toThrow(/simulated workTrace.create failure/);
  });

  it("includes ingressPath, mode, outcome, and contentHash on the work-trace create payload", async () => {
    const { prisma, tx } = makeMockPrisma({});
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });

    const call = (tx.workTrace.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(call.data.ingressPath).toBe("agent_recommendation_emission");
    expect(call.data.mode).toBe("pipeline");
    expect(call.data.outcome).toBe("pending_approval");
    expect(call.data.contentHash).toEqual(expect.any(String));
    expect(call.data.idempotencyKey).toBe(baseInsert.idempotencyKey);
  });

  it("the WorkTrace contentHash recomputes to the same value (deterministic hash)", async () => {
    const { prisma, tx } = makeMockPrisma({});
    const mirror = new PrismaRecommendationEmissionMirror(prisma as never);

    await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });

    const call = (tx.workTrace.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // The mirror persists with traceVersion=1 (initial persist); hash must be stable.
    const expectedHash = computeWorkTraceContentHash(wt, 1);
    expect(call.data.contentHash).toBe(expectedHash);
    expect(call.data.traceVersion).toBe(1);

    // Recomputing from the captured input yields the same hash — round-trip.
    const recomputed = computeWorkTraceContentHash(wt, 1);
    expect(call.data.contentHash).toBe(recomputed);
  });
});
