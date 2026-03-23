import { describe, it, expect } from "vitest";
import { createPendingAction } from "../pending-action.js";
import {
  createWorkflowPlan,
  advanceStep,
  canReplan,
  getNextPendingStep,
  areAllStepsTerminal,
} from "../workflow-plan.js";

describe("WorkflowPlan", () => {
  const makeAction = (intent: string) =>
    createPendingAction({
      intent,
      targetEntities: [{ type: "test", id: "123" }],
      parameters: {},
      humanSummary: `Test action: ${intent}`,
      confidence: 0.9,
      riskLevel: "low",
      dollarsAtRisk: 0,
      requiredCapabilities: [],
      dryRunSupported: true,
      approvalRequired: "auto",
      sourceAgent: "test-agent",
      organizationId: "org-1",
    });

  describe("createWorkflowPlan", () => {
    it("creates sequential plan with correct dependencies", () => {
      const actions = [makeAction("step1"), makeAction("step2"), makeAction("step3")];
      const plan = createWorkflowPlan(actions, "sequential");

      expect(plan.steps).toHaveLength(3);
      expect(plan.strategy).toBe("sequential");
      expect(plan.replannedCount).toBe(0);

      expect(plan.steps[0]!.index).toBe(0);
      expect(plan.steps[0]!.actionId).toBe(actions[0]!.id);
      expect(plan.steps[0]!.dependsOn).toEqual([]);
      expect(plan.steps[0]!.status).toBe("pending");
      expect(plan.steps[0]!.result).toBeNull();

      expect(plan.steps[1]!.index).toBe(1);
      expect(plan.steps[1]!.actionId).toBe(actions[1]!.id);
      expect(plan.steps[1]!.dependsOn).toEqual([0]);
      expect(plan.steps[1]!.status).toBe("pending");

      expect(plan.steps[2]!.index).toBe(2);
      expect(plan.steps[2]!.actionId).toBe(actions[2]!.id);
      expect(plan.steps[2]!.dependsOn).toEqual([1]);
      expect(plan.steps[2]!.status).toBe("pending");
    });

    it("creates parallel plan with empty dependencies", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      const plan = createWorkflowPlan(actions, "parallel_where_possible");

      expect(plan.steps).toHaveLength(2);
      expect(plan.strategy).toBe("parallel_where_possible");
      expect(plan.steps[0]!.dependsOn).toEqual([]);
      expect(plan.steps[1]!.dependsOn).toEqual([]);
    });

    it("throws for empty action list", () => {
      expect(() => createWorkflowPlan([], "sequential")).toThrow(
        "WorkflowPlan must have 1-3 steps, got 0",
      );
    });

    it("throws for more than 3 actions", () => {
      const actions = [
        makeAction("step1"),
        makeAction("step2"),
        makeAction("step3"),
        makeAction("step4"),
      ];
      expect(() => createWorkflowPlan(actions, "sequential")).toThrow(
        "WorkflowPlan must have 1-3 steps, got 4",
      );
    });

    it("creates single-step plan", () => {
      const actions = [makeAction("step1")];
      const plan = createWorkflowPlan(actions, "sequential");

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.index).toBe(0);
      expect(plan.steps[0]!.dependsOn).toEqual([]);
    });
  });

  describe("advanceStep", () => {
    it("marks step as completed with result", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      const plan = createWorkflowPlan(actions, "sequential");
      const result = { outcome: "success", value: 42 };

      const updated = advanceStep(plan, 0, "completed", result);

      expect(updated.steps[0]!.status).toBe("completed");
      expect(updated.steps[0]!.result).toEqual(result);
      expect(updated.steps[1]!.status).toBe("pending"); // unchanged
    });

    it("marks step as failed with null result", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      const plan = createWorkflowPlan(actions, "sequential");

      const updated = advanceStep(plan, 1, "failed", null);

      expect(updated.steps[1]!.status).toBe("failed");
      expect(updated.steps[1]!.result).toBeNull();
      expect(updated.steps[0]!.status).toBe("pending"); // unchanged
    });

    it("marks step as executing", () => {
      const actions = [makeAction("step1")];
      const plan = createWorkflowPlan(actions, "sequential");

      const updated = advanceStep(plan, 0, "executing", null);

      expect(updated.steps[0]!.status).toBe("executing");
      expect(updated.steps[0]!.result).toBeNull();
    });

    it("marks step as skipped", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      const plan = createWorkflowPlan(actions, "sequential");

      const updated = advanceStep(plan, 1, "skipped", null);

      expect(updated.steps[1]!.status).toBe("skipped");
      expect(updated.steps[1]!.result).toBeNull();
    });

    it("preserves other steps unchanged", () => {
      const actions = [makeAction("step1"), makeAction("step2"), makeAction("step3")];
      const plan = createWorkflowPlan(actions, "sequential");

      const updated = advanceStep(plan, 1, "completed", { data: "test" });

      expect(updated.steps[0]).toEqual(plan.steps[0]!);
      expect(updated.steps[2]).toEqual(plan.steps[2]!);
    });
  });

  describe("canReplan", () => {
    it("returns true when replans used is below max", () => {
      expect(canReplan(0, 3)).toBe(true);
      expect(canReplan(1, 3)).toBe(true);
      expect(canReplan(2, 3)).toBe(true);
    });

    it("returns false when replans used equals max", () => {
      expect(canReplan(3, 3)).toBe(false);
    });

    it("returns false when replans used exceeds max", () => {
      expect(canReplan(4, 3)).toBe(false);
    });

    it("returns false when maxReplans is zero", () => {
      expect(canReplan(0, 0)).toBe(false);
    });
  });

  describe("getNextPendingStep", () => {
    it("returns first pending step in parallel plan", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      const plan = createWorkflowPlan(actions, "parallel_where_possible");

      const next = getNextPendingStep(plan);

      expect(next).not.toBeNull();
      expect(next?.index).toBe(0);
    });

    it("returns null when no pending steps exist", () => {
      const actions = [makeAction("step1")];
      let plan = createWorkflowPlan(actions, "sequential");
      plan = advanceStep(plan, 0, "completed", {});

      const next = getNextPendingStep(plan);

      expect(next).toBeNull();
    });

    it("returns first pending step with satisfied dependencies in sequential plan", () => {
      const actions = [makeAction("step1"), makeAction("step2"), makeAction("step3")];
      let plan = createWorkflowPlan(actions, "sequential");

      // Initially, only step 0 is ready (no dependencies)
      expect(getNextPendingStep(plan)?.index).toBe(0);

      // After completing step 0, step 1 becomes ready
      plan = advanceStep(plan, 0, "completed", {});
      expect(getNextPendingStep(plan)?.index).toBe(1);

      // After completing step 1, step 2 becomes ready
      plan = advanceStep(plan, 1, "completed", {});
      expect(getNextPendingStep(plan)?.index).toBe(2);
    });

    it("skips pending steps with unmet dependencies", () => {
      const actions = [makeAction("step1"), makeAction("step2"), makeAction("step3")];
      const plan = createWorkflowPlan(actions, "sequential");

      // Steps 1 and 2 depend on previous steps being completed
      // Only step 0 is ready
      const next = getNextPendingStep(plan);

      expect(next?.index).toBe(0);
    });

    it("returns second pending step in parallel plan if first is executing", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      let plan = createWorkflowPlan(actions, "parallel_where_possible");
      plan = advanceStep(plan, 0, "executing", null);

      const next = getNextPendingStep(plan);

      expect(next?.index).toBe(1);
    });

    it("returns null when pending steps have failed dependencies", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      let plan = createWorkflowPlan(actions, "sequential");
      plan = advanceStep(plan, 0, "failed", null);

      const next = getNextPendingStep(plan);

      expect(next).toBeNull();
    });
  });

  describe("areAllStepsTerminal", () => {
    it("returns true when all steps are completed", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      let plan = createWorkflowPlan(actions, "sequential");
      plan = advanceStep(plan, 0, "completed", {});
      plan = advanceStep(plan, 1, "completed", {});

      expect(areAllStepsTerminal(plan)).toBe(true);
    });

    it("returns true when all steps are failed", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      let plan = createWorkflowPlan(actions, "sequential");
      plan = advanceStep(plan, 0, "failed", null);
      plan = advanceStep(plan, 1, "failed", null);

      expect(areAllStepsTerminal(plan)).toBe(true);
    });

    it("returns true when all steps are skipped", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      let plan = createWorkflowPlan(actions, "sequential");
      plan = advanceStep(plan, 0, "skipped", null);
      plan = advanceStep(plan, 1, "skipped", null);

      expect(areAllStepsTerminal(plan)).toBe(true);
    });

    it("returns true when steps are mixed terminal states", () => {
      const actions = [makeAction("step1"), makeAction("step2"), makeAction("step3")];
      let plan = createWorkflowPlan(actions, "sequential");
      plan = advanceStep(plan, 0, "completed", {});
      plan = advanceStep(plan, 1, "failed", null);
      plan = advanceStep(plan, 2, "skipped", null);

      expect(areAllStepsTerminal(plan)).toBe(true);
    });

    it("returns false when any step is pending", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      let plan = createWorkflowPlan(actions, "sequential");
      plan = advanceStep(plan, 0, "completed", {});

      expect(areAllStepsTerminal(plan)).toBe(false);
    });

    it("returns false when any step is executing", () => {
      const actions = [makeAction("step1"), makeAction("step2")];
      let plan = createWorkflowPlan(actions, "sequential");
      plan = advanceStep(plan, 0, "executing", null);
      plan = advanceStep(plan, 1, "completed", {});

      expect(areAllStepsTerminal(plan)).toBe(false);
    });

    it("returns false for newly created plan", () => {
      const actions = [makeAction("step1")];
      const plan = createWorkflowPlan(actions, "sequential");

      expect(areAllStepsTerminal(plan)).toBe(false);
    });
  });
});
