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

export class ActionExecutor {
  private handlers = new Map<string, ActionHandler>();

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

    try {
      const result = await handler(action.parameters, context);
      return {
        actionType: action.actionType,
        success: result.success,
        blockedByPolicy: false,
        result: result.result,
      };
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
