// ---------------------------------------------------------------------------
// Cross-Platform Deduplication handlers — analyze, estimate_overlap
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import { ConversionDeduplicator } from "../../orchestrator/deduplication.js";
import type {
  PlatformConversionData,
  OverlapEstimationConfig,
} from "../../orchestrator/deduplication.js";

export const deduplicationHandlers: Map<string, ActionHandler> = new Map([
  [
    "digital-ads.deduplication.analyze",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const dedupPlatforms = params.platforms as PlatformConversionData[] | undefined;
        if (!dedupPlatforms || !Array.isArray(dedupPlatforms) || dedupPlatforms.length < 2) {
          return fail(
            "At least 2 platform datasets are required for deduplication analysis",
            "validation",
            "Provide a 'platforms' array with at least 2 PlatformConversionData entries",
          );
        }
        const dedupConfig = params.config as OverlapEstimationConfig | undefined;
        const deduplicator = new ConversionDeduplicator();
        const dedupResult = deduplicator.deduplicate(dedupPlatforms, dedupConfig);
        return success(
          `Deduplication analysis: ${dedupResult.naiveTotal.conversions.toLocaleString()} naive → ${dedupResult.deduplicatedTotal.conversions.toLocaleString()} deduplicated (${dedupResult.overcountingFactor.toFixed(2)}x overcounting), blended CPA $${dedupResult.deduplicatedTotal.blendedCPA.toFixed(2)}`,
          dedupResult,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to run deduplication analysis: ${errMsg(err)}`,
          "deduplication.analyze",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.deduplication.estimate_overlap",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const dedupP1 = params.platform1 as PlatformConversionData | undefined;
        const dedupP2 = params.platform2 as PlatformConversionData | undefined;
        if (!dedupP1 || !dedupP2) {
          return fail(
            "Both platform1 and platform2 are required",
            "validation",
            "Provide platform1 and platform2 as PlatformConversionData objects",
          );
        }
        const dedupMethod = (params.method as string) ?? "hybrid";
        const deduplicator = new ConversionDeduplicator();
        const overlapResult = deduplicator.estimatePairwiseOverlap(dedupP1, dedupP2, dedupMethod);
        return success(
          `Overlap estimate (${dedupP1.platform} + ${dedupP2.platform}): ${(overlapResult.overlapRate * 100).toFixed(1)}% overlap (~${overlapResult.overlappingConversions} shared conversions) [${overlapResult.confidence} confidence, ${overlapResult.method}]`,
          overlapResult,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to estimate overlap: ${errMsg(err)}`,
          "deduplication.estimate_overlap",
          errMsg(err),
        );
      }
    },
  ],
]);
