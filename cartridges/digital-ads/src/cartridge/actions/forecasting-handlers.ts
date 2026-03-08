// ---------------------------------------------------------------------------
// Forecasting action handlers — budget scenarios, diminishing returns,
// annual/quarterly planning, and catalog health/product sets
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, errMsg } from "./handler-context.js";
import { ScenarioModeler } from "../../forecasting/scenario-modeler.js";
import { DiminishingReturnsAnalyzer } from "../../forecasting/diminishing-returns.js";
import { AnnualPlanner } from "../../forecasting/annual-planner.js";
import type { AnnualPlanParams } from "../../forecasting/annual-planner.js";
import { CatalogHealthChecker } from "../../catalog/catalog-health.js";
import { ProductSetManager } from "../../catalog/product-sets.js";

export const forecastingHandlers: Map<string, ActionHandler> = new Map([
  // -----------------------------------------------------------------------
  // READ: forecast.budget_scenario
  // -----------------------------------------------------------------------
  [
    "digital-ads.forecast.budget_scenario",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const modeler = new ScenarioModeler();
        const currentSpend = Number(params.currentSpend ?? 0);
        const currentConversions = Number(params.currentConversions ?? 0);
        const currentCPA = Number(params.currentCPA ?? 0);
        const scenarioBudgets = (params.scenarioBudgets ?? []) as number[];
        if (!currentSpend || !currentConversions || scenarioBudgets.length === 0) {
          return fail(
            "Missing required scenario parameters",
            "validation",
            "currentSpend, currentConversions, and scenarioBudgets are required",
          );
        }
        const scenarios = modeler.model({
          currentSpend,
          currentConversions,
          currentCPA,
          scenarioBudgets,
        });
        return {
          success: true,
          summary: `Budget scenario: ${scenarios.length} scenario(s) modeled`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: scenarios,
        };
      } catch (err) {
        return fail(
          `Failed to model budget scenarios: ${errMsg(err)}`,
          "forecast.budget_scenario",
          errMsg(err),
        );
      }
    },
  ],

  // -----------------------------------------------------------------------
  // READ: forecast.diminishing_returns
  // -----------------------------------------------------------------------
  [
    "digital-ads.forecast.diminishing_returns",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const analyzer = new DiminishingReturnsAnalyzer();
        const dataPoints = (params.dataPoints ?? []) as Array<{
          spend: number;
          conversions: number;
        }>;
        if (dataPoints.length < 3) {
          return fail(
            "Not enough data for diminishing returns analysis (need at least 3 data points)",
            "validation",
            "Provide at least 3 dataPoints",
          );
        }
        const result = analyzer.analyze(dataPoints);
        const optStr = result.optimalSpend !== null ? `$${result.optimalSpend.toFixed(2)}` : "N/A";
        const satStr =
          result.saturationPoint !== null ? `$${result.saturationPoint.toFixed(2)}` : "N/A";
        return {
          success: true,
          summary: `Diminishing returns: optimal spend ${optStr}, saturation at ${satStr}`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: result,
        };
      } catch (err) {
        return fail(
          `Failed to analyze diminishing returns: ${errMsg(err)}`,
          "forecast.diminishing_returns",
          errMsg(err),
        );
      }
    },
  ],

  // -----------------------------------------------------------------------
  // READ: plan.annual
  // -----------------------------------------------------------------------
  [
    "digital-ads.plan.annual",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const planner = new AnnualPlanner();
        const planParams: AnnualPlanParams = {
          totalAnnualBudget: Number(params.totalAnnualBudget ?? 0),
          vertical: (params.vertical as "commerce" | "leadgen" | "brand") ?? "commerce",
          businessGoal: (params.businessGoal as string) ?? "",
          currentMonthlyCPA: Number(params.currentMonthlyCPA ?? 0),
          currentMonthlyConversions: Number(params.currentMonthlyConversions ?? 0),
          currentMonthlySpend: Number(params.currentMonthlySpend ?? 0),
          currentROAS: params.currentROAS != null ? Number(params.currentROAS) : undefined,
          targetAnnualGrowth:
            params.targetAnnualGrowth != null ? Number(params.targetAnnualGrowth) : undefined,
          targetCPA: params.targetCPA != null ? Number(params.targetCPA) : undefined,
          historicalMonthlyData:
            params.historicalMonthlyData as AnnualPlanParams["historicalMonthlyData"],
          frontLoadBudget: params.frontLoadBudget as boolean | undefined,
          aggressiveScaling: params.aggressiveScaling as boolean | undefined,
        };
        if (
          !planParams.totalAnnualBudget ||
          !planParams.currentMonthlyCPA ||
          !planParams.currentMonthlyConversions
        ) {
          return fail(
            "Missing required annual plan parameters",
            "validation",
            "totalAnnualBudget, currentMonthlyCPA, and currentMonthlyConversions are required",
          );
        }
        const plan = planner.createAnnualPlan(planParams);
        return {
          success: true,
          summary: `Annual plan: $${plan.totalAnnualBudget.toLocaleString()} budget across 4 quarters, projecting ${Math.round(plan.projectedAnnualConversions).toLocaleString()} conversions at $${plan.projectedAnnualCPA.toFixed(2)} CPA`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: plan,
        };
      } catch (err) {
        return fail(`Failed to create annual plan: ${errMsg(err)}`, "plan.annual", errMsg(err));
      }
    },
  ],

  // -----------------------------------------------------------------------
  // READ: plan.quarterly
  // -----------------------------------------------------------------------
  [
    "digital-ads.plan.quarterly",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const planner = new AnnualPlanner();
        const targetQuarter = (params.quarter as string) ?? "Q1";
        const planParams: AnnualPlanParams = {
          totalAnnualBudget: Number(params.totalAnnualBudget ?? 0),
          vertical: (params.vertical as "commerce" | "leadgen" | "brand") ?? "commerce",
          businessGoal: (params.businessGoal as string) ?? "",
          currentMonthlyCPA: Number(params.currentMonthlyCPA ?? 0),
          currentMonthlyConversions: Number(params.currentMonthlyConversions ?? 0),
          currentMonthlySpend: Number(params.currentMonthlySpend ?? 0),
          currentROAS: params.currentROAS != null ? Number(params.currentROAS) : undefined,
          targetAnnualGrowth:
            params.targetAnnualGrowth != null ? Number(params.targetAnnualGrowth) : undefined,
          targetCPA: params.targetCPA != null ? Number(params.targetCPA) : undefined,
          historicalMonthlyData:
            params.historicalMonthlyData as AnnualPlanParams["historicalMonthlyData"],
          frontLoadBudget: params.frontLoadBudget as boolean | undefined,
          aggressiveScaling: params.aggressiveScaling as boolean | undefined,
        };
        if (
          !planParams.totalAnnualBudget ||
          !planParams.currentMonthlyCPA ||
          !planParams.currentMonthlyConversions
        ) {
          return fail(
            "Missing required plan parameters",
            "validation",
            "totalAnnualBudget, currentMonthlyCPA, and currentMonthlyConversions are required",
          );
        }
        const fullPlan = planner.createAnnualPlan(planParams);
        const quarter = fullPlan.quarters.find((q) => q.quarter === targetQuarter);
        if (!quarter) {
          return fail(
            `Quarter ${targetQuarter} not found`,
            "validation",
            "quarter must be Q1, Q2, Q3, or Q4",
          );
        }
        return {
          success: true,
          summary: `${targetQuarter} plan: $${quarter.totalBudget.toLocaleString()} budget, projecting ${Math.round(quarter.projectedConversions).toLocaleString()} conversions at $${quarter.projectedCPA.toFixed(2)} CPA — "${quarter.strategicTheme}"`,
          externalRefs: {},
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: quarter,
        };
      } catch (err) {
        return fail(
          `Failed to create quarterly plan: ${errMsg(err)}`,
          "plan.quarterly",
          errMsg(err),
        );
      }
    },
  ],

  // -----------------------------------------------------------------------
  // READ: catalog.health
  // -----------------------------------------------------------------------
  [
    "digital-ads.catalog.health",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const checker = new CatalogHealthChecker(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const catalogId = params.catalogId as string;
        if (!catalogId) return fail("Missing catalogId", "validation", "catalogId is required");
        const health = await checker.check(catalogId);
        return {
          success: true,
          summary: `Catalog health: ${health.totalProducts} product(s), ${health.rejectedProducts} rejected, ${health.issues.length} issue(s)`,
          externalRefs: { catalogId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: health,
        };
      } catch (err) {
        return fail(
          `Failed to check catalog health: ${errMsg(err)}`,
          "catalog.health",
          errMsg(err),
        );
      }
    },
  ],

  // -----------------------------------------------------------------------
  // WRITE: catalog.product_sets
  // -----------------------------------------------------------------------
  [
    "digital-ads.catalog.product_sets",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const setManager = new ProductSetManager(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const catalogId = String(params.catalogId ?? "");
        if (!catalogId) return fail("Missing catalogId", "validation", "catalogId is required");
        const actionMode = String(params.action ?? "list");
        if (actionMode === "create") {
          const name = params.name as string;
          const filter = (params.filter as Record<string, unknown>) ?? {};
          if (!name)
            return fail("Missing name for product set creation", "validation", "name is required");
          const productSet = await setManager.create(catalogId, { name, filter });
          return {
            success: true,
            summary: `Created product set "${name}" (${productSet.id}) in catalog ${catalogId}`,
            externalRefs: { productSetId: productSet.id, catalogId },
            rollbackAvailable: false,
            partialFailures: [],
            durationMs: Date.now() - start,
            undoRecipe: null,
            data: productSet,
          };
        }
        const productSets = await setManager.list(catalogId);
        return {
          success: true,
          summary: `Listed ${productSets.length} product set(s) in catalog ${catalogId}`,
          externalRefs: { catalogId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: Date.now() - start,
          undoRecipe: null,
          data: productSets,
        };
      } catch (err) {
        return fail(
          `Failed to manage product sets: ${errMsg(err)}`,
          "catalog.product_sets",
          errMsg(err),
        );
      }
    },
  ],
]);
