// ---------------------------------------------------------------------------
// Geo-Holdout Experiment handlers — design, analyze, power, create, conclude
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import type { GeoRegion, GeoRegionMetrics } from "../../ab-testing/geo-experiment.js";

export const geoExperimentHandlers: Map<string, ActionHandler> = new Map([
  // ---- READ handlers ----

  [
    "digital-ads.geo_experiment.design",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const name = params.name as string;
        const hypothesis = params.hypothesis as string;
        const availableRegions = params.availableRegions as GeoRegion[];
        const primaryMetric = (params.primaryMetric ?? "conversions") as
          | "conversions"
          | "revenue"
          | "store_visits";
        const testDays = params.testDays as number;
        const treatmentBudgetPerDay = params.treatmentBudgetPerDay as number;
        if (
          !name ||
          !hypothesis ||
          !availableRegions ||
          availableRegions.length < 2 ||
          !testDays ||
          !treatmentBudgetPerDay
        ) {
          return fail(
            "Missing required geo experiment design parameters",
            "validation",
            "name, hypothesis, availableRegions (>=2), testDays, and treatmentBudgetPerDay are required",
          );
        }
        const design = ctx.geoExperimentManager.designExperiment({
          name,
          hypothesis,
          availableRegions,
          primaryMetric,
          testDays,
          preTestDays: params.preTestDays as number | undefined,
          cooldownDays: params.cooldownDays as number | undefined,
          treatmentBudgetPerDay,
        });
        return success(
          `Geo experiment designed: "${design.name}" — ${design.treatmentRegions.length} treatment, ${design.holdoutRegions.length} holdout regions, ${design.testDays}-day test`,
          design,
          start,
          { externalRefs: { experimentId: design.id } },
        );
      } catch (err) {
        return fail(
          `Failed to design geo experiment: ${errMsg(err)}`,
          "geo_experiment.design",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.geo_experiment.analyze",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const experimentId = params.experimentId as string;
        const regionMetrics = params.regionMetrics as GeoRegionMetrics[];
        if (!experimentId || !regionMetrics || regionMetrics.length === 0) {
          return fail(
            "Missing experimentId or regionMetrics",
            "validation",
            "experimentId and regionMetrics array are required",
          );
        }
        const result = ctx.geoExperimentManager.analyzeResults(experimentId, regionMetrics);
        const sigText = result.significant ? "SIGNIFICANT" : "not significant";
        return success(
          `Geo experiment analysis: ${result.liftPercent.toFixed(1)}% lift (${sigText}, p=${result.pValue.toFixed(3)}), ${result.incrementalConversions.toFixed(0)} incremental conversions`,
          result,
          start,
          { externalRefs: { experimentId } },
        );
      } catch (err) {
        return fail(
          `Failed to analyze geo experiment: ${errMsg(err)}`,
          "geo_experiment.analyze",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.geo_experiment.power",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const baselineConversionRatePerRegion = params.baselineConversionRatePerRegion as number;
        const minimumDetectableLift = params.minimumDetectableLift as number;
        const numberOfRegions = params.numberOfRegions as number;
        if (
          baselineConversionRatePerRegion === undefined ||
          minimumDetectableLift === undefined ||
          !numberOfRegions
        ) {
          return fail(
            "Missing required power analysis parameters",
            "validation",
            "baselineConversionRatePerRegion, minimumDetectableLift, and numberOfRegions are required",
          );
        }
        const result = ctx.geoExperimentManager.calculateMinimumDuration({
          baselineConversionRatePerRegion,
          minimumDetectableLift,
          numberOfRegions,
          significanceLevel: params.significanceLevel as number | undefined,
          power: params.power as number | undefined,
        });
        return success(
          `Geo experiment power analysis: minimum ${result.minimumTestDays} test days needed for ${(minimumDetectableLift * 100).toFixed(1)}% detectable lift across ${numberOfRegions} regions`,
          result,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to calculate power: ${errMsg(err)}`,
          "geo_experiment.power",
          errMsg(err),
        );
      }
    },
  ],

  // ---- WRITE handlers ----

  [
    "digital-ads.geo_experiment.create",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const name = params.name as string;
        const hypothesis = params.hypothesis as string;
        const availableRegions = params.availableRegions as GeoRegion[];
        const primaryMetric = (params.primaryMetric ?? "conversions") as
          | "conversions"
          | "revenue"
          | "store_visits";
        const testDays = params.testDays as number;
        const treatmentBudgetPerDay = params.treatmentBudgetPerDay as number;
        if (
          !name ||
          !hypothesis ||
          !availableRegions ||
          availableRegions.length < 2 ||
          !testDays ||
          !treatmentBudgetPerDay
        ) {
          return fail(
            "Missing required geo experiment parameters",
            "validation",
            "name, hypothesis, availableRegions (>=2), testDays, and treatmentBudgetPerDay are required",
          );
        }
        const experiment = ctx.geoExperimentManager.designExperiment({
          name,
          hypothesis,
          availableRegions,
          primaryMetric,
          testDays,
          preTestDays: params.preTestDays as number | undefined,
          cooldownDays: params.cooldownDays as number | undefined,
          treatmentBudgetPerDay,
        });
        // Auto-start the experiment
        const started = ctx.geoExperimentManager.startExperiment(experiment.id);
        return success(
          `Created and started geo experiment "${started.name}" (${started.id}) — ${started.treatmentRegions.length} treatment, ${started.holdoutRegions.length} holdout regions`,
          started,
          start,
          {
            externalRefs: { experimentId: started.id },
            rollbackAvailable: true,
            undoRecipe: {
              originalActionId: "",
              originalEnvelopeId: "",
              reverseActionType: "digital-ads.geo_experiment.conclude",
              reverseParameters: { experimentId: started.id },
              undoExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              undoRiskCategory: "medium",
              undoApprovalRequired: "standard",
            },
          },
        );
      } catch (err) {
        return fail(
          `Failed to create geo experiment: ${errMsg(err)}`,
          "geo_experiment.create",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.geo_experiment.conclude",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const experimentId = params.experimentId as string;
        if (!experimentId)
          return fail("Missing experimentId", "validation", "experimentId is required");
        const experiment = ctx.geoExperimentManager.concludeExperiment(experimentId);
        return success(
          `Concluded geo experiment "${experiment.name}" (${experiment.id})`,
          experiment,
          start,
          { externalRefs: { experimentId: experiment.id } },
        );
      } catch (err) {
        return fail(
          `Failed to conclude geo experiment: ${errMsg(err)}`,
          "geo_experiment.conclude",
          errMsg(err),
        );
      }
    },
  ],
]);
