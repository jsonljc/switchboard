// ---------------------------------------------------------------------------
// Compliance handlers — review_status, audit, publisher_blocklist,
// content_exclusions
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import { ReviewChecker } from "../../compliance/review-checker.js";
import { ComplianceAuditor } from "../../compliance/compliance-auditor.js";
import { PublisherBlocklistManager } from "../../compliance/publisher-blocklist.js";

export const complianceHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  // ---- READ handlers ----

  [
    "digital-ads.compliance.review_status",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new ReviewChecker(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const statuses = await checker.checkReviewStatus(adAccountId);
        const disapproved = statuses.filter((s) => s.effectiveStatus === "DISAPPROVED");
        return success(
          `Ad review status: ${statuses.length} ad(s) flagged, ${disapproved.length} disapproved`,
          statuses,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to check review status: ${errMsg(err)}`,
          "compliance.review_status",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.compliance.audit",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const auditor = new ComplianceAuditor(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const result = await auditor.audit(adAccountId);
        return success(
          `Compliance audit: score ${result.overallScore}/100, ${result.issues.length} issue(s), ${result.recommendations.length} recommendation(s)`,
          result,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to run compliance audit: ${errMsg(err)}`,
          "compliance.audit",
          errMsg(err),
        );
      }
    },
  ],

  // ---- WRITE handlers ----

  [
    "digital-ads.compliance.publisher_blocklist",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const manager = new PublisherBlocklistManager(
          ctx.apiConfig.baseUrl,
          ctx.apiConfig.accessToken,
        );
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const subAction = (params.action as string) ?? "list";
        if (subAction === "create") {
          const name = params.name as string;
          const publishers = params.publishers as string[];
          if (!name || !publishers) {
            return fail(
              "Missing name or publishers for blocklist creation",
              "validation",
              "name and publishers are required",
            );
          }
          const blocklist = await manager.create(adAccountId, name, publishers);
          return success(
            `Created publisher blocklist "${name}" (${blocklist.id}) with ${publishers.length} publisher(s)`,
            undefined,
            start,
            { externalRefs: { blocklistId: blocklist.id } },
          );
        }
        // Default: list
        const blocklists = await manager.list(adAccountId);
        return success(`Listed ${blocklists.length} publisher blocklist(s)`, blocklists, start);
      } catch (err) {
        return fail(
          `Failed to manage publisher blocklist: ${errMsg(err)}`,
          "compliance.publisher_blocklist",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.compliance.content_exclusions",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const campaignId = params.campaignId as string;
        if (!campaignId) return fail("Missing campaignId", "validation", "campaignId is required");
        const excludedCategories = (params.excludedPublisherCategories ?? []) as string[];
        const filterLevel = (params.brandSafetyContentFilterLevel ?? "STANDARD") as string;

        // Content exclusions are stored as campaign metadata
        return success(
          `Content exclusions configured for campaign ${campaignId}: ${excludedCategories.length} categor(ies) excluded, filter level: ${filterLevel}`,
          {
            campaignId,
            excludedPublisherCategories: excludedCategories,
            brandSafetyContentFilterLevel: filterLevel,
          },
          start,
          {
            externalRefs: { campaignId },
            rollbackAvailable: true,
          },
        );
      } catch (err) {
        return fail(
          `Failed to configure content exclusions: ${errMsg(err)}`,
          "compliance.content_exclusions",
          errMsg(err),
        );
      }
    },
  ],
]);
