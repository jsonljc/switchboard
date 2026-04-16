// packages/core/src/skill-runtime/tools/ads-analytics.ts
import type { MetricDeltaSchema as MetricDelta } from "@switchboard/schemas";
import type { SkillTool } from "../types.js";
import type { GovernanceTier } from "../governance.js";
import { diagnose } from "../../ad-optimizer/metric-diagnostician.js";
import { comparePeriods, type MetricSet } from "../../ad-optimizer/period-comparator.js";
import { analyzeFunnel, type FunnelInput } from "../../ad-optimizer/funnel-analyzer.js";
import {
  LearningPhaseGuard,
  type CampaignLearningInput,
} from "../../ad-optimizer/learning-phase-guard.js";

const TIER: GovernanceTier = "read";
const learningGuard = new LearningPhaseGuard();

export function createAdsAnalyticsTool(): SkillTool {
  return {
    id: "ads-analytics",
    operations: {
      diagnose: {
        description:
          "Diagnose campaign health issues from metric deltas. Returns pattern-based diagnoses.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            deltas: { type: "array", description: "MetricDelta[] from compare-periods" },
          },
          required: ["deltas"],
        },
        execute: async (params: unknown) => {
          const { deltas } = params as { deltas: MetricDelta[] };
          return { diagnoses: diagnose(deltas) };
        },
      },

      "compare-periods": {
        description:
          "Compare current vs previous period metrics. Returns deltas with direction and significance.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            current: { type: "object", description: "MetricSet" },
            previous: { type: "object", description: "MetricSet" },
          },
          required: ["current", "previous"],
        },
        execute: async (params: unknown) => {
          const { current, previous } = params as { current: MetricSet; previous: MetricSet };
          return { deltas: comparePeriods(current, previous) };
        },
      },

      "analyze-funnel": {
        description:
          "Analyze conversion funnel from impressions to close. Returns stages with leakage point.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            insights: { type: "array" },
            crmData: { type: "object" },
            benchmarks: { type: "object" },
          },
          required: ["insights", "crmData", "benchmarks"],
        },
        execute: async (params: unknown) => {
          const input = params as FunnelInput;
          return analyzeFunnel(input);
        },
      },

      "check-learning-phase": {
        description: "Check if a campaign is in Meta's learning phase.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: { campaignId: { type: "string" }, input: { type: "object" } },
          required: ["campaignId", "input"],
        },
        execute: async (params: unknown) => {
          const { campaignId, input } = params as {
            campaignId: string;
            input: CampaignLearningInput;
          };
          return learningGuard.check(campaignId, input);
        },
      },
    },
  };
}
