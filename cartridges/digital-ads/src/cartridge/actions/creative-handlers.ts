// ---------------------------------------------------------------------------
// Creative handlers — list, analyze, generate, score, brief, upload, rotate
// ---------------------------------------------------------------------------

import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { CreativeAnalyzer } from "../../creative/creative-analyzer.js";
import { CreativeVariantGenerator } from "../../creative/creative-variant-generator.js";
import { CreativeAssetScorer } from "../../creative/asset-scorer.js";
import type {
  AssetPerformanceData,
  VisualAttributes,
  AssetScore,
} from "../../creative/asset-scorer.js";
import type { CreateAdCreativeWriteParams } from "../types.js";

export const creativeHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  // -------------------------------------------------------------------------
  // READ: creative.list
  // -------------------------------------------------------------------------
  [
    "digital-ads.creative.list",
    async (params, ctx): Promise<ExecuteResult> => {
      const apiConfig = ctx.apiConfig;
      if (!apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
        const limit = (params.limit as number) ?? 50;
        const url =
          `${apiConfig.baseUrl}/${accountId}/adcreatives?fields=` +
          "id,name,status,object_type,thumbnail_url,effective_object_story_id" +
          `&limit=${limit}&access_token=${apiConfig.accessToken}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Meta API error: HTTP ${response.status}`);
        }
        const data = (await response.json()) as Record<string, unknown>;
        const creatives = (data.data ?? []) as Record<string, unknown>[];
        return success(`Listed ${creatives.length} creative(s)`, creatives, start);
      } catch (err) {
        return fail(`Failed to list creatives: ${errMsg(err)}`, "creative.list", errMsg(err));
      }
    },
  ],

  // -------------------------------------------------------------------------
  // READ: creative.analyze
  // -------------------------------------------------------------------------
  [
    "digital-ads.creative.analyze",
    async (params, ctx): Promise<ExecuteResult> => {
      const apiConfig = ctx.apiConfig;
      if (!apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const analyzer = new CreativeAnalyzer(apiConfig.baseUrl, apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const result = await analyzer.analyze(adAccountId, params.datePreset as string | undefined);
        return success(
          `Creative analysis: ${result.topPerformers.length} top, ${result.fatigued.length} fatigued, ${result.recommendations.length} recommendation(s)`,
          result,
          start,
        );
      } catch (err) {
        return fail(`Failed to analyze creatives: ${errMsg(err)}`, "creative.analyze", errMsg(err));
      }
    },
  ],

  // -------------------------------------------------------------------------
  // READ: creative.generate
  // -------------------------------------------------------------------------
  [
    "digital-ads.creative.generate",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const generator = new CreativeVariantGenerator();
        const productDescription = params.productDescription as string;
        const targetAudience = params.targetAudience as string;
        if (!productDescription || !targetAudience) {
          return fail(
            "Missing productDescription or targetAudience",
            "validation",
            "productDescription and targetAudience are required",
          );
        }
        const result = generator.generateVariants({
          productDescription,
          targetAudience,
          angles: params.angles as string[] | undefined,
          variantsPerAngle: params.variantsPerAngle as number | undefined,
        });
        return success(
          `Generated ${result.totalGenerated} creative variant(s) across ${result.angles.length} angle(s)`,
          result,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate creative variants: ${errMsg(err)}`,
          "creative.generate",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // READ: creative.score_assets
  // -------------------------------------------------------------------------
  [
    "digital-ads.creative.score_assets",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const scorer = new CreativeAssetScorer();
        const accountId = params.accountId as string;
        const assets = params.assets as AssetPerformanceData[];
        if (!accountId || !assets || !Array.isArray(assets)) {
          return fail(
            "Missing accountId or assets",
            "validation",
            "accountId and assets array are required",
          );
        }
        // Reconstruct visual attributes map if provided
        let visualAttributesMap: Map<string, VisualAttributes> | undefined;
        const rawVisualMap = params.visualAttributes as
          | Record<string, VisualAttributes>
          | undefined;
        if (rawVisualMap && typeof rawVisualMap === "object") {
          visualAttributesMap = new Map(Object.entries(rawVisualMap));
        }
        const result = scorer.analyzePortfolio(accountId, assets, visualAttributesMap);
        return success(
          `Scored ${result.totalAssetsAnalyzed} creative asset(s) — avg score: ${result.insights.avgOverallScore}, diversity: ${result.insights.diversityScore}`,
          result,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to score creative assets: ${errMsg(err)}`,
          "creative.score_assets",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // READ: creative.generate_brief
  // -------------------------------------------------------------------------
  [
    "digital-ads.creative.generate_brief",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const scorer = new CreativeAssetScorer();
        const topPerformers = params.topPerformers as AssetScore[];
        const weaknesses = params.weaknesses as string[];
        if (!topPerformers || !Array.isArray(topPerformers)) {
          return fail("Missing topPerformers", "validation", "topPerformers array is required");
        }
        const brief = scorer.generateCreativeBrief(topPerformers, weaknesses ?? []);
        return success(
          `Creative brief generated: ${brief.recommendedFormats.length} format(s), ${brief.visualGuidelines.length} visual guideline(s), ${brief.avoidList.length} avoid item(s)`,
          brief,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate creative brief: ${errMsg(err)}`,
          "creative.generate_brief",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: creative.upload
  // -------------------------------------------------------------------------
  [
    "digital-ads.creative.upload",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      try {
        const castParams = params as unknown as CreateAdCreativeWriteParams;
        const result = await ctx.writeProvider.createAdCreative(castParams);
        return {
          success: true,
          summary: `Uploaded creative "${castParams.name}" (${result.id})`,
          externalRefs: { creativeId: result.id },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: null,
        };
      } catch (err) {
        return fail(`Failed to upload creative: ${errMsg(err)}`, "creative.upload", errMsg(err));
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: creative.rotate
  // -------------------------------------------------------------------------
  [
    "digital-ads.creative.rotate",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      const adsToPause = params.adsToPause as string[] | undefined;
      const adsToActivate = params.adsToActivate as string[] | undefined;
      const results: Array<{ adId: string; action: string; previousStatus: string }> = [];
      const failures: Array<{ step: string; error: string }> = [];

      for (const adId of adsToPause ?? []) {
        try {
          const r = await ctx.writeProvider.updateAdStatus(adId, "PAUSED");
          results.push({ adId, action: "paused", previousStatus: r.previousStatus });
        } catch (err) {
          failures.push({
            step: `pause_${adId}`,
            error: errMsg(err),
          });
        }
      }
      for (const adId of adsToActivate ?? []) {
        try {
          const r = await ctx.writeProvider.updateAdStatus(adId, "ACTIVE");
          results.push({ adId, action: "activated", previousStatus: r.previousStatus });
        } catch (err) {
          failures.push({
            step: `activate_${adId}`,
            error: errMsg(err),
          });
        }
      }

      return {
        success: failures.length === 0,
        summary: `Rotated creatives: ${results.filter((r) => r.action === "paused").length} paused, ${results.filter((r) => r.action === "activated").length} activated${failures.length > 0 ? ` (${failures.length} failed)` : ""}`,
        externalRefs: { rotatedAds: JSON.stringify(results) },
        rollbackAvailable: results.length > 0,
        partialFailures: failures,
        durationMs: 0,
        undoRecipe:
          results.length > 0
            ? {
                originalActionId: "",
                originalEnvelopeId: "",
                reverseActionType: "digital-ads.creative.rotate",
                reverseParameters: {
                  adsToPause: results.filter((r) => r.action === "activated").map((r) => r.adId),
                  adsToActivate: results.filter((r) => r.action === "paused").map((r) => r.adId),
                },
                undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                undoRiskCategory: "high",
                undoApprovalRequired: "standard",
              }
            : null,
      };
    },
  ],
]);
