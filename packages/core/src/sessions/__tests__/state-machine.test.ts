import { describe, it, expect } from "vitest";
import {
  canTransition,
  validateTransition,
  SessionTransitionError,
  VALID_TRANSITIONS,
} from "../state-machine.js";

describe("Session State Machine", () => {
  describe("canTransition", () => {
    it("allows running → paused", () => {
      expect(canTransition("running", "paused")).toBe(true);
    });

    it("allows running → completed", () => {
      expect(canTransition("running", "completed")).toBe(true);
    });

    it("allows running → failed", () => {
      expect(canTransition("running", "failed")).toBe(true);
    });

    it("allows running → cancelled", () => {
      expect(canTransition("running", "cancelled")).toBe(true);
    });

    it("allows paused → running (resume)", () => {
      expect(canTransition("paused", "running")).toBe(true);
    });

    it("allows paused → cancelled", () => {
      expect(canTransition("paused", "cancelled")).toBe(true);
    });

    it("rejects paused → completed (must resume first)", () => {
      expect(canTransition("paused", "completed")).toBe(false);
    });

    it("rejects paused → failed (must cancel, not fail directly)", () => {
      expect(canTransition("paused", "failed")).toBe(false);
    });

    it("rejects running → running (no self-transition)", () => {
      expect(canTransition("running", "running")).toBe(false);
    });

    it("rejects completed → any (terminal)", () => {
      expect(canTransition("completed", "running")).toBe(false);
      expect(canTransition("completed", "paused")).toBe(false);
      expect(canTransition("completed", "failed")).toBe(false);
      expect(canTransition("completed", "cancelled")).toBe(false);
    });

    it("rejects failed → any (terminal)", () => {
      expect(canTransition("failed", "running")).toBe(false);
      expect(canTransition("failed", "paused")).toBe(false);
    });

    it("rejects cancelled → any (terminal)", () => {
      expect(canTransition("cancelled", "running")).toBe(false);
    });
  });

  describe("validateTransition", () => {
    it("returns valid for allowed transitions", () => {
      const result = validateTransition("running", "paused");
      expect(result).toEqual({ valid: true });
    });

    it("returns invalid with reason for disallowed transitions", () => {
      const result = validateTransition("completed", "running");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("completed");
        expect(result.reason).toContain("running");
      }
    });

    it("returns invalid for self-transitions", () => {
      const result = validateTransition("running", "running");
      expect(result.valid).toBe(false);
    });
  });

  describe("SessionTransitionError", () => {
    it("has descriptive message", () => {
      const err = new SessionTransitionError("paused", "completed");
      expect(err.message).toContain("paused");
      expect(err.message).toContain("completed");
      expect(err.name).toBe("SessionTransitionError");
    });
  });

  describe("VALID_TRANSITIONS", () => {
    it("exports the full transition table", () => {
      expect(VALID_TRANSITIONS).toBeDefined();
      expect(VALID_TRANSITIONS["running"]).toContain("paused");
      expect(VALID_TRANSITIONS["running"]).toContain("completed");
      expect(VALID_TRANSITIONS["running"]).toContain("failed");
      expect(VALID_TRANSITIONS["running"]).toContain("cancelled");
      expect(VALID_TRANSITIONS["paused"]).toContain("running");
      expect(VALID_TRANSITIONS["paused"]).toContain("cancelled");
    });

    it("has no transitions from terminal states", () => {
      expect(VALID_TRANSITIONS["completed"]).toEqual([]);
      expect(VALID_TRANSITIONS["failed"]).toEqual([]);
      expect(VALID_TRANSITIONS["cancelled"]).toEqual([]);
    });
  });
});
