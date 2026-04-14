// ---------------------------------------------------------------------------
// Action Executor — dispatches action requests to cartridge operations
// ---------------------------------------------------------------------------

import type { AgentContext, ActionRequest } from "./ports.js";
import type { PolicyBridge } from "./policy-bridge.js";

export type ActionHandler = (
  parameters: Record<string, unknown>,
  context: AgentContext,
) => Promise<{ success: boolean; result?: unknown }>;

export interface ActionResult {
  actionType: string;
  success: boolean;
  blockedByPolicy: boolean;
  result?: unknown;
  error?: string;
}

export interface ActionExecutorConfig {
  idempotencyGuard?: {
    checkDuplicate(
      principalId: string,
      actionType: string,
      parameters: Record<string, unknown>,
    ): Promise<{ isDuplicate: boolean; cachedResponse: unknown | null }>;
    recordResponse(
      principalId: string,
      actionType: string,
      parameters: Record<string, unknown>,
      response: unknown,
    ): Promise<void>;
  };
  writeActions?: Set<string>;
}

export class ActionExecutor {
  private handlers = new Map<string, ActionHandler>();
  private idempotencyGuard: ActionExecutorConfig["idempotencyGuard"];
  private writeActions: Set<string>;

  constructor(config?: ActionExecutorConfig) {
    this.idempotencyGuard = config?.idempotencyGuard;
    this.writeActions = config?.writeActions ?? new Set();
  }

  register(actionType: string, handler: ActionHandler): void {
    this.handlers.set(actionType, handler);
  }

  listRegistered(): string[] {
    return [...this.handlers.keys()];
  }

  async execute(
    action: ActionRequest,
    context: AgentContext,
    policyBridge: PolicyBridge,
  ): Promise<ActionResult> {
    const handler = this.handlers.get(action.actionType);
    if (!handler) {
      return {
        actionType: action.actionType,
        success: false,
        blockedByPolicy: false,
        error: `No handler registered for action type: ${action.actionType}`,
      };
    }

    const evaluation = await policyBridge.evaluate({
      eventId: "action-" + action.actionType,
      destinationType: "system",
      destinationId: action.actionType,
      action: action.actionType,
      payload: action.parameters,
      criticality: "required",
    });

    if (!evaluation.approved) {
      return {
        actionType: action.actionType,
        success: false,
        blockedByPolicy: true,
        error: evaluation.reason,
      };
    }

    const isWriteAction = this.writeActions.has(action.actionType);
    if (isWriteAction && this.idempotencyGuard) {
      const { isDuplicate, cachedResponse } = await this.idempotencyGuard.checkDuplicate(
        context.organizationId,
        action.actionType,
        action.parameters,
      );
      if (isDuplicate && cachedResponse) {
        return cachedResponse as ActionResult;
      }
    }

    try {
      const handlerResult = await handler(action.parameters, context);
      const result: ActionResult = {
        actionType: action.actionType,
        success: handlerResult.success,
        blockedByPolicy: false,
        result: handlerResult.result,
      };

      if (isWriteAction && this.idempotencyGuard) {
        await this.idempotencyGuard.recordResponse(
          context.organizationId,
          action.actionType,
          action.parameters,
          result,
        );
      }

      return result;
    } catch (err) {
      return {
        actionType: action.actionType,
        success: false,
        blockedByPolicy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
