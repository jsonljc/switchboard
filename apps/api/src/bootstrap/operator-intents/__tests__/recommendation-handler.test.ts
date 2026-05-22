import { describe, expect, it, vi } from "vitest";
import type { RecommendationStore } from "@switchboard/core";
import type { WorkUnit } from "@switchboard/core/platform";
import { buildActOnRecommendationHandler } from "../recommendation.js";

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu_1",
    requestedAt: new Date().toISOString(),
    organizationId: "org_a",
    actor: { id: "alice", type: "user" },
    intent: "operator.act_on_recommendation",
    parameters: { recommendationId: "rec_1", action: "primary" },
    deployment: { deploymentId: "dep_a" } as never,
    resolvedMode: "operator_mutation",
    traceId: "trace_1",
    trigger: "api",
    priority: "normal",
    ...overrides,
  } as WorkUnit;
}

function makeStore(overrides: Partial<RecommendationStore> = {}): RecommendationStore {
  return {
    getById: async () => null,
    applyAct: async () => ({}) as never,
    insert: async () => ({}) as never,
    listBySurface: async () => [],
    listResolvedForAgent: async () => [],
    listPendingForAgent: async () => ({ rows: [], totalCount: 0 }),
    ...overrides,
  } as RecommendationStore;
}

describe("buildActOnRecommendationHandler (Cohort A semantics)", () => {
  it("returns failed-RECOMMENDATION_NOT_FOUND when row absent", async () => {
    const store = makeStore({ getById: async () => null });
    const handler = buildActOnRecommendationHandler(store);
    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("RECOMMENDATION_NOT_FOUND");
  });

  it("returns failed-RECOMMENDATION_NOT_FOUND when row.orgId mismatches workUnit.organizationId", async () => {
    const applyAct = vi.fn();
    const store = makeStore({
      getById: async () => ({ id: "rec_1", orgId: "org_other" }) as never,
      applyAct: applyAct as never,
    });
    const handler = buildActOnRecommendationHandler(store);
    const result = await handler.execute(makeWorkUnit({ organizationId: "org_a" }));

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("RECOMMENDATION_NOT_FOUND");
    // Hardening assertion: tenant-reject MUST short-circuit BEFORE any
    // state-mutating call. A buggy handler could detect mismatch and still
    // call applyAct, which would mutate the wrong tenant's data.
    expect(applyAct).not.toHaveBeenCalled();
  });

  it("returns completed when row exists in the right org and act succeeds", async () => {
    const store = makeStore({
      getById: async () => ({ id: "rec_1", orgId: "org_a" }) as never,
      applyAct: async () => ({ id: "rec_1", orgId: "org_a" }) as never,
    });
    const handler = buildActOnRecommendationHandler(store);
    const result = await handler.execute(makeWorkUnit({ organizationId: "org_a" }));

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.result).toBeDefined();
  });

  it("returns failed-RECOMMENDATION_INVALID_ACTION when applyAct rejects with surface mismatch", async () => {
    const store = makeStore({
      getById: async () => ({ id: "rec_1", orgId: "org_a" }) as never,
      applyAct: async () => {
        throw new Error("surface accepts only undo");
      },
    });
    const handler = buildActOnRecommendationHandler(store);
    const result = await handler.execute(makeWorkUnit({ organizationId: "org_a" }));

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("RECOMMENDATION_INVALID_ACTION");
  });
});
