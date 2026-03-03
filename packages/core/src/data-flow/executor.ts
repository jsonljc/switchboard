import type { DataFlowPlan, StepExecutionResult } from "./types.js";
import type { EntityGraphService } from "./resolver.js";
import { resolveBindings, BindingResolutionError } from "./resolver.js";
import { evaluateCondition } from "./condition.js";

export interface DataFlowOrchestrator {
  propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
    organizationId?: string | null;
    parentEnvelopeId?: string | null;
    traceId?: string;
  }): Promise<{
    denied: boolean;
    envelope: { id: string; status: string };
    explanation: string;
  }>;

  executeApproved(envelopeId: string): Promise<{
    success: boolean;
    summary: string;
    externalRefs: Record<string, string>;
    data?: unknown;
    [key: string]: unknown;
  }>;
}

export interface DataFlowExecutorConfig {
  orchestrator: DataFlowOrchestrator;
  entityGraphService?: EntityGraphService;
}

export interface DataFlowExecutionResult {
  planId: string;
  strategy: string;
  stepResults: StepExecutionResult[];
  overallOutcome: "completed" | "partial" | "failed";
}

export class DataFlowExecutor {
  private orchestrator: DataFlowOrchestrator;
  private entityGraphService?: EntityGraphService;

  constructor(config: DataFlowExecutorConfig) {
    this.orchestrator = config.orchestrator;
    this.entityGraphService = config.entityGraphService;
  }

  async execute(
    plan: DataFlowPlan,
    context: {
      principalId: string;
      organizationId?: string;
      traceId?: string;
    },
  ): Promise<DataFlowExecutionResult> {
    const stepResults: StepExecutionResult[] = [];
    let failed = false;

    for (const step of plan.steps) {
      // If a prior step failed: behavior depends on strategy
      if (failed) {
        if (plan.strategy === "sequential") {
          stepResults.push({
            stepIndex: step.index,
            resolvedParameters: {},
            conditionMet: false,
            envelopeId: null,
            outcome: "skipped_prior_failure",
            result: null,
            error: "Skipped due to prior step failure",
          });
          continue;
        }
        if (plan.strategy === "atomic") {
          stepResults.push({
            stepIndex: step.index,
            resolvedParameters: {},
            conditionMet: false,
            envelopeId: null,
            outcome: "skipped_prior_failure",
            result: null,
            error: "Skipped due to atomic rollback",
          });
          continue;
        }
        // best_effort: continue despite failure
      }

      // Evaluate condition
      const conditionMet = evaluateCondition(step.condition, step.index, stepResults);
      if (!conditionMet) {
        stepResults.push({
          stepIndex: step.index,
          resolvedParameters: {},
          conditionMet: false,
          envelopeId: null,
          outcome: "skipped_condition",
          result: null,
          error: null,
        });
        continue;
      }

      // Resolve bindings
      let resolvedParams: Record<string, unknown>;
      try {
        resolvedParams = await resolveBindings(step.parameters, step.index, {
          stepResults,
          entityGraphService: this.entityGraphService,
          organizationId: context.organizationId,
        });
      } catch (err) {
        const errorMsg =
          err instanceof BindingResolutionError
            ? err.message
            : `Binding resolution failed: ${err instanceof Error ? err.message : String(err)}`;

        stepResults.push({
          stepIndex: step.index,
          resolvedParameters: {},
          conditionMet: true,
          envelopeId: null,
          outcome: "error",
          result: null,
          error: errorMsg,
        });
        failed = true;
        continue;
      }

      // Propose through governance
      try {
        const proposeResult = await this.orchestrator.propose({
          actionType: step.actionType,
          parameters: resolvedParams,
          principalId: context.principalId,
          cartridgeId: step.cartridgeId,
          organizationId: context.organizationId,
          parentEnvelopeId: plan.envelopeId,
          traceId: context.traceId,
        });

        if (proposeResult.denied) {
          stepResults.push({
            stepIndex: step.index,
            resolvedParameters: resolvedParams,
            conditionMet: true,
            envelopeId: proposeResult.envelope.id,
            outcome: "denied",
            result: null,
            error: proposeResult.explanation,
          });
          failed = true;
          continue;
        }

        // If approved, execute immediately
        if (proposeResult.envelope.status === "approved") {
          const execResult = await this.orchestrator.executeApproved(proposeResult.envelope.id);
          stepResults.push({
            stepIndex: step.index,
            resolvedParameters: resolvedParams,
            conditionMet: true,
            envelopeId: proposeResult.envelope.id,
            outcome: execResult.success ? "executed" : "error",
            result: execResult,
            error: execResult.success ? null : execResult.summary,
          });
          if (!execResult.success) {
            failed = true;
          }
        } else if (proposeResult.envelope.status === "pending_approval") {
          stepResults.push({
            stepIndex: step.index,
            resolvedParameters: resolvedParams,
            conditionMet: true,
            envelopeId: proposeResult.envelope.id,
            outcome: "pending_approval",
            result: null,
            error: null,
          });
          // pending_approval blocks further steps in sequential/atomic
          if (plan.strategy !== "best_effort") {
            failed = true;
          }
        }
      } catch (err) {
        stepResults.push({
          stepIndex: step.index,
          resolvedParameters: resolvedParams,
          conditionMet: true,
          envelopeId: null,
          outcome: "error",
          result: null,
          error: err instanceof Error ? err.message : String(err),
        });
        failed = true;
      }
    }

    // Determine overall outcome
    const outcomes = stepResults.map((r) => r.outcome);
    let overallOutcome: "completed" | "partial" | "failed";
    if (outcomes.every((o) => o === "executed" || o === "skipped_condition")) {
      overallOutcome = "completed";
    } else if (outcomes.some((o) => o === "executed")) {
      overallOutcome = "partial";
    } else {
      overallOutcome = "failed";
    }

    return {
      planId: plan.id,
      strategy: plan.strategy,
      stepResults,
      overallOutcome,
    };
  }
}
