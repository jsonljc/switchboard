import type { ResultCardPayload } from "../adapters/adapter.js";

export function buildResultCard(
  summary: string,
  success: boolean,
  auditId: string,
  riskCategory: string,
  undoAvailable: boolean,
  undoExpiresAt: Date | null,
): ResultCardPayload {
  return {
    summary,
    success,
    auditId,
    riskCategory,
    undoAvailable,
    undoExpiresAt,
  };
}
