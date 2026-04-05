import { describe, it, expect } from "vitest";
import type { PendingActionStatus } from "@switchboard/schemas";
import {
  createPendingAction,
  VALID_ACTION_TRANSITIONS,
  canActionTransition,
  PendingActionTransitionError,
} from "../pending-action.js";

describe("pending-action", () => {
  describe("createPendingAction", () => {
    it("should create action with status 'proposed' and generated id/idempotencyKey", () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [{ type: "contact", id: "c123" }],
        parameters: { subject: "Hello" },
        humanSummary: "Send welcome email to contact",
        confidence: 0.95,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: ["email.send"],
        dryRunSupported: true,
        approvalRequired: "auto",
        sourceAgent: "employee-a",
        organizationId: "org123",
      });

      expect(action.status).toBe("proposed");
      expect(action.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(action.idempotencyKey).toContain("employee-a");
      expect(action.idempotencyKey).toContain("send_email");
    });

    it("should set null defaults for optional fields", () => {
      const action = createPendingAction({
        intent: "send_email",
        targetEntities: [],
        parameters: {},
        humanSummary: "Test",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: [],
        dryRunSupported: false,
        approvalRequired: "auto",
        sourceAgent: "test",
        organizationId: "org123",
      });

      expect(action.workflowId).toBeNull();
      expect(action.stepIndex).toBeNull();
      expect(action.fallback).toBeNull();
      expect(action.sourceWorkflow).toBeNull();
      expect(action.resolvedAt).toBeNull();
      expect(action.resolvedBy).toBeNull();
      expect(action.expiresAt).toBeNull();
    });

    it("should accept optional workflowId and stepIndex", () => {
      const action = createPendingAction({
        intent: "test",
        targetEntities: [],
        parameters: {},
        humanSummary: "Test",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: [],
        dryRunSupported: false,
        approvalRequired: "auto",
        sourceAgent: "test",
        organizationId: "org123",
        workflowId: "wf-123",
        stepIndex: 5,
      });

      expect(action.workflowId).toBe("wf-123");
      expect(action.stepIndex).toBe(5);
    });

    it("should accept optional sourceWorkflow and expiresAt", () => {
      const expiresAt = new Date("2026-12-31");
      const action = createPendingAction({
        intent: "test",
        targetEntities: [],
        parameters: {},
        humanSummary: "Test",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: [],
        dryRunSupported: false,
        approvalRequired: "auto",
        sourceAgent: "test",
        organizationId: "org123",
        sourceWorkflow: "sw-456",
        expiresAt,
      });

      expect(action.sourceWorkflow).toBe("sw-456");
      expect(action.expiresAt).toEqual(expiresAt);
    });

    it("should accept optional fallback", () => {
      const action = createPendingAction({
        intent: "charge_card",
        targetEntities: [],
        parameters: {},
        humanSummary: "Test",
        confidence: 0.9,
        riskLevel: "high",
        dollarsAtRisk: 100,
        requiredCapabilities: [],
        dryRunSupported: false,
        approvalRequired: "operator_approval",
        sourceAgent: "test",
        organizationId: "org123",
        fallback: { action: "send_invoice", reason: "Card declined" },
      });

      expect(action.fallback).toEqual({ action: "send_invoice", reason: "Card declined" });
    });

    it("should set createdAt to current time", () => {
      const before = new Date();
      const action = createPendingAction({
        intent: "test",
        targetEntities: [],
        parameters: {},
        humanSummary: "Test",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: [],
        dryRunSupported: false,
        approvalRequired: "auto",
        sourceAgent: "test",
        organizationId: "org123",
      });
      const after = new Date();

      expect(action.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(action.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("VALID_ACTION_TRANSITIONS", () => {
    it("should include all 7 action statuses", () => {
      const statuses: PendingActionStatus[] = [
        "proposed",
        "approved",
        "executing",
        "completed",
        "failed",
        "rejected",
        "expired",
      ];
      statuses.forEach((status) => {
        expect(VALID_ACTION_TRANSITIONS).toHaveProperty(status);
      });
      expect(Object.keys(VALID_ACTION_TRANSITIONS)).toHaveLength(7);
    });

    it("should allow proposed → approved/rejected/expired", () => {
      expect(VALID_ACTION_TRANSITIONS.proposed).toEqual(
        expect.arrayContaining(["approved", "rejected", "expired"]),
      );
      expect(VALID_ACTION_TRANSITIONS.proposed).toHaveLength(3);
    });

    it("should allow approved → executing", () => {
      expect(VALID_ACTION_TRANSITIONS.approved).toEqual(["executing"]);
    });

    it("should allow executing → completed/failed", () => {
      expect(VALID_ACTION_TRANSITIONS.executing).toEqual(
        expect.arrayContaining(["completed", "failed"]),
      );
      expect(VALID_ACTION_TRANSITIONS.executing).toHaveLength(2);
    });

    it("should have empty arrays for terminal states", () => {
      expect(VALID_ACTION_TRANSITIONS.completed).toEqual([]);
      expect(VALID_ACTION_TRANSITIONS.failed).toEqual([]);
      expect(VALID_ACTION_TRANSITIONS.rejected).toEqual([]);
      expect(VALID_ACTION_TRANSITIONS.expired).toEqual([]);
    });
  });

  describe("canActionTransition", () => {
    it("should return true for valid transitions", () => {
      expect(canActionTransition("proposed", "approved")).toBe(true);
      expect(canActionTransition("proposed", "rejected")).toBe(true);
      expect(canActionTransition("proposed", "expired")).toBe(true);
      expect(canActionTransition("approved", "executing")).toBe(true);
      expect(canActionTransition("executing", "completed")).toBe(true);
      expect(canActionTransition("executing", "failed")).toBe(true);
    });

    it("should return false for invalid transitions", () => {
      expect(canActionTransition("proposed", "completed")).toBe(false);
      expect(canActionTransition("completed", "proposed")).toBe(false);
      expect(canActionTransition("completed", "executing")).toBe(false);
      expect(canActionTransition("rejected", "approved")).toBe(false);
      expect(canActionTransition("expired", "approved")).toBe(false);
    });
  });

  describe("PendingActionTransitionError", () => {
    it("should include from and to in error properties", () => {
      const error = new PendingActionTransitionError("completed", "executing");
      expect(error.from).toBe("completed");
      expect(error.to).toBe("executing");
    });

    it("should include descriptive message", () => {
      const error = new PendingActionTransitionError("completed", "executing");
      expect(error.message).toContain("completed");
      expect(error.message).toContain("executing");
      expect(error.message).toContain("none (terminal)");
    });

    it("should have correct name property", () => {
      const error = new PendingActionTransitionError("completed", "executing");
      expect(error.name).toBe("PendingActionTransitionError");
    });

    it("should list valid transitions in message", () => {
      const error = new PendingActionTransitionError("proposed", "completed");
      expect(error.message).toContain("approved");
      expect(error.message).toContain("rejected");
      expect(error.message).toContain("expired");
    });
  });
});
