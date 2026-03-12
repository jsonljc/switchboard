import { describe, it, expect, beforeEach } from "vitest";
import { PostChangeMonitor } from "../post-change-monitor.js";
import {
  InMemoryInterventionStore,
  InMemoryMonitorCheckpointStore,
} from "../../stores/in-memory.js";
import { MockConnector } from "../../data/normalizer.js";
import type { Intervention } from "@switchboard/schemas";

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: crypto.randomUUID(),
    cycleId: "cycle-1",
    constraintType: "SIGNAL",
    actionType: "FIX_TRACKING",
    status: "EXECUTING",
    priority: 1,
    estimatedImpact: "HIGH",
    reasoning: "Binding constraint: SIGNAL (score 35/60). Pixel inactive.",
    artifacts: [],
    outcomeStatus: "MEASURING",
    measurementWindowDays: 7,
    measurementStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("PostChangeMonitor", () => {
  const monitor = new PostChangeMonitor();
  let interventionStore: InMemoryInterventionStore;
  let checkpointStore: InMemoryMonitorCheckpointStore;

  beforeEach(() => {
    interventionStore = new InMemoryInterventionStore();
    checkpointStore = new InMemoryMonitorCheckpointStore();
  });

  it("returns empty array when no stores configured", async () => {
    const result = await monitor.checkDueInterventions({ connectors: [] }, "acct-1", "org-1");
    expect(result).toEqual([]);
  });

  it("creates checkpoints for due monitoring intervals", async () => {
    const intervention = makeIntervention();
    await interventionStore.save(intervention);

    const connector = new MockConnector({
      signalHealth: {
        pixelActive: true,
        capiConfigured: true,
        eventMatchQuality: 7,
        eventCompleteness: 0.9,
        deduplicationRate: 0.8,
        conversionLagHours: 2,
      },
    });

    const checkpoints = await monitor.checkDueInterventions(
      {
        connectors: [connector],
        interventionStore,
        monitorCheckpointStore: checkpointStore,
      },
      "acct-1",
      "org-1",
    );

    // 25h elapsed: should have 4h and 24h checkpoints
    expect(checkpoints.length).toBe(2);
    expect(checkpoints.map((c) => c.checkpointHours).sort((a, b) => a - b)).toEqual([4, 24]);
  });

  it("does not create duplicate checkpoints", async () => {
    const intervention = makeIntervention();
    await interventionStore.save(intervention);

    const connector = new MockConnector({
      signalHealth: {
        pixelActive: true,
        capiConfigured: true,
        eventMatchQuality: 7,
        eventCompleteness: 0.9,
        deduplicationRate: 0.8,
        conversionLagHours: 2,
      },
    });

    const deps = {
      connectors: [connector],
      interventionStore,
      monitorCheckpointStore: checkpointStore,
    };

    // First check — creates checkpoints
    await monitor.checkDueInterventions(deps, "acct-1", "org-1");

    // Second check — should not create duplicates
    const secondCheck = await monitor.checkDueInterventions(deps, "acct-1", "org-1");
    expect(secondCheck).toEqual([]);
  });

  it("detects anomaly when metric drops >20%", async () => {
    // Reasoning says score 35 — if current metric value drops >20% below 35
    const intervention = makeIntervention({
      reasoning: "Binding constraint: SIGNAL (score 50/60). Pixel inactive.",
    });
    await interventionStore.save(intervention);

    const connector = new MockConnector({
      signalHealth: {
        pixelActive: false,
        capiConfigured: false,
        eventMatchQuality: 2,
        eventCompleteness: 0.3, // 30 vs baseline 50 = -40%
        deduplicationRate: null,
        conversionLagHours: null,
      },
    });

    const checkpoints = await monitor.checkDueInterventions(
      {
        connectors: [connector],
        interventionStore,
        monitorCheckpointStore: checkpointStore,
      },
      "acct-1",
      "org-1",
    );

    const anomaly = checkpoints.find((c) => c.anomalyDetected);
    expect(anomaly).toBeDefined();
    expect(anomaly!.recommendation).toContain("PAUSE recommended");
  });

  it("does not flag anomaly when metric is stable", async () => {
    const intervention = makeIntervention({
      reasoning: "Binding constraint: SIGNAL (score 35/60).",
    });
    await interventionStore.save(intervention);

    const connector = new MockConnector({
      signalHealth: {
        pixelActive: true,
        capiConfigured: true,
        eventMatchQuality: 7,
        eventCompleteness: 0.4, // 40 vs baseline 35 = +14% (improvement)
        deduplicationRate: 0.8,
        conversionLagHours: 2,
      },
    });

    const checkpoints = await monitor.checkDueInterventions(
      {
        connectors: [connector],
        interventionStore,
        monitorCheckpointStore: checkpointStore,
      },
      "acct-1",
      "org-1",
    );

    expect(checkpoints.every((c) => !c.anomalyDetected)).toBe(true);
  });

  it("skips interventions without measurementStartedAt", async () => {
    const intervention = makeIntervention({
      measurementStartedAt: undefined,
    });
    await interventionStore.save(intervention);

    const checkpoints = await monitor.checkDueInterventions(
      {
        connectors: [],
        interventionStore,
        monitorCheckpointStore: checkpointStore,
      },
      "acct-1",
      "org-1",
    );

    expect(checkpoints).toEqual([]);
  });

  it("handles multiple constraint types", async () => {
    const creativeIntervention = makeIntervention({
      constraintType: "CREATIVE",
      actionType: "REFRESH_CREATIVE",
      reasoning: "Binding constraint: CREATIVE (score 30/50).",
    });
    await interventionStore.save(creativeIntervention);

    const connector = new MockConnector({
      creativeAssets: {
        totalAssets: 20,
        activeAssets: 15,
        averageScore: 45,
        fatigueRate: 0.2,
        topPerformerCount: 5,
        bottomPerformerCount: 3,
        diversityScore: 60,
      },
    });

    const checkpoints = await monitor.checkDueInterventions(
      {
        connectors: [connector],
        interventionStore,
        monitorCheckpointStore: checkpointStore,
      },
      "acct-1",
      "org-1",
    );

    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints[0]!.metricName).toBe("averageScore");
  });
});
