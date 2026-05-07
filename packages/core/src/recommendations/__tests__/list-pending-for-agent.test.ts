import { describe, expect, it } from "vitest";
import { createInMemoryRecommendationStore } from "../in-memory-store.js";
import type { PersistRecommendationInput } from "../types.js";

const NOW = new Date("2026-05-07T08:00:00Z");

function persistInput(over: Partial<PersistRecommendationInput>): PersistRecommendationInput {
  return {
    idempotencyKey: `k-${Math.random()}`,
    orgId: "org-A",
    agentKey: "riley",
    intent: "recommendation.pause_adset",
    action: "pause_adset",
    humanSummary: "x",
    confidence: 0.5,
    dollarsAtRisk: 0,
    riskLevel: "low",
    surface: "queue",
    parameters: {},
    targetEntities: { campaignId: "c", campaignName: "c" },
    sourceWorkflow: null,
    undoableUntil: null,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    ...over,
  } as PersistRecommendationInput;
}

describe("InMemoryRecommendationStore.listPendingForAgent — ordering", () => {
  it("orders riskLevel high → medium → low first", async () => {
    const store = createInMemoryRecommendationStore();
    await store.insert(persistInput({ riskLevel: "low", humanSummary: "low-1" }));
    await store.insert(persistInput({ riskLevel: "high", humanSummary: "high-1" }));
    await store.insert(persistInput({ riskLevel: "medium", humanSummary: "med-1" }));
    const result = await store.listPendingForAgent({
      orgId: "org-A",
      agentKey: "riley",
      surface: "queue",
      limit: 10,
    });
    expect(result.rows.map((r) => r.humanSummary)).toEqual(["high-1", "med-1", "low-1"]);
  });

  it("breaks risk ties by dollarsAtRisk DESC", async () => {
    const store = createInMemoryRecommendationStore();
    await store.insert(persistInput({ riskLevel: "high", dollarsAtRisk: 100, humanSummary: "lo" }));
    await store.insert(persistInput({ riskLevel: "high", dollarsAtRisk: 900, humanSummary: "hi" }));
    const result = await store.listPendingForAgent({
      orgId: "org-A",
      agentKey: "riley",
      surface: "queue",
      limit: 10,
    });
    expect(result.rows.map((r) => r.humanSummary)).toEqual(["hi", "lo"]);
  });

  it("breaks dollar ties by confidence ASC (low confidence promoted)", async () => {
    const store = createInMemoryRecommendationStore();
    await store.insert(
      persistInput({
        riskLevel: "high",
        dollarsAtRisk: 200,
        confidence: 0.9,
        humanSummary: "sure",
      }),
    );
    await store.insert(
      persistInput({
        riskLevel: "high",
        dollarsAtRisk: 200,
        confidence: 0.4,
        humanSummary: "shaky",
      }),
    );
    const result = await store.listPendingForAgent({
      orgId: "org-A",
      agentKey: "riley",
      surface: "queue",
      limit: 10,
    });
    expect(result.rows.map((r) => r.humanSummary)).toEqual(["shaky", "sure"]);
  });

  it("respects limit and reports totalCount over the unsliced filtered set", async () => {
    const store = createInMemoryRecommendationStore();
    for (let i = 0; i < 7; i++) {
      await store.insert(persistInput({ riskLevel: "low", humanSummary: `r-${i}` }));
    }
    const result = await store.listPendingForAgent({
      orgId: "org-A",
      agentKey: "riley",
      surface: "queue",
      limit: 3,
    });
    expect(result.rows).toHaveLength(3);
    expect(result.totalCount).toBe(7);
  });

  it("does not leak across orgs or agentKeys", async () => {
    const store = createInMemoryRecommendationStore();
    await store.insert(persistInput({ orgId: "org-B", humanSummary: "wrong-org" }));
    await store.insert(persistInput({ agentKey: "alex", humanSummary: "wrong-agent" }));
    await store.insert(persistInput({ humanSummary: "right" }));
    const result = await store.listPendingForAgent({
      orgId: "org-A",
      agentKey: "riley",
      surface: "queue",
      limit: 10,
    });
    expect(result.rows.map((r) => r.humanSummary)).toEqual(["right"]);
    expect(result.totalCount).toBe(1);
  });

  it("excludes pending recs whose expiresAt is in the past", async () => {
    const store = createInMemoryRecommendationStore();
    await store.insert(
      persistInput({
        humanSummary: "expired",
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    await store.insert(
      persistInput({
        humanSummary: "live",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const result = await store.listPendingForAgent({
      orgId: "org-A",
      agentKey: "riley",
      surface: "queue",
      limit: 10,
    });
    expect(result.rows.map((r) => r.humanSummary)).toEqual(["live"]);
    expect(result.totalCount).toBe(1);
  });
});
