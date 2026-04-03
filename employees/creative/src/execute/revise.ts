import type { ExecuteResult } from "@switchboard/schemas";
import type { EmployeeContext } from "@switchboard/employee-sdk";
import { ContentReviseParamsSchema } from "../schemas.js";

export async function executeRevise(
  params: Record<string, unknown>,
  _context: EmployeeContext,
): Promise<ExecuteResult> {
  const parsed = ContentReviseParamsSchema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      summary: `Invalid revise params: ${parsed.error.message}`,
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
    };
  }

  return {
    success: true,
    summary: `Revision created for draft ${parsed.data.originalDraftId}`,
    externalRefs: { originalDraftId: parsed.data.originalDraftId },
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 0,
    undoRecipe: null,
    data: {
      content: parsed.data.content,
      originalDraftId: parsed.data.originalDraftId,
    },
  };
}
