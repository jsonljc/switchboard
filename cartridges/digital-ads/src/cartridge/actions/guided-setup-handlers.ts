// ---------------------------------------------------------------------------
// Guided Setup handler — multi-step campaign + ad set + ad creation
// ---------------------------------------------------------------------------

import type { ActionHandler } from "./handler-context.js";
import { fail, errMsg } from "./handler-context.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";

export const guidedSetupHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  [
    "digital-ads.campaign.setup_guided",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }

      const objective = params.objective as string;
      const campaignName = params.campaignName as string;
      const dailyBudget = params.dailyBudget as number;
      const targeting = params.targeting as Record<string, unknown>;
      const creative = params.creative as Record<string, unknown>;
      const adSetName = params.adSetName as string | undefined;
      const adName = params.adName as string | undefined;

      if (!objective || !campaignName || !dailyBudget || !targeting || !creative) {
        return fail(
          "Missing required guided setup parameters",
          "validation",
          "objective, campaignName, dailyBudget, targeting, and creative are required",
        );
      }

      const createdIds: Record<string, string> = {};
      const failures: Array<{ step: string; error: string }> = [];

      try {
        const campaign = await ctx.writeProvider.createCampaign({
          name: campaignName,
          objective,
          dailyBudget,
          status: "PAUSED",
        });
        createdIds.campaignId = campaign.id;

        const adSet = await ctx.writeProvider.createAdSet({
          campaignId: campaign.id,
          name: adSetName ?? `${campaignName} — Ad Set`,
          dailyBudget,
          targeting,
          status: "PAUSED",
        });
        createdIds.adSetId = adSet.id;

        const ad = await ctx.writeProvider.createAd({
          adSetId: adSet.id,
          name: adName ?? `${campaignName} — Ad`,
          creative,
          status: "PAUSED",
        });
        createdIds.adId = ad.id;
      } catch (err) {
        failures.push({
          step: "guided_setup",
          error: errMsg(err),
        });
      }

      return {
        success: failures.length === 0,
        summary:
          failures.length === 0
            ? `Guided setup complete: campaign ${createdIds.campaignId}, ad set ${createdIds.adSetId}, ad ${createdIds.adId} (all PAUSED)`
            : `Guided setup partially failed: ${failures[0]?.error}`,
        externalRefs: createdIds,
        rollbackAvailable: !!createdIds.campaignId,
        partialFailures: failures,
        durationMs: 0,
        undoRecipe: createdIds.campaignId
          ? {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.campaign.pause",
              reverseParameters: { campaignId: createdIds.campaignId },
              undoExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              undoRiskCategory: "low",
              undoApprovalRequired: "none",
            }
          : null,
      };
    },
  ],
]);
