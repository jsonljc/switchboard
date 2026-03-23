import { describe, it, expect, vi } from "vitest";
import { WorkflowEngine } from "../workflow-engine.js";
import { createPendingAction } from "../pending-action.js";
import { createTestWorkflowStores } from "./test-stores.js";
import type { WorkflowStepExecutor } from "../workflow-engine.js";
import type { StepExecutionResult } from "../step-executor.js";

function makeDeps(
  overrides: {
    stepExecutor?: WorkflowStepExecutor;
  } = {},
) {
  const stores = createTestWorkflowStores();
  const stepExecutor: WorkflowStepExecutor =
    overrides.stepExecutor ??
    ({
      execute: vi.fn().mockResolvedValue({ outcome: "completed", result: { ok: true } }),
    } as unknown as WorkflowStepExecutor);

  return {
    workflows: stores.workflows,
    actions: stores.actions,
    checkpoints: stores.checkpoints,
    stepExecutor,
  };
}

function makeActionInput(intent: string) {
  return {
    intent,
    targetEntities: [] as Array<{ type: string; id: string }>,
    parameters: {},
    humanSummary: `Do ${intent}`,
    confidence: 0.9,
    riskLevel: "low" as const,
    dollarsAtRisk: 0,
    requiredCapabilities: [] as string[],
    dryRunSupported: false,
    approvalRequired: "auto" as const,
    sourceAgent: "test-agent",
    organizationId: "org-1",
  };
}

describe("WorkflowEngine", () => {
  describe("createWorkflow", () => {
    it("creates workflow in pending status and persists actions", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("test-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      expect(workflow.status).toBe("pending");
      expect(workflow.plan.steps).toHaveLength(1);
      expect(workflow.counters.stepsCompleted).toBe(0);

      // Action should be persisted
      const storedAction = await deps.actions.getById(action.id);
      expect(storedAction).not.toBeNull();
      if (!storedAction) throw new Error("Action not persisted");
      expect(storedAction.id).toBe(action.id);
    });
  });

  describe("startWorkflow", () => {
    it("transitions to running and executes first step, ends completed", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("test-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("completed");
      if (!result.plan.steps[0]) throw new Error("Step not found");
      expect(result.plan.steps[0].status).toBe("completed");
      expect(result.counters.stepsCompleted).toBe(1);
      expect(result.completedAt).toBeTruthy();
    });
  });

  describe("multi-step workflow", () => {
    it("executes 2 steps both successfully, final status completed, stepsCompleted=2", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const action1 = createPendingAction(makeActionInput("action-1"));
      const action2 = createPendingAction(makeActionInput("action-2"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action1, action2],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("completed");
      if (!result.plan.steps[0]) throw new Error("Step 0 not found");
      if (!result.plan.steps[1]) throw new Error("Step 1 not found");
      expect(result.plan.steps[0].status).toBe("completed");
      expect(result.plan.steps[1].status).toBe("completed");
      expect(result.counters.stepsCompleted).toBe(2);
    });
  });

  describe("approval pause", () => {
    it("pauses when stepExecutor returns requires_approval, checkpoint created", async () => {
      const mockExecutor: WorkflowStepExecutor = {
        execute: vi
          .fn()
          .mockResolvedValue({ outcome: "requires_approval", reason: "Policy requires review" }),
      };
      const deps = makeDeps({ stepExecutor: mockExecutor });
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("risky-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("awaiting_approval");
      if (!result.plan.steps[0]) throw new Error("Step not found");
      expect(result.plan.steps[0].status).toBe("pending");

      // Checkpoint should be created
      const checkpoints = await deps.checkpoints.listPending("org-1");
      expect(checkpoints).toHaveLength(1);
      if (!checkpoints[0]) throw new Error("Checkpoint not created");
      expect(checkpoints[0].workflowId).toBe(workflow.id);
      expect(checkpoints[0].stepIndex).toBe(0);
    });
  });

  describe("cancelWorkflow", () => {
    it("cancels pending workflow and sets completedAt", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("test-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      await engine.cancelWorkflow(workflow.id);
      const cancelled = await engine.getWorkflow(workflow.id);

      expect(cancelled).not.toBeNull();
      if (!cancelled) throw new Error("Workflow not found");
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.completedAt).toBeTruthy();
    });
  });

  describe("step failure", () => {
    it("fails workflow when stepExecutor returns failed", async () => {
      const mockExecutor: WorkflowStepExecutor = {
        execute: vi.fn().mockResolvedValue({ outcome: "failed", error: "Execution failed" }),
      };
      const deps = makeDeps({ stepExecutor: mockExecutor });
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("failing-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("failed");
      if (!result.plan.steps[0]) throw new Error("Step not found");
      expect(result.plan.steps[0].status).toBe("failed");
      expect(result.errorCode).toBe("STEP_FAILED");
      expect(result.error).toContain("Execution failed");
    });
  });

  describe("step rejection", () => {
    it("fails workflow with ACTION_REJECTED when stepExecutor returns rejected", async () => {
      const mockExecutor: WorkflowStepExecutor = {
        execute: vi
          .fn()
          .mockResolvedValue({ outcome: "rejected", reason: "Policy blocked action" }),
      };
      const deps = makeDeps({ stepExecutor: mockExecutor });
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("blocked-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("ACTION_REJECTED");
      expect(result.error).toContain("Policy blocked action");
    });
  });

  describe("safety envelope - maxReplans", () => {
    it("fails when maxReplans is exceeded", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("test-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 0 },
      });

      // Manually set replansUsed to trigger the check
      await deps.workflows.update(workflow.id, {
        status: "running",
        counters: { stepsCompleted: 0, dollarsAtRisk: 0, replansUsed: 1 },
      });

      // Reset to pending so startWorkflow can transition
      await deps.workflows.update(workflow.id, { status: "pending" });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("SAFETY_ENVELOPE_EXCEEDED");
      expect(result.error).toContain("maxReplans");
    });
  });

  describe("safety envelope - maxSteps", () => {
    it("fails immediately when maxSteps=0", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("test-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 0, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("SAFETY_ENVELOPE_EXCEEDED");
      expect(result.error).toContain("maxSteps");
    });
  });

  describe("safety envelope - timeoutMs", () => {
    it("fails when timeoutMs is exceeded", async () => {
      // Mock executor that takes time
      let resolveExecution: (value: StepExecutionResult) => void;
      const executionPromise = new Promise<StepExecutionResult>((resolve) => {
        resolveExecution = resolve;
      });
      const mockExecutor: WorkflowStepExecutor = {
        execute: vi.fn().mockReturnValue(executionPromise),
      };

      const deps = makeDeps({ stepExecutor: mockExecutor });
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("slow-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 1, maxReplans: 2 },
      });

      // Start workflow (will check timeout before executing first step)
      // Wait a tiny bit to ensure timeout is exceeded
      await new Promise((resolve) => setTimeout(resolve, 5));
      const resultPromise = engine.startWorkflow(workflow.id);

      // The workflow should fail due to timeout before the step even completes
      const result = await resultPromise;

      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("SAFETY_ENVELOPE_EXCEEDED");
      expect(result.error).toContain("timeoutMs");

      // Clean up
      resolveExecution!({ outcome: "completed", result: { ok: true } });
    });
  });

  describe("getWorkflow", () => {
    it("returns workflow by id", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("test-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      const retrieved = await engine.getWorkflow(workflow.id);
      expect(retrieved).not.toBeNull();
      if (!retrieved) throw new Error("Workflow not found");
      expect(retrieved.id).toBe(workflow.id);
    });

    it("returns null for non-existent workflow", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const retrieved = await engine.getWorkflow("non-existent-id");
      expect(retrieved).toBeNull();
    });
  });

  describe("scheduled state", () => {
    it("transitions to scheduled when step result contains scheduleRequest", async () => {
      const mockExecutor: WorkflowStepExecutor = {
        execute: vi.fn().mockResolvedValueOnce({
          outcome: "completed",
          result: {
            scheduleRequest: {
              fireAt: new Date(Date.now() + 7200_000).toISOString(),
              reason: "Follow up in 2 hours",
            },
          },
        }),
      };
      const deps = makeDeps({ stepExecutor: mockExecutor });
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction({
        intent: "schedule_follow_up",
        organizationId: "org-1",
        sourceAgent: "nurture",
        humanSummary: "Schedule follow-up in 2 hours",
        targetEntities: [],
        parameters: {},
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: [],
        dryRunSupported: false,
        approvalRequired: "auto",
      });

      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "operator_command",
        sourceAgent: "nurture",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: 5,
          maxDollarsAtRisk: 100,
          timeoutMs: 300000,
          maxReplans: 3,
        },
        metadata: {},
      });

      const result = await engine.startWorkflow(workflow.id);
      expect(result.status).toBe("scheduled");
      // Schedule request stored in metadata for API layer to read
      expect(result.metadata.scheduleRequest).toBeDefined();
      expect((result.metadata.scheduleRequest as { reason: string }).reason).toBe(
        "Follow up in 2 hours",
      );
    });
  });

  describe("resumeAfterApproval", () => {
    it("applies field edits from modified checkpoint before re-execution", async () => {
      let callCount = 0;
      const mockExecutor: WorkflowStepExecutor = {
        execute: vi
          .fn()
          .mockImplementation(async (action: { parameters: Record<string, unknown> }) => {
            callCount++;
            if (callCount === 1) {
              return { outcome: "requires_approval", reason: "Needs review" };
            }
            // On second call, verify the parameters were updated
            return { outcome: "completed", result: { params: action.parameters } };
          }),
      };

      const deps = makeDeps({ stepExecutor: mockExecutor });
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction({
        ...makeActionInput("editable-action"),
        parameters: { subject: "Original", body: "Text" },
      });
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      // Start and pause at approval
      const paused = await engine.startWorkflow(workflow.id);
      expect(paused.status).toBe("awaiting_approval");

      // Get checkpoint and resolve with field edits
      const checkpoints = await deps.checkpoints.listPending("org-1");
      if (!checkpoints[0]) throw new Error("No checkpoint found");

      // Simulate resolving with field edits
      await deps.checkpoints.update(checkpoints[0].id, {
        status: "modified",
        resolution: {
          decidedBy: "operator-1",
          decidedAt: new Date(),
          selectedAlternative: null,
          fieldEdits: { subject: "Modified Subject" },
        },
      });

      const resumed = await engine.resumeAfterApproval(workflow.id, checkpoints[0].id);
      expect(resumed.status).toBe("completed");

      // Verify the action's parameters were updated
      const updatedAction = await deps.actions.getById(action.id);
      expect(updatedAction?.parameters.subject).toBe("Modified Subject");
      expect(updatedAction?.parameters.body).toBe("Text"); // unchanged field preserved
    });

    it("resumes workflow after approval and completes", async () => {
      let callCount = 0;
      const mockExecutor: WorkflowStepExecutor = {
        execute: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return { outcome: "requires_approval", reason: "Needs review" };
          }
          return { outcome: "completed", result: { ok: true } };
        }),
      };

      const deps = makeDeps({ stepExecutor: mockExecutor });
      const engine = new WorkflowEngine(deps);

      const action = createPendingAction(makeActionInput("reviewed-action"));
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions: [action],
        strategy: "sequential",
        safetyEnvelope: { maxSteps: 5, maxDollarsAtRisk: 1000, timeoutMs: 60000, maxReplans: 2 },
      });

      // Start and pause at approval
      const paused = await engine.startWorkflow(workflow.id);
      expect(paused.status).toBe("awaiting_approval");

      // Resume after approval
      const checkpoints = await deps.checkpoints.listPending("org-1");
      if (!checkpoints[0]) throw new Error("No checkpoint found");
      const resumed = await engine.resumeAfterApproval(workflow.id, checkpoints[0].id);

      expect(resumed.status).toBe("completed");
      if (!resumed.plan.steps[0]) throw new Error("Step not found");
      expect(resumed.plan.steps[0].status).toBe("completed");
    });
  });
});
