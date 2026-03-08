// ---------------------------------------------------------------------------
// System Commands — undo and kill-switch handlers
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { HandlerContext } from "./handler-context.js";
import type { ProposeResult } from "@switchboard/core";
import { handleProposeResult } from "./proposal-handler.js";
import { safeErrorMessage } from "../utils/safe-error.js";

export async function handleUndo(
  ctx: HandlerContext,
  threadId: string,
  principalId: string,
): Promise<void> {
  const lastEnvelopeId = await ctx.getLastExecutedEnvelopeId(threadId);
  if (!lastEnvelopeId) {
    await ctx.sendFilteredReply(threadId, "No recent action to undo.");
    return;
  }

  try {
    const undoResult = await ctx.orchestrator.requestUndo(lastEnvelopeId);
    await handleProposeResult(ctx, threadId, undoResult as ProposeResult, principalId);
  } catch (err) {
    console.error("Undo error:", err);
    await ctx.sendFilteredReply(threadId, `Cannot undo: ${safeErrorMessage(err)}`);
  }
}

export async function handleKillSwitch(
  ctx: HandlerContext,
  threadId: string,
  principalId: string,
  organizationId: string | null,
): Promise<void> {
  if (!ctx.readAdapter) {
    await ctx.sendFilteredReply(
      threadId,
      "Cannot execute kill switch: read adapter not configured.",
    );
    return;
  }

  try {
    // Query all campaigns
    const queryResult = await ctx.readAdapter.query({
      cartridgeId: "digital-ads",
      operation: "searchCampaigns",
      parameters: { query: "" },
      actorId: principalId,
      organizationId,
    });

    const campaigns = queryResult.data as Array<{ id: string; name: string; status: string }>;
    const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE" || c.status === "active");

    if (activeCampaigns.length === 0) {
      await ctx.sendFilteredReply(threadId, "No active campaigns to pause.");
      return;
    }

    await ctx.sendFilteredReply(
      threadId,
      `Emergency: pausing ${activeCampaigns.length} active campaign(s)...`,
    );

    const failures: string[] = [];
    for (const campaign of activeCampaigns) {
      try {
        const killSwitchIdempotencyKey = createHash("sha256")
          .update(principalId)
          .update("kill-switch")
          .update(campaign.id)
          .digest("hex");

        const proposeResult = await ctx.orchestrator.resolveAndPropose({
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignId: campaign.id, entityId: campaign.id },
          principalId,
          cartridgeId: "digital-ads",
          entityRefs: [],
          message: `Emergency kill switch: pause ${campaign.name}`,
          organizationId,
          emergencyOverride: true,
          idempotencyKey: killSwitchIdempotencyKey,
        });

        if (!("needsClarification" in proposeResult) && !("notFound" in proposeResult)) {
          await handleProposeResult(ctx, threadId, proposeResult, principalId);
        }
      } catch (err) {
        console.error(`Kill switch error for campaign ${campaign.name}:`, err);
        failures.push(`${campaign.name}: ${safeErrorMessage(err)}`);
      }
    }

    if (failures.length > 0) {
      await ctx.sendFilteredReply(
        threadId,
        `Kill switch failures:\n${failures.map((f) => `- ${f}`).join("\n")}`,
      );
    }
  } catch (err) {
    console.error("Kill switch error:", err);
    await ctx.sendFilteredReply(threadId, `Kill switch error: ${safeErrorMessage(err)}`);
  }
}
