// ---------------------------------------------------------------------------
// KPI + LTV + Seasonal handlers — kpi.list, kpi.compute, kpi.register,
//   kpi.remove, ltv.project, ltv.optimize, ltv.allocate,
//   seasonal.calendar, seasonal.events, seasonal.add_event
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import type { CustomKPIDefinition } from "../../core/custom-kpi.js";
import { LTVOptimizer } from "../../optimization/ltv-optimizer.js";
import type { CustomerCohort } from "../../optimization/ltv-optimizer.js";
import type { EventRegion, EventCategory } from "../../core/analysis/seasonality.js";

export const kpiSeasonalHandlers: Map<string, ActionHandler> = new Map([
  // ---- KPI READ handlers ----

  [
    "digital-ads.kpi.list",
    async (_params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      const definitions = ctx.kpiEngine.listKPIs();
      const presets = ctx.kpiEngine.getPresetKPIs();
      return success(
        `Listed ${definitions.length} registered KPI(s) and ${presets.length} available preset(s)`,
        { registered: definitions, presets },
        start,
      );
    },
  ],

  [
    "digital-ads.kpi.compute",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const metrics = (params.metrics ?? {}) as Record<string, number>;
        const kpiId = params.kpiId as string | undefined;
        if (kpiId) {
          const result = ctx.kpiEngine.computeKPI(kpiId, metrics);
          return success(
            `KPI "${result.kpiName}": ${result.formattedValue} (${result.status})`,
            result,
            start,
          );
        }
        const results = ctx.kpiEngine.computeAllKPIs(metrics);
        return success(`Computed ${results.length} KPI(s)`, results, start);
      } catch (err) {
        return fail(`Failed to compute KPI: ${errMsg(err)}`, "kpi.compute", errMsg(err));
      }
    },
  ],

  // ---- KPI WRITE handlers ----

  [
    "digital-ads.kpi.register",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const definition = params as unknown as Omit<CustomKPIDefinition, "id">;
        const registered = ctx.kpiEngine.registerKPI(definition);
        return success(
          `Registered custom KPI "${registered.name}" (${registered.id})`,
          undefined,
          start,
          {
            externalRefs: { kpiId: registered.id },
            rollbackAvailable: true,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.kpi.remove",
              reverseParameters: { kpiId: registered.id },
              undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              undoRiskCategory: "low",
              undoApprovalRequired: "none",
            },
          },
        );
      } catch (err) {
        return fail(`Failed to register KPI: ${errMsg(err)}`, "kpi.register", errMsg(err));
      }
    },
  ],

  [
    "digital-ads.kpi.remove",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      const kpiId = params.kpiId as string;
      if (!kpiId) return fail("Missing kpiId", "validation", "kpiId is required");
      const removed = ctx.kpiEngine.removeKPI(kpiId);
      if (!removed) {
        return fail(`KPI not found: ${kpiId}`, "kpi.remove", `No KPI with ID ${kpiId}`);
      }
      return success(`Removed KPI ${kpiId}`, undefined, start, {
        externalRefs: { kpiId },
      });
    },
  ],

  // ---- LTV READ handlers ----

  [
    "digital-ads.ltv.project",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const cohort = params.cohort as CustomerCohort;
        if (!cohort) {
          return fail("Missing cohort data", "validation", "cohort (CustomerCohort) is required");
        }
        const optimizer = new LTVOptimizer();
        const projection = optimizer.projectLTV(cohort);
        return success(
          `LTV projection for cohort ${projection.cohortId}: $${projection.projectedLTV.toFixed(2)} projected LTV, ${projection.ltvToCACRatio.toFixed(1)}x LTV:CAC, ${projection.confidenceLevel} confidence (${projection.curveType} curve)`,
          projection,
          start,
          { externalRefs: { cohortId: projection.cohortId } },
        );
      } catch (err) {
        return fail(`Failed to project LTV: ${errMsg(err)}`, "ltv.project", errMsg(err));
      }
    },
  ],

  [
    "digital-ads.ltv.optimize",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const cohorts = params.cohorts as CustomerCohort[];
        if (!cohorts || !Array.isArray(cohorts) || cohorts.length === 0) {
          return fail(
            "Missing cohorts data",
            "validation",
            "cohorts (CustomerCohort[]) is required and must be non-empty",
          );
        }
        const targetRatio = params.targetLTVtoCACRatio as number | undefined;
        const optimizer = new LTVOptimizer();
        const result = optimizer.optimizeByCohortLTV(cohorts, targetRatio);
        const scaleCount = result.campaignRecommendations.filter(
          (r) => r.action === "scale",
        ).length;
        const pauseCount = result.campaignRecommendations.filter(
          (r) => r.action === "pause",
        ).length;
        return success(
          `LTV optimization: ${result.cohorts.length} cohort(s) analyzed, ${result.campaignRecommendations.length} campaign(s) — avg LTV $${result.insights.avgLTV.toFixed(2)}, ${scaleCount} to scale, ${pauseCount} to pause`,
          result,
          start,
        );
      } catch (err) {
        return fail(`Failed to optimize by LTV: ${errMsg(err)}`, "ltv.optimize", errMsg(err));
      }
    },
  ],

  [
    "digital-ads.ltv.allocate",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const campaigns = params.campaigns as Array<{
          campaignId: string;
          campaignName: string;
          dailyBudget: number;
          cpa: number;
        }>;
        const cohorts = params.cohorts as CustomerCohort[];
        if (!campaigns || !Array.isArray(campaigns) || campaigns.length === 0) {
          return fail(
            "Missing campaigns data",
            "validation",
            "campaigns array is required and must be non-empty",
          );
        }
        if (!cohorts || !Array.isArray(cohorts) || cohorts.length === 0) {
          return fail(
            "Missing cohorts data",
            "validation",
            "cohorts (CustomerCohort[]) is required and must be non-empty",
          );
        }
        const totalBudget = params.totalBudget as number | undefined;
        const optimizer = new LTVOptimizer();
        const allocations = optimizer.allocateBudgetByLTV(campaigns, cohorts, totalBudget);
        const changed = allocations.filter((a) => Math.abs(a.changeDollars) > 1);
        const totalCurrent = allocations.reduce((s, a) => s + a.currentBudget, 0);
        const totalRecommended = allocations.reduce((s, a) => s + a.recommendedBudget, 0);
        return success(
          `LTV budget allocation: ${allocations.length} campaign(s), ${changed.length} with changes — $${totalCurrent.toFixed(2)} current → $${totalRecommended.toFixed(2)} recommended`,
          allocations,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to allocate budget by LTV: ${errMsg(err)}`,
          "ltv.allocate",
          errMsg(err),
        );
      }
    },
  ],

  // ---- SEASONAL READ handlers ----

  [
    "digital-ads.seasonal.calendar",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const vertical = params.vertical as string;
        if (!vertical) return fail("Missing vertical", "validation", "vertical is required");
        const region = params.region as EventRegion | undefined;
        const calendar = ctx.seasonalCalendar.getAnnualCalendar(vertical, region);
        return success(
          `Generated 12-month seasonal calendar for ${vertical}${region ? ` (${region})` : ""}`,
          { calendar },
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate seasonal calendar: ${errMsg(err)}`,
          "seasonal.calendar",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.seasonal.events",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const region = params.region as EventRegion | undefined;
        const vertical = params.vertical as string | undefined;
        const month = params.month as number | undefined;
        const category = params.category as EventCategory | undefined;
        const events = ctx.seasonalCalendar.getEvents({ region, vertical, month, category });

        let profile = null;
        if (month !== undefined && vertical) {
          profile = ctx.seasonalCalendar.getMonthlyProfile(month, vertical, region);
        }

        return success(
          `Found ${events.length} seasonal events matching filters`,
          { events, profile },
          start,
        );
      } catch (err) {
        return fail(
          `Failed to query seasonal events: ${errMsg(err)}`,
          "seasonal.events",
          errMsg(err),
        );
      }
    },
  ],

  // ---- SEASONAL WRITE handlers ----

  [
    "digital-ads.seasonal.add_event",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const name = params.name as string;
        const startMMDD = params.startMMDD as string;
        const endMMDD = params.endMMDD as string;
        const cpmThresholdMultiplier = params.cpmThresholdMultiplier as number;
        const cpaThresholdMultiplier = params.cpaThresholdMultiplier as number;
        const category = params.category as EventCategory;
        const region = params.region as EventRegion;
        const verticals = params.verticals as Array<"commerce" | "leadgen" | "brand" | "all">;
        const impact = (params.impact as string) ?? "";
        const recommendedActions = (params.recommendedActions as string[]) ?? [];

        if (
          !name ||
          !startMMDD ||
          !endMMDD ||
          !cpmThresholdMultiplier ||
          !cpaThresholdMultiplier ||
          !category ||
          !region ||
          !verticals
        ) {
          return fail(
            "Missing required fields",
            "validation",
            "name, startMMDD, endMMDD, cpmThresholdMultiplier, cpaThresholdMultiplier, category, region, and verticals are all required",
          );
        }

        ctx.seasonalCalendar.addCustomEvent({
          name,
          startMMDD,
          endMMDD,
          cpmThresholdMultiplier,
          cpaThresholdMultiplier,
          category,
          region,
          verticals,
          impact,
          recommendedActions,
        });

        return success(
          `Added custom seasonal event "${name}" (${startMMDD} to ${endMMDD}, CPM x${cpmThresholdMultiplier})`,
          undefined,
          start,
          {
            externalRefs: { eventName: name },
            rollbackAvailable: true,
          },
        );
      } catch (err) {
        return fail(
          `Failed to add custom seasonal event: ${errMsg(err)}`,
          "seasonal.add_event",
          errMsg(err),
        );
      }
    },
  ],
]);
