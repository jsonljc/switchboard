import type { MetricDeltaSchema as MetricDelta } from "@switchboard/schemas";
import type { SkillTool, EffectCategory } from "@switchboard/core/skill-runtime";
import { ok } from "@switchboard/core/skill-runtime";
import {
  diagnose,
  comparePeriods,
  analyzeFunnel,
  LearningPhaseGuard,
} from "@switchboard/ad-optimizer";
import type { MetricSet, FunnelInput, CampaignLearningInput } from "@switchboard/ad-optimizer";

const TIER: EffectCategory = "read";
const learningGuard = new LearningPhaseGuard();

export function createAdsAnalyticsTool(): SkillTool {
  return {
    id: "ads-analytics",
    operations: {
      diagnose: {
        description:
          "Diagnose campaign health issues from metric deltas. Returns pattern-based diagnoses.",
        effectCategory: TIER,
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
          return ok({ diagnoses: diagnose(deltas) });
        },
      },

      "compare-periods": {
        description:
          "Compare current vs previous period metrics. Returns deltas with direction and significance.",
        effectCategory: TIER,
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
          return ok({ deltas: comparePeriods(current, previous) });
        },
      },

      "analyze-funnel": {
        description:
          "Analyze conversion funnel from impressions to close. Returns stages with leakage point.",
        effectCategory: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            insights: { type: "array" },
            crmData: { type: "object" },
            crmBenchmarks: { type: "object" },
            mediaBenchmarks: { type: "object" },
          },
          required: ["insights", "crmData", "crmBenchmarks", "mediaBenchmarks"],
        },
        execute: async (params: unknown) => {
          const input = params as FunnelInput;
          const result = analyzeFunnel(input);
          return ok(result as Record<string, unknown>);
        },
      },

      "check-learning-phase": {
        description: "Check if a campaign is in Meta's learning phase.",
        effectCategory: TIER,
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
          const result = learningGuard.check(campaignId, input);
          return ok(result as Record<string, unknown>);
        },
      },
    },
  };
}
