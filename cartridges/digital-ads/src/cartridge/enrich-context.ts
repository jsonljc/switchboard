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

  switch (actionType) {
    case "digital-ads.funnel.diagnose": {
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
      break;
    }

    case "digital-ads.portfolio.diagnose": {
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
      break;
    }

    case "digital-ads.snapshot.fetch": {
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
      break;
    }

    case "digital-ads.platform.connect": {
      const creds = parameters.credentials as PlatformCredentials | undefined;
      if (creds && isPlatformType(parameters.platform)) {
        if (creds.platform !== parameters.platform) {
          enriched.validationError = `Credential platform "${creds.platform}" doesn't match requested platform "${parameters.platform}"`;
        }
      }
      break;
    }

    // Write actions: enrich with current entity state for risk scoring
    case "digital-ads.campaign.pause":
    case "digital-ads.campaign.resume":
    case "digital-ads.campaign.adjust_budget": {
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
      break;
    }

    case "digital-ads.adset.pause":
    case "digital-ads.adset.resume":
    case "digital-ads.adset.adjust_budget":
    case "digital-ads.targeting.modify": {
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
      break;
    }

    case "digital-ads.structure.analyze":
    case "digital-ads.health.check":
      break;

    // Reporting — validate connection
    case "digital-ads.report.performance":
    case "digital-ads.report.creative":
    case "digital-ads.report.audience":
    case "digital-ads.report.placement":
    case "digital-ads.report.comparison":
    case "digital-ads.auction.insights":
    case "digital-ads.signal.pixel.diagnose":
    case "digital-ads.signal.capi.diagnose":
    case "digital-ads.signal.emq.check":
    case "digital-ads.account.learning_phase":
    case "digital-ads.account.delivery.diagnose":
    case "digital-ads.audience.list":
    case "digital-ads.audience.insights":
    case "digital-ads.reach.estimate":
    case "digital-ads.creative.list":
    case "digital-ads.creative.analyze":
    case "digital-ads.experiment.check":
    case "digital-ads.experiment.list":
    case "digital-ads.rule.list":
    case "digital-ads.compliance.review_status":
    case "digital-ads.compliance.audit":
    case "digital-ads.measurement.lift_study.check":
    case "digital-ads.measurement.attribution.compare":
    case "digital-ads.measurement.mmm_export":
    case "digital-ads.alert.budget_forecast":
    case "digital-ads.alert.policy_scan":
    case "digital-ads.catalog.health":
    case "digital-ads.catalog.product_sets": {
      if (!session.connections.has("meta")) {
        enriched.validationError =
          "No Meta connection established. Run digital-ads.platform.connect first.";
      }
      break;
    }

    // Actions that require no API — local computation only
    case "digital-ads.strategy.recommend":
    case "digital-ads.strategy.mediaplan":
    case "digital-ads.budget.recommend":
    case "digital-ads.optimization.review":
    case "digital-ads.creative.generate":
    case "digital-ads.creative.score_assets":
    case "digital-ads.creative.generate_brief":
    case "digital-ads.alert.anomaly_scan":
    case "digital-ads.alert.send_notifications":
    case "digital-ads.alert.configure_notifications":
    case "digital-ads.forecast.budget_scenario":
    case "digital-ads.forecast.diminishing_returns":
    case "digital-ads.plan.annual":
    case "digital-ads.plan.quarterly":
    case "digital-ads.pacing.check":
    case "digital-ads.pacing.create_flight":
    case "digital-ads.pacing.auto_adjust":
    case "digital-ads.creative.test_queue":
    case "digital-ads.creative.test_evaluate":
    case "digital-ads.creative.test_create":
    case "digital-ads.creative.test_conclude":
    case "digital-ads.creative.power_calculate":
    case "digital-ads.attribution.multi_touch":
    case "digital-ads.attribution.compare_models":
    case "digital-ads.attribution.channel_roles":
    case "digital-ads.kpi.list":
    case "digital-ads.kpi.compute":
    case "digital-ads.kpi.register":
    case "digital-ads.kpi.remove":
    case "digital-ads.deduplication.analyze":
    case "digital-ads.deduplication.estimate_overlap":
    case "digital-ads.geo_experiment.design":
    case "digital-ads.geo_experiment.analyze":
    case "digital-ads.geo_experiment.power":
    case "digital-ads.geo_experiment.create":
    case "digital-ads.geo_experiment.conclude":
    case "digital-ads.memory.insights":
    case "digital-ads.memory.list":
    case "digital-ads.memory.recommend":
    case "digital-ads.memory.record":
    case "digital-ads.memory.record_outcome":
    case "digital-ads.memory.export":
    case "digital-ads.memory.import":
    case "digital-ads.ltv.project":
    case "digital-ads.ltv.optimize":
    case "digital-ads.ltv.allocate":
    case "digital-ads.seasonal.calendar":
    case "digital-ads.seasonal.events":
    case "digital-ads.seasonal.add_event":
      break;
  }

  return enriched;
}
