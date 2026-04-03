import type { ExecuteResult } from "@switchboard/schemas";
import type { EmployeeContext } from "@switchboard/employee-sdk";
import { ContentPublishParamsSchema } from "../schemas.js";

export async function executePublish(
  params: Record<string, unknown>,
  _context: EmployeeContext,
): Promise<ExecuteResult> {
  const parsed = ContentPublishParamsSchema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      summary: `Invalid publish params: ${parsed.error.message}`,
      externalRefs: {},
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: 0,
      undoRecipe: null,
    };
  }

  // In v1, mark as published (actual publishing to social APIs comes later)
  return {
    success: true,
    summary: `Content published to ${parsed.data.channel}`,
    externalRefs: { draftId: parsed.data.draftId },
    rollbackAvailable: false,
    partialFailures: [],
    durationMs: 0,
    undoRecipe: null,
    data: {
      draftId: parsed.data.draftId,
      channel: parsed.data.channel,
      scheduledFor: parsed.data.scheduledFor,
    },
  };
}
