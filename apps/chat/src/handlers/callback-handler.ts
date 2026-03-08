// ---------------------------------------------------------------------------
// Callback Query Handler — approval button taps (Telegram inline keyboard)
// ---------------------------------------------------------------------------

import type { HandlerContext } from "./handler-context.js";
import type { UndoRecipe } from "@switchboard/schemas";
import { buildResultCard } from "../composer/result-card.js";
import { safeErrorMessage } from "../utils/safe-error.js";

export async function handleCallbackQuery(
  ctx: HandlerContext,
  threadId: string,
  callbackData: string,
  principalId: string,
): Promise<void> {
  let parsed: {
    action: "approve" | "reject" | "patch";
    approvalId: string;
    bindingHash?: string;
    patchValue?: Record<string, unknown>;
  };

  try {
    parsed = JSON.parse(callbackData);
  } catch {
    return;
  }

  try {
    const response = await ctx.orchestrator.respondToApproval({
      approvalId: parsed.approvalId,
      action: parsed.action,
      respondedBy: principalId,
      bindingHash: parsed.bindingHash ?? "",
      patchValue: parsed.patchValue,
    });

    if (parsed.action === "approve" || parsed.action === "patch") {
      if (response.executionResult) {
        await ctx.trackLastExecuted(threadId, response.envelope.id);

        const undoRecipe = response.executionResult.undoRecipe as UndoRecipe | null;

        const rawCard = buildResultCard(
          response.executionResult.summary,
          response.executionResult.success,
          response.envelope.auditEntryIds[0] ?? response.envelope.id,
          response.envelope.decisions[0]?.computedRiskScore.category ?? "low",
          response.executionResult.rollbackAvailable,
          undoRecipe?.undoExpiresAt ?? null,
        );
        const card = ctx.filterCardText(ctx.humanizer.humanizeResultCard(rawCard));
        await ctx.adapter.sendResultCard(threadId, card);
        await ctx.recordAssistantMessage(threadId, card.summary);
      }
    } else if (parsed.action === "reject") {
      const rejectText = `Action rejected by ${principalId}.`;
      await ctx.sendFilteredReply(threadId, rejectText);
      await ctx.recordAssistantMessage(threadId, rejectText);
    }
  } catch (err) {
    console.error("Approval callback error:", err);
    await ctx.sendFilteredReply(threadId, `Error: ${safeErrorMessage(err)}`);
  }
}

export function extractCallbackQueryId(rawPayload: unknown): string | null {
  const payload = rawPayload as Record<string, unknown> | undefined;
  if (!payload) return null;
  const callbackQuery = payload["callback_query"] as Record<string, unknown> | undefined;
  return callbackQuery ? String(callbackQuery["id"]) : null;
}
