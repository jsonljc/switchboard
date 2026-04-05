// ---------------------------------------------------------------------------
// Operator deps — stubbed after domain code removal
// ---------------------------------------------------------------------------
// The operator command interpretation pipeline was removed with domain-specific
// agent code. This stub preserves the interface so callers (app.ts, operator
// route) don't break. The operator route guards on `deps` being non-null, so
// passing null from app.ts effectively disables it.
// ---------------------------------------------------------------------------

import type { OperatorCommandStore } from "@switchboard/core";

export interface OperatorDeps {
  interpreter: {
    interpret(
      rawInput: string,
      ctx: { organizationId: string; channel: string },
    ): Promise<{
      intent: string;
      entities: Array<{ type: string; value: string }>;
      parameters: Record<string, unknown>;
      confidence: number;
      ambiguityFlags: string[];
    }>;
  };
  guardrailEvaluator: {
    evaluate(result: {
      intent: string;
      entities: Array<{ type: string; value: string }>;
      parameters: Record<string, unknown>;
      confidence: number;
      ambiguityFlags: string[];
    }): {
      canExecute: boolean;
      requiresConfirmation: boolean;
      warnings: string[];
      missingEntities: string[];
    };
  };
  router: {
    dispatch(command: {
      intent: string;
      entities: Array<{ type: string; value: string }>;
      parameters: Record<string, unknown>;
    }): Promise<{
      success: boolean;
      error?: string;
      resultSummary?: string;
      workflowIds: string[];
    }>;
  };
  formatter: {
    formatSuccess(intent: string, data: Record<string, unknown>, channel: string): string;
    formatError(error: string, channel: string): string;
    formatClarificationPrompt(entities: string[], channel: string): string;
    formatConfirmationPrompt(
      intent: string,
      entities: Array<{ type: string; value: string }>,
      channel: string,
    ): string;
  };
  commandStore: OperatorCommandStore;
}

export interface BuildOperatorDepsOptions {
  commandStore: OperatorCommandStore;
}

/**
 * Build operator deps — currently returns null as the operator pipeline
 * has been removed. The operator route handles null deps gracefully.
 */
export function buildOperatorDeps(_options: BuildOperatorDepsOptions): OperatorDeps | null {
  return null;
}
