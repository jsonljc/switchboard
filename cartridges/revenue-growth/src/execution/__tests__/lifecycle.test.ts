import { describe, it, expect } from "vitest";
import { InterventionLifecycle } from "../lifecycle.js";
import { InMemoryInterventionStore } from "../../stores/in-memory.js";
import type { Intervention } from "@switchboard/schemas";

function makeIntervention(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: crypto.randomUUID(),
    cycleId: "cycle-1",
    constraintType: "SIGNAL",
    actionType: "FIX_TRACKING",
    status: "PROPOSED",
    priority: 1,
    estimatedImpact: "HIGH",
    reasoning: "score 20/60",
    artifacts: [],
    outcomeStatus: "PENDING",
    measurementWindowDays: 7,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("InterventionLifecycle", () => {
  const lifecycle = new InterventionLifecycle();

  describe("transition", () => {
    it("allows PROPOSED → APPROVED", () => {
      const intervention = makeIntervention({ status: "PROPOSED" });
      const result = lifecycle.transition(intervention, "APPROVED");
      expect(result.status).toBe("APPROVED");
    });

    it("allows PROPOSED → DEFERRED", () => {
      const intervention = makeIntervention({ status: "PROPOSED" });
      const result = lifecycle.transition(intervention, "DEFERRED");
      expect(result.status).toBe("DEFERRED");
    });

    it("allows PROPOSED → REJECTED", () => {
      const intervention = makeIntervention({ status: "PROPOSED" });
      const result = lifecycle.transition(intervention, "REJECTED");
      expect(result.status).toBe("REJECTED");
    });

    it("allows APPROVED → EXECUTING", () => {
      const intervention = makeIntervention({ status: "APPROVED" });
      const result = lifecycle.transition(intervention, "EXECUTING");
      expect(result.status).toBe("EXECUTING");
    });

    it("allows EXECUTING → EXECUTED", () => {
      const intervention = makeIntervention({ status: "EXECUTING" });
      const result = lifecycle.transition(intervention, "EXECUTED");
      expect(result.status).toBe("EXECUTED");
    });

    it("allows DEFERRED → PROPOSED", () => {
      const intervention = makeIntervention({ status: "DEFERRED" });
      const result = lifecycle.transition(intervention, "PROPOSED");
      expect(result.status).toBe("PROPOSED");
    });

    it("throws on invalid transition PROPOSED → EXECUTING", () => {
      const intervention = makeIntervention({ status: "PROPOSED" });
      expect(() => lifecycle.transition(intervention, "EXECUTING")).toThrow("Invalid transition");
    });

    it("throws on invalid transition EXECUTED → PROPOSED", () => {
      const intervention = makeIntervention({ status: "EXECUTED" });
      expect(() => lifecycle.transition(intervention, "PROPOSED")).toThrow("Invalid transition");
    });

    it("throws on invalid transition REJECTED → any", () => {
      const intervention = makeIntervention({ status: "REJECTED" });
      expect(() => lifecycle.transition(intervention, "PROPOSED")).toThrow("Invalid transition");
    });

    it("updates the updatedAt timestamp", () => {
      const intervention = makeIntervention({
        status: "PROPOSED",
        updatedAt: "2020-01-01T00:00:00.000Z",
      });
      const result = lifecycle.transition(intervention, "APPROVED");
      expect(result.updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    });
  });

  describe("enforceOneActivePerType", () => {
    it("defers older active interventions of the same constraint type", async () => {
      const store = new InMemoryInterventionStore();
      const existing = makeIntervention({
        id: "old-1",
        constraintType: "SIGNAL",
        status: "PROPOSED",
      });
      await store.save(existing);

      const newIntervention = makeIntervention({
        id: "new-1",
        constraintType: "SIGNAL",
        status: "PROPOSED",
      });

      const deferred = await lifecycle.enforceOneActivePerType(store, "SIGNAL", newIntervention);

      expect(deferred).toHaveLength(1);
      expect(deferred[0]!.id).toBe("old-1");
      expect(deferred[0]!.status).toBe("DEFERRED");
    });

    it("does not defer interventions of different constraint type", async () => {
      const store = new InMemoryInterventionStore();
      const existing = makeIntervention({
        id: "old-1",
        constraintType: "CREATIVE",
        status: "PROPOSED",
      });
      await store.save(existing);

      const newIntervention = makeIntervention({
        id: "new-1",
        constraintType: "SIGNAL",
        status: "PROPOSED",
      });

      const deferred = await lifecycle.enforceOneActivePerType(store, "SIGNAL", newIntervention);

      expect(deferred).toHaveLength(0);
    });

    it("does not defer the new intervention itself", async () => {
      const store = new InMemoryInterventionStore();
      const newIntervention = makeIntervention({
        id: "new-1",
        constraintType: "SIGNAL",
        status: "PROPOSED",
      });
      await store.save(newIntervention);

      const deferred = await lifecycle.enforceOneActivePerType(store, "SIGNAL", newIntervention);

      expect(deferred).toHaveLength(0);
    });
  });

  describe("startMeasurement", () => {
    it("sets measurementStartedAt and outcomeStatus to MEASURING", () => {
      const intervention = makeIntervention({ status: "EXECUTING" });
      const result = lifecycle.startMeasurement(intervention);

      expect(result.measurementStartedAt).toBeDefined();
      expect(result.outcomeStatus).toBe("MEASURING");
    });

    it("throws if intervention is not EXECUTING", () => {
      const intervention = makeIntervention({ status: "APPROVED" });
      expect(() => lifecycle.startMeasurement(intervention)).toThrow(
        "Intervention must be EXECUTING",
      );
    });

    it("throws if intervention is PROPOSED", () => {
      const intervention = makeIntervention({ status: "PROPOSED" });
      expect(() => lifecycle.startMeasurement(intervention)).toThrow("Cannot start measurement");
    });
  });
});
