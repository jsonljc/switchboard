// ---------------------------------------------------------------------------
// Proposal Result Handler — processes orchestrator propose/execute outcomes
// ---------------------------------------------------------------------------

import type { HandlerContext } from "./handler-context.js";
import type { ProposeResult, DataFlowExecutionResult } from "@switchboard/core";
import type { UndoRecipe } from "@switchboard/schemas";
import { buildApprovalCard } from "../composer/approval-card.js";
import { buildResultCard } from "../composer/result-card.js";
import { formatDiagnosticResult, isDiagnosticAction } from "../formatters/diagnostic-formatter.js";
import { getThread, setThread } from "../conversation/threads.js";
import { transitionConversation } from "../conversation/state.js";
import { safeErrorMessage } from "../utils/safe-error.js";

export async function handleProposeResult(
  ctx: HandlerContext,
  threadId: string,
  result: ProposeResult,
  _principalId: string,
): Promise<void> {
  if (result.denied) {
    const deniedCheck = result.decisionTrace.checks.find((c) => c.matched && c.effect === "deny");
    const denialResponse = await ctx.composeResponse({
      type: "denial",
      explanation: result.decisionTrace.explanation,
      denialDetail: deniedCheck?.humanDetail,
    });
    await ctx.adapter.sendTextReply(threadId, denialResponse.text);
    await ctx.recordAssistantMessage(threadId, denialResponse.text);
    return;
  }

  if (result.approvalRequest) {
    const conversation = await getThread(threadId);
    if (conversation) {
      const updated = transitionConversation(conversation, {
        type: "set_awaiting_approval",
        approvalIds: [result.approvalRequest.id],
      });
      await setThread(updated);
    }

    const actionType = result.envelope.proposals[0]?.actionType;
    const rawCard = buildApprovalCard(
      result.approvalRequest.summary,
      result.approvalRequest.riskCategory,
      result.explanation,
      result.approvalRequest.id,
      result.approvalRequest.bindingHash,
      actionType,
    );
    const card = ctx.filterCardText(ctx.humanizer.humanizeApprovalCard(rawCard));
    await ctx.adapter.sendApprovalCard(threadId, card);
    await ctx.recordAssistantMessage(
      threadId,
      `[Approval Required] ${result.approvalRequest.summary}`,
    );
    return;
  }

  // Auto-approved — execute immediately
  try {
    const executeResult = await ctx.orchestrator.executeApproved(result.envelope.id);
    await ctx.trackLastExecuted(threadId, result.envelope.id);

    // Diagnostic actions → formatted text reply (not result card)
    const actionType = result.envelope.proposals[0]?.actionType ?? "";
    if (isDiagnosticAction(actionType) && executeResult.data) {
      const formatted = formatDiagnosticResult(actionType, executeResult.data);
      const diagnosticResponse = await ctx.composeResponse({
        type: "diagnostic",
        actionType,
        data: formatted,
      });
      await ctx.adapter.sendTextReply(threadId, diagnosticResponse.text);
      await ctx.recordAssistantMessage(threadId, diagnosticResponse.text);
      return;
    }

    const undoRecipe = executeResult.undoRecipe as UndoRecipe | null;

    // Generate summary text via ResponseGenerator before building the card
    const responseType = executeResult.success ? "result_success" : "result_failure";
    const summaryResponse = await ctx.composeResponse({
      type: responseType,
      actionType,
      summary: executeResult.summary,
    });

    const rawCard = buildResultCard(
      summaryResponse.text,
      executeResult.success,
      result.envelope.auditEntryIds[0] ?? result.envelope.id,
      result.decisionTrace.computedRiskScore.category,
      executeResult.rollbackAvailable,
      undoRecipe?.undoExpiresAt ?? null,
    );
    // Skip humanizer on the card since composeResponse already applied terminology
    const card = ctx.filterCardText(rawCard);
    await ctx.adapter.sendResultCard(threadId, card);
    await ctx.recordAssistantMessage(threadId, card.summary);
  } catch (err) {
    console.error("Execution error:", err);
    ctx.failedMessageStore
      ?.record({
        channel: ctx.adapter.channel,
        rawPayload: { envelopeId: result.envelope.id },
        stage: "execute",
        errorMessage: safeErrorMessage(err),
        errorStack: err instanceof Error ? err.stack : undefined,
      })
      .catch((dlqErr) => console.error("DLQ record error:", dlqErr));
    const errText = `Execution failed: ${safeErrorMessage(err)}`;
    await ctx.sendFilteredReply(threadId, errText);
    await ctx.recordAssistantMessage(threadId, errText);
  }
}

export async function handlePlanResult(
  ctx: HandlerContext,
  threadId: string,
  planResult: DataFlowExecutionResult,
  _principalId: string,
): Promise<void> {
  const executed = planResult.stepResults.filter((s) => s.outcome === "executed");
  const pending = planResult.stepResults.filter((s) => s.outcome === "pending_approval");
  const denied = planResult.stepResults.filter((s) => s.outcome === "denied");
  const errors = planResult.stepResults.filter((s) => s.outcome === "error");

  const parts: string[] = [
    `Plan ${planResult.overallOutcome} (${planResult.stepResults.length} steps):`,
  ];

  if (executed.length > 0) {
    parts.push(`${executed.length} executed`);
  }
  if (pending.length > 0) {
    parts.push(`${pending.length} awaiting approval`);
  }
  if (denied.length > 0) {
    parts.push(`${denied.length} denied`);
  }
  if (errors.length > 0) {
    parts.push(`${errors.length} failed`);
  }

  const summaryText = parts.join(", ");
  const responseType =
    planResult.overallOutcome === "completed" ? "result_success" : "result_failure";
  const response = await ctx.composeResponse({ type: responseType, summary: summaryText });
  await ctx.adapter.sendTextReply(threadId, response.text);
  await ctx.recordAssistantMessage(threadId, response.text);
}
