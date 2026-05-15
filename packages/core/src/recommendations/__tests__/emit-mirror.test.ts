import { describe, expect, it } from "vitest";
import { emitRecommendation } from "../emit.js";
import { createInMemoryRecommendationStore } from "../in-memory-store.js";
import { createInMemoryEmissionMirror, type CapturedTrace } from "../in-memory-emission-mirror.js";
import type { RecommendationInput } from "../types.js";

const baseInput = (overrides: Partial<RecommendationInput> = {}): RecommendationInput => ({
  orgId: "org-1",
  agentKey: "riley",
  intent: "recommendation.pause_adset",
  action: "pause",
  humanSummary: "Pause Cold Interests adset",
  confidence: 0.9,
  dollarsAtRisk: 240,
  riskLevel: "high",
  parameters: { cronId: "ad-optimizer-weekly-audit" },
  presentation: {
    primaryLabel: "Pause",
    secondaryLabel: "Reduce 50%",
    dismissLabel: "Dismiss",
    dataLines: [],
  },
  targetEntities: { campaignId: "c-1" },
  ...overrides,
});

const NOW = () => new Date("2026-05-16T12:00:00Z");

describe("emitRecommendation with mirror", () => {
  it("writes both Recommendation and WorkTrace when mirror is provided", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    const result = await emitRecommendation(store, baseInput(), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      now: NOW,
    });

    expect(result.surface).toBe("queue");
    expect(store.rows).toHaveLength(1);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.trace.ingressPath).toBe("agent_recommendation_emission");
    expect(traces[0]?.trace.organizationId).toBe("org-1");
    expect(traces[0]?.trace.intent).toBe("recommendation.pause_adset");
  });

  it("idempotent: a re-emit produces neither a duplicate Recommendation nor a duplicate WorkTrace", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    await emitRecommendation(store, baseInput(), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      now: NOW,
    });
    const second = await emitRecommendation(store, baseInput(), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      now: NOW,
    });

    expect(second.surface).toBe("queue");
    expect(store.rows).toHaveLength(1);
    expect(traces).toHaveLength(1);
  });

  it("rolls back the Recommendation when the WorkTrace persist fails", async () => {
    const store = createInMemoryRecommendationStore();
    const mirror = createInMemoryEmissionMirror({
      store,
      traces: [],
      onTracePersist: () => {
        throw new Error("trace persist boom");
      },
    });

    await expect(
      emitRecommendation(store, baseInput(), {
        mirror,
        cronId: "ad-optimizer-weekly-audit",
        now: NOW,
      }),
    ).rejects.toThrow(/trace persist boom/);

    expect(store.rows).toHaveLength(0);
  });

  it("falls back to single-write when no mirror is provided (back-compat)", async () => {
    const store = createInMemoryRecommendationStore();
    const result = await emitRecommendation(store, baseInput());
    expect(result.surface).toBe("queue");
    expect(store.rows).toHaveLength(1);
  });

  it("shadow_action surface produces a WorkTrace with outcome=completed", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    // shadow_action requires reversible action (pause/reduce_budget) + confidence>=0.85 + dollarsAtRisk<50.
    await emitRecommendation(
      store,
      baseInput({ action: "pause", confidence: 0.9, dollarsAtRisk: 25 }),
      {
        mirror,
        cronId: "ad-optimizer-weekly-audit",
        now: NOW,
      },
    );

    expect(traces[0]?.trace.outcome).toBe("completed");
    expect(traces[0]?.trace.governanceOutcome).toBe("execute");
  });

  it("dropped surface (router returns dropped) writes neither a Recommendation nor a WorkTrace", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    const result = await emitRecommendation(
      store,
      baseInput({ confidence: 0.3, dollarsAtRisk: 5 }),
      {
        mirror,
        cronId: "ad-optimizer-weekly-audit",
        now: NOW,
      },
    );

    expect(result.surface).toBe("dropped");
    expect(store.rows).toHaveLength(0);
    expect(traces).toHaveLength(0);
  });

  it("throws when mirror is provided without cronId", async () => {
    const store = createInMemoryRecommendationStore();
    const mirror = createInMemoryEmissionMirror({ store, traces: [] });

    await expect(emitRecommendation(store, baseInput(), { mirror, now: NOW })).rejects.toThrow(
      /cronId is required/,
    );
  });

  it("propagates deploymentId option through to the WorkTrace", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    await emitRecommendation(store, baseInput(), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      deploymentId: "dep-99",
      now: NOW,
    });

    expect(traces[0]?.trace.deploymentId).toBe("dep-99");
  });

  it("omits WorkTrace.deploymentId when option absent (back-compat)", async () => {
    const store = createInMemoryRecommendationStore();
    const traces: CapturedTrace[] = [];
    const mirror = createInMemoryEmissionMirror({ store, traces });

    await emitRecommendation(store, baseInput(), {
      mirror,
      cronId: "ad-optimizer-weekly-audit",
      now: NOW,
    });

    expect(traces[0]?.trace.deploymentId).toBeUndefined();
  });
});
