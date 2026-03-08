// ---------------------------------------------------------------------------
// Reporting action handlers — extracted from DigitalAdsCartridge.execute()
// ---------------------------------------------------------------------------
// Covers: report.performance, report.creative, report.audience,
//         report.placement, report.comparison, auction.insights
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import { ReportBuilder } from "../../reporting/report-builder.js";
import { AuctionInsightsChecker } from "../../reporting/auction-insights.js";

export const reportingHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  // --- report.performance ---
  [
    "digital-ads.report.performance",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const builder = new ReportBuilder(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const report = await builder.generatePerformanceReport(
          params as unknown as Parameters<typeof builder.generatePerformanceReport>[0],
        );
        return success(
          `Performance report generated: ${report.rows.length} rows, $${report.summary.totalSpend.toFixed(2)} total spend`,
          report,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate performance report: ${errMsg(err)}`,
          "report.performance",
          errMsg(err),
        );
      }
    },
  ],

  // --- report.creative ---
  [
    "digital-ads.report.creative",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const builder = new ReportBuilder(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const report = await builder.generateCreativeReport(
          params as unknown as Parameters<typeof builder.generateCreativeReport>[0],
        );
        return success(
          `Creative report generated: ${report.creatives.length} creatives analyzed`,
          report,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate creative report: ${errMsg(err)}`,
          "report.creative",
          errMsg(err),
        );
      }
    },
  ],

  // --- report.audience ---
  [
    "digital-ads.report.audience",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const builder = new ReportBuilder(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const report = await builder.generateAudienceReport(
          params as unknown as Parameters<typeof builder.generateAudienceReport>[0],
        );
        return success(
          `Audience report generated: ${report.ageGender.length} age/gender segments, ${report.countries.length} countries`,
          report,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate audience report: ${errMsg(err)}`,
          "report.audience",
          errMsg(err),
        );
      }
    },
  ],

  // --- report.placement ---
  [
    "digital-ads.report.placement",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const builder = new ReportBuilder(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const report = await builder.generatePlacementReport(
          params as unknown as Parameters<typeof builder.generatePlacementReport>[0],
        );
        return success(
          `Placement report generated: ${report.placements.length} placements analyzed`,
          report,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate placement report: ${errMsg(err)}`,
          "report.placement",
          errMsg(err),
        );
      }
    },
  ],

  // --- report.comparison ---
  [
    "digital-ads.report.comparison",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const builder = new ReportBuilder(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const report = await builder.generateComparisonReport(
          params as unknown as Parameters<typeof builder.generateComparisonReport>[0],
        );
        return success(
          `Comparison report generated: ${report.changes.length} metrics compared`,
          report,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate comparison report: ${errMsg(err)}`,
          "report.comparison",
          errMsg(err),
        );
      }
    },
  ],

  // --- auction.insights ---
  [
    "digital-ads.auction.insights",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new AuctionInsightsChecker(
          ctx.apiConfig.baseUrl,
          ctx.apiConfig.accessToken,
        );
        const entityId = params.entityId as string;
        if (!entityId) return fail("Missing entityId", "validation", "entityId is required");
        const result = await checker.analyze({
          entityId,
          entityLevel: params.entityLevel as "campaign" | "adset" | "account" | undefined,
          datePreset: params.datePreset as string | undefined,
          since: params.since as string | undefined,
          until: params.until as string | undefined,
        });
        return success(
          `Auction insights: ${result.competitors.length} competitor(s), ${result.yourPosition.impressionShare.toFixed(1)}% impression share, competitive pressure: ${result.yourPosition.competitivePressure}`,
          result,
          start,
          { externalRefs: { entityId } },
        );
      } catch (err) {
        return fail(
          `Failed to fetch auction insights: ${errMsg(err)}`,
          "auction.insights",
          errMsg(err),
        );
      }
    },
  ],
]);
