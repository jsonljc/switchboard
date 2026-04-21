import type { ExecutionContext, ExecutionMode } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { SubmitWorkResponse } from "../platform-ingress.js";
import type { WorkUnit } from "../work-unit.js";
import type { Actor, ExecutionModeName, Priority } from "../types.js";

export interface WorkflowHandlerResult {
  outcome: "queued" | "completed" | "failed" | "pending_approval";
  summary: string;
  outputs?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface ChildWorkRequest {
  intent: string;
  organizationId: string;
  actor: Actor;
  parameters: Record<string, unknown>;
  parentWorkUnitId: string;
  idempotencyKey?: string;
  priority?: Priority;
}

export interface WorkflowRuntimeServices {
  submitChildWork(request: ChildWorkRequest): Promise<SubmitWorkResponse>;
}

export interface WorkflowHandler {
  execute(workUnit: WorkUnit, services: WorkflowRuntimeServices): Promise<WorkflowHandlerResult>;
}

export interface WorkflowModeConfig {
  handlers: Map<string, WorkflowHandler>;
  services: WorkflowRuntimeServices;
}

export class WorkflowMode implements ExecutionMode {
  readonly name: ExecutionModeName = "workflow";

  constructor(private readonly config: WorkflowModeConfig) {}

  async execute(
    workUnit: WorkUnit,
    _constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const handler = this.config.handlers.get(workUnit.intent);
    if (!handler) {
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: `Workflow handler not found for ${workUnit.intent}`,
        outputs: {},
        mode: "workflow",
        durationMs: 0,
        traceId: context.traceId,
        error: {
          code: "WORKFLOW_NOT_REGISTERED",
          message: `No workflow handler registered for ${workUnit.intent}`,
        },
      };
    }

    const startedAt = Date.now();
    const result = await handler.execute(workUnit, this.config.services);
    return {
      workUnitId: workUnit.id,
      outcome: result.outcome,
      summary: result.summary,
      outputs: result.outputs ?? {},
      mode: "workflow",
      durationMs: Date.now() - startedAt,
      traceId: context.traceId,
      error: result.error,
    };
  }
}
