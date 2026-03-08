// ---------------------------------------------------------------------------
// Account Memory handlers — insights, list, recommend, export, record,
//                           record_outcome, import
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import type { OptimizationActionType, OptimizationRecord } from "../../core/account-memory.js";

export const memoryHandlers: Map<string, ActionHandler> = new Map([
  // ---- READ handlers ----

  [
    "digital-ads.memory.insights",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const accountId = params.accountId as string;
        if (!accountId) return fail("Missing accountId", "validation", "accountId is required");
        const snapshot = ctx.accountMemory.getAccountInsights(accountId);
        return success(
          `Account memory insights: ${snapshot.totalRecords} record(s), ${snapshot.insights.length} action type(s), ${(snapshot.overallSuccessRate * 100).toFixed(0)}% overall success rate`,
          snapshot,
          start,
          { externalRefs: { accountId } },
        );
      } catch (err) {
        return fail(
          `Failed to get account insights: ${errMsg(err)}`,
          "memory.insights",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.memory.list",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const accountId = params.accountId as string;
        if (!accountId) return fail("Missing accountId", "validation", "accountId is required");
        const records = ctx.accountMemory.listRecords(accountId, {
          actionType: params.actionType as OptimizationActionType | undefined,
          entityId: params.entityId as string | undefined,
          status: params.status as "positive" | "negative" | "neutral" | "pending" | undefined,
          limit: params.limit as number | undefined,
        });
        return success(
          `Listed ${records.length} optimization record(s) for account ${accountId}`,
          records,
          start,
          { externalRefs: { accountId } },
        );
      } catch (err) {
        return fail(`Failed to list records: ${errMsg(err)}`, "memory.list", errMsg(err));
      }
    },
  ],

  [
    "digital-ads.memory.recommend",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const accountId = params.accountId as string;
        const proposedAction = params.proposedAction as OptimizationActionType;
        if (!accountId || !proposedAction) {
          return fail(
            "Missing accountId or proposedAction",
            "validation",
            "accountId and proposedAction are required",
          );
        }
        const recommendation = ctx.accountMemory.getRecommendation(
          accountId,
          proposedAction,
          params.entityId as string | undefined,
        );
        return success(
          `Memory recommendation for ${proposedAction}: ${recommendation.confidence} confidence, ${(recommendation.historicalSuccessRate * 100).toFixed(0)}% historical success, trend: ${recommendation.recentTrend}`,
          recommendation,
          start,
          { externalRefs: { accountId } },
        );
      } catch (err) {
        return fail(
          `Failed to get recommendation: ${errMsg(err)}`,
          "memory.recommend",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.memory.export",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const accountId = params.accountId as string;
        if (!accountId) return fail("Missing accountId", "validation", "accountId is required");
        const exported = ctx.accountMemory.exportMemory(accountId);
        const parsed = JSON.parse(exported) as { recordCount: number };
        return success(
          `Exported ${parsed.recordCount} optimization record(s) for account ${accountId}`,
          exported,
          start,
          { externalRefs: { accountId } },
        );
      } catch (err) {
        return fail(`Failed to export memory: ${errMsg(err)}`, "memory.export", errMsg(err));
      }
    },
  ],

  // ---- WRITE handlers ----

  [
    "digital-ads.memory.record",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const accountId = params.accountId as string;
        const actionType = params.actionType as OptimizationActionType;
        const entityId = params.entityId as string;
        const entityType = params.entityType as OptimizationRecord["entityType"];
        const changeDescription = params.changeDescription as string;
        const recordParams = params.parameters as Record<string, unknown>;
        const metricsBefore = params.metricsBefore as OptimizationRecord["metricsBefore"];
        if (
          !accountId ||
          !actionType ||
          !entityId ||
          !entityType ||
          !changeDescription ||
          !metricsBefore
        ) {
          return fail(
            "Missing required fields for memory record",
            "validation",
            "accountId, actionType, entityId, entityType, changeDescription, and metricsBefore are required",
          );
        }
        const record = ctx.accountMemory.recordOptimization({
          accountId,
          actionType,
          entityId,
          entityType,
          changeDescription,
          parameters: recordParams ?? {},
          metricsBefore,
          triggeringFinding: params.triggeringFinding as string | undefined,
        });
        return success(
          `Recorded optimization: ${actionType} on ${entityType} ${entityId} (record ${record.id})`,
          record,
          start,
          { externalRefs: { recordId: record.id, accountId } },
        );
      } catch (err) {
        return fail(`Failed to record optimization: ${errMsg(err)}`, "memory.record", errMsg(err));
      }
    },
  ],

  [
    "digital-ads.memory.record_outcome",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const recordId = params.recordId as string;
        const metricsAfter = params.metricsAfter as OptimizationRecord["metricsAfter"];
        if (!recordId || !metricsAfter) {
          return fail(
            "Missing recordId or metricsAfter",
            "validation",
            "recordId and metricsAfter are required",
          );
        }
        const record = ctx.accountMemory.recordOutcome(recordId, metricsAfter);
        const outcomeStr = record.outcome
          ? `${record.outcome.status} (${record.outcome.primaryMetricDeltaPercent > 0 ? "+" : ""}${record.outcome.primaryMetricDeltaPercent.toFixed(1)}%)`
          : "pending";
        return success(`Recorded outcome for ${recordId}: ${outcomeStr}`, record, start, {
          externalRefs: { recordId },
        });
      } catch (err) {
        return fail(
          `Failed to record outcome: ${errMsg(err)}`,
          "memory.record_outcome",
          errMsg(err),
        );
      }
    },
  ],

  [
    "digital-ads.memory.import",
    async (params, ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const data = params.data as string;
        if (!data) {
          return fail("Missing data", "validation", "data (JSON string) is required");
        }
        const imported = ctx.accountMemory.importMemory(data);
        return success(
          `Imported ${imported} optimization record(s)`,
          { importedCount: imported },
          start,
        );
      } catch (err) {
        return fail(`Failed to import memory: ${errMsg(err)}`, "memory.import", errMsg(err));
      }
    },
  ],
]);
