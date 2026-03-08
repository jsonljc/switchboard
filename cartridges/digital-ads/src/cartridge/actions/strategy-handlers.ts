// ---------------------------------------------------------------------------
// Strategy handlers — strategy.recommend, strategy.mediaplan
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { ActionHandler } from "./handler-context.js";
import { fail, success, errMsg } from "./handler-context.js";
import { StrategyEngine } from "../../strategy/strategy-engine.js";
import { MediaPlanner } from "../../strategy/media-planner.js";

export const strategyHandlers: ReadonlyMap<string, ActionHandler> = new Map([
  [
    "digital-ads.strategy.recommend",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const engine = new StrategyEngine();
        const businessGoal = params.businessGoal as string;
        const monthlyBudget = params.monthlyBudget as number;
        if (!businessGoal || !monthlyBudget) {
          return fail(
            "Missing businessGoal or monthlyBudget",
            "validation",
            "businessGoal and monthlyBudget are required",
          );
        }
        const recommendation = engine.recommend({
          businessGoal,
          monthlyBudget,
          targetAudience: (params.targetAudience as string) ?? "broad",
          vertical: (params.vertical as string) ?? "commerce",
          hasExistingCampaigns: (params.hasExistingCampaigns as boolean) ?? false,
        });
        return success(
          `Strategy recommendation: ${recommendation.objective}, ${recommendation.structure.campaignCount} campaign(s), ${recommendation.bidStrategy.split(" — ")[0]}`,
          recommendation,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate strategy recommendation: ${errMsg(err)}`,
          "strategy.recommend",
          errMsg(err),
        );
      }
    },
  ],
  [
    "digital-ads.strategy.mediaplan",
    async (params, _ctx): Promise<ExecuteResult> => {
      const start = Date.now();
      try {
        const planner = new MediaPlanner();
        const totalBudget = params.totalBudget as number;
        const durationDays = params.durationDays as number;
        const objective = params.objective as string;
        if (!totalBudget || !durationDays || !objective) {
          return fail(
            "Missing totalBudget, durationDays, or objective",
            "validation",
            "totalBudget, durationDays, and objective are required",
          );
        }
        const plan = planner.plan({
          totalBudget,
          durationDays,
          objective: objective as Parameters<typeof planner.plan>[0]["objective"],
          targetAudience: (params.targetAudience as string) ?? "broad",
        });
        return success(
          `Media plan: $${plan.totalBudget} over ${plan.duration} days, ${plan.phases.length} phase(s), ~${plan.estimatedResults.estimatedConversions} conversions`,
          plan,
          start,
        );
      } catch (err) {
        return fail(
          `Failed to generate media plan: ${errMsg(err)}`,
          "strategy.mediaplan",
          errMsg(err),
        );
      }
    },
  ],
]);
