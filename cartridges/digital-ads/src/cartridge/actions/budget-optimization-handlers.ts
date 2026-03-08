// ---------------------------------------------------------------------------
// Budget & Optimization handlers — budget recommend/reallocate, optimization
// review/apply, rule CRUD, bid strategy, schedule, campaign objective
// ---------------------------------------------------------------------------

import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import { BudgetAllocator } from "../../optimization/budget-allocator.js";
import type { CampaignPerformanceData } from "../../optimization/budget-allocator.js";
import { OptimizationLoop } from "../../optimization/optimization-loop.js";
import { RulesManager } from "../../rules/rules-manager.js";
import type { CreateAdRuleWriteParams } from "../types.js";

export const budgetOptimizationHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  // -------------------------------------------------------------------------
  // READ: budget.recommend
  // -------------------------------------------------------------------------
  [
    "digital-ads.budget.recommend",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const allocator = new BudgetAllocator();
        const campaigns = (params.campaigns ?? []) as CampaignPerformanceData[];
        if (campaigns.length === 0) {
          return fail(
            "No campaign data provided for budget recommendation",
            "validation",
            "Provide campaigns array with performance data",
          );
        }
        const plan = allocator.recommend(campaigns, {
          maxShiftPercent: params.maxShiftPercent as number | undefined,
        });
        return success(`Budget recommendation: ${plan.summary}`, plan, start);
      } catch (err) {
        return fail(
          `Failed to generate budget recommendation: ${errMsg(err)}`,
          "budget.recommend",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // READ: optimization.review
  // -------------------------------------------------------------------------
  [
    "digital-ads.optimization.review",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const loop = new OptimizationLoop();
        const accountId = (params.adAccountId ?? params.accountId) as string;
        if (!accountId) return fail("Missing adAccountId", "validation", "adAccountId is required");
        const campaigns = (params.campaigns ?? []) as Array<{
          campaignId: string;
          campaignName: string;
          dailyBudget: number;
          spend: number;
          conversions: number;
          cpa: number | null;
          roas: number | null;
          deliveryStatus: string;
        }>;
        const adSets = (params.adSets ?? []) as Array<{
          adSetId: string;
          campaignId: string;
          dailyBudget: number;
          spend: number;
          conversions: number;
          cpa: number | null;
          bidStrategy: string;
          bidAmount: number | null;
          learningPhase: boolean;
        }>;
        const result = await loop.review({
          accountId,
          campaigns,
          adSets,
        });
        return success(
          `Optimization review: score ${result.overallScore}/100, ${result.tier1Actions.length} auto actions, ${result.tier2Actions.length} recommended`,
          result,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to run optimization review: ${errMsg(err)}`,
          "optimization.review",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // READ: rule.list
  // -------------------------------------------------------------------------
  [
    "digital-ads.rule.list",
    async (params, ctx): Promise<ExecuteResult> => {
      const apiConfig = ctx.apiConfig;
      if (!apiConfig) return ctx.noApiConfigResult();
      const start = Date.now();
      try {
        const manager = new RulesManager(apiConfig.baseUrl, apiConfig.accessToken);
        const adAccountId = params.adAccountId as string;
        if (!adAccountId)
          return fail("Missing adAccountId", "validation", "adAccountId is required");
        const rules = await manager.list(adAccountId);
        return success(`Listed ${rules.length} automated rule(s)`, rules, start);
      } catch (err) {
        return fail(`Failed to list rules: ${errMsg(err)}`, "rule.list", errMsg(err));
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: budget.reallocate
  // -------------------------------------------------------------------------
  [
    "digital-ads.budget.reallocate",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      const allocations = params.allocations as Array<{
        campaignId: string;
        newBudgetCents: number;
      }>;
      if (!Array.isArray(allocations) || allocations.length === 0) {
        return fail("Missing allocations", "validation", "allocations array required");
      }
      const results: Array<{ campaignId: string; previousBudget: number }> = [];
      const failures: Array<{ step: string; error: string }> = [];
      for (const alloc of allocations) {
        try {
          const r = await ctx.writeProvider.updateBudget(alloc.campaignId, alloc.newBudgetCents);
          results.push({ campaignId: alloc.campaignId, previousBudget: r.previousBudget });
        } catch (err) {
          failures.push({
            step: `update_budget_${alloc.campaignId}`,
            error: errMsg(err),
          });
        }
      }
      return {
        success: failures.length === 0,
        summary: `Reallocated budget across ${results.length} campaign(s)${failures.length > 0 ? ` (${failures.length} failed)` : ""}`,
        externalRefs: { updatedCampaigns: JSON.stringify(results.map((r) => r.campaignId)) },
        rollbackAvailable: results.length > 0,
        partialFailures: failures,
        durationMs: 0,
        undoRecipe:
          results.length > 0
            ? {
                originalActionId: "",
                originalEnvelopeId: "",
                reverseActionType: "digital-ads.budget.reallocate",
                reverseParameters: {
                  allocations: results.map((r) => ({
                    campaignId: r.campaignId,
                    newBudgetCents: r.previousBudget,
                  })),
                },
                undoExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
                undoRiskCategory: "high",
                undoApprovalRequired: "standard",
              }
            : null,
      };
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: optimization.apply
  // -------------------------------------------------------------------------
  [
    "digital-ads.optimization.apply",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      const actions = params.actions as Array<{
        actionType: string;
        parameters: Record<string, unknown>;
      }>;
      if (!Array.isArray(actions) || actions.length === 0) {
        return fail("Missing actions", "validation", "actions array required");
      }
      const results: Array<{ actionType: string; success: boolean }> = [];
      const failures: Array<{ step: string; error: string }> = [];
      for (const action of actions) {
        try {
          const r = await ctx.dispatchWriteAction(action.actionType, action.parameters);
          results.push({ actionType: action.actionType, success: r.success });
          if (!r.success) {
            failures.push({ step: action.actionType, error: r.summary });
          }
        } catch (err) {
          failures.push({
            step: action.actionType,
            error: errMsg(err),
          });
        }
      }
      return {
        success: failures.length === 0,
        summary: `Applied ${results.filter((r) => r.success).length}/${actions.length} optimization actions${failures.length > 0 ? ` (${failures.length} failed)` : ""}`,
        externalRefs: { appliedActions: JSON.stringify(results) },
        rollbackAvailable: false,
        partialFailures: failures,
        durationMs: 0,
        undoRecipe: null,
      };
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: rule.create
  // -------------------------------------------------------------------------
  [
    "digital-ads.rule.create",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      try {
        const castParams = params as unknown as CreateAdRuleWriteParams;
        const result = await ctx.writeProvider.createAdRule(castParams);
        return {
          success: true,
          summary: `Created rule "${castParams.name}" (${result.id})`,
          externalRefs: { ruleId: result.id },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: {
            originalActionId: "",
            originalEnvelopeId: "",
            reverseActionType: "digital-ads.rule.delete",
            reverseParameters: { ruleId: result.id },
            undoExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            undoRiskCategory: "medium",
            undoApprovalRequired: "none",
          },
        };
      } catch (err) {
        return fail(`Failed to create rule: ${errMsg(err)}`, "rule.create", errMsg(err));
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: rule.delete
  // -------------------------------------------------------------------------
  [
    "digital-ads.rule.delete",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      const ruleId = params.ruleId as string;
      if (!ruleId) return fail("Missing ruleId", "validation", "ruleId required");
      await ctx.writeProvider.deleteAdRule(ruleId);
      return {
        success: true,
        summary: `Deleted rule ${ruleId}`,
        externalRefs: { ruleId },
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 0,
        undoRecipe: null,
      };
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: bid.update_strategy
  // -------------------------------------------------------------------------
  [
    "digital-ads.bid.update_strategy",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      const adSetId = params.adSetId as string;
      const bidStrategy = params.bidStrategy as string;
      const bidAmount = params.bidAmount as number | undefined;
      if (!adSetId || !bidStrategy) {
        return fail(
          "Missing adSetId or bidStrategy",
          "validation",
          "adSetId and bidStrategy required",
        );
      }
      try {
        const result = await ctx.writeProvider.updateBidStrategy(adSetId, bidStrategy, bidAmount);
        return {
          success: true,
          summary: `Updated bid strategy on ad set ${adSetId}: ${result.previousBidStrategy} \u2192 ${bidStrategy}`,
          externalRefs: { adSetId },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: {
            originalActionId: "",
            originalEnvelopeId: "",
            reverseActionType: "digital-ads.bid.update_strategy",
            reverseParameters: { adSetId, bidStrategy: result.previousBidStrategy },
            undoExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
            undoRiskCategory: "high",
            undoApprovalRequired: "standard",
          },
        };
      } catch (err) {
        return fail(
          `Failed to update bid strategy: ${errMsg(err)}`,
          "bid.update_strategy",
          errMsg(err),
        );
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: schedule.set
  // -------------------------------------------------------------------------
  [
    "digital-ads.schedule.set",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      const adSetId = params.adSetId as string;
      const schedule = params.schedule as Array<Record<string, unknown>>;
      if (!adSetId || !schedule) {
        return fail("Missing adSetId or schedule", "validation", "adSetId and schedule required");
      }
      try {
        await ctx.writeProvider.updateAdSetSchedule(adSetId, schedule);
        return {
          success: true,
          summary: `Updated schedule on ad set ${adSetId} with ${schedule.length} time block(s)`,
          externalRefs: { adSetId },
          rollbackAvailable: false,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: null,
        };
      } catch (err) {
        return fail(`Failed to set schedule: ${errMsg(err)}`, "schedule.set", errMsg(err));
      }
    },
  ],

  // -------------------------------------------------------------------------
  // WRITE: campaign.update_objective
  // -------------------------------------------------------------------------
  [
    "digital-ads.campaign.update_objective",
    async (params, ctx): Promise<ExecuteResult> => {
      if (!ctx.writeProvider) {
        return fail("Write provider not configured", "resolve_provider", "No write provider");
      }
      const campaignId = params.campaignId as string;
      const objective = params.objective as string;
      if (!campaignId || !objective) {
        return fail(
          "Missing campaignId or objective",
          "validation",
          "campaignId and objective required",
        );
      }
      try {
        const result = await ctx.writeProvider.updateCampaignObjective(campaignId, objective);
        return {
          success: true,
          summary: `Updated campaign ${campaignId} objective: ${result.previousObjective} \u2192 ${objective}`,
          externalRefs: { campaignId },
          rollbackAvailable: true,
          partialFailures: [],
          durationMs: 0,
          undoRecipe: {
            originalActionId: "",
            originalEnvelopeId: "",
            reverseActionType: "digital-ads.campaign.update_objective",
            reverseParameters: { campaignId, objective: result.previousObjective },
            undoExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            undoRiskCategory: "critical",
            undoApprovalRequired: "elevated",
          },
        };
      } catch (err) {
        return fail(
          `Failed to update objective: ${errMsg(err)}`,
          "campaign.update_objective",
          errMsg(err),
        );
      }
    },
  ],
]);
