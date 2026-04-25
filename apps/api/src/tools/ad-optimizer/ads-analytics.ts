import type { MetricDeltaSchema as MetricDelta } from "@switchboard/schemas";
import type {
  MetricTrendSchema as MetricTrend,
  CreativeEntrySchema as CreativeEntry,
} from "@switchboard/schemas";
import type { SkillTool, EffectCategory } from "@switchboard/core/skill-runtime";
import { ok } from "@switchboard/core/skill-runtime";
import {
  diagnose,
  comparePeriods,
  analyzeFunnel,
  LearningPhaseGuard,
  detectSaturation,
  analyzeCreatives,
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

      "detect-saturation": {
        description:
          "Detect audience saturation, creative fatigue, or campaign decay signals for an ad set.",
        effectCategory: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            adSetId: { type: "string" },
            trends: { type: "array", description: "MetricTrend[] from trend engine" },
            audienceReachedRatio: { type: "number" },
            weeklyConversionRates: { type: "array", items: { type: "number" } },
          },
          required: ["adSetId", "trends"],
        },
        execute: async (params: unknown) => {
          const { adSetId, trends, audienceReachedRatio, weeklyConversionRates } = params as {
            adSetId: string;
            trends: MetricTrend[];
            audienceReachedRatio?: number | null;
            weeklyConversionRates?: number[] | null;
          };
          const signals = detectSaturation(
            adSetId,
            trends,
            audienceReachedRatio ?? null,
            weeklyConversionRates ?? null,
          );
          return ok({ signals });
        },
      },

      "analyze-creatives": {
        description:
          "Analyze creative-level performance for a campaign. Returns ranking, diagnoses, and recommendations.",
        effectCategory: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            campaignId: { type: "string" },
            creativeEntries: {
              type: "array",
              description: "CreativeEntry[] from deduplication",
            },
          },
          required: ["campaignId", "creativeEntries"],
        },
        execute: async (params: unknown) => {
          const { campaignId, creativeEntries } = params as {
            campaignId: string;
            creativeEntries: CreativeEntry[];
          };
          const result = analyzeCreatives(campaignId, creativeEntries);
          return ok(result as Record<string, unknown>);
        },
      },
    },
  };
}
