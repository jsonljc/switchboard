import { describe, it, expect } from "vitest";
import type { WorkflowStatus } from "@switchboard/schemas";
import {
  VALID_WORKFLOW_TRANSITIONS,
  WorkflowTransitionError,
  canWorkflowTransition,
  validateWorkflowTransition,
  isTerminalStatus,
} from "../workflow-state-machine.js";

describe("workflow-state-machine", () => {
  describe("VALID_WORKFLOW_TRANSITIONS", () => {
    it("should include all 9 workflow states", () => {
      const states: WorkflowStatus[] = [
        "pending",
        "running",
        "awaiting_approval",
        "awaiting_event",
        "scheduled",
        "blocked",
        "completed",
        "failed",
        "cancelled",
      ];
      states.forEach((state) => {
        expect(VALID_WORKFLOW_TRANSITIONS).toHaveProperty(state);
      });
      expect(Object.keys(VALID_WORKFLOW_TRANSITIONS)).toHaveLength(9);
    });

    it("should have empty arrays for terminal states", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.completed).toEqual([]);
      expect(VALID_WORKFLOW_TRANSITIONS.failed).toEqual([]);
      expect(VALID_WORKFLOW_TRANSITIONS.cancelled).toEqual([]);
    });

    it("should allow pending → running", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.pending).toContain("running");
    });

    it("should allow pending → cancelled", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.pending).toContain("cancelled");
    });

    it("should allow running → all 7 non-pending states", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.running).toEqual(
        expect.arrayContaining([
          "awaiting_approval",
          "awaiting_event",
          "scheduled",
          "blocked",
          "completed",
          "failed",
          "cancelled",
        ]),
      );
      expect(VALID_WORKFLOW_TRANSITIONS.running).toHaveLength(7);
    });

    it("should allow awaiting_approval → running/cancelled", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.awaiting_approval).toEqual(
        expect.arrayContaining(["running", "cancelled"]),
      );
      expect(VALID_WORKFLOW_TRANSITIONS.awaiting_approval).toHaveLength(2);
    });

    it("should allow awaiting_event → running/failed", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.awaiting_event).toEqual(
        expect.arrayContaining(["running", "failed"]),
      );
      expect(VALID_WORKFLOW_TRANSITIONS.awaiting_event).toHaveLength(2);
    });

    it("should allow scheduled → running/cancelled", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.scheduled).toEqual(
        expect.arrayContaining(["running", "cancelled"]),
      );
      expect(VALID_WORKFLOW_TRANSITIONS.scheduled).toHaveLength(2);
    });

    it("should allow blocked → running/failed", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.blocked).toEqual(
        expect.arrayContaining(["running", "failed"]),
      );
      expect(VALID_WORKFLOW_TRANSITIONS.blocked).toHaveLength(2);
    });
  });

  describe("canWorkflowTransition", () => {
    it("should return true for valid transitions", () => {
      expect(canWorkflowTransition("pending", "running")).toBe(true);
      expect(canWorkflowTransition("pending", "cancelled")).toBe(true);
      expect(canWorkflowTransition("running", "completed")).toBe(true);
      expect(canWorkflowTransition("running", "failed")).toBe(true);
      expect(canWorkflowTransition("awaiting_approval", "running")).toBe(true);
      expect(canWorkflowTransition("awaiting_event", "failed")).toBe(true);
      expect(canWorkflowTransition("scheduled", "cancelled")).toBe(true);
      expect(canWorkflowTransition("blocked", "running")).toBe(true);
    });

    it("should return false for invalid transitions", () => {
      expect(canWorkflowTransition("completed", "running")).toBe(false);
      expect(canWorkflowTransition("pending", "completed")).toBe(false);
      expect(canWorkflowTransition("failed", "running")).toBe(false);
      expect(canWorkflowTransition("cancelled", "running")).toBe(false);
      expect(canWorkflowTransition("awaiting_approval", "completed")).toBe(false);
    });
  });

  describe("validateWorkflowTransition", () => {
    it("should return {valid: true} for valid transitions", () => {
      expect(validateWorkflowTransition("pending", "running")).toEqual({ valid: true });
      expect(validateWorkflowTransition("running", "completed")).toEqual({ valid: true });
      expect(validateWorkflowTransition("awaiting_approval", "cancelled")).toEqual({ valid: true });
    });

    it("should return {valid: false, reason} for invalid transitions", () => {
      const result = validateWorkflowTransition("completed", "running");
      expect(result).toEqual({
        valid: false,
        reason: expect.stringContaining("Cannot transition from 'completed' to 'running'"),
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("none (terminal)");
      }
    });

    it("should include valid transitions in reason for invalid transitions", () => {
      const result = validateWorkflowTransition("pending", "completed");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("running");
        expect(result.reason).toContain("cancelled");
      }
    });
  });

  describe("isTerminalStatus", () => {
    it("should return true for terminal states", () => {
      expect(isTerminalStatus("completed")).toBe(true);
      expect(isTerminalStatus("failed")).toBe(true);
      expect(isTerminalStatus("cancelled")).toBe(true);
    });

    it("should return false for non-terminal states", () => {
      expect(isTerminalStatus("pending")).toBe(false);
      expect(isTerminalStatus("running")).toBe(false);
      expect(isTerminalStatus("awaiting_approval")).toBe(false);
      expect(isTerminalStatus("awaiting_event")).toBe(false);
      expect(isTerminalStatus("scheduled")).toBe(false);
      expect(isTerminalStatus("blocked")).toBe(false);
    });
  });

  describe("WorkflowTransitionError", () => {
    it("should include from and to in error properties", () => {
      const error = new WorkflowTransitionError("completed", "running");
      expect(error.from).toBe("completed");
      expect(error.to).toBe("running");
    });

    it("should include descriptive message", () => {
      const error = new WorkflowTransitionError("completed", "running");
      expect(error.message).toContain("completed");
      expect(error.message).toContain("running");
      expect(error.message).toContain("none (terminal)");
    });

    it("should have correct name property", () => {
      const error = new WorkflowTransitionError("completed", "running");
      expect(error.name).toBe("WorkflowTransitionError");
    });

    it("should list valid transitions in message", () => {
      const error = new WorkflowTransitionError("pending", "completed");
      expect(error.message).toContain("running");
      expect(error.message).toContain("cancelled");
    });
  });
});
