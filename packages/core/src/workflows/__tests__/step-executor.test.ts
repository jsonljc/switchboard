import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPendingAction } from "../pending-action.js";
import type { CreatePendingActionInput } from "../pending-action.js";
import { StepExecutor } from "../step-executor.js";
import type {
  StepExecutorContext,
  StepExecutorPolicyBridge,
  StepExecutorActionExecutor,
} from "../step-executor.js";
import { InMemoryPendingActionStore } from "./test-stores.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<CreatePendingActionInput> = {}) {
  return createPendingAction({
    intent: "test_action",
    targetEntities: [],
    parameters: { key: "value" },
    humanSummary: "Test action",
    confidence: 0.9,
    riskLevel: "low",
    dollarsAtRisk: 0,
    requiredCapabilities: [],
    dryRunSupported: false,
    approvalRequired: "auto",
    sourceAgent: "test-agent",
    organizationId: "org-1",
    ...overrides,
  });
}

const mockContext: StepExecutorContext = {
  organizationId: "org-1",
  profile: { businessName: "Test Business" },
  conversationHistory: [],
  contactData: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StepExecutor", () => {
  let actionStore: InMemoryPendingActionStore;
  let mockPolicyBridge: StepExecutorPolicyBridge;
  let mockActionExecutor: StepExecutorActionExecutor;
  let executor: StepExecutor;

  beforeEach(() => {
    actionStore = new InMemoryPendingActionStore();
    mockPolicyBridge = {
      evaluate: vi.fn(),
    };
    mockActionExecutor = {
      execute: vi.fn(),
    };
    executor = new StepExecutor({
      actionStore,
      policyBridge: mockPolicyBridge,
      actionExecutor: mockActionExecutor,
    });
  });

  describe("Auto-execution when policy approves", () => {
    it("should execute and mark as completed when policy approves and execution succeeds", async () => {
      const action = makeAction();
      await actionStore.create(action);

      // Policy approves
      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });

      // Execution succeeds
      vi.mocked(mockActionExecutor.execute).mockResolvedValue({
        actionType: "test_action",
        success: true,
        blockedByPolicy: false,
        result: { data: "success" },
      });

      const result = await executor.execute(action, mockContext);

      // Verify outcome
      expect(result.outcome).toBe("completed");
      expect(result.result).toEqual({ data: "success" });
      expect(result.error).toBeUndefined();

      // Verify policy was called
      expect(mockPolicyBridge.evaluate).toHaveBeenCalledWith({
        eventId: `action-${action.id}`,
        destinationType: "system",
        destinationId: action.intent,
        action: action.intent,
        payload: action.parameters,
        criticality: "required",
      });

      // Verify action executor was called with bypass policy
      expect(mockActionExecutor.execute).toHaveBeenCalledWith(
        { actionType: action.intent, parameters: action.parameters },
        mockContext,
        expect.objectContaining({
          evaluate: expect.any(Function),
        }),
      );

      // Verify the bypass policy returns approved
      const bypassPolicy = vi.mocked(mockActionExecutor.execute).mock.calls[0]?.[2];
      expect(bypassPolicy).toBeDefined();
      if (bypassPolicy) {
        const bypassResult = await bypassPolicy.evaluate({
          eventId: "test",
          destinationType: "test",
          destinationId: "test",
          action: "test",
          payload: {},
          criticality: "required",
        });
        expect(bypassResult.approved).toBe(true);
      }

      // Verify status transitions
      const updatedAction = await actionStore.getById(action.id);
      expect(updatedAction?.status).toBe("completed");
      expect(updatedAction?.resolvedAt).toBeInstanceOf(Date);
      expect(updatedAction?.resolvedBy).toBe("auto");
    });

    it("should transition through approved -> executing -> completed states", async () => {
      const action = makeAction();
      await actionStore.create(action);

      const statusHistory: string[] = [];

      // Track status changes
      const originalUpdate = actionStore.update.bind(actionStore);
      actionStore.update = vi.fn(async (id, updates) => {
        await originalUpdate(id, updates);
        if (updates.status) {
          statusHistory.push(updates.status);
        }
      });

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });
      vi.mocked(mockActionExecutor.execute).mockResolvedValue({
        actionType: "test_action",
        success: true,
        blockedByPolicy: false,
      });

      await executor.execute(action, mockContext);

      expect(statusHistory).toEqual(["approved", "executing", "completed"]);
    });
  });

  describe("Requires approval when policy flags it", () => {
    it("should return requires_approval when policy requires human review", async () => {
      const action = makeAction();
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({
        approved: false,
        requiresApproval: true,
        reason: "high risk operation",
      });

      const result = await executor.execute(action, mockContext);

      expect(result.outcome).toBe("requires_approval");
      expect(result.reason).toBe("high risk operation");

      // Should NOT call action executor
      expect(mockActionExecutor.execute).not.toHaveBeenCalled();

      // Action should remain in proposed state (not updated)
      const updatedAction = await actionStore.getById(action.id);
      expect(updatedAction?.status).toBe("proposed");
      expect(updatedAction?.resolvedAt).toBeNull();
    });

    it("should not execute action when requiring approval", async () => {
      const action = makeAction({ riskLevel: "critical", dollarsAtRisk: 10000 });
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({
        approved: false,
        requiresApproval: true,
        reason: "critical risk level",
      });

      await executor.execute(action, mockContext);

      expect(mockActionExecutor.execute).not.toHaveBeenCalled();
    });
  });

  describe("Rejected when policy denies", () => {
    it("should mark as rejected when policy denies without requiring approval", async () => {
      const action = makeAction();
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({
        approved: false,
        reason: "forbidden by policy",
      });

      const result = await executor.execute(action, mockContext);

      expect(result.outcome).toBe("rejected");
      expect(result.reason).toBe("forbidden by policy");

      // Should NOT call action executor
      expect(mockActionExecutor.execute).not.toHaveBeenCalled();

      // Action should be marked as rejected
      const updatedAction = await actionStore.getById(action.id);
      expect(updatedAction?.status).toBe("rejected");
      expect(updatedAction?.resolvedAt).toBeInstanceOf(Date);
      expect(updatedAction?.resolvedBy).toBe("policy_engine");
    });

    it("should handle rejection with detailed reason", async () => {
      const action = makeAction({ intent: "delete_all_data" });
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({
        approved: false,
        reason: "Destructive operation not allowed in production",
      });

      const result = await executor.execute(action, mockContext);

      expect(result.outcome).toBe("rejected");
      expect(result.reason).toBe("Destructive operation not allowed in production");

      const updatedAction = await actionStore.getById(action.id);
      expect(updatedAction?.status).toBe("rejected");
    });
  });

  describe("Handles execution failure", () => {
    it("should mark as failed when action execution fails", async () => {
      const action = makeAction();
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });
      vi.mocked(mockActionExecutor.execute).mockResolvedValue({
        actionType: "test_action",
        success: false,
        blockedByPolicy: false,
        error: "API timeout",
      });

      const result = await executor.execute(action, mockContext);

      expect(result.outcome).toBe("failed");
      expect(result.error).toBe("API timeout");
      expect(result.result).toBeUndefined();

      // Verify status transitions
      const updatedAction = await actionStore.getById(action.id);
      expect(updatedAction?.status).toBe("failed");
      expect(updatedAction?.resolvedAt).toBeInstanceOf(Date);
      expect(updatedAction?.resolvedBy).toBe("auto");
    });

    it("should transition through approved -> executing -> failed on execution error", async () => {
      const action = makeAction();
      await actionStore.create(action);

      const statusHistory: string[] = [];
      const originalUpdate = actionStore.update.bind(actionStore);
      actionStore.update = vi.fn(async (id, updates) => {
        await originalUpdate(id, updates);
        if (updates.status) {
          statusHistory.push(updates.status);
        }
      });

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });
      vi.mocked(mockActionExecutor.execute).mockResolvedValue({
        actionType: "test_action",
        success: false,
        blockedByPolicy: false,
        error: "Network error",
      });

      await executor.execute(action, mockContext);

      expect(statusHistory).toEqual(["approved", "executing", "failed"]);
    });

    it("should handle execution failure with detailed error message", async () => {
      const action = makeAction({ intent: "send_email" });
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });
      vi.mocked(mockActionExecutor.execute).mockResolvedValue({
        actionType: "send_email",
        success: false,
        blockedByPolicy: false,
        error: "SMTP connection refused on port 587",
      });

      const result = await executor.execute(action, mockContext);

      expect(result.outcome).toBe("failed");
      expect(result.error).toBe("SMTP connection refused on port 587");
    });
  });

  describe("Handles executor exceptions", () => {
    it("should mark as failed when action executor throws an exception", async () => {
      const action = makeAction();
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });
      vi.mocked(mockActionExecutor.execute).mockRejectedValue(new Error("Connection timeout"));

      const result = await executor.execute(action, mockContext);

      expect(result.outcome).toBe("failed");
      expect(result.error).toContain("Action executor threw");
      expect(result.error).toContain("Connection timeout");

      // Verify action is marked as failed, not stuck in "executing"
      const updatedAction = await actionStore.getById(action.id);
      expect(updatedAction?.status).toBe("failed");
      expect(updatedAction?.resolvedAt).toBeInstanceOf(Date);
      expect(updatedAction?.resolvedBy).toBe("auto");
    });

    it("should handle non-Error exceptions from executor", async () => {
      const action = makeAction();
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });
      vi.mocked(mockActionExecutor.execute).mockRejectedValue("string error");

      const result = await executor.execute(action, mockContext);

      expect(result.outcome).toBe("failed");
      expect(result.error).toContain("string error");

      const updatedAction = await actionStore.getById(action.id);
      expect(updatedAction?.status).toBe("failed");
    });
  });

  describe("Integration scenarios", () => {
    it("should handle action with custom parameters and context", async () => {
      const action = makeAction({
        intent: "book_appointment",
        parameters: { serviceId: "123", time: "2026-03-23T10:00:00Z" },
      });
      await actionStore.create(action);

      const customContext: StepExecutorContext = {
        organizationId: "org-1",
        profile: { timezone: "America/New_York" },
        contactData: { contactId: "contact-456", phone: "+1234567890" },
      };

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });
      vi.mocked(mockActionExecutor.execute).mockResolvedValue({
        actionType: "book_appointment",
        success: true,
        blockedByPolicy: false,
        result: { appointmentId: "apt-789" },
      });

      const result = await executor.execute(action, customContext);

      expect(result.outcome).toBe("completed");
      expect(result.result).toEqual({ appointmentId: "apt-789" });

      // Verify context was passed to executor
      expect(mockActionExecutor.execute).toHaveBeenCalledWith(
        expect.anything(),
        customContext,
        expect.anything(),
      );
    });

    it("should preserve action metadata through execution lifecycle", async () => {
      const action = makeAction({
        intent: "test_action",
        sourceAgent: "sales-closer",
        workflowId: "workflow-123",
        stepIndex: 2,
      });
      await actionStore.create(action);

      vi.mocked(mockPolicyBridge.evaluate).mockResolvedValue({ approved: true });
      vi.mocked(mockActionExecutor.execute).mockResolvedValue({
        actionType: "test_action",
        success: true,
        blockedByPolicy: false,
      });

      await executor.execute(action, mockContext);

      const updatedAction = await actionStore.getById(action.id);
      expect(updatedAction?.sourceAgent).toBe("sales-closer");
      expect(updatedAction?.workflowId).toBe("workflow-123");
      expect(updatedAction?.stepIndex).toBe(2);
    });
  });
});
