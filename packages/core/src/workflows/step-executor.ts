import type { PendingAction } from "@switchboard/schemas";
import type { PendingActionStore } from "./store-interfaces.js";

// Matches AgentContext from packages/agents/src/ports.ts (structural typing)
export interface StepExecutorContext {
  organizationId: string;
  profile?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; content: string }>;
  contactData?: Record<string, unknown>;
}

export interface StepExecutorPolicyBridge {
  evaluate(intent: {
    eventId: string;
    destinationType: string;
    destinationId: string;
    action: string;
    payload: unknown;
    criticality: string;
  }): Promise<{ approved: boolean; requiresApproval?: boolean; reason?: string }>;
}

export interface StepExecutorActionExecutor {
  execute(
    action: { actionType: string; parameters: Record<string, unknown> },
    context: StepExecutorContext,
    policyBridge: StepExecutorPolicyBridge,
  ): Promise<{
    actionType: string;
    success: boolean;
    blockedByPolicy: boolean;
    result?: unknown;
    error?: string;
  }>;
}

export interface StepExecutorDeps {
  actionStore: PendingActionStore;
  policyBridge: StepExecutorPolicyBridge;
  actionExecutor: StepExecutorActionExecutor;
}

export type StepExecutionOutcome = "completed" | "failed" | "rejected" | "requires_approval";

export interface StepExecutionResult {
  outcome: StepExecutionOutcome;
  result?: unknown;
  error?: string;
  reason?: string;
}

export class StepExecutor {
  private readonly deps: StepExecutorDeps;

  constructor(deps: StepExecutorDeps) {
    this.deps = deps;
  }

  async execute(action: PendingAction, context: StepExecutorContext): Promise<StepExecutionResult> {
    // 1. Policy check
    const evaluation = await this.deps.policyBridge.evaluate({
      eventId: `action-${action.id}`,
      destinationType: "system",
      destinationId: action.intent,
      action: action.intent,
      payload: action.parameters,
      criticality: "required",
    });

    if (!evaluation.approved) {
      if (evaluation.requiresApproval) {
        return { outcome: "requires_approval", reason: evaluation.reason };
      }
      // Hard reject
      await this.deps.actionStore.update(action.id, {
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: "policy_engine",
      });
      return { outcome: "rejected", reason: evaluation.reason };
    }

    // 2. Mark as executing
    await this.deps.actionStore.update(action.id, { status: "approved" });
    await this.deps.actionStore.update(action.id, { status: "executing" });

    // 3. Execute via ActionExecutor (bypass policy — already checked)
    try {
      const execResult = await this.deps.actionExecutor.execute(
        { actionType: action.intent, parameters: action.parameters },
        context,
        { evaluate: async () => ({ approved: true }) },
      );

      if (execResult.success) {
        await this.deps.actionStore.update(action.id, {
          status: "completed",
          resolvedAt: new Date(),
          resolvedBy: "auto",
        });
        return { outcome: "completed", result: execResult.result };
      }

      await this.deps.actionStore.update(action.id, {
        status: "failed",
        resolvedAt: new Date(),
        resolvedBy: "auto",
      });
      return { outcome: "failed", error: execResult.error };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.deps.actionStore.update(action.id, {
        status: "failed",
        resolvedAt: new Date(),
        resolvedBy: "auto",
      });
      return { outcome: "failed", error: `Action executor threw: ${errorMessage}` };
    }
  }
}
