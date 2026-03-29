// ---------------------------------------------------------------------------
// enrichContext — populates extra fields on the context before execute()
// ---------------------------------------------------------------------------
// Resolves funnels/benchmarks, validates time ranges, checks credential
// mismatches, enriches campaign/adset state for risk scoring, and validates
// connection requirements per action type.
// ---------------------------------------------------------------------------

import type { MetaAdsWriteProvider, SessionState } from "./types.js";
import type { PlatformCredentials } from "../platforms/types.js";
import type { VerticalType } from "../core/types.js";
import { isPlatformType, isVerticalType } from "./constants.js";
import { resolveFunnel, resolveBenchmarks } from "../platforms/registry.js";

/**
 * Build the enrichment record for a given action type and parameters.
 *
 * This is called by the orchestrator *before* execute() and the returned
 * fields are merged into the CartridgeContext that execute() receives.
 */
export async function buildEnrichment(
  actionType: string,
  parameters: Record<string, unknown>,
  session: SessionState,
  writeProvider: MetaAdsWriteProvider | null,
): Promise<Record<string, unknown>> {
  const enriched: Record<string, unknown> = {};

  // Delegate to specialized enrichers
  if (actionType === "digital-ads.funnel.diagnose") {
    return enrichFunnelDiagnose(parameters);
  }
  if (actionType === "digital-ads.portfolio.diagnose") {
    return enrichPortfolioDiagnose(parameters);
  }
  if (actionType === "digital-ads.snapshot.fetch") {
    return enrichSnapshotFetch(parameters);
  }
  if (actionType === "digital-ads.platform.connect") {
    return enrichPlatformConnect(parameters);
  }

  // Campaign write actions
  if (
    actionType === "digital-ads.campaign.pause" ||
    actionType === "digital-ads.campaign.resume" ||
    actionType === "digital-ads.campaign.adjust_budget"
  ) {
    return enrichCampaignWrite(parameters, writeProvider);
  }

  // AdSet write actions
  if (
    actionType === "digital-ads.adset.pause" ||
    actionType === "digital-ads.adset.resume" ||
    actionType === "digital-ads.adset.adjust_budget" ||
    actionType === "digital-ads.targeting.modify"
  ) {
    return enrichAdSetWrite(parameters, writeProvider);
  }

  // Actions requiring Meta connection
  if (requiresMetaConnection(actionType)) {
    if (!session.connections.has("meta")) {
      enriched.validationError =
        "No Meta connection established. Run digital-ads.platform.connect first.";
    }
  }

  return enriched;
}

function enrichFunnelDiagnose(parameters: Record<string, unknown>): Record<string, unknown> {
  const enriched: Record<string, unknown> = {};
  const platform = parameters.platform;
  const vertical = parameters.vertical;
  if (isPlatformType(platform) && isVerticalType(vertical)) {
    try {
      enriched.resolvedFunnel = resolveFunnel(platform, vertical);
      enriched.resolvedBenchmarks = resolveBenchmarks(platform, vertical);
    } catch {
      // Will fail during execution with a better error
    }
  }
  return enriched;
}

function enrichPortfolioDiagnose(parameters: Record<string, unknown>): Record<string, unknown> {
  const enriched: Record<string, unknown> = {};
  const platforms = parameters.platforms;
  if (Array.isArray(platforms)) {
    const resolved: Array<{ platform: string; funnel: unknown; benchmarks: unknown }> = [];
    for (const p of platforms) {
      if (isPlatformType(p?.platform) && isVerticalType(parameters.vertical)) {
        try {
          resolved.push({
            platform: p.platform,
            funnel: resolveFunnel(p.platform, parameters.vertical as VerticalType),
            benchmarks: resolveBenchmarks(p.platform, parameters.vertical as VerticalType),
          });
        } catch {
          // Individual platform resolution failure
        }
      }
    }
    enriched.resolvedPlatforms = resolved;
  }
  return enriched;
}

function enrichSnapshotFetch(parameters: Record<string, unknown>): Record<string, unknown> {
  const enriched: Record<string, unknown> = {};
  const timeRange = parameters.timeRange as { since?: string; until?: string } | undefined;
  if (timeRange) {
    if (!timeRange.since || !timeRange.until) {
      enriched.validationError = "timeRange requires both 'since' and 'until' dates";
    } else {
      const since = new Date(timeRange.since);
      const until = new Date(timeRange.until);
      if (since > until) {
        enriched.validationError = "timeRange.since must be before timeRange.until";
      }
      enriched.periodDays =
        Math.ceil((until.getTime() - since.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }
  }
  return enriched;
}

function enrichPlatformConnect(parameters: Record<string, unknown>): Record<string, unknown> {
  const enriched: Record<string, unknown> = {};
  const creds = parameters.credentials as PlatformCredentials | undefined;
  if (creds && isPlatformType(parameters.platform)) {
    if (creds.platform !== parameters.platform) {
      enriched.validationError = `Credential platform "${creds.platform}" doesn't match requested platform "${parameters.platform}"`;
    }
  }
  return enriched;
}

async function enrichCampaignWrite(
  parameters: Record<string, unknown>,
  writeProvider: MetaAdsWriteProvider | null,
): Promise<Record<string, unknown>> {
  const enriched: Record<string, unknown> = {};
  if (writeProvider && parameters.campaignId) {
    try {
      const campaign = await writeProvider.getCampaign(parameters.campaignId as string);
      enriched.currentBudget = campaign.dailyBudget / 100;
      enriched.campaignName = campaign.name;
      enriched.campaignStatus = campaign.status;
      enriched.deliveryStatus = campaign.deliveryStatus;
      enriched.objective = campaign.objective;
      enriched.endTime = campaign.endTime;
    } catch {
      // Continue without enrichment
    }
  }
  return enriched;
}

async function enrichAdSetWrite(
  parameters: Record<string, unknown>,
  writeProvider: MetaAdsWriteProvider | null,
): Promise<Record<string, unknown>> {
  const enriched: Record<string, unknown> = {};
  if (writeProvider && parameters.adSetId) {
    try {
      const adSet = await writeProvider.getAdSet(parameters.adSetId as string);
      enriched.currentBudget = adSet.dailyBudget / 100;
      enriched.adSetName = adSet.name;
      enriched.adSetStatus = adSet.status;
      enriched.deliveryStatus = adSet.deliveryStatus;
      enriched.endTime = adSet.endTime;
    } catch {
      // Continue without enrichment
    }
  }
  return enriched;
}

function requiresMetaConnection(actionType: string): boolean {
  const metaActions = [
    "digital-ads.report.performance",
    "digital-ads.report.creative",
    "digital-ads.report.audience",
    "digital-ads.report.placement",
    "digital-ads.report.comparison",
    "digital-ads.auction.insights",
    "digital-ads.signal.pixel.diagnose",
    "digital-ads.signal.capi.diagnose",
    "digital-ads.signal.emq.check",
    "digital-ads.account.learning_phase",
    "digital-ads.account.delivery.diagnose",
    "digital-ads.audience.list",
    "digital-ads.audience.insights",
    "digital-ads.reach.estimate",
    "digital-ads.creative.list",
    "digital-ads.creative.analyze",
    "digital-ads.experiment.check",
    "digital-ads.experiment.list",
    "digital-ads.rule.list",
    "digital-ads.compliance.review_status",
    "digital-ads.compliance.audit",
    "digital-ads.measurement.lift_study.check",
    "digital-ads.measurement.attribution.compare",
    "digital-ads.measurement.mmm_export",
    "digital-ads.alert.budget_forecast",
    "digital-ads.alert.policy_scan",
    "digital-ads.catalog.health",
    "digital-ads.catalog.product_sets",
  ];
  return metaActions.includes(actionType);
}
