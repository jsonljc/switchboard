import { randomUUID } from "node:crypto";
import type {
  WorkflowExecution,
  WorkflowSafetyEnvelope,
  PendingAction,
  WorkflowTriggerType,
} from "@switchboard/schemas";
import type {
  WorkflowStore,
  PendingActionStore,
  ApprovalCheckpointStore,
} from "./store-interfaces.js";
import { canWorkflowTransition, WorkflowTransitionError } from "./workflow-state-machine.js";
import {
  createWorkflowPlan,
  advanceStep,
  getNextPendingStep,
  areAllStepsTerminal,
} from "./workflow-plan.js";
import { createApprovalCheckpoint } from "./approval-checkpoint.js";
import type { StepExecutionResult } from "./step-executor.js";

const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface WorkflowStepExecutor {
  execute(
    action: PendingAction,
    context: { organizationId: string; profile?: Record<string, unknown> },
  ): Promise<StepExecutionResult>;
}

export interface WorkflowEngineDeps {
  workflows: WorkflowStore;
  actions: PendingActionStore;
  checkpoints: ApprovalCheckpointStore;
  stepExecutor: WorkflowStepExecutor;
}

export interface CreateWorkflowInput {
  organizationId: string;
  triggerType: WorkflowTriggerType;
  triggerRef?: string;
  sourceAgent: string;
  actions: PendingAction[];
  strategy: "sequential" | "parallel_where_possible";
  safetyEnvelope: WorkflowSafetyEnvelope;
  metadata?: Record<string, unknown>;
}

export class WorkflowEngine {
  private readonly deps: WorkflowEngineDeps;

  constructor(deps: WorkflowEngineDeps) {
    this.deps = deps;
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowExecution> {
    const plan = createWorkflowPlan(input.actions, input.strategy);

    // Persist all actions
    for (const action of input.actions) {
      await this.deps.actions.create(action);
    }

    const workflow: WorkflowExecution = {
      id: randomUUID(),
      organizationId: input.organizationId,
      triggerType: input.triggerType,
      triggerRef: input.triggerRef ?? null,
      sourceAgent: input.sourceAgent,
      status: "pending",
      plan,
      currentStepIndex: 0,
      safetyEnvelope: input.safetyEnvelope,
      counters: { stepsCompleted: 0, dollarsAtRisk: 0, replansUsed: 0 },
      metadata: input.metadata ?? {},
      traceId: randomUUID(),
      error: null,
      errorCode: null,
      startedAt: new Date(),
      completedAt: null,
    };

    await this.deps.workflows.create(workflow);
    return workflow;
  }

  async startWorkflow(workflowId: string): Promise<WorkflowExecution> {
    const workflow = await this.requireWorkflow(workflowId);
    this.assertTransition(workflow.status, "running");
    await this.deps.workflows.update(workflowId, { status: "running" });
    return this.runSteps(workflowId);
  }

  async resumeAfterApproval(workflowId: string, checkpointId: string): Promise<WorkflowExecution> {
    const workflow = await this.requireWorkflow(workflowId);
    this.assertTransition(workflow.status, "running");
    await this.deps.workflows.update(workflowId, { status: "running" });

    const step = workflow.plan.steps[workflow.currentStepIndex];
    if (!step) throw new Error(`Step ${workflow.currentStepIndex} not found in plan`);
    const action = await this.deps.actions.getById(step.actionId);
    if (!action) throw new Error(`Action ${step.actionId} not found`);

    // Apply field edits from "modified" checkpoints before re-execution
    const checkpoint = await this.deps.checkpoints.getById(checkpointId);
    if (checkpoint?.resolution?.fieldEdits) {
      const updatedParams = { ...action.parameters, ...checkpoint.resolution.fieldEdits };
      await this.deps.actions.update(action.id, { status: "approved", parameters: updatedParams });
    } else {
      await this.deps.actions.update(action.id, { status: "approved" });
    }

    return this.runSteps(workflowId);
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.requireWorkflow(workflowId);
    this.assertTransition(workflow.status, "cancelled");
    await this.deps.workflows.update(workflowId, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  async getWorkflow(workflowId: string): Promise<WorkflowExecution | null> {
    return this.deps.workflows.getById(workflowId);
  }

  // Private: run steps until blocked, completed, or failed
  private async runSteps(workflowId: string): Promise<WorkflowExecution> {
    let workflow = await this.requireWorkflow(workflowId);
    let shouldContinue = true;

    while (shouldContinue) {
      shouldContinue = false;

      // Safety envelope check
      const envelopeError = this.checkSafetyEnvelope(workflow);
      if (envelopeError) {
        return this.handleSafetyViolation(workflowId, envelopeError);
      }

      const nextStep = getNextPendingStep(workflow.plan);
      if (!nextStep) {
        return this.handleNoMoreSteps(workflowId, workflow);
      }

      const action = await this.deps.actions.getById(nextStep.actionId);
      if (!action) {
        return this.handleMissingAction(workflowId, nextStep.actionId);
      }

      const result = await this.deps.stepExecutor.execute(action, {
        organizationId: workflow.organizationId,
      });

      if (result.outcome === "completed") {
        workflow = await this.handleStepSuccess(workflowId, workflow, nextStep, action, result);
        // If handleStepSuccess transitioned to scheduled, stop the loop
        if (workflow.status === "scheduled") {
          return workflow;
        }
        shouldContinue = true;
        continue;
      }

      if (result.outcome === "requires_approval") {
        return this.handleApprovalRequired(workflowId, nextStep, action, result);
      }

      if (result.outcome === "rejected" || result.outcome === "failed") {
        return this.handleStepFailure(workflowId, workflow, nextStep, result);
      }
    }

    return this.requireWorkflow(workflowId);
  }

  private async handleSafetyViolation(
    workflowId: string,
    error: string,
  ): Promise<WorkflowExecution> {
    await this.deps.workflows.update(workflowId, {
      status: "failed",
      error,
      errorCode: "SAFETY_ENVELOPE_EXCEEDED",
      completedAt: new Date(),
    });
    return this.requireWorkflow(workflowId);
  }

  private async handleNoMoreSteps(
    workflowId: string,
    workflow: WorkflowExecution,
  ): Promise<WorkflowExecution> {
    if (areAllStepsTerminal(workflow.plan)) {
      const hasFailure = workflow.plan.steps.some((s) => s.status === "failed");
      const finalStatus = hasFailure ? "failed" : "completed";
      await this.deps.workflows.update(workflowId, {
        status: finalStatus,
        completedAt: new Date(),
        error: hasFailure ? "One or more steps failed" : null,
      });
    }
    return this.requireWorkflow(workflowId);
  }

  private async handleMissingAction(
    workflowId: string,
    actionId: string,
  ): Promise<WorkflowExecution> {
    await this.deps.workflows.update(workflowId, {
      status: "failed",
      error: `Action ${actionId} not found`,
      errorCode: "ACTION_NOT_FOUND",
      completedAt: new Date(),
    });
    return this.requireWorkflow(workflowId);
  }

  private async handleStepSuccess(
    workflowId: string,
    workflow: WorkflowExecution,
    nextStep: { index: number; actionId: string },
    action: PendingAction,
    result: StepExecutionResult,
  ): Promise<WorkflowExecution> {
    const updatedPlan = advanceStep(workflow.plan, nextStep.index, "completed", {
      result: result.result ?? null,
    });
    const updatedCounters = {
      ...workflow.counters,
      stepsCompleted: workflow.counters.stepsCompleted + 1,
      dollarsAtRisk: workflow.counters.dollarsAtRisk + action.dollarsAtRisk,
    };

    // Check if step result requests scheduling
    const stepResult = result.result as Record<string, unknown> | undefined;
    if (stepResult?.scheduleRequest) {
      await this.deps.workflows.update(workflowId, {
        plan: updatedPlan,
        currentStepIndex: nextStep.index + 1,
        counters: updatedCounters,
        status: "scheduled",
        metadata: {
          ...workflow.metadata,
          scheduleRequest: stepResult.scheduleRequest,
        },
      });
      return this.requireWorkflow(workflowId);
    }

    await this.deps.workflows.update(workflowId, {
      plan: updatedPlan,
      currentStepIndex: nextStep.index + 1,
      counters: updatedCounters,
    });
    return this.requireWorkflow(workflowId);
  }

  private async handleApprovalRequired(
    workflowId: string,
    nextStep: { index: number; actionId: string },
    action: PendingAction,
    result: StepExecutionResult,
  ): Promise<WorkflowExecution> {
    const checkpoint = createApprovalCheckpoint({
      workflowId,
      stepIndex: nextStep.index,
      action,
      reason: result.reason ?? "Approval required by policy",
      ttlMs: DEFAULT_APPROVAL_TTL_MS,
    });
    await this.deps.checkpoints.create(checkpoint);
    await this.deps.workflows.update(workflowId, { status: "awaiting_approval" });
    return this.requireWorkflow(workflowId);
  }

  private async handleStepFailure(
    workflowId: string,
    workflow: WorkflowExecution,
    nextStep: { index: number },
    result: StepExecutionResult,
  ): Promise<WorkflowExecution> {
    const updatedPlan = advanceStep(workflow.plan, nextStep.index, "failed", {
      error: result.error ?? result.reason ?? "Step failed",
    });
    await this.deps.workflows.update(workflowId, {
      plan: updatedPlan,
      status: "failed",
      error: result.error ?? result.reason ?? "Step execution failed",
      errorCode: result.outcome === "rejected" ? "ACTION_REJECTED" : "STEP_FAILED",
      completedAt: new Date(),
    });
    return this.requireWorkflow(workflowId);
  }

  private checkSafetyEnvelope(workflow: WorkflowExecution): string | null {
    const { safetyEnvelope, counters } = workflow;
    if (counters.stepsCompleted >= safetyEnvelope.maxSteps) {
      return `Safety envelope exceeded: maxSteps (${counters.stepsCompleted}/${safetyEnvelope.maxSteps})`;
    }
    if (counters.dollarsAtRisk >= safetyEnvelope.maxDollarsAtRisk) {
      return `Safety envelope exceeded: maxDollarsAtRisk (${counters.dollarsAtRisk}/${safetyEnvelope.maxDollarsAtRisk})`;
    }
    if (counters.replansUsed >= safetyEnvelope.maxReplans) {
      return `Safety envelope exceeded: maxReplans (${counters.replansUsed}/${safetyEnvelope.maxReplans})`;
    }
    const elapsedMs = Date.now() - workflow.startedAt.getTime();
    if (elapsedMs >= safetyEnvelope.timeoutMs) {
      return `Safety envelope exceeded: timeoutMs (${elapsedMs}ms/${safetyEnvelope.timeoutMs}ms)`;
    }
    return null;
  }

  private assertTransition(
    from: WorkflowExecution["status"],
    to: WorkflowExecution["status"],
  ): void {
    if (!canWorkflowTransition(from, to)) {
      throw new WorkflowTransitionError(from, to);
    }
  }

  private async requireWorkflow(id: string): Promise<WorkflowExecution> {
    const workflow = await this.deps.workflows.getById(id);
    if (!workflow) throw new Error(`Workflow ${id} not found`);
    return workflow;
  }
}
