import { describe, expect, it } from "vitest";
import { buildRileyEmissionWorkTrace } from "../emission-mirror.js";
import { createInMemoryEmissionMirror, type CapturedTrace } from "../in-memory-emission-mirror.js";
import { createInMemoryRecommendationStore } from "../in-memory-store.js";
import type { PersistRecommendationInput } from "../types.js";

const baseInsert: PersistRecommendationInput = {
  orgId: "org-1",
  agentKey: "riley",
  intent: "recommendation.pause_adset",
  action: "pause",
  humanSummary: "Pause Cold Interests adset — CPL trending above target",
  confidence: 0.82,
  dollarsAtRisk: 240,
  riskLevel: "high",
  parameters: {
    cronId: "ad-optimizer-weekly-audit",
    __recommendation: {
      action: "pause",
      presentation: {
        primaryLabel: "Pause",
        secondaryLabel: "Reduce 50%",
        dismissLabel: "Dismiss",
        dataLines: [],
      },
    },
  },
  targetEntities: { campaignId: "camp-1", adsetId: "as-1" },
  sourceWorkflow: "ad-optimizer.weekly_audit",
  surface: "queue",
  idempotencyKey: "deadbeef".repeat(4),
  undoableUntil: null,
  expiresAt: new Date("2026-05-23T00:00:00Z"),
};

const NOW = new Date("2026-05-16T12:00:00Z");

describe("buildRileyEmissionWorkTrace", () => {
  it("maps the queue surface to outcome=pending_approval", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.outcome).toBe("pending_approval");
  });

  it("maps the shadow_action surface to outcome=completed", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: { ...baseInsert, surface: "shadow_action" },
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.outcome).toBe("completed");
  });

  it("sets ingressPath to agent_recommendation_emission", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.ingressPath).toBe("agent_recommendation_emission");
  });

  it("uses pipeline mode and schedule trigger", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.mode).toBe("pipeline");
    expect(trace.trigger).toBe("schedule");
  });

  it("reuses the recommendation idempotencyKey", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.idempotencyKey).toBe(baseInsert.idempotencyKey);
  });

  it("maps riskLevel high → riskScore 0.8", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.riskScore).toBe(0.8);
  });

  it("maps riskLevel medium → riskScore 0.5", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: { ...baseInsert, riskLevel: "medium" },
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.riskScore).toBe(0.5);
  });

  it("maps riskLevel low → riskScore 0.2", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: { ...baseInsert, riskLevel: "low" },
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.riskScore).toBe(0.2);
  });

  it("uses governanceOutcome=require_approval for queue and execute for shadow_action", () => {
    const queue = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(queue.governanceOutcome).toBe("require_approval");

    const shadow = buildRileyEmissionWorkTrace({
      insert: { ...baseInsert, surface: "shadow_action" },
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(shadow.governanceOutcome).toBe("execute");
  });

  it("populates parameters with cronId, action, humanSummary, confidence, dollarsAtRisk", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.parameters).toMatchObject({
      cronId: "ad-optimizer-weekly-audit",
      action: "pause",
      humanSummary: "Pause Cold Interests adset — CPL trending above target",
      confidence: 0.82,
      dollarsAtRisk: 240,
    });
  });

  it("sets actor.type=service, actor.id=ad-optimizer", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.actor).toEqual({ type: "service", id: "ad-optimizer" });
  });

  it("sets requestedAt = governanceCompletedAt = completedAt = now (iso)", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.requestedAt).toBe(NOW.toISOString());
    expect(trace.governanceCompletedAt).toBe(NOW.toISOString());
    expect(trace.completedAt).toBe(NOW.toISOString());
  });

  it("sets durationMs to 0 (advisory emissions have no execution duration)", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.durationMs).toBe(0);
  });

  it("derives organizationId from insert.orgId", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.organizationId).toBe("org-1");
  });

  it("derives intent verbatim from insert.intent", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.intent).toBe("recommendation.pause_adset");
  });

  it("hashInputVersion is set to the v2 (latest) value", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.hashInputVersion).toBe(2);
  });

  it("matchedPolicies defaults to an empty array (PR-5 will populate later)", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.matchedPolicies).toEqual([]);
  });

  it("generates a fresh workUnitId and traceId on each invocation (no cross-call collisions)", () => {
    const a = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    const b = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(a.workUnitId).not.toBe(b.workUnitId);
    expect(a.traceId).not.toBe(b.traceId);
  });

  it("populates WorkTrace.deploymentId when provided in args", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
      deploymentId: "dep-42",
    });
    expect(trace.deploymentId).toBe("dep-42");
  });

  it("omits WorkTrace.deploymentId when not provided", () => {
    const trace = buildRileyEmissionWorkTrace({
      insert: baseInsert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
    expect(trace.deploymentId).toBeUndefined();
  });
});

describe("createInMemoryEmissionMirror", () => {
  function buildTrace(insert: PersistRecommendationInput) {
    return buildRileyEmissionWorkTrace({
      insert,
      now: NOW,
      cronId: "ad-optimizer-weekly-audit",
    });
  }

  it("records both the recommendation and the work trace on a fresh emission", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    const wt = buildTrace(baseInsert);
    const result = await mirror.recordEmission({
      recommendationInsert: baseInsert,
      workTrace: wt,
    });

    expect(result.idempotent).toBe(false);
    expect(store.rows).toHaveLength(1);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.idempotencyKey).toBe(baseInsert.idempotencyKey);
  });

  it("returns idempotent=true and writes nothing new on duplicate idempotencyKey", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    const wt = buildTrace(baseInsert);
    await mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt });
    const second = await mirror.recordEmission({
      recommendationInsert: baseInsert,
      workTrace: wt,
    });

    expect(second.idempotent).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(traces).toHaveLength(1);
  });

  it("rolls back the recommendation when the trace recorder throws", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({
      store,
      traces,
      onTracePersist: () => {
        throw new Error("simulated trace persist failure");
      },
    });
    const wt = buildTrace(baseInsert);

    await expect(
      mirror.recordEmission({ recommendationInsert: baseInsert, workTrace: wt }),
    ).rejects.toThrow(/simulated trace persist failure/);

    expect(store.rows).toHaveLength(0);
    expect(traces).toHaveLength(0);
  });
});
