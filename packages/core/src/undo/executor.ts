/**
 * UndoExecutionEngine — validates and executes undo recipes through governance.
 *
 * Validates expiry, prevents double-undo, and submits reverse actions
 * through the full governance pipeline (audited, approval-gated).
 */

import type { UndoRecipe } from "@switchboard/schemas";

export interface UndoExecutionContext {
  /** Retrieve the envelope by ID */
  getEnvelope(envelopeId: string): Promise<{
    id: string;
    executionResults: Array<{
      undoRecipe?: UndoRecipe | null;
    }>;
    proposals: Array<{
      id: string;
      actionType: string;
      parameters: Record<string, unknown>;
    }>;
    decisions: Array<{
      computedRiskScore: { category: string };
    }>;
    traceId: string | null;
    parentEnvelopeId: string | null;
  } | null>;

  /** Check if an undo has already been submitted for this envelope */
  hasUndoBeenSubmitted(envelopeId: string): Promise<boolean>;

  /** Mark an envelope as having had an undo submitted */
  markUndoSubmitted(envelopeId: string): Promise<void>;

  /** Submit the reverse action through governance */
  propose(params: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId: string;
    message: string;
    parentEnvelopeId: string;
  }): Promise<{ envelopeId: string; status: string }>;
}

export interface UndoResult {
  success: boolean;
  envelopeId?: string;
  status?: string;
  error?: string;
}

export class UndoExecutionEngine {
  constructor(private context: UndoExecutionContext) {}

  /**
   * Execute an undo for a given envelope.
   *
   * 1. Load envelope and find undo recipe
   * 2. Validate expiry window
   * 3. Prevent double-undo
   * 4. Submit reverse action through governance pipeline
   */
  async executeUndo(envelopeId: string): Promise<UndoResult> {
    // 1. Load envelope
    const envelope = await this.context.getEnvelope(envelopeId);
    if (!envelope) {
      return { success: false, error: `Envelope not found: ${envelopeId}` };
    }

    // 2. Find execution result with undo recipe
    const execResult = envelope.executionResults.find(
      (r) => r.undoRecipe !== null && r.undoRecipe !== undefined,
    );
    if (!execResult?.undoRecipe) {
      return { success: false, error: "No undo recipe available for this action" };
    }

    const undoRecipe = execResult.undoRecipe;

    // 3. Check expiry
    if (new Date() > undoRecipe.undoExpiresAt) {
      return {
        success: false,
        error: `Undo window expired at ${undoRecipe.undoExpiresAt.toISOString()}`,
      };
    }

    // 4. Prevent double-undo
    const alreadyUndone = await this.context.hasUndoBeenSubmitted(envelopeId);
    if (alreadyUndone) {
      return { success: false, error: "Undo has already been submitted for this envelope" };
    }

    // 5. Resolve cartridge and principal from original proposal
    const originalProposal = envelope.proposals[0];
    const cartridgeId =
      (originalProposal?.parameters["_cartridgeId"] as string | undefined) ??
      this.inferCartridgeId(undoRecipe.reverseActionType);

    if (!cartridgeId) {
      return { success: false, error: "Cannot determine cartridge for undo action" };
    }

    const principalId =
      (originalProposal?.parameters["_principalId"] as string | undefined) ?? "system";

    // 6. Mark as submitted (before propose, to prevent race conditions)
    await this.context.markUndoSubmitted(envelopeId);

    // 7. Submit through governance
    try {
      const result = await this.context.propose({
        actionType: undoRecipe.reverseActionType,
        parameters: undoRecipe.reverseParameters,
        principalId,
        cartridgeId,
        message: `Undo of action ${undoRecipe.originalActionId}`,
        parentEnvelopeId: envelopeId,
      });

      return {
        success: true,
        envelopeId: result.envelopeId,
        status: result.status,
      };
    } catch (err) {
      return {
        success: false,
        error: `Undo proposal failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Validate whether an undo is still possible for a given envelope,
   * without actually executing it.
   */
  async canUndo(envelopeId: string): Promise<{
    canUndo: boolean;
    reason?: string;
    expiresAt?: Date;
  }> {
    const envelope = await this.context.getEnvelope(envelopeId);
    if (!envelope) {
      return { canUndo: false, reason: "Envelope not found" };
    }

    const execResult = envelope.executionResults.find(
      (r) => r.undoRecipe !== null && r.undoRecipe !== undefined,
    );
    if (!execResult?.undoRecipe) {
      return { canUndo: false, reason: "No undo recipe available" };
    }

    if (new Date() > execResult.undoRecipe.undoExpiresAt) {
      return { canUndo: false, reason: "Undo window expired" };
    }

    const alreadyUndone = await this.context.hasUndoBeenSubmitted(envelopeId);
    if (alreadyUndone) {
      return { canUndo: false, reason: "Already undone" };
    }

    return { canUndo: true, expiresAt: execResult.undoRecipe.undoExpiresAt };
  }

  private inferCartridgeId(actionType: string): string | null {
    const prefix = actionType.split(".")[0];
    const knownPrefixes: Record<string, string> = {
      "digital-ads": "digital-ads",
      crm: "crm",
      payments: "payments",
      "quant-trading": "quant-trading",
      "patient-engagement": "patient-engagement",
    };
    return knownPrefixes[prefix!] ?? null;
  }
}
