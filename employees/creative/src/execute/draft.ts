import type { ExecuteResult } from "@switchboard/schemas";
import type { EmployeeContext } from "@switchboard/employee-sdk";
import { ContentDraftParamsSchema } from "../schemas.js";

export async function executeDraft(
  params: Record<string, unknown>,
  _context: EmployeeContext,
): Promise<ExecuteResult> {
  const parsed = ContentDraftParamsSchema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      summary: `Invalid draft params: ${parsed.error.message}`,
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
    };
  }

  return {
    success: true,
    summary: `Draft created for ${parsed.data.channel} (${parsed.data.format})`,
    externalRefs: {},
    rollbackAvailable: true,
    partialFailures: [],
    durationMs: 0,
    undoRecipe: null,
    data: {
      content: parsed.data.content,
      channel: parsed.data.channel,
      format: parsed.data.format,
      topic: parsed.data.topic,
    },
  };
}
