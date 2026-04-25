# Ad Optimizer V2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the ad optimizer with 7 capabilities: learning phase rework (ad set level, Meta 3-state), funnel auto-detection (website/instant form/WhatsApp), creative-level performance, trend engine (30/60/90 avg + WoW), budget distribution analysis, ad set frequency, and multi-signal saturation detection.

**Architecture:** Each enhancement is a new module in `packages/ad-optimizer/src/` with its own test file. Shared types go in `packages/schemas/src/ad-optimizer.ts`. The `AuditRunner` orchestrates all modules. Each task is independently testable — later tasks don't break earlier ones.

**Tech Stack:** TypeScript, Zod schemas, Vitest, Meta Marketing API (via `MetaAdsClient`)

**Spec:** `docs/superpowers/specs/2026-04-25-ad-optimizer-v2-design.md`

---

## File Structure

### New files:

- `packages/schemas/src/ad-optimizer-v2.ts` — V2 types (AdSetDetail, TrendAnalysis, BudgetAnalysis, CreativeAnalysis, new recommendation actions)
- `packages/ad-optimizer/src/funnel-detector.ts` — detect funnel shape from ad set destination_type
- `packages/ad-optimizer/src/trend-engine.ts` — rolling averages + WoW snapshots + trend detection + projected breach
- `packages/ad-optimizer/src/budget-analyzer.ts` — cross-campaign balance + per-campaign sizing
- `packages/ad-optimizer/src/creative-analyzer.ts` — creative ranking, diagnosis, recommendations
- `packages/ad-optimizer/src/saturation-detector.ts` — multi-signal saturation detection (replaces frequency > 3.5)
- `packages/ad-optimizer/src/__tests__/funnel-detector.test.ts`
- `packages/ad-optimizer/src/__tests__/trend-engine.test.ts`
- `packages/ad-optimizer/src/__tests__/budget-analyzer.test.ts`
- `packages/ad-optimizer/src/__tests__/creative-analyzer.test.ts`
- `packages/ad-optimizer/src/__tests__/saturation-detector.test.ts`

### Modified files:

- `packages/schemas/src/ad-optimizer.ts` — extend RecommendationActionSchema, update LearningPhaseStatusSchema, update AuditReportSchema
- `packages/schemas/src/crm-outcome.ts` — update CampaignLearningInput and CampaignInsightsProvider interfaces
- `packages/ad-optimizer/src/learning-phase-guard.ts` — rework to use Meta 3-state, ad set level
- `packages/ad-optimizer/src/funnel-analyzer.ts` — accept funnel shape parameter
- `packages/ad-optimizer/src/metric-diagnostician.ts` — replace frequency > 3.5 threshold, add new patterns
- `packages/ad-optimizer/src/recommendation-engine.ts` — new actions, trend-aware confidence, budget distribution weighting
- `packages/ad-optimizer/src/audit-runner.ts` — orchestrate all new modules
- `packages/ad-optimizer/src/meta-campaign-insights-provider.ts` — return real learning_stage_info
- `packages/ad-optimizer/src/index.ts` — export new modules
- `packages/ad-optimizer/src/__tests__/learning-phase-guard.test.ts` — update for 3-state
- `packages/ad-optimizer/src/__tests__/funnel-analyzer.test.ts` — add funnel shape tests
- `packages/ad-optimizer/src/__tests__/metric-diagnostician.test.ts` — update pattern tests
- `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts` — new actions + trend awareness
- `packages/ad-optimizer/src/__tests__/audit-runner.test.ts` — V2 integration

---

### Task 1: V2 Schema Types

**Files:**

- Modify: `packages/schemas/src/ad-optimizer.ts`
- Create: `packages/schemas/src/ad-optimizer-v2.ts`
- Modify: `packages/schemas/src/crm-outcome.ts`

- [ ] **Step 1: Add new recommendation actions and funnel shape enum to ad-optimizer.ts**

Add new actions to `RecommendationActionSchema` and add `FunnelShapeSchema`:

```typescript
// In packages/schemas/src/ad-optimizer.ts

// Update RecommendationActionSchema — add new actions, remove "kill"
export const RecommendationActionSchema = z.enum([
  "scale",
  "pause", // replaces "kill" — reserved for extreme cases (CPA > 3x)
  "add_creative", // add fresh creative + reduce budget on fatigued
  "refresh_creative",
  "restructure",
  "hold",
  "test",
  "review_budget",
  "expand_targeting", // for Learning Limited + high frequency
  "consolidate", // merge Learning Limited ad sets
]);

// Add funnel shape enum
export const FunnelShapeSchema = z.enum(["website", "instant_form", "whatsapp"]);
export type FunnelShapeSchema = z.infer<typeof FunnelShapeSchema>;

// Add learning state enum (replaces boolean inLearning)
export const LearningStateSchema = z.enum(["learning", "learning_limited", "success", "unknown"]);
export type LearningStateSchema = z.infer<typeof LearningStateSchema>;
```

- [ ] **Step 2: Update LearningPhaseStatusSchema for ad set level + 3-state**

```typescript
// Replace existing LearningPhaseStatusSchema in packages/schemas/src/ad-optimizer.ts
export const LearningPhaseStatusSchema = z.object({
  adSetId: z.string(),
  adSetName: z.string(),
  campaignId: z.string(),
  state: LearningStateSchema,
  metricsSnapshot: z
    .object({
      cpa: z.number(),
      roas: z.number(),
      ctr: z.number(),
      spend: z.number(),
      conversions: z.number(),
    })
    .nullable(),
  postExitSnapshot: z
    .object({
      cpa: z.number(),
      roas: z.number(),
      ctr: z.number(),
      spend: z.number(),
      conversions: z.number(),
    })
    .nullable(),
  exitStability: z.enum(["healthy", "unstable", "pending"]).nullable(),
});
export type LearningPhaseStatusSchema = z.infer<typeof LearningPhaseStatusSchema>;
```

- [ ] **Step 3: Update FunnelAnalysisSchema to include funnel shape**

```typescript
// Update in packages/schemas/src/ad-optimizer.ts
export const FunnelAnalysisSchema = z.object({
  funnelShape: FunnelShapeSchema,
  stages: z.array(FunnelStageSchema),
  leakagePoint: z.string(),
  leakageMagnitude: z.number(),
});
```

- [ ] **Step 4: Create ad-optimizer-v2.ts with new V2 types**

```typescript
// packages/schemas/src/ad-optimizer-v2.ts
import { z } from "zod";
import {
  MetricDeltaSchema,
  LearningPhaseStatusSchema,
  FunnelShapeSchema,
  RecommendationActionSchema,
} from "./ad-optimizer.js";

// ── Trend Analysis ──

export const MetricSnapshotSchema = z.object({
  cpm: z.number(),
  ctr: z.number(),
  cpc: z.number(),
  cpl: z.number(),
  cpa: z.number(),
  roas: z.number(),
});
export type MetricSnapshotSchema = z.infer<typeof MetricSnapshotSchema>;

export const TrendTierSchema = z.enum(["alert", "confirmed", "stable"]);
export type TrendTierSchema = z.infer<typeof TrendTierSchema>;

export const WeeklySnapshotSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  metrics: MetricSnapshotSchema,
});
export type WeeklySnapshotSchema = z.infer<typeof WeeklySnapshotSchema>;

export const MetricTrendSchema = z.object({
  metric: z.string(),
  direction: z.enum(["rising", "falling", "stable"]),
  consecutiveWeeks: z.number(),
  tier: TrendTierSchema,
  projectedBreachWeeks: z.number().nullable(),
});
export type MetricTrendSchema = z.infer<typeof MetricTrendSchema>;

export const TrendAnalysisSchema = z.object({
  rollingAverages: z.object({
    day30: MetricSnapshotSchema,
    day60: MetricSnapshotSchema,
    day90: MetricSnapshotSchema,
  }),
  weeklySnapshots: z.array(WeeklySnapshotSchema),
  trends: z.array(MetricTrendSchema),
});
export type TrendAnalysisSchema = z.infer<typeof TrendAnalysisSchema>;

// ── Budget Distribution ──

export const CampaignBudgetEntrySchema = z.object({
  campaignId: z.string(),
  campaignName: z.string(),
  spendShare: z.number(),
  spend: z.number(),
  cpa: z.number(),
  roas: z.number(),
  isCbo: z.boolean(),
  dailyBudget: z.number().nullable(),
  lifetimeBudget: z.number().nullable(),
  spendCap: z.number().nullable(),
  objective: z.string(),
});
export type CampaignBudgetEntrySchema = z.infer<typeof CampaignBudgetEntrySchema>;

export const BudgetImbalanceSchema = z.object({
  type: z.enum(["overspending_underperformer", "underspending_winner"]),
  campaignId: z.string(),
  campaignName: z.string(),
  spendShare: z.number(),
  metric: z.string(),
  value: z.number(),
  message: z.string(),
});
export type BudgetImbalanceSchema = z.infer<typeof BudgetImbalanceSchema>;

export const BudgetAnalysisSchema = z.object({
  entries: z.array(CampaignBudgetEntrySchema),
  imbalances: z.array(BudgetImbalanceSchema),
  accountSpendCap: z.number().nullable(),
  currency: z.string(),
});
export type BudgetAnalysisSchema = z.infer<typeof BudgetAnalysisSchema>;

// ── Creative Analysis ──

export const CreativeEntrySchema = z.object({
  creativeKey: z.string(),
  keyType: z.enum(["image_hash", "video_id"]),
  adIds: z.array(z.string()),
  spend: z.number(),
  spendShare: z.number(),
  impressions: z.number(),
  clicks: z.number(),
  ctr: z.number(),
  cpc: z.number(),
  cpa: z.number(),
  roas: z.number(),
  conversions: z.number(),
  thumbStopRatio: z.number().nullable(),
  qualityRanking: z.string().nullable(),
  engagementRateRanking: z.string().nullable(),
  conversionRateRanking: z.string().nullable(),
});
export type CreativeEntrySchema = z.infer<typeof CreativeEntrySchema>;

export const CreativeDiagnosisSchema = z.object({
  creativeKey: z.string(),
  pattern: z.enum([
    "creative_fatigue",
    "creative_limited",
    "spend_concentration",
    "underperforming_outlier",
  ]),
  severity: z.enum(["warning", "error"]),
  message: z.string(),
});
export type CreativeDiagnosisSchema = z.infer<typeof CreativeDiagnosisSchema>;

export const CreativeAnalysisSchema = z.object({
  campaignId: z.string(),
  entries: z.array(CreativeEntrySchema),
  diagnoses: z.array(CreativeDiagnosisSchema),
});
export type CreativeAnalysisSchema = z.infer<typeof CreativeAnalysisSchema>;

// ── Ad Set Detail ──

export const AdSetDetailSchema = z.object({
  adSetId: z.string(),
  adSetName: z.string(),
  campaignId: z.string(),
  destinationType: z.string(),
  funnelShape: FunnelShapeSchema,
  frequency: z.number(),
  learningStatus: LearningPhaseStatusSchema,
  hasFrequencyCap: z.boolean(),
});
export type AdSetDetailSchema = z.infer<typeof AdSetDetailSchema>;

// ── Saturation Signal ──

export const SaturationSignalSchema = z.object({
  adSetId: z.string(),
  pattern: z.enum(["audience_saturation", "creative_fatigue", "campaign_decay"]),
  confidence: z.enum(["high", "medium", "low"]),
  signals: z.array(z.string()),
  audienceReachedRatio: z.number().nullable(),
  conversionRateDecline: z.number().nullable(),
});
export type SaturationSignalSchema = z.infer<typeof SaturationSignalSchema>;
```

- [ ] **Step 5: Update CampaignLearningInput in crm-outcome.ts**

```typescript
// Replace CampaignLearningInput in packages/schemas/src/crm-outcome.ts
export interface AdSetLearningInput {
  adSetId: string;
  adSetName: string;
  campaignId: string;
  learningStageStatus: "LEARNING" | "SUCCESS" | "FAIL" | "UNKNOWN";
  frequency: number;
  spend: number;
  conversions: number;
  cpa: number;
  roas: number;
  ctr: number;
}

// Keep CampaignLearningInput as deprecated alias for backward compat during migration
/** @deprecated Use AdSetLearningInput */
export interface CampaignLearningInput {
  effectiveStatus: string;
  learningPhase: boolean;
  lastModifiedDays: number;
  optimizationEvents: number;
}
```

- [ ] **Step 6: Update AuditReportSchema to include V2 sections**

```typescript
// Update in packages/schemas/src/ad-optimizer.ts — import V2 types at top
// Add to AuditReportSchema:
export const AuditReportSchema = z.object({
  accountId: z.string(),
  dateRange: z.object({ since: z.string(), until: z.string() }),
  summary: z.object({
    totalSpend: z.number(),
    totalLeads: z.number(),
    totalRevenue: z.number(),
    overallROAS: z.number(),
    activeCampaigns: z.number(),
    campaignsInLearning: z.number(),
    adSetsInLearning: z.number(),
    adSetsLearningLimited: z.number(),
  }),
  funnel: z.array(FunnelAnalysisSchema),
  periodDeltas: z.array(MetricDeltaSchema),
  insights: z.array(InsightOutputSchema),
  watches: z.array(WatchOutputSchema),
  recommendations: z.array(RecommendationOutputSchema),
  // V2 additions — imported from ad-optimizer-v2.ts
  trends: z.lazy(() => TrendAnalysisSchema).optional(),
  budgetDistribution: z.lazy(() => BudgetAnalysisSchema).optional(),
  creativeBreakdown: z.lazy(() => CreativeAnalysisSchema).optional(),
  adSetDetails: z.lazy(() => z.array(AdSetDetailSchema)).optional(),
});
```

- [ ] **Step 7: Run typecheck to verify schema changes compile**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(schemas): add ad optimizer V2 types — learning 3-state, funnel shapes, trends, budget, creative, saturation"
```

---

### Task 2: Learning Phase Rework

**Files:**

- Modify: `packages/ad-optimizer/src/learning-phase-guard.ts`
- Modify: `packages/ad-optimizer/src/__tests__/learning-phase-guard.test.ts`

- [ ] **Step 1: Write failing tests for 3-state learning phase guard**

```typescript
// packages/ad-optimizer/src/__tests__/learning-phase-guard.test.ts
import { describe, it, expect } from "vitest";
import { LearningPhaseGuardV2 } from "../learning-phase-guard.js";
import type { AdSetLearningInput } from "@switchboard/schemas";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";

function makeAdSetInput(overrides: Partial<AdSetLearningInput> = {}): AdSetLearningInput {
  return {
    adSetId: "adset_001",
    adSetName: "Test Ad Set",
    campaignId: "camp_001",
    learningStageStatus: "SUCCESS",
    frequency: 1.5,
    spend: 500,
    conversions: 60,
    cpa: 8.33,
    roas: 3.5,
    ctr: 2.0,
    ...overrides,
  };
}

function makeRec(overrides: Partial<RecommendationOutput> = {}): RecommendationOutput {
  return {
    type: "recommendation",
    action: "scale",
    campaignId: "camp_001",
    campaignName: "Test Campaign",
    confidence: 0.85,
    urgency: "this_week",
    estimatedImpact: "+20% conversions",
    steps: ["Increase budget by 20%"],
    learningPhaseImpact: "none",
    ...overrides,
  };
}

describe("LearningPhaseGuardV2", () => {
  const guard = new LearningPhaseGuardV2();

  describe("classifyState()", () => {
    it("maps LEARNING to learning state", () => {
      const input = makeAdSetInput({ learningStageStatus: "LEARNING" });
      const status = guard.classifyState(input);
      expect(status.state).toBe("learning");
      expect(status.adSetId).toBe("adset_001");
    });

    it("maps FAIL to learning_limited state", () => {
      const input = makeAdSetInput({ learningStageStatus: "FAIL" });
      const status = guard.classifyState(input);
      expect(status.state).toBe("learning_limited");
    });

    it("maps SUCCESS to success state", () => {
      const input = makeAdSetInput({ learningStageStatus: "SUCCESS" });
      const status = guard.classifyState(input);
      expect(status.state).toBe("success");
    });

    it("maps UNKNOWN to unknown state", () => {
      const input = makeAdSetInput({ learningStageStatus: "UNKNOWN" });
      const status = guard.classifyState(input);
      expect(status.state).toBe("unknown");
    });

    it("snapshots metrics for learning state", () => {
      const input = makeAdSetInput({
        learningStageStatus: "LEARNING",
        cpa: 10,
        roas: 3.0,
        ctr: 1.8,
        spend: 300,
        conversions: 30,
      });
      const status = guard.classifyState(input);
      expect(status.metricsSnapshot).toEqual({
        cpa: 10,
        roas: 3.0,
        ctr: 1.8,
        spend: 300,
        conversions: 30,
      });
    });
  });

  describe("gate()", () => {
    it("gates destructive actions (pause, restructure) during learning", () => {
      const input = makeAdSetInput({ learningStageStatus: "LEARNING" });
      const status = guard.classifyState(input);
      const rec = makeRec({ action: "pause" });
      const result = guard.gate(rec, status);
      expect(result.type).toBe("watch");
    });

    it("allows non-destructive actions during learning", () => {
      const input = makeAdSetInput({ learningStageStatus: "LEARNING" });
      const status = guard.classifyState(input);
      const rec = makeRec({ action: "refresh_creative" });
      const result = guard.gate(rec, status);
      expect(result.type).toBe("recommendation");
    });

    it("does NOT gate during learning_limited — escalates instead", () => {
      const input = makeAdSetInput({ learningStageStatus: "FAIL" });
      const status = guard.classifyState(input);
      const rec = makeRec({ action: "scale" });
      const result = guard.gate(rec, status);
      expect(result.type).toBe("recommendation");
    });

    it("passes through during success state", () => {
      const input = makeAdSetInput({ learningStageStatus: "SUCCESS" });
      const status = guard.classifyState(input);
      const rec = makeRec({ action: "scale" });
      const result = guard.gate(rec, status);
      expect(result.type).toBe("recommendation");
      expect(result).toBe(rec);
    });
  });

  describe("diagnoseLearningLimited()", () => {
    it("diagnoses audience_too_narrow when frequency is high", () => {
      const input = makeAdSetInput({
        learningStageStatus: "FAIL",
        frequency: 5.0,
        spend: 500,
      });
      const status = guard.classifyState(input);
      const diagnosis = guard.diagnoseLearningLimited(status, input);
      expect(diagnosis.rootCause).toBe("audience_too_narrow");
      expect(diagnosis.recommendedAction).toBe("expand_targeting");
    });

    it("diagnoses underfunded when frequency is low and spend is low", () => {
      const input = makeAdSetInput({
        learningStageStatus: "FAIL",
        frequency: 1.2,
        spend: 50,
      });
      const status = guard.classifyState(input);
      const diagnosis = guard.diagnoseLearningLimited(status, input);
      expect(diagnosis.rootCause).toBe("underfunded");
      expect(diagnosis.recommendedAction).toBe("consolidate");
    });
  });

  describe("isDestructiveAction()", () => {
    it("treats pause as destructive", () => {
      expect(guard.isDestructiveAction("pause")).toBe(true);
    });

    it("treats restructure as destructive", () => {
      expect(guard.isDestructiveAction("restructure")).toBe(true);
    });

    it("treats refresh_creative as non-destructive", () => {
      expect(guard.isDestructiveAction("refresh_creative")).toBe(false);
    });

    it("treats scale as non-destructive", () => {
      expect(guard.isDestructiveAction("scale")).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- learning-phase-guard`
Expected: FAIL — `LearningPhaseGuardV2` not found

- [ ] **Step 3: Implement LearningPhaseGuardV2**

```typescript
// packages/ad-optimizer/src/learning-phase-guard.ts
// Keep existing LearningPhaseGuard for backward compat, add V2 below

import type {
  LearningPhaseStatusSchema as LearningPhaseStatus,
  RecommendationOutputSchema as RecommendationOutput,
  WatchOutputSchema as WatchOutput,
  LearningStateSchema as LearningState,
  RecommendationActionSchema as RecommendationAction,
} from "@switchboard/schemas";
import type { AdSetLearningInput } from "@switchboard/schemas";

const DESTRUCTIVE_ACTIONS: Set<string> = new Set(["pause", "restructure"]);

const HIGH_FREQUENCY_THRESHOLD = 3.0;
const LOW_SPEND_THRESHOLD = 100;

interface LearningLimitedDiagnosis {
  rootCause: "audience_too_narrow" | "underfunded" | "cost_constrained";
  recommendedAction: "expand_targeting" | "consolidate" | "review_budget";
  message: string;
}

export class LearningPhaseGuardV2 {
  classifyState(input: AdSetLearningInput): LearningPhaseStatus {
    const stateMap: Record<string, LearningState> = {
      LEARNING: "learning",
      FAIL: "learning_limited",
      SUCCESS: "success",
    };
    const state = stateMap[input.learningStageStatus] ?? "unknown";

    const shouldSnapshot = state === "learning" || state === "learning_limited";
    const metricsSnapshot = shouldSnapshot
      ? {
          cpa: input.cpa,
          roas: input.roas,
          ctr: input.ctr,
          spend: input.spend,
          conversions: input.conversions,
        }
      : null;

    return {
      adSetId: input.adSetId,
      adSetName: input.adSetName,
      campaignId: input.campaignId,
      state,
      metricsSnapshot,
      postExitSnapshot: null,
      exitStability: state === "success" ? "pending" : null,
    };
  }

  isDestructiveAction(action: string): boolean {
    return DESTRUCTIVE_ACTIONS.has(action);
  }

  gate(
    recommendation: RecommendationOutput,
    status: LearningPhaseStatus,
  ): RecommendationOutput | WatchOutput {
    if (status.state !== "learning") {
      return recommendation;
    }

    if (!this.isDestructiveAction(recommendation.action)) {
      return recommendation;
    }

    return {
      type: "watch",
      campaignId: recommendation.campaignId,
      campaignName: recommendation.campaignName,
      pattern: "in_learning_phase",
      message: `Ad set ${status.adSetId} is in learning. ${recommendation.action} recommendation held until learning completes.`,
      checkBackDate:
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] ?? "",
    };
  }

  diagnoseLearningLimited(
    status: LearningPhaseStatus,
    input: AdSetLearningInput,
  ): LearningLimitedDiagnosis {
    if (input.frequency > HIGH_FREQUENCY_THRESHOLD) {
      return {
        rootCause: "audience_too_narrow",
        recommendedAction: "expand_targeting",
        message: `Ad set ${status.adSetId} is Learning Limited with high frequency (${input.frequency.toFixed(1)}). Audience may be too narrow.`,
      };
    }

    if (input.spend < LOW_SPEND_THRESHOLD) {
      return {
        rootCause: "underfunded",
        recommendedAction: "consolidate",
        message: `Ad set ${status.adSetId} is Learning Limited with low spend ($${input.spend.toFixed(0)}). Consider consolidating ad sets or increasing budget.`,
      };
    }

    return {
      rootCause: "cost_constrained",
      recommendedAction: "review_budget",
      message: `Ad set ${status.adSetId} is Learning Limited. Review bid strategy and budget.`,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- learning-phase-guard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ad-optimizer): learning phase V2 — 3-state machine, ad set level, smart gating"
```

---

### Task 3: Funnel Auto-Detection

**Files:**

- Create: `packages/ad-optimizer/src/funnel-detector.ts`
- Create: `packages/ad-optimizer/src/__tests__/funnel-detector.test.ts`
- Modify: `packages/ad-optimizer/src/funnel-analyzer.ts`
- Modify: `packages/ad-optimizer/src/__tests__/funnel-analyzer.test.ts`

- [ ] **Step 1: Write failing tests for funnel detector**

```typescript
// packages/ad-optimizer/src/__tests__/funnel-detector.test.ts
import { describe, it, expect } from "vitest";
import { detectFunnelShape, getFunnelStageTemplate } from "../funnel-detector.js";

describe("detectFunnelShape", () => {
  it("returns website for WEBSITE destination", () => {
    expect(detectFunnelShape("WEBSITE")).toBe("website");
  });

  it("returns instant_form for ON_AD destination", () => {
    expect(detectFunnelShape("ON_AD")).toBe("instant_form");
  });

  it("returns whatsapp for WHATSAPP destination", () => {
    expect(detectFunnelShape("WHATSAPP")).toBe("whatsapp");
  });

  it("returns whatsapp for multi-destination containing WHATSAPP", () => {
    expect(detectFunnelShape("MESSAGING_MESSENGER_WHATSAPP")).toBe("whatsapp");
    expect(detectFunnelShape("MESSAGING_INSTAGRAM_DIRECT_WHATSAPP")).toBe("whatsapp");
  });

  it("defaults to website for unknown destination", () => {
    expect(detectFunnelShape("UNKNOWN_VALUE")).toBe("website");
    expect(detectFunnelShape("UNDEFINED")).toBe("website");
  });
});

describe("getFunnelStageTemplate", () => {
  it("returns 6 stages for website funnel", () => {
    const stages = getFunnelStageTemplate("website");
    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.name)).toEqual([
      "Impressions",
      "Clicks",
      "Landing Page Views",
      "Leads",
      "Qualified",
      "Closed",
    ]);
  });

  it("returns 5 stages for instant_form funnel", () => {
    const stages = getFunnelStageTemplate("instant_form");
    expect(stages).toHaveLength(5);
    expect(stages.map((s) => s.name)).toEqual([
      "Impressions",
      "Clicks",
      "Leads",
      "Qualified",
      "Closed",
    ]);
  });

  it("returns 6 stages for whatsapp funnel", () => {
    const stages = getFunnelStageTemplate("whatsapp");
    expect(stages).toHaveLength(6);
    expect(stages.map((s) => s.name)).toEqual([
      "Impressions",
      "Clicks",
      "Conversations Started",
      "First Reply",
      "Qualified",
      "Closed",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- funnel-detector`
Expected: FAIL

- [ ] **Step 3: Implement funnel detector**

```typescript
// packages/ad-optimizer/src/funnel-detector.ts
import type { FunnelShapeSchema as FunnelShape } from "@switchboard/schemas";

interface StageTemplate {
  name: string;
  metricKey: string;
}

export function detectFunnelShape(destinationType: string): FunnelShape {
  if (destinationType === "ON_AD") return "instant_form";
  if (destinationType === "WHATSAPP" || destinationType.includes("WHATSAPP")) return "whatsapp";
  return "website";
}

export function getFunnelStageTemplate(shape: FunnelShape): StageTemplate[] {
  switch (shape) {
    case "website":
      return [
        { name: "Impressions", metricKey: "impressions" },
        { name: "Clicks", metricKey: "clicks" },
        { name: "Landing Page Views", metricKey: "lpv" },
        { name: "Leads", metricKey: "leads" },
        { name: "Qualified", metricKey: "qualified" },
        { name: "Closed", metricKey: "closed" },
      ];
    case "instant_form":
      return [
        { name: "Impressions", metricKey: "impressions" },
        { name: "Clicks", metricKey: "clicks" },
        { name: "Leads", metricKey: "leads" },
        { name: "Qualified", metricKey: "qualified" },
        { name: "Closed", metricKey: "closed" },
      ];
    case "whatsapp":
      return [
        { name: "Impressions", metricKey: "impressions" },
        { name: "Clicks", metricKey: "clicks" },
        { name: "Conversations Started", metricKey: "conversations_started" },
        { name: "First Reply", metricKey: "first_reply" },
        { name: "Qualified", metricKey: "qualified" },
        { name: "Closed", metricKey: "closed" },
      ];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- funnel-detector`
Expected: PASS

- [ ] **Step 5: Update funnel-analyzer.ts to accept funnel shape**

Modify `analyzeFunnel()` in `packages/ad-optimizer/src/funnel-analyzer.ts` to accept an optional `funnelShape` parameter. When provided, use the corresponding stage template. When omitted, default to `"website"` (backward compatible).

This is a refactor of the existing function — the existing tests should still pass with the default shape, and new tests verify the shape-specific behavior.

- [ ] **Step 6: Add funnel shape tests to funnel-analyzer.test.ts**

Add tests to `packages/ad-optimizer/src/__tests__/funnel-analyzer.test.ts` that verify:

- `analyzeFunnel(input, "website")` produces 6 stages (existing behavior)
- `analyzeFunnel(input, "instant_form")` produces 5 stages (no LPV)
- `analyzeFunnel(input, "whatsapp")` produces 6 stages with WhatsApp-specific names

- [ ] **Step 7: Run all funnel tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- funnel`
Expected: PASS (both old and new tests)

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(ad-optimizer): funnel auto-detection — website, instant form, WhatsApp shapes"
```

---

### Task 4: Trend Engine

**Files:**

- Create: `packages/ad-optimizer/src/trend-engine.ts`
- Create: `packages/ad-optimizer/src/__tests__/trend-engine.test.ts`

- [ ] **Step 1: Write failing tests for trend engine**

```typescript
// packages/ad-optimizer/src/__tests__/trend-engine.test.ts
import { describe, it, expect } from "vitest";
import { detectTrends, projectBreach, classifyTrendTier } from "../trend-engine.js";
import type { MetricSnapshotSchema as MetricSnapshot } from "@switchboard/schemas";

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return { cpm: 10, ctr: 2.0, cpc: 1.5, cpl: 8, cpa: 50, roas: 3.0, ...overrides };
}

describe("classifyTrendTier", () => {
  it("returns stable for 0 consecutive weeks", () => {
    expect(classifyTrendTier(0)).toBe("stable");
  });

  it("returns alert for 1-2 consecutive weeks", () => {
    expect(classifyTrendTier(1)).toBe("alert");
    expect(classifyTrendTier(2)).toBe("alert");
  });

  it("returns confirmed for 3+ consecutive weeks", () => {
    expect(classifyTrendTier(3)).toBe("confirmed");
    expect(classifyTrendTier(4)).toBe("confirmed");
  });
});

describe("detectTrends", () => {
  it("detects rising CPA over 3 weeks as confirmed trend", () => {
    const snapshots = [
      makeSnapshot({ cpa: 40 }),
      makeSnapshot({ cpa: 50 }),
      makeSnapshot({ cpa: 60 }),
      makeSnapshot({ cpa: 70 }),
    ];
    const trends = detectTrends(snapshots);
    const cpaTrend = trends.find((t) => t.metric === "cpa");
    expect(cpaTrend).toBeDefined();
    expect(cpaTrend!.direction).toBe("rising");
    expect(cpaTrend!.consecutiveWeeks).toBe(3);
    expect(cpaTrend!.tier).toBe("confirmed");
  });

  it("detects stable metrics when no consecutive movement", () => {
    const snapshots = [
      makeSnapshot({ cpa: 50 }),
      makeSnapshot({ cpa: 55 }),
      makeSnapshot({ cpa: 48 }),
      makeSnapshot({ cpa: 52 }),
    ];
    const trends = detectTrends(snapshots);
    const cpaTrend = trends.find((t) => t.metric === "cpa");
    expect(cpaTrend).toBeDefined();
    expect(cpaTrend!.tier).toBe("stable");
  });

  it("detects falling CTR over 2 weeks as alert", () => {
    const snapshots = [
      makeSnapshot({ ctr: 3.0 }),
      makeSnapshot({ ctr: 3.0 }),
      makeSnapshot({ ctr: 2.5 }),
      makeSnapshot({ ctr: 2.0 }),
    ];
    const trends = detectTrends(snapshots);
    const ctrTrend = trends.find((t) => t.metric === "ctr");
    expect(ctrTrend).toBeDefined();
    expect(ctrTrend!.direction).toBe("falling");
    expect(ctrTrend!.consecutiveWeeks).toBe(2);
    expect(ctrTrend!.tier).toBe("alert");
  });
});

describe("projectBreach", () => {
  it("projects weeks until CPA breaches target", () => {
    const weeklyValues = [40, 50, 60, 70];
    const target = 100;
    const weeks = projectBreach(weeklyValues, target, "cost");
    expect(weeks).toBe(3);
  });

  it("returns null when trend is flat or improving", () => {
    const weeklyValues = [70, 65, 60, 55];
    const target = 100;
    const weeks = projectBreach(weeklyValues, target, "cost");
    expect(weeks).toBeNull();
  });

  it("returns null when already above target", () => {
    const weeklyValues = [110, 115, 120, 125];
    const target = 100;
    const weeks = projectBreach(weeklyValues, target, "cost");
    expect(weeks).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- trend-engine`
Expected: FAIL

- [ ] **Step 3: Implement trend engine**

```typescript
// packages/ad-optimizer/src/trend-engine.ts
import type {
  MetricSnapshotSchema as MetricSnapshot,
  MetricTrendSchema as MetricTrend,
  TrendTierSchema as TrendTier,
} from "@switchboard/schemas";

type MetricKey = keyof MetricSnapshot;

const TRACKED_METRICS: MetricKey[] = ["cpm", "ctr", "cpc", "cpl", "cpa", "roas"];

export function classifyTrendTier(consecutiveWeeks: number): TrendTier {
  if (consecutiveWeeks >= 3) return "confirmed";
  if (consecutiveWeeks >= 1) return "alert";
  return "stable";
}

function countConsecutiveDirection(values: number[]): {
  direction: "rising" | "falling" | "stable";
  count: number;
} {
  if (values.length < 2) return { direction: "stable", count: 0 };

  let risingCount = 0;
  let fallingCount = 0;

  for (let i = values.length - 1; i > 0; i--) {
    if (values[i]! > values[i - 1]!) {
      if (fallingCount > 0) break;
      risingCount++;
    } else if (values[i]! < values[i - 1]!) {
      if (risingCount > 0) break;
      fallingCount++;
    } else {
      break;
    }
  }

  if (risingCount > 0) return { direction: "rising", count: risingCount };
  if (fallingCount > 0) return { direction: "falling", count: fallingCount };
  return { direction: "stable", count: 0 };
}

export function detectTrends(weeklySnapshots: MetricSnapshot[]): MetricTrend[] {
  const results: MetricTrend[] = [];

  for (const metric of TRACKED_METRICS) {
    const values = weeklySnapshots.map((s) => s[metric]);
    const { direction, count } = countConsecutiveDirection(values);
    const tier = classifyTrendTier(count);

    results.push({
      metric,
      direction,
      consecutiveWeeks: count,
      tier,
      projectedBreachWeeks: null,
    });
  }

  return results;
}

export function projectBreach(
  weeklyValues: number[],
  target: number,
  metricType: "cost" | "performance",
): number | null {
  if (weeklyValues.length < 2) return null;

  const current = weeklyValues[weeklyValues.length - 1]!;
  const previous = weeklyValues[weeklyValues.length - 2]!;
  const weeklyDelta = current - previous;

  if (metricType === "cost") {
    if (current >= target) return null;
    if (weeklyDelta <= 0) return null;
    return Math.ceil((target - current) / weeklyDelta);
  }

  if (current <= target) return null;
  if (weeklyDelta >= 0) return null;
  return Math.ceil((current - target) / Math.abs(weeklyDelta));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- trend-engine`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ad-optimizer): trend engine — WoW detection, alert/confirmed tiers, projected breach"
```

---

### Task 5: Budget Distribution Analyzer

**Files:**

- Create: `packages/ad-optimizer/src/budget-analyzer.ts`
- Create: `packages/ad-optimizer/src/__tests__/budget-analyzer.test.ts`

- [ ] **Step 1: Write failing tests for budget analyzer**

```typescript
// packages/ad-optimizer/src/__tests__/budget-analyzer.test.ts
import { describe, it, expect } from "vitest";
import { analyzeBudgetDistribution, detectCBO } from "../budget-analyzer.js";
import type { CampaignBudgetEntrySchema as CampaignBudgetEntry } from "@switchboard/schemas";

function makeEntry(overrides: Partial<CampaignBudgetEntry> = {}): CampaignBudgetEntry {
  return {
    campaignId: "camp-1",
    campaignName: "Campaign 1",
    spendShare: 0.5,
    spend: 5000,
    cpa: 50,
    roas: 3.0,
    isCbo: false,
    dailyBudget: 200,
    lifetimeBudget: null,
    spendCap: null,
    objective: "OUTCOME_LEADS",
    ...overrides,
  };
}

describe("detectCBO", () => {
  it("returns true when campaign has nonzero daily_budget", () => {
    expect(detectCBO(500, null)).toBe(true);
  });

  it("returns true when campaign has nonzero lifetime_budget", () => {
    expect(detectCBO(null, 10000)).toBe(true);
  });

  it("returns false when both are null or zero", () => {
    expect(detectCBO(null, null)).toBe(false);
    expect(detectCBO(0, 0)).toBe(false);
  });
});

describe("analyzeBudgetDistribution", () => {
  it("flags overspending underperformer", () => {
    const entries = [
      makeEntry({ campaignId: "a", spendShare: 0.7, cpa: 150, roas: 0.8 }),
      makeEntry({ campaignId: "b", spendShare: 0.3, cpa: 30, roas: 5.0 }),
    ];
    const result = analyzeBudgetDistribution(entries, 100, null);
    const imbalance = result.imbalances.find(
      (i) => i.campaignId === "a" && i.type === "overspending_underperformer",
    );
    expect(imbalance).toBeDefined();
  });

  it("flags underspending winner", () => {
    const entries = [
      makeEntry({ campaignId: "a", spendShare: 0.05, cpa: 20, roas: 6.0 }),
      makeEntry({ campaignId: "b", spendShare: 0.95, cpa: 80, roas: 1.5 }),
    ];
    const result = analyzeBudgetDistribution(entries, 100, null);
    const imbalance = result.imbalances.find(
      (i) => i.campaignId === "a" && i.type === "underspending_winner",
    );
    expect(imbalance).toBeDefined();
  });

  it("returns no imbalances when distribution is balanced", () => {
    const entries = [
      makeEntry({ campaignId: "a", spendShare: 0.5, cpa: 50, roas: 3.0 }),
      makeEntry({ campaignId: "b", spendShare: 0.5, cpa: 55, roas: 2.8 }),
    ];
    const result = analyzeBudgetDistribution(entries, 100, null);
    expect(result.imbalances).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- budget-analyzer`
Expected: FAIL

- [ ] **Step 3: Implement budget analyzer**

```typescript
// packages/ad-optimizer/src/budget-analyzer.ts
import type {
  CampaignBudgetEntrySchema as CampaignBudgetEntry,
  BudgetImbalanceSchema as BudgetImbalance,
  BudgetAnalysisSchema as BudgetAnalysis,
} from "@switchboard/schemas";

const OVERSPEND_SHARE_THRESHOLD = 0.4;
const UNDERSPEND_SHARE_THRESHOLD = 0.1;

export function detectCBO(dailyBudget: number | null, lifetimeBudget: number | null): boolean {
  return (dailyBudget != null && dailyBudget > 0) || (lifetimeBudget != null && lifetimeBudget > 0);
}

export function analyzeBudgetDistribution(
  entries: CampaignBudgetEntry[],
  targetCPA: number,
  accountSpendCap: number | null,
): BudgetAnalysis {
  const imbalances: BudgetImbalance[] = [];

  if (entries.length < 2) {
    return { entries, imbalances, accountSpendCap, currency: "USD" };
  }

  const avgCpa = entries.reduce((sum, e) => sum + e.cpa, 0) / entries.length;
  const avgRoas = entries.reduce((sum, e) => sum + e.roas, 0) / entries.length;

  for (const entry of entries) {
    if (
      entry.spendShare > OVERSPEND_SHARE_THRESHOLD &&
      entry.cpa > targetCPA &&
      entry.roas < avgRoas
    ) {
      imbalances.push({
        type: "overspending_underperformer",
        campaignId: entry.campaignId,
        campaignName: entry.campaignName,
        spendShare: entry.spendShare,
        metric: "cpa",
        value: entry.cpa,
        message: `Campaign has ${(entry.spendShare * 100).toFixed(0)}% of spend but CPA ($${entry.cpa.toFixed(0)}) exceeds target ($${targetCPA}).`,
      });
    }

    if (
      entry.spendShare < UNDERSPEND_SHARE_THRESHOLD &&
      entry.cpa < targetCPA * 0.8 &&
      entry.roas > avgRoas
    ) {
      imbalances.push({
        type: "underspending_winner",
        campaignId: entry.campaignId,
        campaignName: entry.campaignName,
        spendShare: entry.spendShare,
        metric: "roas",
        value: entry.roas,
        message: `Campaign has only ${(entry.spendShare * 100).toFixed(0)}% of spend but best ROAS (${entry.roas.toFixed(1)}x). Consider increasing budget.`,
      });
    }
  }

  return { entries, imbalances, accountSpendCap, currency: "USD" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- budget-analyzer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ad-optimizer): budget distribution analysis — cross-campaign balance, CBO detection"
```

---

### Task 6: Creative Analyzer

**Files:**

- Create: `packages/ad-optimizer/src/creative-analyzer.ts`
- Create: `packages/ad-optimizer/src/__tests__/creative-analyzer.test.ts`

- [ ] **Step 1: Write failing tests for creative analyzer**

```typescript
// packages/ad-optimizer/src/__tests__/creative-analyzer.test.ts
import { describe, it, expect } from "vitest";
import { analyzeCreatives, deduplicateCreatives } from "../creative-analyzer.js";
import type { CreativeEntrySchema as CreativeEntry } from "@switchboard/schemas";

function makeCreative(overrides: Partial<CreativeEntry> = {}): CreativeEntry {
  return {
    creativeKey: "hash_abc",
    keyType: "image_hash",
    adIds: ["ad_1"],
    spend: 100,
    spendShare: 0.25,
    impressions: 10000,
    clicks: 200,
    ctr: 2.0,
    cpc: 0.5,
    cpa: 50,
    roas: 3.0,
    conversions: 2,
    thumbStopRatio: null,
    qualityRanking: null,
    engagementRateRanking: null,
    conversionRateRanking: null,
    ...overrides,
  };
}

describe("analyzeCreatives", () => {
  it("detects spend concentration when one creative has >60% spend", () => {
    const entries = [
      makeCreative({ creativeKey: "a", spendShare: 0.75, spend: 750 }),
      makeCreative({ creativeKey: "b", spendShare: 0.25, spend: 250 }),
    ];
    const result = analyzeCreatives("camp-1", entries);
    const concentration = result.diagnoses.find((d) => d.pattern === "spend_concentration");
    expect(concentration).toBeDefined();
    expect(concentration!.creativeKey).toBe("a");
  });

  it("detects underperforming outlier when CPA >2x campaign average", () => {
    const entries = [
      makeCreative({ creativeKey: "a", cpa: 30 }),
      makeCreative({ creativeKey: "b", cpa: 40 }),
      makeCreative({ creativeKey: "c", cpa: 150 }),
    ];
    const result = analyzeCreatives("camp-1", entries);
    const outlier = result.diagnoses.find((d) => d.pattern === "underperforming_outlier");
    expect(outlier).toBeDefined();
    expect(outlier!.creativeKey).toBe("c");
  });

  it("returns no diagnoses for balanced creatives", () => {
    const entries = [
      makeCreative({ creativeKey: "a", spendShare: 0.5, cpa: 50, spend: 500 }),
      makeCreative({ creativeKey: "b", spendShare: 0.5, cpa: 55, spend: 500 }),
    ];
    const result = analyzeCreatives("camp-1", entries);
    expect(result.diagnoses).toHaveLength(0);
  });
});

describe("deduplicateCreatives", () => {
  it("groups ads by image_hash and aggregates metrics", () => {
    const rawAds = [
      {
        adId: "ad_1",
        imageHash: "hash_x",
        videoId: null,
        spend: 100,
        impressions: 5000,
        clicks: 100,
        conversions: 2,
        ctr: 2.0,
        cpc: 1.0,
        cpa: 50,
        roas: 3.0,
        videoViews: null,
        qualityRanking: null,
        engagementRateRanking: null,
        conversionRateRanking: null,
      },
      {
        adId: "ad_2",
        imageHash: "hash_x",
        videoId: null,
        spend: 200,
        impressions: 10000,
        clicks: 200,
        conversions: 4,
        ctr: 2.0,
        cpc: 1.0,
        cpa: 50,
        roas: 3.0,
        videoViews: null,
        qualityRanking: null,
        engagementRateRanking: null,
        conversionRateRanking: null,
      },
    ];
    const entries = deduplicateCreatives(rawAds);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.creativeKey).toBe("hash_x");
    expect(entries[0]!.adIds).toEqual(["ad_1", "ad_2"]);
    expect(entries[0]!.spend).toBe(300);
    expect(entries[0]!.impressions).toBe(15000);
  });

  it("uses video_id as key for video ads", () => {
    const rawAds = [
      {
        adId: "ad_1",
        imageHash: null,
        videoId: "vid_1",
        spend: 100,
        impressions: 5000,
        clicks: 100,
        conversions: 2,
        ctr: 2.0,
        cpc: 1.0,
        cpa: 50,
        roas: 3.0,
        videoViews: 3000,
        qualityRanking: null,
        engagementRateRanking: null,
        conversionRateRanking: null,
      },
    ];
    const entries = deduplicateCreatives(rawAds);
    expect(entries[0]!.keyType).toBe("video_id");
    expect(entries[0]!.creativeKey).toBe("vid_1");
    expect(entries[0]!.thumbStopRatio).toBe(60);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- creative-analyzer`
Expected: FAIL

- [ ] **Step 3: Implement creative analyzer**

```typescript
// packages/ad-optimizer/src/creative-analyzer.ts
import type {
  CreativeEntrySchema as CreativeEntry,
  CreativeDiagnosisSchema as CreativeDiagnosis,
  CreativeAnalysisSchema as CreativeAnalysis,
} from "@switchboard/schemas";

const SPEND_CONCENTRATION_THRESHOLD = 0.6;
const OUTLIER_CPA_MULTIPLIER = 2;

export interface RawAdData {
  adId: string;
  imageHash: string | null;
  videoId: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
  videoViews: number | null;
  qualityRanking: string | null;
  engagementRateRanking: string | null;
  conversionRateRanking: string | null;
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function deduplicateCreatives(rawAds: RawAdData[]): CreativeEntry[] {
  const groups = new Map<string, { keyType: "image_hash" | "video_id"; ads: RawAdData[] }>();

  for (const ad of rawAds) {
    const key = ad.videoId ?? ad.imageHash ?? ad.adId;
    const keyType = ad.videoId ? "video_id" : "image_hash";
    const existing = groups.get(key);
    if (existing) {
      existing.ads.push(ad);
    } else {
      groups.set(key, { keyType, ads: [ad] });
    }
  }

  const totalSpend = rawAds.reduce((sum, a) => sum + a.spend, 0);
  const entries: CreativeEntry[] = [];

  for (const [creativeKey, { keyType, ads }] of groups) {
    const spend = ads.reduce((s, a) => s + a.spend, 0);
    const impressions = ads.reduce((s, a) => s + a.impressions, 0);
    const clicks = ads.reduce((s, a) => s + a.clicks, 0);
    const conversions = ads.reduce((s, a) => s + a.conversions, 0);
    const totalVideoViews = ads.reduce((s, a) => s + (a.videoViews ?? 0), 0);
    const hasVideo = ads.some((a) => a.videoViews != null);

    entries.push({
      creativeKey,
      keyType,
      adIds: ads.map((a) => a.adId),
      spend,
      spendShare: safeDivide(spend, totalSpend),
      impressions,
      clicks,
      ctr: safeDivide(clicks, impressions) * 100,
      cpc: safeDivide(spend, clicks),
      cpa: safeDivide(spend, conversions),
      roas: safeDivide(
        ads.reduce((s, a) => s + a.roas * a.spend, 0),
        spend,
      ),
      conversions,
      thumbStopRatio: hasVideo ? safeDivide(totalVideoViews, impressions) * 100 : null,
      qualityRanking: ads[0]?.qualityRanking ?? null,
      engagementRateRanking: ads[0]?.engagementRateRanking ?? null,
      conversionRateRanking: ads[0]?.conversionRateRanking ?? null,
    });
  }

  return entries;
}

export function analyzeCreatives(campaignId: string, entries: CreativeEntry[]): CreativeAnalysis {
  const diagnoses: CreativeDiagnosis[] = [];

  if (entries.length === 0) {
    return { campaignId, entries, diagnoses };
  }

  const avgCpa = entries.reduce((s, e) => s + e.cpa, 0) / entries.length;

  for (const entry of entries) {
    if (entry.spendShare > SPEND_CONCENTRATION_THRESHOLD) {
      diagnoses.push({
        creativeKey: entry.creativeKey,
        pattern: "spend_concentration",
        severity: "warning",
        message: `Creative has ${(entry.spendShare * 100).toFixed(0)}% of campaign spend. High concentration risk if this creative fatigues.`,
      });
    }

    if (entry.cpa > OUTLIER_CPA_MULTIPLIER * avgCpa && entries.length > 1) {
      diagnoses.push({
        creativeKey: entry.creativeKey,
        pattern: "underperforming_outlier",
        severity: "error",
        message: `Creative CPA ($${entry.cpa.toFixed(0)}) is ${(entry.cpa / avgCpa).toFixed(1)}x the campaign average ($${avgCpa.toFixed(0)}).`,
      });
    }
  }

  return { campaignId, entries, diagnoses };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- creative-analyzer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ad-optimizer): creative analyzer — dedup by image_hash/video_id, ranking, diagnosis"
```

---

### Task 7: Saturation Detector

**Files:**

- Create: `packages/ad-optimizer/src/saturation-detector.ts`
- Create: `packages/ad-optimizer/src/__tests__/saturation-detector.test.ts`

- [ ] **Step 1: Write failing tests for saturation detector**

```typescript
// packages/ad-optimizer/src/__tests__/saturation-detector.test.ts
import { describe, it, expect } from "vitest";
import { detectSaturation } from "../saturation-detector.js";
import type { MetricTrendSchema as MetricTrend } from "@switchboard/schemas";

function makeTrend(
  metric: string,
  direction: "rising" | "falling" | "stable",
  consecutiveWeeks: number,
): MetricTrend {
  return {
    metric,
    direction,
    consecutiveWeeks,
    tier: consecutiveWeeks >= 3 ? "confirmed" : consecutiveWeeks >= 1 ? "alert" : "stable",
    projectedBreachWeeks: null,
  };
}

describe("detectSaturation", () => {
  it("detects audience saturation when frequency rising 2+ weeks + CTR declining", () => {
    const trends = [makeTrend("frequency", "rising", 3), makeTrend("ctr", "falling", 2)];
    const signals = detectSaturation("adset_1", trends, null, null);
    const saturation = signals.find((s) => s.pattern === "audience_saturation");
    expect(saturation).toBeDefined();
    expect(saturation!.confidence).toBe("high");
  });

  it("does not detect saturation when frequency is stable", () => {
    const trends = [makeTrend("frequency", "stable", 0), makeTrend("ctr", "falling", 2)];
    const signals = detectSaturation("adset_1", trends, null, null);
    const saturation = signals.find((s) => s.pattern === "audience_saturation");
    expect(saturation).toBeUndefined();
  });

  it("detects campaign decay when conversion rate declines over 4+ weeks", () => {
    const trends: MetricTrend[] = [];
    const conversionRates = [0.05, 0.045, 0.035, 0.028, 0.02];
    const signals = detectSaturation("adset_1", trends, null, conversionRates);
    const decay = signals.find((s) => s.pattern === "campaign_decay");
    expect(decay).toBeDefined();
    expect(decay!.confidence).toBe("medium");
  });

  it("includes audience reached ratio when provided", () => {
    const trends = [makeTrend("frequency", "rising", 2), makeTrend("ctr", "falling", 2)];
    const signals = detectSaturation("adset_1", trends, 0.75, null);
    const saturation = signals.find((s) => s.pattern === "audience_saturation");
    expect(saturation).toBeDefined();
    expect(saturation!.audienceReachedRatio).toBe(0.75);
  });

  it("returns empty array when no saturation signals", () => {
    const trends = [makeTrend("frequency", "stable", 0), makeTrend("ctr", "stable", 0)];
    const signals = detectSaturation("adset_1", trends, null, null);
    expect(signals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- saturation-detector`
Expected: FAIL

- [ ] **Step 3: Implement saturation detector**

```typescript
// packages/ad-optimizer/src/saturation-detector.ts
import type {
  MetricTrendSchema as MetricTrend,
  SaturationSignalSchema as SaturationSignal,
} from "@switchboard/schemas";

const MIN_FREQUENCY_WEEKS = 2;
const MIN_DECAY_WEEKS = 4;
const DECAY_THRESHOLD = 0.3;

function findTrend(trends: MetricTrend[], metric: string): MetricTrend | undefined {
  return trends.find((t) => t.metric === metric);
}

export function detectSaturation(
  adSetId: string,
  trends: MetricTrend[],
  audienceReachedRatio: number | null,
  weeklyConversionRates: number[] | null,
): SaturationSignal[] {
  const signals: SaturationSignal[] = [];

  const freqTrend = findTrend(trends, "frequency");
  const ctrTrend = findTrend(trends, "ctr");

  const frequencyRising =
    freqTrend != null &&
    freqTrend.direction === "rising" &&
    freqTrend.consecutiveWeeks >= MIN_FREQUENCY_WEEKS;
  const ctrDeclining = ctrTrend != null && ctrTrend.direction === "falling";

  if (frequencyRising && ctrDeclining) {
    const signalList = [
      `Frequency rising ${freqTrend!.consecutiveWeeks} consecutive weeks`,
      `CTR declining ${ctrTrend!.consecutiveWeeks} consecutive weeks`,
    ];
    if (audienceReachedRatio != null) {
      signalList.push(`Audience reached ratio: ${(audienceReachedRatio * 100).toFixed(0)}%`);
    }

    signals.push({
      adSetId,
      pattern: "audience_saturation",
      confidence: "high",
      signals: signalList,
      audienceReachedRatio,
      conversionRateDecline: null,
    });
  }

  if (weeklyConversionRates != null && weeklyConversionRates.length >= MIN_DECAY_WEEKS + 1) {
    const week1 = weeklyConversionRates[0]!;
    const currentWeek = weeklyConversionRates[weeklyConversionRates.length - 1]!;

    if (week1 > 0) {
      const decline = (week1 - currentWeek) / week1;
      if (decline >= DECAY_THRESHOLD) {
        signals.push({
          adSetId,
          pattern: "campaign_decay",
          confidence: "medium",
          signals: [
            `Conversion rate declined ${(decline * 100).toFixed(0)}% from week 1 (${(week1 * 100).toFixed(1)}%) to current (${(currentWeek * 100).toFixed(1)}%)`,
          ],
          audienceReachedRatio: null,
          conversionRateDecline: decline,
        });
      }
    }
  }

  return signals;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- saturation-detector`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ad-optimizer): saturation detector — multi-signal, replaces frequency > 3.5 threshold"
```

---

### Task 8: Update Metric Diagnostician

**Files:**

- Modify: `packages/ad-optimizer/src/metric-diagnostician.ts`
- Modify: `packages/ad-optimizer/src/__tests__/metric-diagnostician.test.ts`

- [ ] **Step 1: Write failing tests for updated patterns**

Add new tests to `packages/ad-optimizer/src/__tests__/metric-diagnostician.test.ts`:

```typescript
// Add to existing describe("diagnose") block:

it("detects creative_fatigue without fixed frequency threshold — uses trend direction", () => {
  const deltas: MetricDelta[] = [
    makeDelta("cpm", 10, 10, "stable", false),
    makeDelta("ctr", 1.0, 2.0, "down", true),
    makeDelta("cpa", 30, 20, "up", true),
    makeDelta("frequency", 2.8, 2.0, "up", true),
  ];

  const result = diagnose(deltas);
  const patterns = result.map((d) => d.pattern);
  expect(patterns).toContain("creative_fatigue");
});

it("does not require frequency > 3.5 for creative_fatigue", () => {
  const deltas: MetricDelta[] = [
    makeDelta("cpm", 10, 10, "stable", false),
    makeDelta("ctr", 1.0, 2.0, "down", true),
    makeDelta("cpa", 30, 20, "up", true),
    makeDelta("frequency", 2.5, 1.8, "up", true),
  ];

  const result = diagnose(deltas);
  const fatigue = result.find((d) => d.pattern === "creative_fatigue");
  expect(fatigue).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- metric-diagnostician`
Expected: FAIL (current code requires frequency > 3.5)

- [ ] **Step 3: Update diagnostician rules to remove hardcoded frequency threshold**

In `packages/ad-optimizer/src/metric-diagnostician.ts`, update the `creative_fatigue` rule:

Replace the `match` function for creative_fatigue with:

```typescript
match: (map) => {
  const ctr = map.get("ctr");
  const freq = map.get("frequency");
  const cpa = map.get("cpa");
  const cpm = map.get("cpm");
  const ctrDownSignificant = ctr !== undefined && ctr.direction === "down" && ctr.significant;
  const freqRising = freq !== undefined && freq.direction === "up" && freq.significant;
  const cpmNotSignificant = cpm === undefined || !cpm.significant;
  const cpaRisingOrStable = cpa === undefined || cpa.direction === "up" || cpa.direction === "stable";
  return ctrDownSignificant && freqRising && cpmNotSignificant && cpaRisingOrStable;
},
```

Similarly update `audience_saturation` rule to use `freq.direction === "up" && freq.significant` instead of `freq.current > FREQUENCY_THRESHOLD`.

- [ ] **Step 4: Update existing tests that relied on frequency > 3.5**

Update the test fixtures in `metric-diagnostician.test.ts` to use `significant: true` on frequency deltas instead of relying on the absolute value being > 3.5.

- [ ] **Step 5: Run all diagnostician tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- metric-diagnostician`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(ad-optimizer): remove hardcoded frequency 3.5 threshold — use trend direction instead"
```

---

### Task 9: Update Recommendation Engine

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-engine.ts`
- Modify: `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts`

- [ ] **Step 1: Write failing tests for new recommendation actions**

Add to `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts`:

```typescript
it("generates add_creative instead of kill when CPA > 2x target (daily, 7+ days)", () => {
  const input: RecommendationInput = {
    campaignId: "camp-1",
    campaignName: "Test Campaign",
    diagnoses: [],
    deltas: [makeDelta("cpa", 250, 100, "up", true)],
    targetCPA: 100,
    targetROAS: 3,
    currentSpend: 5000,
    targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
  };

  const result = generateRecommendations(input);
  const addCreative = result.find((r) => r.action === "add_creative");
  expect(addCreative).toBeDefined();
  const kill = result.find((r) => r.action === "kill");
  expect(kill).toBeUndefined();
});

it("generates pause only when CPA > 3x target", () => {
  const input: RecommendationInput = {
    campaignId: "camp-extreme",
    campaignName: "Extreme CPA",
    diagnoses: [],
    deltas: [makeDelta("cpa", 350, 100, "up", true)],
    targetCPA: 100,
    targetROAS: 3,
    currentSpend: 5000,
    targetBreach: { periodsAboveTarget: 10, granularity: "daily", isApproximate: false },
  };

  const result = generateRecommendations(input);
  const pause = result.find((r) => r.action === "pause");
  expect(pause).toBeDefined();
});

it("adds learning phase reset warning to restructure recommendations", () => {
  const input: RecommendationInput = {
    campaignId: "camp-sat",
    campaignName: "Saturated",
    diagnoses: [{ pattern: "audience_saturation", description: "saturated", confidence: "high" }],
    deltas: [makeDelta("cpa", 90, 80, "up", false)],
    targetCPA: 100,
    targetROAS: 3,
    currentSpend: 2000,
    targetBreach: { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
  };

  const result = generateRecommendations(input);
  const restructure = result.find((r) => r.action === "restructure");
  expect(restructure).toBeDefined();
  expect(restructure!.learningPhaseImpact).toBe("will reset learning");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- recommendation-engine`
Expected: FAIL

- [ ] **Step 3: Update recommendation engine**

In `packages/ad-optimizer/src/recommendation-engine.ts`:

1. Replace the `kill` action at 2x CPA with `add_creative` action
2. Add new `pause` action at 3x CPA (extreme cases only)
3. Update the `RecommendationActionSchema` import to include new actions
4. Add learning phase impact warnings to restructure recommendations

Key changes:

- `KILL_CPA_MULTIPLIER = 2` becomes `ADD_CREATIVE_CPA_MULTIPLIER = 2`
- New `PAUSE_CPA_MULTIPLIER = 3` for extreme cases
- `addKillRecommendation` becomes `addCreativeRecommendation` with steps: "Add fresh creatives alongside existing", "Reduce budget on underperforming ads once replacements deliver"
- New `addPauseRecommendation` for CPA > 3x target only

- [ ] **Step 4: Update existing tests that reference "kill" action**

Replace all `action === "kill"` checks with `action === "add_creative"` or `action === "pause"` as appropriate. Update test names to match new terminology.

- [ ] **Step 5: Run all recommendation engine tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- recommendation-engine`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ad-optimizer): revised recommendation actions — add_creative replaces kill, pause for extreme only"
```

---

### Task 10: Audit Runner V2 Integration

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts`
- Modify: `packages/ad-optimizer/src/__tests__/audit-runner.test.ts`
- Modify: `packages/ad-optimizer/src/index.ts`

- [ ] **Step 1: Write failing tests for V2 audit report sections**

Add to `packages/ad-optimizer/src/__tests__/audit-runner.test.ts`:

```typescript
it("includes adSetDetails in audit report", async () => {
  const deps = buildMockDeps();
  const runner = new AuditRunner(deps);
  const report = await runner.run({
    dateRange: { since: "2026-03-01", until: "2026-03-31" },
    previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
  });

  expect(report.adSetDetails).toBeDefined();
  expect(Array.isArray(report.adSetDetails)).toBe(true);
});

it("includes trends in audit report", async () => {
  const deps = buildMockDeps();
  const runner = new AuditRunner(deps);
  const report = await runner.run({
    dateRange: { since: "2026-03-01", until: "2026-03-31" },
    previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
  });

  expect(report.trends).toBeDefined();
});

it("includes budgetDistribution in audit report", async () => {
  const deps = buildMockDeps();
  const runner = new AuditRunner(deps);
  const report = await runner.run({
    dateRange: { since: "2026-03-01", until: "2026-03-31" },
    previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
  });

  expect(report.budgetDistribution).toBeDefined();
});

it("returns funnel as array with detected shapes", async () => {
  const deps = buildMockDeps();
  const runner = new AuditRunner(deps);
  const report = await runner.run({
    dateRange: { since: "2026-03-01", until: "2026-03-31" },
    previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
  });

  expect(Array.isArray(report.funnel)).toBe(true);
  expect(report.funnel.length).toBeGreaterThan(0);
  expect(report.funnel[0]!.funnelShape).toBeDefined();
});

it("tracks adSetsInLearning and adSetsLearningLimited in summary", async () => {
  const deps = buildMockDeps();
  const runner = new AuditRunner(deps);
  const report = await runner.run({
    dateRange: { since: "2026-03-01", until: "2026-03-31" },
    previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
  });

  expect(typeof report.summary.adSetsInLearning).toBe("number");
  expect(typeof report.summary.adSetsLearningLimited).toBe("number");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- audit-runner`
Expected: FAIL

- [ ] **Step 3: Update AuditRunner to orchestrate V2 modules**

Modify `packages/ad-optimizer/src/audit-runner.ts` to:

1. Import the new modules: `LearningPhaseGuardV2`, `detectFunnelShape`, `detectTrends`, `analyzeBudgetDistribution`, `detectSaturation`
2. Add ad set insights fetch in the parallel data pull (Step 1)
3. Replace campaign-level learning phase with ad set-level via `LearningPhaseGuardV2.classifyState()`
4. Group ad sets by `destination_type` and detect funnel shape per group
5. Pass trend data from the trend engine into the recommendation engine
6. Compute budget distribution from campaign insights
7. Assemble the expanded `AuditReport` with new sections

The `AuditDependencies` interface gains:

```typescript
getAdSetInsights(params: {
  dateRange: { since: string; until: string };
  fields: string[];
}): Promise<AdSetLearningInput[]>;

getTrendData(params: {
  campaignId: string;
}): Promise<{ day30: MetricSnapshot; day60: MetricSnapshot; day90: MetricSnapshot; weekly: MetricSnapshot[] }>;
```

- [ ] **Step 4: Update mock dependencies in test to provide V2 data**

Add mock implementations for `getAdSetInsights` and `getTrendData` to the test's `buildMockDeps()`.

- [ ] **Step 5: Run all audit runner tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- audit-runner`
Expected: PASS

- [ ] **Step 6: Update index.ts exports**

Add exports for all new modules:

```typescript
export { LearningPhaseGuardV2 } from "./learning-phase-guard.js";
export { detectFunnelShape, getFunnelStageTemplate } from "./funnel-detector.js";
export { detectTrends, projectBreach, classifyTrendTier } from "./trend-engine.js";
export { analyzeBudgetDistribution, detectCBO } from "./budget-analyzer.js";
export { analyzeCreatives, deduplicateCreatives } from "./creative-analyzer.js";
export { detectSaturation } from "./saturation-detector.js";
```

- [ ] **Step 7: Run full test suite**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test`
Expected: ALL PASS

- [ ] **Step 8: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(ad-optimizer): V2 audit runner integration — trends, budget, ad set details, funnel shapes"
```

---

### Task 11: Update Ads Analytics Tool

**Files:**

- Modify: `apps/api/src/tools/ad-optimizer/ads-analytics.ts`
- Modify: `apps/api/src/tools/ad-optimizer/ads-analytics.test.ts`

- [ ] **Step 1: Add V2 operations to the ads-analytics skill tool**

Add new operations to the `createAdsAnalyticsTool()` return value:

```typescript
"detect-saturation": {
  description: "Detect audience saturation, creative fatigue, or campaign decay signals for an ad set.",
  effectCategory: TIER,
  idempotent: true,
  inputSchema: {
    type: "object",
    properties: {
      adSetId: { type: "string" },
      trends: { type: "array" },
      audienceReachedRatio: { type: "number", nullable: true },
      weeklyConversionRates: { type: "array", items: { type: "number" }, nullable: true },
    },
    required: ["adSetId", "trends"],
  },
  execute: async (params: unknown) => {
    const { adSetId, trends, audienceReachedRatio, weeklyConversionRates } = params as {
      adSetId: string;
      trends: MetricTrend[];
      audienceReachedRatio: number | null;
      weeklyConversionRates: number[] | null;
    };
    const signals = detectSaturation(adSetId, trends, audienceReachedRatio ?? null, weeklyConversionRates ?? null);
    return ok({ signals });
  },
},

"analyze-creatives": {
  description: "Analyze creative-level performance for a campaign. Returns ranking, diagnoses, and recommendations.",
  effectCategory: TIER,
  idempotent: true,
  inputSchema: {
    type: "object",
    properties: {
      campaignId: { type: "string" },
      creativeEntries: { type: "array" },
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
```

- [ ] **Step 2: Write tests for new operations**

- [ ] **Step 3: Run tests**

Run: `npx pnpm@9.15.4 --filter api test -- ads-analytics`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): expose V2 ad optimizer operations — saturation detection, creative analysis"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx pnpm@9.15.4 test`
Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`
Expected: PASS

- [ ] **Step 4: Verify file sizes are under 400 lines**

Check that no new file exceeds the 400-line warning threshold.

- [ ] **Step 5: Commit any final fixes**

```bash
git commit -m "chore: ad optimizer V2 final verification — all checks pass"
```
