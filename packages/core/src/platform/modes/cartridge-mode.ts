import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionModeName } from "../types.js";

export interface CartridgeOrchestrator {
  propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    organizationId?: string | null;
    cartridgeId: string;
    traceId?: string;
    idempotencyKey?: string;
  }): Promise<{
    envelope: { id: string; status: string };
    approvalRequest: unknown | null;
    denied: boolean;
    explanation: string;
  }>;
}

export interface CartridgeModeConfig {
  orchestrator: CartridgeOrchestrator;
  intentRegistry: {
    lookup(intent: string): { executor: { actionId?: string } } | undefined;
  };
}

/**
 * Derives the cartridge ID from an action ID by taking everything before the first dot.
 * E.g. "digital-ads.campaign.pause" → "digital-ads"
 */
function deriveCartridgeId(actionId: string): string {
  const dotIndex = actionId.indexOf(".");
  return dotIndex > 0 ? actionId.slice(0, dotIndex) : actionId;
}

export class CartridgeMode implements ExecutionMode {
  readonly name: ExecutionModeName = "cartridge";
  private readonly config: CartridgeModeConfig;

  constructor(config: CartridgeModeConfig) {
    this.config = config;
  }

  async execute(
    workUnit: WorkUnit,
    _constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const registration = this.config.intentRegistry.lookup(workUnit.intent);
    const actionId = registration?.executor?.actionId ?? workUnit.intent;
    const cartridgeId = deriveCartridgeId(actionId);

    const startMs = Date.now();
    try {
      const result = await this.config.orchestrator.propose({
        actionType: actionId,
        parameters: workUnit.parameters,
        principalId: workUnit.actor.id,
        organizationId: workUnit.organizationId,
        cartridgeId,
        traceId: workUnit.traceId,
        idempotencyKey: workUnit.idempotencyKey,
      });

      const durationMs = Date.now() - startMs;

      if (result.denied) {
        return {
          workUnitId: workUnit.id,
          outcome: "failed",
          summary: result.explanation,
          outputs: {},
          mode: "cartridge",
          durationMs,
          traceId: context.traceId,
          error: { code: "DENIED", message: result.explanation },
        };
      }

      if (result.approvalRequest) {
        return {
          workUnitId: workUnit.id,
          outcome: "pending_approval",
          summary: result.explanation,
          outputs: { envelopeId: result.envelope.id },
          mode: "cartridge",
          durationMs,
          traceId: context.traceId,
          approvalId: result.envelope.id,
        };
      }

      return {
        workUnitId: workUnit.id,
        outcome: "completed",
        summary: result.explanation,
        outputs: { envelopeId: result.envelope.id },
        mode: "cartridge",
        durationMs,
        traceId: context.traceId,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);
      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: message,
        outputs: {},
        mode: "cartridge",
        durationMs,
        traceId: context.traceId,
        error: { code: "CARTRIDGE_ERROR", message },
      };
    }
  }
}
