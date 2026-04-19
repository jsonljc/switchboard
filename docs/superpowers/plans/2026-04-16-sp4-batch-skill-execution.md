# SP4: Batch Skill Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize batch skill execution for per-deployment async workflows, starting with ad-optimizer, using the same governance, tracing, and orchestration patterns from SP1–SP3.

**Architecture:** Two-layer split. Layer 1: Inngest dispatches one event per eligible deployment (thin dispatcher). Layer 2: `BatchSkillHandler` executes one skill run per deployment, loads context via typed contract, runs the skill through the existing executor, routes proposed writes through governance, and emits a `batch_job` trace. The ad-optimizer proves the pattern.

**Tech Stack:** TypeScript (ESM), Vitest, Zod, Anthropic SDK, Inngest, existing ad-optimizer pure functions wrapped as tools.

**Spec:** `docs/superpowers/specs/2026-04-16-sp4-batch-skill-execution-design.md`

---

### Task 1: Batch Types — Context Contract, Result, Handler Interface

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`
- Create: `packages/core/src/skill-runtime/batch-types.ts`
- Create: `packages/core/src/skill-runtime/batch-types.test.ts`

The foundational types for batch execution. Every subsequent task depends on these.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/batch-types.test.ts
import { describe, it, expect } from "vitest";
import type {
  BatchContextRequirement,
  BatchContextContract,
  BatchSkillResult,
  BatchExecutionConfig,
} from "./batch-types.js";
import { validateBatchSkillResult } from "./batch-types.js";

describe("BatchContextRequirement", () => {
  it("accepts a valid requirement with scope", () => {
    const req: BatchContextRequirement = {
      key: "campaign_insights",
      source: "ads",
      freshnessSeconds: 3600,
      scope: "current_period",
    };
    expect(req.source).toBe("ads");
    expect(req.scope).toBe("current_period");
  });
});

describe("BatchContextContract", () => {
  it("accepts a contract with multiple requirements", () => {
    const contract: BatchContextContract = {
      required: [
        { key: "campaign_insights", source: "ads", scope: "current_period" },
        { key: "crm_funnel_data", source: "crm" },
        { key: "deployment_config", source: "deployment", freshnessSeconds: 0 },
      ],
    };
    expect(contract.required).toHaveLength(3);
  });
});

describe("validateBatchSkillResult", () => {
  it("passes for a valid result", () => {
    const result: BatchSkillResult = {
      recommendations: [
        {
          type: "scale",
          action: "Increase budget 20%",
          confidence: "high",
          reasoning: "CPA below target",
        },
      ],
      proposedWrites: [],
      summary: "One recommendation produced.",
    };
    expect(() => validateBatchSkillResult(result)).not.toThrow();
  });

  it("throws for missing recommendations", () => {
    expect(() => validateBatchSkillResult({} as any)).toThrow("recommendations");
  });

  it("throws for missing summary", () => {
    expect(() =>
      validateBatchSkillResult({ recommendations: [], proposedWrites: [] } as any),
    ).toThrow("summary");
  });

  it("passes with proposedWrites", () => {
    const result: BatchSkillResult = {
      recommendations: [],
      proposedWrites: [
        {
          tool: "ads-data",
          operation: "send-conversion-event",
          params: {},
          governanceTier: "external_write",
        },
      ],
      summary: "No recs, one write.",
    };
    expect(() => validateBatchSkillResult(result)).not.toThrow();
  });

  it("passes with nextRunHint", () => {
    const result: BatchSkillResult = {
      recommendations: [],
      proposedWrites: [],
      summary: "Nothing to do.",
      nextRunHint: "run again in 24h",
    };
    expect(result.nextRunHint).toBe("run again in 24h");
    expect(() => validateBatchSkillResult(result)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/batch-types.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/batch-types.ts
import type { GovernanceTier } from "./governance.js";

// ── Context Contract ──

export interface BatchContextRequirement {
  key: string;
  source: "ads" | "crm" | "deployment" | "benchmark";
  freshnessSeconds?: number;
  scope?: string; // e.g. "current_period", "previous_period", "last_30d"
}

export interface BatchContextContract {
  required: BatchContextRequirement[];
}

// ── Batch Execution Config ──

export interface BatchExecutionConfig {
  deploymentId: string;
  orgId: string;
  trigger: string; // "weekly_audit" | "daily_check" | "manual"
  scheduleName?: string;
}

// ── Batch Skill Result ──

export interface BatchRecommendation {
  type: string;
  action: string;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface BatchProposedWrite {
  tool: string;
  operation: string;
  params: unknown;
  governanceTier: GovernanceTier;
}

export interface BatchSkillResult {
  recommendations: BatchRecommendation[];
  proposedWrites: BatchProposedWrite[];
  summary: string;
  nextRunHint?: string;
}

// ── Batch Parameter Builder ──

export interface BatchSkillStores {
  adsClient: {
    getCampaignInsights(params: {
      dateRange: { since: string; until: string };
      fields: string[];
    }): Promise<unknown[]>;
    getAccountSummary(): Promise<unknown>;
  };
  crmDataProvider: {
    getFunnelData(campaignIds: string[]): Promise<unknown>;
    getBenchmarks(accountId: string): Promise<unknown>;
  };
  deploymentStore: {
    findById(deploymentId: string): Promise<unknown>;
  };
}

export type BatchParameterBuilder = (
  config: BatchExecutionConfig,
  stores: BatchSkillStores,
  contract: BatchContextContract,
) => Promise<Record<string, unknown>>;

// ── Validation ──

export function validateBatchSkillResult(result: unknown): asserts result is BatchSkillResult {
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.recommendations)) {
    throw new Error("BatchSkillResult missing recommendations array");
  }
  if (!Array.isArray(r.proposedWrites)) {
    throw new Error("BatchSkillResult missing proposedWrites array");
  }
  if (typeof r.summary !== "string" || r.summary.length === 0) {
    throw new Error("BatchSkillResult missing summary string");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/batch-types.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/batch-types.ts packages/core/src/skill-runtime/batch-types.test.ts
git commit -m "feat: add batch execution types — context contract, result, parameter builder"
```

---

### Task 2: Ads Analytics Tool

**Files:**

- Create: `packages/core/src/skill-runtime/tools/ads-analytics.ts`
- Create: `packages/core/src/skill-runtime/tools/ads-analytics.test.ts`
- Modify: `packages/core/src/skill-runtime/tools/index.ts`

Wraps 4 existing pure functions from `ad-optimizer/`. All `read` tier, all idempotent.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/tools/ads-analytics.test.ts
import { describe, it, expect } from "vitest";
import { createAdsAnalyticsTool } from "./ads-analytics.js";

describe("ads-analytics tool", () => {
  const tool = createAdsAnalyticsTool();

  it("has correct id", () => {
    expect(tool.id).toBe("ads-analytics");
  });

  it("has 4 operations", () => {
    expect(Object.keys(tool.operations)).toEqual([
      "diagnose",
      "compare-periods",
      "analyze-funnel",
      "check-learning-phase",
    ]);
  });

  it("all operations have governanceTier read", () => {
    for (const op of Object.values(tool.operations)) {
      expect(op.governanceTier).toBe("read");
    }
  });

  describe("diagnose", () => {
    it("detects creative fatigue pattern", async () => {
      const deltas = [
        {
          metric: "ctr",
          current: 1.2,
          previous: 2.0,
          deltaPercent: -40,
          direction: "down",
          significant: true,
        },
        {
          metric: "frequency",
          current: 4.0,
          previous: 3.0,
          deltaPercent: 33,
          direction: "up",
          significant: true,
        },
        {
          metric: "cpm",
          current: 10,
          previous: 9.5,
          deltaPercent: 5,
          direction: "up",
          significant: false,
        },
      ];
      const result = (await tool.operations["diagnose"]!.execute({ deltas })) as {
        diagnoses: unknown[];
      };
      expect(result.diagnoses).toContainEqual(
        expect.objectContaining({ pattern: "creative_fatigue" }),
      );
    });

    it("returns empty for healthy metrics", async () => {
      const deltas = [
        {
          metric: "ctr",
          current: 2.0,
          previous: 2.0,
          deltaPercent: 0,
          direction: "stable",
          significant: false,
        },
        {
          metric: "cpa",
          current: 50,
          previous: 55,
          deltaPercent: -9,
          direction: "down",
          significant: false,
        },
      ];
      const result = (await tool.operations["diagnose"]!.execute({ deltas })) as {
        diagnoses: unknown[];
      };
      expect(result.diagnoses).toHaveLength(0);
    });
  });

  describe("compare-periods", () => {
    it("computes deltas for all metrics", async () => {
      const current = { cpm: 10, ctr: 2, cpc: 5, cpl: 50, cpa: 100, roas: 3, frequency: 2 };
      const previous = { cpm: 8, ctr: 2.5, cpc: 4, cpl: 40, cpa: 80, roas: 3.5, frequency: 1.5 };
      const result = (await tool.operations["compare-periods"]!.execute({ current, previous })) as {
        deltas: unknown[];
      };
      expect(result.deltas).toHaveLength(7);
    });
  });

  describe("analyze-funnel", () => {
    it("identifies leakage point", async () => {
      const result = (await tool.operations["analyze-funnel"]!.execute({
        insights: [
          {
            campaignId: "c1",
            campaignName: "C1",
            status: "ACTIVE",
            impressions: 10000,
            clicks: 200,
            spend: 500,
            conversions: 5,
            revenue: 1000,
            frequency: 2,
          },
        ],
        crmData: { leads: 5, qualified: 1, closed: 0, revenue: 0 },
        benchmarks: {
          ctr: 2,
          landingPageViewRate: 0.8,
          leadRate: 0.05,
          qualificationRate: 0.3,
          closeRate: 0.2,
        },
      })) as { leakagePoint: string };
      expect(result.leakagePoint).toBeDefined();
    });
  });

  describe("check-learning-phase", () => {
    it("detects campaign in learning", async () => {
      const result = (await tool.operations["check-learning-phase"]!.execute({
        campaignId: "c1",
        input: {
          effectiveStatus: "ACTIVE",
          learningPhase: true,
          lastModifiedDays: 2,
          optimizationEvents: 10,
        },
      })) as { inLearning: boolean };
      expect(result.inLearning).toBe(true);
    });

    it("detects campaign not in learning", async () => {
      const result = (await tool.operations["check-learning-phase"]!.execute({
        campaignId: "c1",
        input: {
          effectiveStatus: "ACTIVE",
          learningPhase: false,
          lastModifiedDays: 14,
          optimizationEvents: 100,
        },
      })) as { inLearning: boolean };
      expect(result.inLearning).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/ads-analytics.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/tools/ads-analytics.ts
import type { SkillTool } from "../types.js";
import type { GovernanceTier } from "../governance.js";
import { diagnose } from "../../ad-optimizer/metric-diagnostician.js";
import { comparePeriods, type MetricSet } from "../../ad-optimizer/period-comparator.js";
import { analyzeFunnel } from "../../ad-optimizer/funnel-analyzer.js";
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
          const { deltas } = params as { deltas: unknown[] };
          return { diagnoses: diagnose(deltas as any) };
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
            current: { type: "object", description: "MetricSet for current period" },
            previous: { type: "object", description: "MetricSet for previous period" },
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
          const { insights, crmData, benchmarks } = params as Record<string, unknown>;
          return analyzeFunnel({ insights, crmData, benchmarks } as any);
        },
      },

      "check-learning-phase": {
        description:
          "Check if a campaign is in Meta's learning phase. Returns learning status with estimated exit.",
        governanceTier: TIER,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            campaignId: { type: "string" },
            input: { type: "object", description: "CampaignLearningInput" },
          },
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
```

- [ ] **Step 4: Update tools barrel export**

Add to `packages/core/src/skill-runtime/tools/index.ts`:

```typescript
export { createAdsAnalyticsTool } from "./ads-analytics.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/ads-analytics.test.ts`
Expected: PASS (~8 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/tools/ads-analytics.ts packages/core/src/skill-runtime/tools/ads-analytics.test.ts packages/core/src/skill-runtime/tools/index.ts
git commit -m "feat: add ads-analytics tool wrapping existing ad-optimizer analysis functions"
```

---

### Task 3: Ads Data Tool

**Files:**

- Create: `packages/core/src/skill-runtime/tools/ads-data.ts`
- Create: `packages/core/src/skill-runtime/tools/ads-data.test.ts`
- Modify: `packages/core/src/skill-runtime/tools/index.ts`

Wraps `meta-ads-client`, `meta-capi-client`, and `meta-leads-ingester`. Mixed governance tiers.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/tools/ads-data.test.ts
import { describe, it, expect, vi } from "vitest";
import { createAdsDataTool } from "./ads-data.js";

const mockAdsClient = {
  getCampaignInsights: vi.fn().mockResolvedValue([{ campaignId: "c1", spend: 100 }]),
  getAdSetInsights: vi.fn().mockResolvedValue([]),
  getAccountSummary: vi.fn().mockResolvedValue({ accountId: "a1", totalSpend: 1000 }),
};

const mockCAPIClient = {
  sendEvent: vi.fn().mockResolvedValue({ success: true }),
};

describe("ads-data tool", () => {
  const tool = createAdsDataTool({ adsClient: mockAdsClient, capiClient: mockCAPIClient });

  it("has correct id", () => {
    expect(tool.id).toBe("ads-data");
  });

  it("has 4 operations", () => {
    expect(Object.keys(tool.operations)).toEqual([
      "get-campaign-insights",
      "get-account-summary",
      "send-conversion-event",
      "parse-lead-webhook",
    ]);
  });

  it("read operations have read tier", () => {
    expect(tool.operations["get-campaign-insights"]!.governanceTier).toBe("read");
    expect(tool.operations["get-account-summary"]!.governanceTier).toBe("read");
    expect(tool.operations["parse-lead-webhook"]!.governanceTier).toBe("read");
  });

  it("send-conversion-event has external_write tier", () => {
    expect(tool.operations["send-conversion-event"]!.governanceTier).toBe("external_write");
  });

  describe("get-campaign-insights", () => {
    it("calls adsClient and returns results", async () => {
      const result = await tool.operations["get-campaign-insights"]!.execute({
        dateRange: { since: "2026-04-01", until: "2026-04-07" },
        fields: ["campaign_id", "spend"],
      });
      expect(mockAdsClient.getCampaignInsights).toHaveBeenCalled();
      expect((result as any).insights).toHaveLength(1);
    });
  });

  describe("get-account-summary", () => {
    it("calls adsClient and returns summary", async () => {
      const result = await tool.operations["get-account-summary"]!.execute({});
      expect(mockAdsClient.getAccountSummary).toHaveBeenCalled();
      expect((result as any).accountId).toBe("a1");
    });
  });

  describe("send-conversion-event", () => {
    it("calls capiClient", async () => {
      const result = await tool.operations["send-conversion-event"]!.execute({
        eventName: "Lead",
        eventTime: 1234567890,
        userData: { em: "hash" },
      });
      expect(mockCAPIClient.sendEvent).toHaveBeenCalled();
      expect((result as any).success).toBe(true);
    });
  });

  describe("parse-lead-webhook", () => {
    it("parses lead data from webhook payload", async () => {
      const result = await tool.operations["parse-lead-webhook"]!.execute({
        payload: { leadgen_id: "123", page_id: "p1" },
      });
      expect(result).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/ads-data.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/tools/ads-data.ts
import type { SkillTool } from "../types.js";
import type { GovernanceTier } from "../governance.js";
import { parseLeadWebhook } from "../../ad-optimizer/meta-leads-ingester.js";

interface AdsDataDeps {
  adsClient: {
    getCampaignInsights(params: {
      dateRange: { since: string; until: string };
      fields: string[];
    }): Promise<unknown[]>;
    getAdSetInsights?(params: {
      dateRange: { since: string; until: string };
      fields: string[];
    }): Promise<unknown[]>;
    getAccountSummary(): Promise<unknown>;
  };
  capiClient: {
    sendEvent(params: unknown): Promise<unknown>;
  };
}

export function createAdsDataTool(deps: AdsDataDeps): SkillTool {
  return {
    id: "ads-data",
    operations: {
      "get-campaign-insights": {
        description: "Fetch campaign performance insights from Meta Ads API for a date range.",
        governanceTier: "read" as GovernanceTier,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: {
            dateRange: {
              type: "object",
              properties: { since: { type: "string" }, until: { type: "string" } },
            },
            fields: { type: "array", items: { type: "string" } },
          },
          required: ["dateRange", "fields"],
        },
        execute: async (params: unknown) => {
          const { dateRange, fields } = params as {
            dateRange: { since: string; until: string };
            fields: string[];
          };
          const insights = await deps.adsClient.getCampaignInsights({ dateRange, fields });
          return { insights };
        },
      },

      "get-account-summary": {
        description: "Fetch account-level summary metrics from Meta Ads API.",
        governanceTier: "read" as GovernanceTier,
        idempotent: true,
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          return deps.adsClient.getAccountSummary();
        },
      },

      "send-conversion-event": {
        description:
          "Send a conversion event to Meta CAPI. External write — requires governance approval.",
        governanceTier: "external_write" as GovernanceTier,
        idempotent: false,
        inputSchema: {
          type: "object",
          properties: {
            eventName: { type: "string" },
            eventTime: { type: "number" },
            userData: { type: "object" },
          },
          required: ["eventName", "eventTime"],
        },
        execute: async (params: unknown) => {
          return deps.capiClient.sendEvent(params);
        },
      },

      "parse-lead-webhook": {
        description: "Parse a Meta lead webhook payload into structured lead data.",
        governanceTier: "read" as GovernanceTier,
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: { payload: { type: "object" } },
          required: ["payload"],
        },
        execute: async (params: unknown) => {
          const { payload } = params as { payload: unknown };
          return parseLeadWebhook(payload as any);
        },
      },
    },
  };
}
```

- [ ] **Step 4: Update tools barrel export**

Add to `packages/core/src/skill-runtime/tools/index.ts`:

```typescript
export { createAdsDataTool } from "./ads-data.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/tools/ads-data.test.ts`
Expected: PASS (~7 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/tools/ads-data.ts packages/core/src/skill-runtime/tools/ads-data.test.ts packages/core/src/skill-runtime/tools/index.ts
git commit -m "feat: add ads-data tool wrapping Meta Ads API + CAPI + lead webhook"
```

---

### Task 4: BatchSkillHandler

**Files:**

- Create: `packages/core/src/skill-runtime/batch-skill-handler.ts`
- Create: `packages/core/src/skill-runtime/batch-skill-handler.test.ts`

The core batch execution handler. Loads context, runs skill, routes writes, emits trace.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/batch-skill-handler.test.ts
import { describe, it, expect, vi } from "vitest";
import { BatchSkillHandler } from "./batch-skill-handler.js";
import type {
  BatchParameterBuilder,
  BatchSkillStores,
  BatchContextContract,
} from "./batch-types.js";
import type { SkillDefinition, SkillExecutor } from "./types.js";

const mockSkill: SkillDefinition = {
  name: "test-batch",
  slug: "test-batch",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [{ name: "DATA", type: "object", required: true }],
  tools: [],
  body: "Analyze {{DATA}}",
};

const mockContract: BatchContextContract = {
  required: [{ key: "data", source: "ads" }],
};

const mockStores: BatchSkillStores = {
  adsClient: { getCampaignInsights: vi.fn(), getAccountSummary: vi.fn() },
  crmDataProvider: { getFunnelData: vi.fn(), getBenchmarks: vi.fn() },
  deploymentStore: { findById: vi.fn() },
};

function makeExecutor(response: string) {
  return {
    execute: vi.fn().mockResolvedValue({
      response,
      toolCalls: [],
      tokenUsage: { input: 100, output: 50 },
      trace: {
        durationMs: 500,
        turnCount: 1,
        status: "success",
        responseSummary: response.slice(0, 500),
        writeCount: 0,
        governanceDecisions: [],
      },
    }),
  };
}

describe("BatchSkillHandler", () => {
  it("calls builder, executor, and returns parsed result", async () => {
    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: { foo: "bar" } });
    const resultJson = JSON.stringify({
      recommendations: [
        { type: "scale", action: "Scale up", confidence: "high", reasoning: "CPA low" },
      ],
      proposedWrites: [],
      summary: "One rec.",
    });
    const executor = makeExecutor(resultJson);

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map(),
      trustLevel: "guided",
      trustScore: 50,
    });

    const result = await handler.execute({
      deploymentId: "d1",
      orgId: "org1",
      trigger: "weekly_audit",
    });

    expect(builder).toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalled();
    expect(result.recommendations).toHaveLength(1);
    expect(result.summary).toBe("One rec.");
  });

  it("returns empty result when executor returns non-JSON", async () => {
    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: {} });
    const executor = makeExecutor("I could not complete the analysis.");

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map(),
      trustLevel: "guided",
      trustScore: 50,
    });

    const result = await handler.execute({
      deploymentId: "d1",
      orgId: "org1",
      trigger: "weekly_audit",
    });

    expect(result.recommendations).toHaveLength(0);
    expect(result.summary).toContain("could not");
  });

  it("routes auto-approved writes through tool execution", async () => {
    const mockTool = {
      id: "test-tool",
      operations: {
        "do-write": {
          description: "write",
          governanceTier: "internal_write" as const,
          inputSchema: {},
          execute: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    };

    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: {} });
    const resultJson = JSON.stringify({
      recommendations: [],
      proposedWrites: [
        {
          tool: "test-tool",
          operation: "do-write",
          params: { x: 1 },
          governanceTier: "internal_write",
        },
      ],
      summary: "One write.",
    });
    const executor = makeExecutor(resultJson);

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map([["test-tool", mockTool]]),
      trustLevel: "autonomous",
      trustScore: 80,
    });

    const result = await handler.execute({
      deploymentId: "d1",
      orgId: "org1",
      trigger: "weekly_audit",
    });

    expect(mockTool.operations["do-write"].execute).toHaveBeenCalledWith({ x: 1 });
    expect(result.executedWrites).toBe(1);
  });

  it("skips denied writes", async () => {
    const mockTool = {
      id: "dangerous",
      operations: {
        destroy: {
          description: "destroy",
          governanceTier: "destructive" as const,
          inputSchema: {},
          execute: vi.fn(),
        },
      },
    };

    const builder: BatchParameterBuilder = vi.fn().mockResolvedValue({ DATA: {} });
    const resultJson = JSON.stringify({
      recommendations: [],
      proposedWrites: [
        { tool: "dangerous", operation: "destroy", params: {}, governanceTier: "destructive" },
      ],
      summary: "Denied write.",
    });
    const executor = makeExecutor(resultJson);

    const handler = new BatchSkillHandler({
      skill: mockSkill,
      executor: executor as unknown as SkillExecutor,
      builder,
      stores: mockStores,
      contract: mockContract,
      tools: new Map([["dangerous", mockTool]]),
      trustLevel: "supervised",
      trustScore: 10,
    });

    const result = await handler.execute({
      deploymentId: "d1",
      orgId: "org1",
      trigger: "weekly_audit",
    });

    expect(mockTool.operations["destroy"].execute).not.toHaveBeenCalled();
    expect(result.executedWrites).toBe(0);
    expect(result.deniedWrites).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/batch-skill-handler.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/batch-skill-handler.ts
import type { SkillDefinition, SkillExecutor, SkillTool } from "./types.js";
import type {
  BatchParameterBuilder,
  BatchSkillStores,
  BatchContextContract,
  BatchExecutionConfig,
  BatchSkillResult,
} from "./batch-types.js";
import { validateBatchSkillResult } from "./batch-types.js";
import { getToolGovernanceDecision, mapDecisionToOutcome } from "./governance.js";
import type { TrustLevel } from "./governance.js";

interface BatchSkillHandlerConfig {
  skill: SkillDefinition;
  executor: SkillExecutor;
  builder: BatchParameterBuilder;
  stores: BatchSkillStores;
  contract: BatchContextContract;
  tools: Map<string, SkillTool>;
  trustLevel: TrustLevel;
  trustScore: number;
}

interface BatchExecutionResult extends BatchSkillResult {
  executedWrites: number;
  deniedWrites: number;
  pendingApprovalWrites: number;
  traceData: {
    durationMs: number;
    turnCount: number;
    status: string;
    tokenUsage: { input: number; output: number };
  };
}

export class BatchSkillHandler {
  constructor(private config: BatchSkillHandlerConfig) {}

  async execute(execConfig: BatchExecutionConfig): Promise<BatchExecutionResult> {
    const startMs = Date.now();

    // 1. Load context via builder
    const parameters = await this.config.builder(
      execConfig,
      this.config.stores,
      this.config.contract,
    );

    // 2. Run skill via executor
    const executionResult = await this.config.executor.execute({
      skill: this.config.skill,
      parameters,
      messages: [{ role: "user", content: `Execute batch: ${execConfig.trigger}` }],
      deploymentId: execConfig.deploymentId,
      orgId: execConfig.orgId,
      trustScore: this.config.trustScore,
      trustLevel: this.config.trustLevel,
    });

    // 3. Parse structured result from response
    let batchResult: BatchSkillResult;
    try {
      const parsed = JSON.parse(executionResult.response);
      validateBatchSkillResult(parsed);
      batchResult = parsed;
    } catch {
      // LLM returned non-JSON or invalid structure — return as summary with no recs
      batchResult = {
        recommendations: [],
        proposedWrites: [],
        summary: executionResult.response.slice(0, 500),
      };
    }

    // 4. Route proposed writes through governance — sequentially
    let executedWrites = 0;
    let deniedWrites = 0;
    let pendingApprovalWrites = 0;

    for (const write of batchResult.proposedWrites) {
      const tool = this.config.tools.get(write.tool);
      const op = tool?.operations[write.operation];

      if (!op) {
        deniedWrites++;
        continue;
      }

      const decision = getToolGovernanceDecision(op, this.config.trustLevel);

      if (decision === "auto-approve") {
        try {
          await op.execute(write.params);
          executedWrites++;
        } catch {
          // Write failed — stop sequential execution
          break;
        }
      } else if (decision === "require-approval") {
        pendingApprovalWrites++;
        // TODO: persist to AgentTask with pending_approval status
      } else {
        deniedWrites++;
      }
    }

    return {
      ...batchResult,
      executedWrites,
      deniedWrites,
      pendingApprovalWrites,
      traceData: {
        durationMs: Date.now() - startMs,
        turnCount: executionResult.trace.turnCount,
        status: executionResult.trace.status,
        tokenUsage: executionResult.tokenUsage,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/batch-skill-handler.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/batch-skill-handler.ts packages/core/src/skill-runtime/batch-skill-handler.test.ts
git commit -m "feat: add BatchSkillHandler with governance-mediated write routing"
```

---

### Task 5: Ad-Optimizer BatchParameterBuilder

**Files:**

- Create: `packages/core/src/skill-runtime/builders/ad-optimizer.ts`
- Create: `packages/core/src/skill-runtime/builders/ad-optimizer.test.ts`
- Modify: `packages/core/src/skill-runtime/builders/index.ts`

Loads campaign data per the context contract and maps to skill parameters.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/skill-runtime/builders/ad-optimizer.test.ts
import { describe, it, expect, vi } from "vitest";
import { adOptimizerBuilder, AD_OPTIMIZER_CONTRACT } from "./ad-optimizer.js";

const mockStores = {
  adsClient: {
    getCampaignInsights: vi.fn().mockResolvedValue([{ campaignId: "c1", spend: 500 }]),
    getAccountSummary: vi.fn().mockResolvedValue({ accountId: "a1", totalSpend: 5000 }),
  },
  crmDataProvider: {
    getFunnelData: vi.fn().mockResolvedValue({ leads: 10, qualified: 5, closed: 2, revenue: 1000 }),
    getBenchmarks: vi.fn().mockResolvedValue({
      ctr: 2,
      landingPageViewRate: 0.8,
      leadRate: 0.05,
      qualificationRate: 0.3,
      closeRate: 0.2,
    }),
  },
  deploymentStore: {
    findById: vi.fn().mockResolvedValue({
      id: "d1",
      inputConfig: { targetCPA: 100, targetROAS: 3.0, monthlyBudget: 10000 },
      organizationId: "org1",
    }),
  },
};

const config = { deploymentId: "d1", orgId: "org1", trigger: "weekly_audit" };

describe("adOptimizerBuilder", () => {
  it("loads all context contract fields", async () => {
    const result = await adOptimizerBuilder(config, mockStores, AD_OPTIMIZER_CONTRACT);

    expect(result.CAMPAIGN_INSIGHTS).toBeDefined();
    expect(result.ACCOUNT_SUMMARY).toBeDefined();
    expect(result.CRM_FUNNEL).toBeDefined();
    expect(result.BENCHMARKS).toBeDefined();
    expect(result.DEPLOYMENT_CONFIG).toBeDefined();
  });

  it("calls adsClient for insights", async () => {
    await adOptimizerBuilder(config, mockStores, AD_OPTIMIZER_CONTRACT);
    expect(mockStores.adsClient.getCampaignInsights).toHaveBeenCalled();
  });

  it("calls deploymentStore for config", async () => {
    await adOptimizerBuilder(config, mockStores, AD_OPTIMIZER_CONTRACT);
    expect(mockStores.deploymentStore.findById).toHaveBeenCalledWith("d1");
  });
});

describe("AD_OPTIMIZER_CONTRACT", () => {
  it("has required context keys", () => {
    const keys = AD_OPTIMIZER_CONTRACT.required.map((r) => r.key);
    expect(keys).toContain("campaign_insights");
    expect(keys).toContain("account_summary");
    expect(keys).toContain("crm_funnel_data");
    expect(keys).toContain("benchmarks");
    expect(keys).toContain("deployment_config");
  });

  it("has scope on campaign insights", () => {
    const currentPeriod = AD_OPTIMIZER_CONTRACT.required.find(
      (r) => r.key === "campaign_insights" && r.scope === "current_period",
    );
    expect(currentPeriod).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/builders/ad-optimizer.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/skill-runtime/builders/ad-optimizer.ts
import type { BatchParameterBuilder, BatchContextContract } from "../batch-types.js";

const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "status",
  "impressions",
  "clicks",
  "spend",
  "conversions",
  "revenue",
  "frequency",
  "cpm",
  "ctr",
  "cpc",
];

export const AD_OPTIMIZER_CONTRACT: BatchContextContract = {
  required: [
    { key: "campaign_insights", source: "ads", scope: "current_period" },
    { key: "campaign_insights_previous", source: "ads", scope: "previous_period" },
    { key: "account_summary", source: "ads" },
    { key: "crm_funnel_data", source: "crm" },
    { key: "benchmarks", source: "benchmark" },
    { key: "deployment_config", source: "deployment", freshnessSeconds: 0 },
  ],
};

function getWeeklyDateRanges() {
  const now = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - 6);
  const prevUntil = new Date(since);
  prevUntil.setDate(prevUntil.getDate() - 1);
  const prevSince = new Date(prevUntil);
  prevSince.setDate(prevSince.getDate() - 6);
  const fmt = (d: Date) => d.toISOString().split("T")[0] ?? "";
  return {
    current: { since: fmt(since), until: fmt(until) },
    previous: { since: fmt(prevSince), until: fmt(prevUntil) },
  };
}

export const adOptimizerBuilder: BatchParameterBuilder = async (config, stores, _contract) => {
  const dateRanges = getWeeklyDateRanges();

  const [currentInsights, previousInsights, accountSummary, deployment] = await Promise.all([
    stores.adsClient.getCampaignInsights({ dateRange: dateRanges.current, fields: INSIGHT_FIELDS }),
    stores.adsClient.getCampaignInsights({
      dateRange: dateRanges.previous,
      fields: INSIGHT_FIELDS,
    }),
    stores.adsClient.getAccountSummary(),
    stores.deploymentStore.findById(config.deploymentId),
  ]);

  const dep = deployment as {
    inputConfig?: Record<string, unknown>;
    organizationId?: string;
  } | null;
  const campaignIds = (currentInsights as Array<{ campaignId: string }>).map((i) => i.campaignId);

  const [crmFunnel, benchmarks] = await Promise.all([
    stores.crmDataProvider.getFunnelData(campaignIds),
    stores.crmDataProvider.getBenchmarks(dep?.organizationId ?? config.orgId),
  ]);

  return {
    CAMPAIGN_INSIGHTS: currentInsights,
    PREVIOUS_INSIGHTS: previousInsights,
    ACCOUNT_SUMMARY: accountSummary,
    CRM_FUNNEL: crmFunnel,
    BENCHMARKS: benchmarks,
    DEPLOYMENT_CONFIG: dep?.inputConfig ?? {},
  };
};
```

- [ ] **Step 4: Update builders barrel export**

Add to `packages/core/src/skill-runtime/builders/index.ts`:

```typescript
export { adOptimizerBuilder, AD_OPTIMIZER_CONTRACT } from "./ad-optimizer.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/builders/ad-optimizer.test.ts`
Expected: PASS (~5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/builders/ad-optimizer.ts packages/core/src/skill-runtime/builders/ad-optimizer.test.ts packages/core/src/skill-runtime/builders/index.ts
git commit -m "feat: add ad-optimizer BatchParameterBuilder with typed context contract"
```

---

### Task 6: Ad-Optimizer Skill File

**Files:**

- Create: `skills/ad-optimizer.md`

The skill file defining the weekly audit process. Uses `ads-analytics` tools for deterministic analysis, LLM judgment for recommendations.

- [ ] **Step 1: Create the skill file**

Create `skills/ad-optimizer.md` with frontmatter (name, slug, version, description, author, parameters: CAMPAIGN_INSIGHTS, PREVIOUS_INSIGHTS, ACCOUNT_SUMMARY, CRM_FUNNEL, BENCHMARKS, DEPLOYMENT_CONFIG, tools: ads-analytics, output fields: recommendations, summary, confidence) and body defining the 5-step audit process:

1. Compare current vs previous period via `ads-analytics.compare-periods`
2. Diagnose anomalies via `ads-analytics.diagnose`
3. Analyze funnel health via `ads-analytics.analyze-funnel`
4. Check learning phase for each campaign via `ads-analytics.check-learning-phase`
5. Synthesize findings into prioritized recommendations with confidence levels

The skill body should instruct the LLM to produce output as a JSON object matching `BatchSkillResult`.

- [ ] **Step 2: Verify skill loads**

Add a loader test in `packages/core/src/skill-runtime/skill-loader.test.ts`:

```typescript
it("loads the ad-optimizer skill file", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
  const skill = loadSkill("ad-optimizer", join(repoRoot, "skills"));
  expect(skill.slug).toBe("ad-optimizer");
  expect(skill.tools).toEqual(["ads-analytics"]);
});
```

- [ ] **Step 3: Commit**

```bash
git add skills/ad-optimizer.md packages/core/src/skill-runtime/skill-loader.test.ts
git commit -m "feat: add ad-optimizer skill file for weekly campaign audit"
```

---

### Task 7: Thin Dispatcher (Inngest Rewrite)

**Files:**

- Modify: `packages/core/src/ad-optimizer/inngest-functions.ts`

Replace the monolithic cron loops with thin dispatchers that emit one event per deployment.

- [ ] **Step 1: Read the existing inngest-functions.ts**

Read `packages/core/src/ad-optimizer/inngest-functions.ts` to understand the current `createWeeklyAuditCron` and `createDailyCheckCron` signatures and how they're wired.

- [ ] **Step 2: Add dispatcher functions alongside existing ones**

Do NOT remove the existing functions yet — add new dispatcher variants alongside them:

```typescript
export function createWeeklyAuditDispatcher(inngestClient: InngestLike) {
  return inngestClient.createFunction(
    { id: "ad-optimizer-weekly-dispatch", triggers: [{ cron: "0 6 * * 1" }] },
    async ({ step }: { step: StepTools }) => {
      const deployments = await step.run("list-deployments", () =>
        // This will be wired by the app layer
        Promise.resolve([] as Array<{ id: string }>),
      );

      for (const deployment of deployments) {
        await step.sendEvent(`dispatch-${deployment.id}`, {
          name: "skill-runtime/batch.requested",
          data: {
            deploymentId: deployment.id,
            skillSlug: "ad-optimizer",
            trigger: "weekly_audit",
            scheduleName: "ad-optimizer-weekly",
          },
        });
      }
    },
  );
}
```

- [ ] **Step 3: Update inngest-functions.test.ts**

Add tests for the dispatcher that verify it emits one event per deployment.

- [ ] **Step 4: Run tests**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/ad-optimizer/__tests__/inngest-functions.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ad-optimizer/inngest-functions.ts packages/core/src/ad-optimizer/__tests__/inngest-functions.test.ts
git commit -m "feat: add thin batch dispatcher alongside existing ad-optimizer crons"
```

---

### Task 8: Barrel Exports + Batch Executor Inngest Function

**Files:**

- Modify: `packages/core/src/skill-runtime/index.ts`
- Create: `packages/core/src/skill-runtime/batch-executor-function.ts`

Wire new batch modules into the export surface. Create the Inngest function that handles `batch.requested` events.

- [ ] **Step 1: Update barrel export**

Add to `packages/core/src/skill-runtime/index.ts`:

```typescript
export { BatchSkillHandler } from "./batch-skill-handler.js";
export { validateBatchSkillResult } from "./batch-types.js";
export { createAdsAnalyticsTool } from "./tools/index.js";
export { createAdsDataTool } from "./tools/index.js";
export { adOptimizerBuilder, AD_OPTIMIZER_CONTRACT } from "./builders/index.js";
export type {
  BatchContextRequirement,
  BatchContextContract,
  BatchSkillResult,
  BatchExecutionConfig,
  BatchParameterBuilder,
  BatchSkillStores,
  BatchRecommendation,
  BatchProposedWrite,
} from "./batch-types.js";
```

- [ ] **Step 2: Create batch executor Inngest function**

```typescript
// packages/core/src/skill-runtime/batch-executor-function.ts
import type { BatchSkillHandler } from "./batch-skill-handler.js";

interface InngestLike {
  createFunction(config: unknown, handler: unknown): unknown;
}

interface BatchRuntime {
  getHandler(skillSlug: string): BatchSkillHandler | null;
}

export function createBatchExecutorFunction(inngestClient: InngestLike, runtime: BatchRuntime) {
  return inngestClient.createFunction(
    {
      id: "skill-runtime-batch-executor",
      triggers: [{ event: "skill-runtime/batch.requested" }],
      concurrency: { limit: 5 },
    },
    async ({
      event,
      step,
    }: {
      event: {
        data: { deploymentId: string; skillSlug: string; trigger: string; scheduleName?: string };
      };
      step: { run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T> };
    }) => {
      const handler = runtime.getHandler(event.data.skillSlug);
      if (!handler) {
        throw new Error(`No BatchSkillHandler registered for skill: ${event.data.skillSlug}`);
      }

      const result = await step.run("execute-batch-skill", () =>
        handler.execute({
          deploymentId: event.data.deploymentId,
          orgId: "", // resolved by handler from deployment store
          trigger: event.data.trigger,
          scheduleName: event.data.scheduleName,
        }),
      );

      return result;
    },
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/index.ts packages/core/src/skill-runtime/batch-executor-function.ts
git commit -m "feat: wire batch modules into exports + add batch executor Inngest function"
```

---

### Task 9: Ad-Optimizer Eval Suite

**Files:**

- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/ao-01-healthy-account.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/ao-02-creative-fatigue.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/ao-03-kill-campaign.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/ao-04-scale-winner.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/ao-05-funnel-leak.json`
- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/ao-06-learning-phase.json`
- Modify: `packages/core/src/skill-runtime/__tests__/eval-suite.test.ts`

6 eval fixtures covering the main audit scenarios. Tests validate tool call patterns and recommendation categories.

- [ ] **Step 1: Create 6 fixture files**

Each fixture follows the existing eval format with `skill: "ad-optimizer"`, parameters matching the builder output, scripted mock LLM responses with tool calls to `ads-analytics.*`, and assertions on tool calls and response content.

- [ ] **Step 2: Update eval-suite.test.ts**

Add `ads-analytics` to mock tools. Load and run the 6 `ao-*` fixtures.

- [ ] **Step 3: Run eval suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run src/skill-runtime/__tests__/eval-suite.test.ts`
Expected: PASS (24 existing + 6 new = 30 tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/__tests__/
git commit -m "feat: add ad-optimizer eval suite with 6 fixture scenarios"
```

---

### Task 10: Final Integration Verification

**Files:**

- No new files — verification only

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core test -- --run`
Expected: PASS (all existing + new tests)

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 typecheck`

- [ ] **Step 3: Commit any fixes**

```bash
git commit -m "fix: resolve lint/type issues from SP4 integration"
```

---

### Summary

| Task      | What It Builds                                                         | Files               | Tests         |
| --------- | ---------------------------------------------------------------------- | ------------------- | ------------- |
| 1         | Batch types — context contract, result, builder                        | 2 new               | 6             |
| 2         | Ads analytics tool (wraps diagnostician, comparator, funnel, learning) | 2 new + 1 modify    | ~8            |
| 3         | Ads data tool (wraps Meta API clients)                                 | 2 new + 1 modify    | ~7            |
| 4         | BatchSkillHandler with governance-mediated writes                      | 2 new               | 4             |
| 5         | Ad-optimizer BatchParameterBuilder + contract                          | 2 new + 1 modify    | ~5            |
| 6         | Ad-optimizer skill file                                                | 1 new + 1 modify    | 1 loader      |
| 7         | Thin dispatcher (Inngest rewrite)                                      | 1 modify + 1 modify | ~3            |
| 8         | Barrel exports + batch executor function                               | 2 modify/new        | typecheck     |
| 9         | Ad-optimizer eval suite (6 fixtures)                                   | 6 new + 1 modify    | 6             |
| 10        | Final integration verification                                         | —                   | full suite    |
| **Total** |                                                                        | **~20 files**       | **~40 tests** |

Tasks 1-3 are the foundation (types + tools). Task 4 is the core handler. Tasks 5-6 are the ad-optimizer migration. Tasks 7-8 are wiring. Task 9 is eval. Task 10 is verification.
