// ---------------------------------------------------------------------------
// Signal-health action handlers — extracted from DigitalAdsCartridge.execute()
// ---------------------------------------------------------------------------
// Covers: signal.pixel.diagnose, signal.capi.diagnose, signal.emq.check,
//         account.learning_phase, account.delivery.diagnose
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import { PixelDiagnosticsChecker } from "../../signal-health/pixel-diagnostics.js";
import { CAPIDiagnosticsChecker } from "../../signal-health/capi-diagnostics.js";
import { EMQChecker } from "../../signal-health/emq-checker.js";
import { LearningPhaseTracker } from "../../signal-health/learning-phase-tracker.js";
import { DeliveryDiagnosticsChecker } from "../../signal-health/delivery-diagnostics.js";

export const signalHealthHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  // --- signal.pixel.diagnose ---
  [
    "digital-ads.signal.pixel.diagnose",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new PixelDiagnosticsChecker(
          ctx.apiConfig.baseUrl,
          ctx.apiConfig.accessToken,
        );
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const diagnostics = await checker.diagnose(adAccountId);
        const totalIssues = diagnostics.reduce((sum, d) => sum + d.issues.length, 0);
        return success(
          `Pixel diagnostics: ${diagnostics.length} pixel(s) checked, ${totalIssues} issue(s) found`,
          diagnostics,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to diagnose pixels: ${errMsg(err)}`,
          "signal.pixel.diagnose",
          errMsg(err),
        );
      }
    },
  ],

  // --- signal.capi.diagnose ---
  [
    "digital-ads.signal.capi.diagnose",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new CAPIDiagnosticsChecker(
          ctx.apiConfig.baseUrl,
          ctx.apiConfig.accessToken,
        );
        const pixelId = params.pixelId as string;
        if (!pixelId) return fail("Missing pixelId", "validation", "pixelId is required");
        const diagnostics = await checker.diagnose(pixelId);
        return success(
          `CAPI diagnostics: server=${diagnostics.serverEventsEnabled ? "enabled" : "disabled"}, ${diagnostics.issues.length} issue(s)`,
          diagnostics,
          start,
        );
      } catch (err) {
        return fail(`Failed to diagnose CAPI: ${errMsg(err)}`, "signal.capi.diagnose", errMsg(err));
      }
    },
  ],

  // --- signal.emq.check ---
  [
    "digital-ads.signal.emq.check",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new EMQChecker(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const datasetId = params.datasetId as string;
        if (!datasetId) return fail("Missing datasetId", "validation", "datasetId is required");
        const result = await checker.check(datasetId);
        return success(
          `EMQ check: overall score ${result.overallScore}/10, ${result.recommendations.length} recommendation(s)`,
          result,
          start,
        );
      } catch (err) {
        return fail(`Failed to check EMQ: ${errMsg(err)}`, "signal.emq.check", errMsg(err));
      }
    },
  ],

  // --- account.learning_phase ---
  [
    "digital-ads.account.learning_phase",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const tracker = new LearningPhaseTracker(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adSetId = params.adSetId as string | undefined;
        const adAccountId = params.adAccountId as string | undefined;
        if (adSetId) {
          const info = await tracker.checkAdSet(adSetId);
          return success(
            `Learning phase: ${info.learningStage} (${info.eventsCurrent}/${info.eventsNeeded} events)`,
            info,
            start,
          );
        } else if (adAccountId) {
          const results = await tracker.checkAllAdSets(adAccountId);
          const stuck = results.filter((r) => r.stuckReason !== null);
          return success(
            `Learning phase check: ${results.length} ad set(s), ${stuck.length} stuck/limited`,
            results,
            start,
          );
        }
        return fail(
          "Missing adSetId or adAccountId",
          "validation",
          "Provide adSetId or adAccountId",
        );
      } catch (err) {
        return fail(
          `Failed to check learning phase: ${errMsg(err)}`,
          "account.learning_phase",
          errMsg(err),
        );
      }
    },
  ],

  // --- account.delivery.diagnose ---
  [
    "digital-ads.account.delivery.diagnose",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new DeliveryDiagnosticsChecker(
          ctx.apiConfig.baseUrl,
          ctx.apiConfig.accessToken,
        );
        const campaignId = params.campaignId as string;
        if (!campaignId) return fail("Missing campaignId", "validation", "campaignId is required");
        const diagnostic = await checker.diagnose(campaignId);
        return success(
          `Delivery diagnostics for "${diagnostic.campaignName}": ${diagnostic.issues.length} issue(s), ${diagnostic.activeAdSetCount}/${diagnostic.totalAdSetCount} active ad sets`,
          diagnostic,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to diagnose delivery: ${errMsg(err)}`,
          "account.delivery.diagnose",
          errMsg(err),
        );
      }
    },
  ],
]);
