// ---------------------------------------------------------------------------
// Outcome Tracker — Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { checkOutcomes } from "../tracker.js";
import { InMemoryInterventionStore } from "../../stores/in-memory.js";
import { MockConnector } from "../../data/normalizer.js";
import type { Intervention } from "@switchboard/schemas";

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    cycleId: "cycle_1",
    constraintType: "SIGNAL",
    actionType: "FIX_TRACKING",
    status: "APPROVED",
    priority: 1,
    estimatedImpact: "HIGH",
    reasoning: "Binding constraint: SIGNAL (score 20/60). Pixel not active.",
    artifacts: [],
    outcomeStatus: "PENDING",
    measurementWindowDays: 7,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("checkOutcomes", () => {
  it("returns empty when no intervention store", async () => {
    const results = await checkOutcomes(
      { connectors: [] },
      "acc_1",
      "org_1",
    );
    expect(results).toEqual([]);
  });

  it("skips interventions without measurementStartedAt", async () => {
    const store = new InMemoryInterventionStore();
    await store.save(makeIntervention({ outcomeStatus: "PENDING" }));

    const results = await checkOutcomes(
      { connectors: [], interventionStore: store },
      "acc_1",
      "org_1",
    );
    expect(results).toEqual([]);
  });

  it("skips interventions where window has not elapsed", async () => {
    const store = new InMemoryInterventionStore();
    await store.save(
      makeIntervention({
        outcomeStatus: "PENDING",
        measurementStartedAt: new Date().toISOString(),
        measurementWindowDays: 7,
      }),
    );

    const results = await checkOutcomes(
      { connectors: [], interventionStore: store },
      "acc_1",
      "org_1",
    );
    expect(results).toEqual([]);
  });

  it("evaluates outcome when window has elapsed — IMPROVED case", async () => {
    const store = new InMemoryInterventionStore();
    const pastDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await store.save(
      makeIntervention({
        constraintType: "SIGNAL",
        outcomeStatus: "PENDING",
        measurementStartedAt: pastDate,
        measurementWindowDays: 7,
        reasoning: "Binding constraint: SIGNAL (score 20/60). Pixel not active.",
      }),
    );

    // Provide healthy signal data so the current score is high
    const connector = new MockConnector({
      signalHealth: {
        pixelActive: true,
        capiConfigured: true,
        eventMatchQuality: 9,
        eventCompleteness: 0.95,
        deduplicationRate: 0.05,
        conversionLagHours: 2,
      },
    });

    const results = await checkOutcomes(
      { connectors: [connector], interventionStore: store },
      "acc_1",
      "org_1",
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe("IMPROVED");
    expect(results[0]!.previousScore).toBe(20);

    // Verify store was updated
    const updated = await store.getById(results[0]!.interventionId);
    expect(updated!.outcomeStatus).toBe("IMPROVED");
  });

  it("evaluates outcome — NO_CHANGE case", async () => {
    const store = new InMemoryInterventionStore();
    const pastDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await store.save(
      makeIntervention({
        constraintType: "SIGNAL",
        outcomeStatus: "PENDING",
        measurementStartedAt: pastDate,
        measurementWindowDays: 7,
        reasoning: "Binding constraint: SIGNAL (score 25/60). Pixel not active.",
      }),
    );

    // Provide data that yields a similar low score (no improvement)
    const connector = new MockConnector({
      signalHealth: {
        pixelActive: false,
        capiConfigured: false,
        eventMatchQuality: 3,
        eventCompleteness: 0.2,
        deduplicationRate: null,
        conversionLagHours: 48,
      },
    });

    const results = await checkOutcomes(
      { connectors: [connector], interventionStore: store },
      "acc_1",
      "org_1",
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe("NO_CHANGE");
  });
});
