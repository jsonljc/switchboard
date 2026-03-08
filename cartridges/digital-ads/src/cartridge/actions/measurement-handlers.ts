// ---------------------------------------------------------------------------
// Measurement handlers — lift_study.check, attribution.compare, mmm_export,
// multi_touch, compare_models, channel_roles, lift_study.create
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import { LiftStudyManager } from "../../measurement/lift-study-manager.js";
import { AttributionAnalyzer } from "../../measurement/attribution-analyzer.js";
import { MMMExporter } from "../../measurement/mmm-exporter.js";
import { MultiTouchAttributionEngine } from "../../measurement/multi-touch-attribution.js";
import type {
  Touchpoint,
  ConversionPath,
  AttributionModel,
} from "../../measurement/multi-touch-attribution.js";

export const measurementHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  // ---- READ handlers ----

  [
    "digital-ads.measurement.lift_study.check",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const manager = new LiftStudyManager(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const studyId = params.studyId as string;
        if (!studyId) return fail("Missing studyId", "validation", "studyId is required");
        const study = await manager.check(studyId);
        const resultSummary = study.results
          ? `, lift ${study.results.liftPercent?.toFixed(1) ?? "N/A"}%`
          : "";
        return success(
          `Lift study "${study.name}": status=${study.status}${resultSummary}`,
          study,
          start,
          { externalRefs: { studyId: study.id } },
        );
      } catch (err) {
        return fail(
          `Failed to check lift study: ${errMsg(err)}`,
          "measurement.lift_study.check",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.measurement.attribution.compare",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const analyzer = new AttributionAnalyzer(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const comparisons = await analyzer.compare(
          adAccountId,
          params.datePreset as string | undefined,
        );
        return success(
          `Attribution comparison: ${comparisons.length} metric(s) across attribution windows`,
          comparisons,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to compare attribution: ${errMsg(err)}`,
          "measurement.attribution.compare",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.measurement.mmm_export",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const exporter = new MMMExporter(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        const timeRange = params.timeRange as { since: string; until: string } | undefined;
        if (!adAccountId || !timeRange) {
          return fail(
            "Missing adAccountId or timeRange",
            "validation",
            "adAccountId and timeRange are required",
          );
        }
        const format = (params.format as "csv" | "json") ?? "json";
        const data = await exporter.export(adAccountId, timeRange, format);
        return success(
          `MMM export: ${data.dailyData.length} day(s) of data from ${timeRange.since} to ${timeRange.until}`,
          data,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to export MMM data: ${errMsg(err)}`,
          "measurement.mmm_export",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.attribution.multi_touch",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const engine = new MultiTouchAttributionEngine();
        const touchpoints = params.touchpoints as Touchpoint[];
        const paths = params.paths as ConversionPath[];
        const model = params.model as AttributionModel;
        if (!touchpoints || !paths || !model) {
          return fail(
            "Missing required parameters",
            "validation",
            "touchpoints, paths, and model are required",
          );
        }
        const options = params.decayHalfLife
          ? { decayHalfLife: Number(params.decayHalfLife) }
          : undefined;
        const result = engine.attribute(touchpoints, paths, model, options);
        return success(
          `Multi-touch attribution (${model}): ${result.channelAttribution.length} channel(s) attributed, avg path length ${result.insights.avgPathLength}`,
          result,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to run multi-touch attribution: ${errMsg(err)}`,
          "attribution.multi_touch",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.attribution.compare_models",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const engine = new MultiTouchAttributionEngine();
        const touchpoints = params.touchpoints as Touchpoint[];
        const paths = params.paths as ConversionPath[];
        if (!touchpoints || !paths) {
          return fail(
            "Missing required parameters",
            "validation",
            "touchpoints and paths are required",
          );
        }
        const result = engine.compareModels(touchpoints, paths);
        const modelCount = result.modelComparison
          ? new Set(result.modelComparison.map((m) => m.model)).size
          : 0;
        return success(
          `Attribution model comparison: ${modelCount} models compared across ${result.channelAttribution.length} channel(s)`,
          result,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to compare attribution models: ${errMsg(err)}`,
          "attribution.compare_models",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.attribution.channel_roles",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const engine = new MultiTouchAttributionEngine();
        const touchpoints = params.touchpoints as Touchpoint[];
        if (!touchpoints) {
          return fail("Missing required parameters", "validation", "touchpoints is required");
        }
        const roles = engine.identifyChannelRoles(touchpoints);
        return success(
          `Channel role analysis: ${roles.length} channel(s) classified`,
          roles,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to identify channel roles: ${errMsg(err)}`,
          "attribution.channel_roles",
          errMsg(err),
        );
      }
    },
  ],

  // ---- WRITE handlers ----

  [
    "digital-ads.measurement.lift_study.create",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const manager = new LiftStudyManager(ctx.apiConfig.baseUrl, ctx.apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        const name = params.name as string;
        const startTime = params.startTime as number;
        const endTime = params.endTime as number;
        const cells = params.cells as Array<{
          name: string;
          adSetIds?: string[];
          campaignIds?: string[];
        }>;
        if (!adAccountId || !name || !startTime || !endTime || !cells) {
          return fail(
            "Missing required lift study parameters",
            "validation",
            "adAccountId, name, startTime, endTime, and cells are required",
          );
        }
        const study = await manager.create(adAccountId, { name, startTime, endTime, cells });
        return success(
          `Created lift study "${name}" (${study.id}) with ${cells.length} cell(s)`,
          study,
          start,
          { externalRefs: { studyId: study.id } },
        );
      } catch (err) {
        return fail(
          `Failed to create lift study: ${errMsg(err)}`,
          "measurement.lift_study.create",
          errMsg(err),
        );
      }
    },
  ],
]);
