import type { WorkflowHandler } from "@switchboard/core/platform";
import { StaleVersionError } from "@switchboard/core";
import type { MetaAdsClient } from "@switchboard/ad-optimizer";
import type { CreativeJob } from "@switchboard/schemas";
import type { PrismaCreativeJobStore } from "@switchboard/db";
import type { PublishPrecheck } from "../creative-publish-preconditions.js";

/** The subset of MetaAdsClient the publish chain uses (so tests can inject a mock). */
export type AdsClientLike = Pick<
  MetaAdsClient,
  | "uploadCreativeAsset"
  | "createDraftCampaign"
  | "createDraftAdSet"
  | "createAdCreative"
  | "createAd"
>;

export interface CreativePublishDeps {
  jobStore: Pick<PrismaCreativeJobStore, "findById" | "updatePublishFields">;
  assertPublishable: (organizationId: string, jobId: string) => Promise<PublishPrecheck>;
  makeAdsClient: (cfg: { accessToken: string; accountId: string }) => AdsClientLike;
  fetchAsset: (url: string) => Promise<{ buffer: Buffer; type: "image" | "video" }>;
}

const PARKED_PAUSED = "parked_paused";
const PAUSED_DRAFT_SUMMARY = "Created paused Meta draft package (review & activate in Ads Manager)";

// Placeholder ad content — the operator finalizes ALL of this in Ads Manager before
// activation (the locked "parked draft" framing). Single-sourced here; resolving
// real values (booking link, targeting, copy, currency-aware budget) is go-live
// hardening (spec §11). The campaign is PAUSED so the budget never spends.
const MIN_VALID_PAUSED_DAILY_BUDGET_MINOR_UNITS = 500; // ~5 units of account currency
const DRAFT_OBJECTIVE = "OUTCOME_LEADS";
const DRAFT_BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP";
const DRAFT_OPTIMIZATION_GOAL = "LEAD_GENERATION";
const DRAFT_TARGETING: Record<string, unknown> = { geo_locations: { countries: ["SG"] } };
const DRAFT_CTA = "LEARN_MORE";
const DRAFT_LINK_PLACEHOLDER = "https://switchboard.example/finalize-in-ads-manager";

function draftName(job: CreativeJob): string {
  return `Mira draft — ${job.productDescription.slice(0, 40)} — ${job.id}`;
}

/**
 * Governed `creative.job.publish` handler. Runs ONLY after mandatory human approval
 * (the seeded require_approval policy). Idempotent and resumable: each created Meta
 * object id is persisted as a checkpoint, and a retry reuses any id already present
 * (no orphaned/duplicate paused objects). Activation is unreachable — createAd is
 * PAUSED-only and updateCampaignStatus is never called.
 */
export function buildCreativePublishWorkflow(deps: CreativePublishDeps): WorkflowHandler {
  return {
    async execute(workUnit) {
      const { jobId } = workUnit.parameters as { jobId: string };
      const orgId = workUnit.organizationId;

      let job = await deps.jobStore.findById(jobId);
      if (!job || job.organizationId !== orgId) {
        return {
          outcome: "failed",
          summary: "Creative job not found",
          error: { code: "CREATIVE_JOB_NOT_FOUND", message: "Creative job not found" },
        };
      }

      // Idempotent short-circuit: already a parked draft.
      if (job.metaPublishStatus === PARKED_PAUSED && job.metaAdId) {
        return {
          outcome: "completed",
          summary: PAUSED_DRAFT_SUMMARY,
          outputs: {
            metaAdId: job.metaAdId,
            metaAdSetId: job.metaAdSetId,
            metaCreativeId: job.metaCreativeId,
            metaCampaignId: job.metaCampaignId,
          },
        };
      }

      // Defensive re-check (state may have changed between submit and approval).
      const pre = await deps.assertPublishable(orgId, jobId);
      if (!pre.ok) {
        return {
          outcome: "failed",
          summary: "Creative is not publishable",
          error: { code: pre.code, message: pre.message },
        };
      }

      const ads = deps.makeAdsClient({ accessToken: pre.accessToken, accountId: pre.accountId });

      try {
        const asset = await deps.fetchAsset(pre.durableAssetUrl);

        if (!job.metaVideoId) {
          const v = await ads.uploadCreativeAsset({ file: asset.buffer, type: asset.type });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, { metaVideoId: v.id });
        }
        if (!job.metaCampaignId) {
          const c = await ads.createDraftCampaign({
            name: draftName(job),
            objective: DRAFT_OBJECTIVE,
            budget: { daily: MIN_VALID_PAUSED_DAILY_BUDGET_MINOR_UNITS },
            bidStrategy: DRAFT_BID_STRATEGY,
          });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, { metaCampaignId: c.id });
        }
        if (!job.metaAdSetId) {
          const s = await ads.createDraftAdSet({
            campaignId: job.metaCampaignId as string,
            name: draftName(job),
            targeting: DRAFT_TARGETING,
            optimizationGoal: DRAFT_OPTIMIZATION_GOAL,
          });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, { metaAdSetId: s.id });
        }
        if (!job.metaCreativeId) {
          const cr = await ads.createAdCreative({
            name: draftName(job),
            pageId: pre.pageId,
            videoId: job.metaVideoId as string,
            message: job.productDescription,
            linkUrl: DRAFT_LINK_PLACEHOLDER,
            callToActionType: DRAFT_CTA,
          });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, { metaCreativeId: cr.id });
        }
        if (!job.metaAdId) {
          const a = await ads.createAd({
            name: draftName(job),
            adSetId: job.metaAdSetId as string,
            creativeId: job.metaCreativeId as string,
          });
          job = await deps.jobStore.updatePublishFields(orgId, jobId, {
            metaAdId: a.id,
            metaPublishStatus: PARKED_PAUSED,
          });
        }
      } catch (err) {
        // A StaleVersionError from updatePublishFields means the job row was removed
        // or changed out from under us mid-publish (a rare race; cross-org is already
        // rejected up front). Report it as not-found, NOT a Meta error — a checkpoint
        // write failed, no Meta call did.
        if (err instanceof StaleVersionError) {
          return {
            outcome: "failed",
            summary: "Creative job not found",
            error: {
              code: "CREATIVE_JOB_NOT_FOUND",
              message: "Creative job was modified or removed during publish",
            },
          };
        }
        return {
          outcome: "failed",
          summary: "Meta draft creation failed",
          error: {
            code: "CREATIVE_PUBLISH_META_ERROR",
            message: err instanceof Error ? err.message : "Unknown Meta error",
          },
        };
      }

      return {
        outcome: "completed",
        summary: PAUSED_DRAFT_SUMMARY,
        outputs: {
          metaAdId: job.metaAdId,
          metaAdSetId: job.metaAdSetId,
          metaCreativeId: job.metaCreativeId,
          metaCampaignId: job.metaCampaignId,
        },
      };
    },
  };
}
