// ---------------------------------------------------------------------------
// Audience handlers — list, insights, reach estimation, custom/lookalike CRUD
// ---------------------------------------------------------------------------

import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { CustomAudienceBuilder } from "../../audiences/custom-audience-builder.js";
import { AudienceInsightsChecker } from "../../audiences/audience-insights.js";
import type {
  CreateCustomAudienceWriteParams,
  CreateLookalikeAudienceWriteParams,
} from "../types.js";

export const audienceHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  // -------------------------------------------------------------------------
  // READ: audience.list
  // -------------------------------------------------------------------------
  [
    "digital-ads.audience.list",
    async (params, ctx): Promise<ExecuteResult> => {
      const apiConfig = ctx.apiConfig;
      if (!apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const builder = new CustomAudienceBuilder(apiConfig.baseUrl, apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const audiences = await builder.list(adAccountId, params.limit as number | undefined);
        return success(`Listed ${audiences.length} custom audience(s)`, audiences, start);
      } catch (err) {
        return fail(`Failed to list audiences: ${errMsg(err)}`, "audience.list", errMsg(err));
      }
    },
  ],

  // -------------------------------------------------------------------------
  // READ: audience.insights
  // -------------------------------------------------------------------------
  [
    "digital-ads.audience.insights",
    async (params, ctx): Promise<ExecuteResult> => {
      const apiConfig = ctx.apiConfig;
      if (!apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new AudienceInsightsChecker(apiConfig.baseUrl, apiConfig.accessToken);
        const audienceId = params.audienceId as string | undefined;
        const adAccountId = params.adAccountId as string | undefined;
        const targetingSpec = params.targetingSpec as Record<string, unknown> | undefined;
        if (audienceId) {
          const insights = await checker.getInsights(audienceId);
          return success(
            `Audience insights: ~${insights.approximateCount.toLocaleString()} users`,
            insights,
            start,
          );
        } else if (adAccountId && targetingSpec) {
          const estimate = await checker.getReachEstimate(adAccountId, targetingSpec);
          return success(
            `Reach estimate: ${estimate.dailyReach.lower.toLocaleString()}\u2013${estimate.dailyReach.upper.toLocaleString()} daily reach`,
            estimate,
            start,
          );
        }
        return fail(
          "Missing audienceId or adAccountId+targetingSpec",
          "validation",
          "Provide audienceId or adAccountId with targetingSpec",
        );
      } catch (err) {
        return fail(
          `Failed to get audience insights: ${errMsg(err)}`,
          "audience.insights",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // READ: reach.estimate
  // -------------------------------------------------------------------------
  [
    "digital-ads.reach.estimate",
    async (params, ctx): Promise<ExecuteResult> => {
      const apiConfig = ctx.apiConfig;
      if (!apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new AudienceInsightsChecker(apiConfig.baseUrl, apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        const targetingSpec = params.targetingSpec as Record<string, unknown>;
        if (!adAccountId || !targetingSpec) {
          return fail(
            "Missing adAccountId or targetingSpec",
            "validation",
            "adAccountId and targetingSpec are required",
          );
        }
        const estimate = await checker.getReachEstimate(adAccountId, targetingSpec);
        return success(
          `Reach estimate: ${estimate.dailyReach.lower.toLocaleString()}\u2013${estimate.dailyReach.upper.toLocaleString()} daily reach`,
          estimate,
          start,
        );
      } catch (err) {
        return fail(`Failed to estimate reach: ${errMsg(err)}`, "reach.estimate", errMsg(err));
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: audience.custom.create
  // -------------------------------------------------------------------------
  [
    "digital-ads.audience.custom.create",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      try {
        const castParams = params as unknown as CreateCustomAudienceWriteParams;
        const result = await ctx.writeProvider.createCustomAudience(castParams);
        return {
          success: true,
          summary: `Created custom audience "${castParams.name}" (${result.id})`,
          externalRefs: { audienceId: result.id },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: {
            originalActionId: "",
            originalEnvelopeId: "",
            reverseActionType: "digital-ads.audience.delete",
            reverseParameters: { audienceId: result.id },
            undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            undoRiskCategory: "medium",
            undoApprovalRequired: "none",
          },
        };
      } catch (err) {
        return fail(
          `Failed to create custom audience: ${errMsg(err)}`,
          "audience.custom.create",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: audience.lookalike.create
  // -------------------------------------------------------------------------
  [
    "digital-ads.audience.lookalike.create",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      try {
        const castParams = params as unknown as CreateLookalikeAudienceWriteParams;
        const result = await ctx.writeProvider.createLookalikeAudience(castParams);
        return {
          success: true,
          summary: `Created lookalike audience "${castParams.name}" from source ${castParams.sourceAudienceId} (${castParams.ratio * 100}% in ${castParams.country})`,
          externalRefs: { audienceId: result.id },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: {
            originalActionId: "",
            originalEnvelopeId: "",
            reverseActionType: "digital-ads.audience.delete",
            reverseParameters: { audienceId: result.id },
            undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            undoRiskCategory: "medium",
            undoApprovalRequired: "none",
          },
        };
      } catch (err) {
        return fail(
          `Failed to create lookalike audience: ${errMsg(err)}`,
          "audience.lookalike.create",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: audience.delete
  // -------------------------------------------------------------------------
  [
    "digital-ads.audience.delete",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      const audienceId = params.audienceId as string;
      if (!audienceId) return fail("Missing audienceId", "validation", "audienceId required");
      await ctx.writeProvider.deleteCustomAudience(audienceId);
      return {
        success: true,
        summary: `Deleted audience ${audienceId}`,
        externalRefs: { audienceId },
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 0,
        undoRecipe: null,
      };
    },
  ],
]);
