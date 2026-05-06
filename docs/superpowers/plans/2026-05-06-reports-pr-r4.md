# PR-R4 — Campaign Rollup + Managed-vs-Unmanaged Comparison

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the campaigns and managedComparison stubs in period-rollup with live data, wire MetaReportInsightsProvider per-org, and add an operator-only `/operator/reports` page with a Switchboard Impact section.

**Architecture:** Core rollup functions (`campaign-rollup.ts`, `managed-comparison-rollup.ts`, `baseline-capture.ts`) live in `packages/core/src/reports/` and depend only on interfaces defined in `interfaces.ts` + types from `@switchboard/schemas`. Prisma store implementations live in `packages/db/src/stores/`. The API route layer in `apps/api` wires core + db + ad-optimizer together. The dashboard operator page reuses the existing `useReportData` hook and adds a `<ManagedComparison>` component.

**Tech Stack:** TypeScript, Zod, Prisma, Fastify, React/Next.js, Vitest

**Spec:** `docs/superpowers/specs/2026-05-06-reports-backend-v1-pr-r4-design.md`

---

## Task 1: Schema — Remove CampaignStage, extend CampaignRow, add ReportCampaignInsight, extend ReportInsightsProvider

**Files:**

- Modify: `packages/schemas/src/reports/v1.ts`
- Modify: `apps/dashboard/src/app/(auth)/reports/fixtures.ts`

- [ ] **Step 1: Remove CampaignStage and stage from CampaignRow, extend CampaignRow**

In `packages/schemas/src/reports/v1.ts`, delete the `CampaignStage` type (line 65) and replace `CampaignRow` (lines 67-74) with:

```ts
export interface CampaignRow {
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  ctr: number;
  leads: number;
  revenue: number;
  cpl: number | null;
  clickToLeadRate: number | null;
  roas: number;
}
```

- [ ] **Step 2: Add ReportCampaignInsight type**

In `packages/schemas/src/reports/v1.ts`, add after `CampaignRow`:

```ts
export interface ReportCampaignInsight {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  ctr: number;
  conversions: number;
}
```

- [ ] **Step 3: Extend ReportInsightsProvider with getCampaignMetrics**

In `packages/schemas/src/reports/v1.ts`, replace the `ReportInsightsProvider` interface (lines 131-133) with:

```ts
export interface ReportInsightsProvider {
  getAggregateMetrics(dateRange: { since: string; until: string }): Promise<ReportInsightsMetrics>;
  getCampaignMetrics(dateRange: { since: string; until: string }): Promise<ReportCampaignInsight[]>;
}
```

- [ ] **Step 4: Update fixtures to match new CampaignRow shape**

In `apps/dashboard/src/app/(auth)/reports/fixtures.ts`:

Remove `CampaignStage` from the re-export list (line 33). Add `ReportCampaignInsight` to the re-export list.

Update every campaign object in `goodFixture`, `quietFixture`, and `problemFixture`. Replace `stage` with the new fields. Example for the first campaign in `goodFixture`:

```ts
// Before:
{ name: "Spring-Buyers", stage: "hot", spend: 620, leads: 14, revenue: 3200, roas: 5.2 },

// After:
{ name: "Spring-Buyers", spend: 620, impressions: 48000, clicks: 580, cpc: 1.07, ctr: 1.21, leads: 14, revenue: 3200, cpl: 44.29, clickToLeadRate: 0.024, roas: 5.2 },
```

Apply the same pattern to all campaigns across all three fixtures. Use consistent fake data: `impressions` ≈ `spend * 70`, `clicks` ≈ `spend * 0.9`, `cpc` = `spend / clicks`, `ctr` = `clicks / impressions * 100`, `cpl` = `leads > 0 ? spend / leads : null`, `clickToLeadRate` = `clicks > 0 ? leads / clicks : null`.

- [ ] **Step 5: Verify types compile**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas build`

Expected: Build succeeds. Dashboard will have type errors from `Campaigns` component — that's expected, fixed in Task 10.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/reports/v1.ts apps/dashboard/src/app/\(auth\)/reports/fixtures.ts
git commit -m "feat(schemas): extend CampaignRow with CPL/CTR, add ReportCampaignInsight, extend ReportInsightsProvider"
```

---

## Task 2: MetaReportInsightsProvider — add getCampaignMetrics + test

**Files:**

- Modify: `packages/ad-optimizer/src/meta-report-insights-provider.ts`
- Create: `packages/ad-optimizer/src/meta-report-insights-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ad-optimizer/src/meta-report-insights-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MetaReportInsightsProvider } from "./meta-report-insights-provider.js";
import type { AdsClientInterface } from "./audit-runner.js";

function stubAdsClient(rows: unknown[]): AdsClientInterface {
  return {
    getCampaignInsights: async () => rows as never[],
    getAdSetInsights: async () => [],
    getAccountSummary: async () => ({ id: "act_123", name: "Test", currency: "USD" }) as never,
  };
}

describe("MetaReportInsightsProvider", () => {
  const dateRange = { since: "2026-04-01", until: "2026-04-30" };

  describe("getCampaignMetrics", () => {
    it("returns per-campaign rows", async () => {
      const client = stubAdsClient([
        {
          campaignId: "c1",
          campaignName: "Spring-Buyers",
          spend: 620,
          impressions: 48000,
          clicks: 580,
          cpc: 1.07,
          ctr: 1.21,
          conversions: 14,
        },
        {
          campaignId: "c2",
          campaignName: "Retargeting",
          spend: 217,
          impressions: 15000,
          clicks: 210,
          cpc: 1.03,
          ctr: 1.4,
          conversions: 9,
        },
      ]);

      const provider = new MetaReportInsightsProvider(client);
      const result = await provider.getCampaignMetrics(dateRange);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        campaignId: "c1",
        campaignName: "Spring-Buyers",
        spend: 620,
        impressions: 48000,
        clicks: 580,
        cpc: 1.07,
        ctr: 1.21,
        conversions: 14,
      });
    });

    it("returns empty array when no campaigns", async () => {
      const client = stubAdsClient([]);
      const provider = new MetaReportInsightsProvider(client);
      const result = await provider.getCampaignMetrics(dateRange);
      expect(result).toEqual([]);
    });
  });

  describe("getAggregateMetrics (existing)", () => {
    it("still aggregates correctly", async () => {
      const client = stubAdsClient([
        {
          impressions: 100,
          clicks: 10,
          spend: 50,
          actions: [{ action_type: "landing_page_view", value: "8" }],
        },
        {
          impressions: 200,
          clicks: 20,
          spend: 75,
          actions: [],
        },
      ]);

      const provider = new MetaReportInsightsProvider(client);
      const result = await provider.getAggregateMetrics(dateRange);

      expect(result).toEqual({
        impressions: 300,
        clicks: 30,
        landingPageViews: 8,
        spend: 125,
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- --run meta-report-insights-provider`

Expected: FAIL — `getCampaignMetrics` is not a function.

- [ ] **Step 3: Implement getCampaignMetrics**

In `packages/ad-optimizer/src/meta-report-insights-provider.ts`, add the import and method:

```ts
import type {
  ReportInsightsProvider,
  ReportInsightsMetrics,
  ReportCampaignInsight,
} from "@switchboard/schemas";
```

Add method after `getAggregateMetrics`:

```ts
  async getCampaignMetrics(dateRange: {
    since: string;
    until: string;
  }): Promise<ReportCampaignInsight[]> {
    const rows = await this.adsClient.getCampaignInsights({
      dateRange,
      fields: ["impressions", "clicks", "spend", "conversions", "cpc", "ctr"],
    });

    return rows.map((row) => ({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      cpc: Number(row.cpc ?? 0),
      ctr: Number(row.ctr ?? 0),
      conversions: Number(row.conversions ?? 0),
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- --run meta-report-insights-provider`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/meta-report-insights-provider.ts packages/ad-optimizer/src/meta-report-insights-provider.test.ts
git commit -m "feat(ad-optimizer): add getCampaignMetrics to MetaReportInsightsProvider"
```

---

## Task 3: Extend ReportStores interface + ReportDependencies

**Files:**

- Modify: `packages/core/src/reports/interfaces.ts`
- Modify: `packages/core/src/reports/period-rollup.ts` (ReportDependencies only)

- [ ] **Step 1: Add revenueByCampaign to ReportStores.revenue**

In `packages/core/src/reports/interfaces.ts`, add to the `revenue` sub-interface inside `ReportStores` (after line 78):

```ts
    revenueByCampaign(input: {
      orgId: string;
      from: Date;
      to: Date;
    }): Promise<Array<{ sourceCampaignId: string; totalAmount: number }>>;
```

- [ ] **Step 2: Add conversations sub-interface to ReportStores**

In `packages/core/src/reports/interfaces.ts`, add after the `orgConfig` block (after line 117, before the closing `}` of `ReportStores`):

```ts
  conversations: {
    threadCountsByAgent(input: {
      orgId: string;
      from: Date;
      to: Date;
    }): Promise<Array<{ assignedAgent: string; count: number }>>;
  };

  deployment: {
    getAlexSlug(orgId: string): Promise<string | null>;
  };

  connection: {
    findMetaConnection(orgId: string): Promise<{
      externalAccountId: string;
      credentials: string;
    } | null>;
  };
```

- [ ] **Step 3: Verify types compile**

Run: `npx pnpm@9.15.4 --filter @switchboard/core build`

Expected: Build succeeds. New interface members are additive — existing code still compiles. Downstream wiring in app.ts will need updates (Task 9). `ReportDependencies.baselineStore` is added later in Task 8 when period-rollup is rewritten.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/reports/interfaces.ts packages/core/src/reports/period-rollup.ts
git commit -m "feat(core): extend ReportStores with campaign revenue, conversations, deployment, connection sub-interfaces"
```

---

## Task 4: Campaign rollup — TDD

**Files:**

- Create: `packages/core/src/reports/campaign-rollup.ts`
- Create: `packages/core/src/reports/campaign-rollup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reports/campaign-rollup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeCampaignRollup } from "./campaign-rollup.js";
import type { RollupContext } from "./types.js";
import type { ReportInsightsProvider, ReportCampaignInsight } from "@switchboard/schemas";

const ctx: RollupContext = {
  orgId: "org-1",
  current: {
    start: new Date("2026-04-01"),
    end: new Date("2026-05-01"),
    window: "THIS MONTH",
  },
  prior: {
    start: new Date("2026-03-01"),
    end: new Date("2026-04-01"),
    window: null,
  },
  computedAt: new Date("2026-04-30"),
};

function stubProvider(campaigns: ReportCampaignInsight[]): ReportInsightsProvider {
  return {
    getAggregateMetrics: async () => ({ impressions: 0, clicks: 0, landingPageViews: 0, spend: 0 }),
    getCampaignMetrics: async () => campaigns,
  };
}

function stubRevenue(data: Array<{ sourceCampaignId: string; totalAmount: number }>) {
  return {
    revenueByCampaign: async () => data,
    sumByOrg: async () => ({ totalAmount: 0, count: 0 }),
    revenueWithFirstTouch: async () => [],
  };
}

describe("computeCampaignRollup", () => {
  it("joins Meta spend with Switchboard revenue and computes derived metrics", async () => {
    const provider = stubProvider([
      {
        campaignId: "c1",
        campaignName: "Spring",
        spend: 600,
        impressions: 40000,
        clicks: 500,
        cpc: 1.2,
        ctr: 1.25,
        conversions: 12,
      },
      {
        campaignId: "c2",
        campaignName: "Retarget",
        spend: 200,
        impressions: 15000,
        clicks: 180,
        cpc: 1.11,
        ctr: 1.2,
        conversions: 8,
      },
    ]);
    const revenue = stubRevenue([{ sourceCampaignId: "c1", totalAmount: 3000 }]);

    const result = await computeCampaignRollup(ctx, provider, revenue);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: "Spring",
      spend: 600,
      impressions: 40000,
      clicks: 500,
      cpc: 1.2,
      ctr: 1.25,
      leads: 12,
      revenue: 3000,
      roas: 5,
    });
    expect(result[0]!.cpl).toBeCloseTo(50);
    expect(result[0]!.clickToLeadRate).toBeCloseTo(0.024);

    expect(result[1]).toMatchObject({
      name: "Retarget",
      spend: 200,
      leads: 8,
      revenue: 0,
      roas: 0,
    });
    expect(result[1]!.cpl).toBeCloseTo(25);
  });

  it("returns empty array when provider is null", async () => {
    const revenue = stubRevenue([]);
    const result = await computeCampaignRollup(ctx, null, revenue);
    expect(result).toEqual([]);
  });

  it("sets cpl=null when leads=0", async () => {
    const provider = stubProvider([
      {
        campaignId: "c1",
        campaignName: "No-Leads",
        spend: 100,
        impressions: 5000,
        clicks: 80,
        cpc: 1.25,
        ctr: 1.6,
        conversions: 0,
      },
    ]);
    const revenue = stubRevenue([]);
    const result = await computeCampaignRollup(ctx, null, revenue);
    // null provider => empty
    expect(result).toEqual([]);

    const result2 = await computeCampaignRollup(ctx, provider, revenue);
    expect(result2[0]!.cpl).toBeNull();
    expect(result2[0]!.clickToLeadRate).toBeCloseTo(0);
  });

  it("sets clickToLeadRate=null when clicks=0", async () => {
    const provider = stubProvider([
      {
        campaignId: "c1",
        campaignName: "Zero-Clicks",
        spend: 0,
        impressions: 0,
        clicks: 0,
        cpc: 0,
        ctr: 0,
        conversions: 0,
      },
    ]);
    const revenue = stubRevenue([]);
    const result = await computeCampaignRollup(ctx, provider, revenue);
    expect(result[0]!.clickToLeadRate).toBeNull();
  });

  it("sorts by spend descending", async () => {
    const provider = stubProvider([
      {
        campaignId: "c1",
        campaignName: "Low",
        spend: 100,
        impressions: 5000,
        clicks: 80,
        cpc: 1.25,
        ctr: 1.6,
        conversions: 2,
      },
      {
        campaignId: "c2",
        campaignName: "High",
        spend: 900,
        impressions: 60000,
        clicks: 800,
        cpc: 1.13,
        ctr: 1.33,
        conversions: 20,
      },
    ]);
    const revenue = stubRevenue([]);
    const result = await computeCampaignRollup(ctx, provider, revenue);
    expect(result[0]!.name).toBe("High");
    expect(result[1]!.name).toBe("Low");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run campaign-rollup`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement campaign-rollup.ts**

Create `packages/core/src/reports/campaign-rollup.ts`:

```ts
import type { CampaignRow, ReportInsightsProvider } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function computeCampaignRollup(
  ctx: RollupContext,
  insightsProvider: ReportInsightsProvider | null,
  revenueStore: Pick<ReportStores["revenue"], "revenueByCampaign">,
): Promise<CampaignRow[]> {
  if (!insightsProvider) return [];

  const dateRange = {
    since: formatDate(ctx.current.start),
    until: formatDate(ctx.current.end),
  };

  const [campaigns, revenueRows] = await Promise.all([
    insightsProvider.getCampaignMetrics(dateRange),
    revenueStore.revenueByCampaign({
      orgId: ctx.orgId,
      from: ctx.current.start,
      to: ctx.current.end,
    }),
  ]);

  const revenueMap = new Map<string, number>();
  for (const r of revenueRows) {
    revenueMap.set(r.sourceCampaignId, r.totalAmount);
  }

  const rows: CampaignRow[] = campaigns.map((c) => {
    const revenue = revenueMap.get(c.campaignId) ?? 0;
    return {
      name: c.campaignName,
      spend: c.spend,
      impressions: c.impressions,
      clicks: c.clicks,
      cpc: c.cpc,
      ctr: c.ctr,
      leads: c.conversions,
      revenue,
      cpl: c.conversions > 0 ? c.spend / c.conversions : null,
      clickToLeadRate: c.clicks > 0 ? c.conversions / c.clicks : null,
      roas: c.spend > 0 ? revenue / c.spend : 0,
    };
  });

  rows.sort((a, b) => b.spend - a.spend);
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run campaign-rollup`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/campaign-rollup.ts packages/core/src/reports/campaign-rollup.test.ts
git commit -m "feat(core): campaign-rollup — joins Meta insights with Switchboard revenue"
```

---

## Task 5: Baseline capture — TDD

**Files:**

- Create: `packages/core/src/reports/baseline-capture.ts`
- Create: `packages/core/src/reports/baseline-capture.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reports/baseline-capture.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureAdsBaseline } from "./baseline-capture.js";
import { createInMemoryBaselineStore } from "./in-memory-store.js";
import type { ReportInsightsProvider } from "@switchboard/schemas";
import type { BaselineStore } from "./interfaces.js";

function stubProvider(
  metricsByCall: Array<{ impressions: number; clicks: number; spend: number }>,
): ReportInsightsProvider {
  let callIndex = 0;
  return {
    getAggregateMetrics: async () => {
      const m = metricsByCall[callIndex] ?? { impressions: 0, clicks: 0, spend: 0 };
      callIndex++;
      return { ...m, landingPageViews: 0 };
    },
    getCampaignMetrics: async () => [],
  };
}

describe("captureAdsBaseline", () => {
  let store: BaselineStore;

  beforeEach(() => {
    store = createInMemoryBaselineStore();
  });

  it("captures 3 monthly buckets of ads metrics", async () => {
    const provider = stubProvider([
      { impressions: 1000, clicks: 100, spend: 500 },
      { impressions: 2000, clicks: 200, spend: 800 },
      { impressions: 1500, clicks: 150, spend: 600 },
    ]);

    await captureAdsBaseline("org-1", provider, store);

    const rows = await store.listByDimension("org-1", "ads");
    expect(rows.length).toBe(9); // 3 metrics × 3 months
    const spendRows = rows.filter((r) => r.metric === "spend");
    expect(spendRows).toHaveLength(3);
    expect(spendRows.map((r) => r.value).sort((a, b) => a - b)).toEqual([500, 600, 800]);
  });

  it("is idempotent on re-run", async () => {
    const provider = stubProvider([
      { impressions: 1000, clicks: 100, spend: 500 },
      { impressions: 2000, clicks: 200, spend: 800 },
      { impressions: 1500, clicks: 150, spend: 600 },
    ]);

    await captureAdsBaseline("org-1", provider, store);
    const firstRun = await store.listByDimension("org-1", "ads");

    // Reset provider call index by creating new one with same data
    const provider2 = stubProvider([
      { impressions: 1000, clicks: 100, spend: 500 },
      { impressions: 2000, clicks: 200, spend: 800 },
      { impressions: 1500, clicks: 150, spend: 600 },
    ]);
    await captureAdsBaseline("org-1", provider2, store);
    const secondRun = await store.listByDimension("org-1", "ads");

    expect(secondRun.length).toBe(firstRun.length);
  });

  it("handles provider error gracefully", async () => {
    const provider: ReportInsightsProvider = {
      getAggregateMetrics: async () => {
        throw new Error("Meta API down");
      },
      getCampaignMetrics: async () => [],
    };

    await expect(captureAdsBaseline("org-1", provider, store)).rejects.toThrow("Meta API down");
    const rows = await store.listByDimension("org-1", "ads");
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run baseline-capture`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement baseline-capture.ts**

Create `packages/core/src/reports/baseline-capture.ts`:

```ts
import type { ReportInsightsProvider } from "@switchboard/schemas";
import type { BaselineStore, BaselineRow } from "./interfaces.js";

function monthBuckets(now: Date): Array<{ start: Date; end: Date }> {
  const buckets: Array<{ start: Date; end: Date }> = [];
  for (let i = 3; i >= 1; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    buckets.push({ start, end });
  }
  return buckets;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function captureAdsBaseline(
  orgId: string,
  insightsProvider: ReportInsightsProvider,
  baselineStore: BaselineStore,
  now: Date = new Date(),
): Promise<void> {
  const buckets = monthBuckets(now);
  const capturedAt = now;
  const rows: BaselineRow[] = [];

  for (const bucket of buckets) {
    const metrics = await insightsProvider.getAggregateMetrics({
      since: formatDate(bucket.start),
      until: formatDate(bucket.end),
    });

    for (const [metric, value] of [
      ["spend", metrics.spend],
      ["impressions", metrics.impressions],
      ["clicks", metrics.clicks],
    ] as const) {
      rows.push({
        organizationId: orgId,
        dimension: "ads",
        metric,
        value,
        periodStart: bucket.start,
        periodEnd: bucket.end,
        capturedAt,
      });
    }
  }

  await baselineStore.insertMany(rows);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run baseline-capture`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/baseline-capture.ts packages/core/src/reports/baseline-capture.test.ts
git commit -m "feat(core): baseline-capture — lazy 90-day ads baseline for managed comparison"
```

---

## Task 6: Managed comparison rollup — TDD

**Files:**

- Create: `packages/core/src/reports/managed-comparison-rollup.ts`
- Create: `packages/core/src/reports/managed-comparison-rollup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reports/managed-comparison-rollup.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { computeManagedComparison } from "./managed-comparison-rollup.js";
import { createInMemoryBaselineStore } from "./in-memory-store.js";
import type { RollupContext } from "./types.js";
import type { ReportInsightsProvider, ManagedComparisonData } from "@switchboard/schemas";
import type { BaselineStore, ReportStores } from "./interfaces.js";

const ctx: RollupContext = {
  orgId: "org-1",
  current: {
    start: new Date("2026-04-01"),
    end: new Date("2026-05-01"),
    window: "THIS MONTH",
  },
  prior: {
    start: new Date("2026-03-01"),
    end: new Date("2026-04-01"),
    window: null,
  },
  computedAt: new Date("2026-04-30"),
};

function stubProvider(spend = 1000): ReportInsightsProvider {
  return {
    getAggregateMetrics: async () => ({
      impressions: 50000,
      clicks: 600,
      landingPageViews: 500,
      spend,
    }),
    getCampaignMetrics: async () => [],
  };
}

function stubStores(overrides?: {
  threadCounts?: Array<{ assignedAgent: string; count: number }>;
  alexSlug?: string | null;
  revenueTotal?: number;
}): Pick<ReportStores, "conversations" | "deployment" | "revenue"> {
  return {
    conversations: {
      threadCountsByAgent: async () => overrides?.threadCounts ?? [],
    },
    deployment: {
      getAlexSlug: async () => overrides?.alexSlug ?? null,
    },
    revenue: {
      sumByOrg: async () => ({ totalAmount: overrides?.revenueTotal ?? 0, count: 0 }),
      revenueWithFirstTouch: async () => [],
      revenueByCampaign: async () => [],
    },
  };
}

describe("computeManagedComparison", () => {
  it("returns ads comparison when baseline exists", async () => {
    const baseline = createInMemoryBaselineStore();
    await baseline.insertMany([
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "spend",
        value: 800,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "impressions",
        value: 40000,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "clicks",
        value: 500,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
    ]);

    const result = await computeManagedComparison(ctx, stubProvider(1000), baseline, stubStores());

    expect(result).not.toBeNull();
    expect(result!.source).toBe("pre-switchboard-baseline");
    expect(result!.ads).not.toBeNull();
    expect(result!.ads!.managed.spend).toBe(1000);
    expect(result!.ads!.unmanaged.spend).toBe(800);
  });

  it("triggers lazy-pull and returns ads=null when no baseline", async () => {
    const baseline = createInMemoryBaselineStore();
    const provider = stubProvider(1000);

    const result = await computeManagedComparison(ctx, provider, baseline, stubStores());

    // ads is null because baseline doesn't exist yet (lazy-pull is fire-and-forget)
    expect(result).toBeNull();
  });

  it("returns null when no provider", async () => {
    const baseline = createInMemoryBaselineStore();
    const result = await computeManagedComparison(ctx, null, baseline, stubStores());
    expect(result).toBeNull();
  });

  it("returns conversations comparison when both cohorts exist", async () => {
    const baseline = createInMemoryBaselineStore();
    await baseline.insertMany([
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "spend",
        value: 800,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
    ]);

    const stores = stubStores({
      alexSlug: "alex",
      threadCounts: [
        { assignedAgent: "alex", count: 30 },
        { assignedAgent: "employee-a", count: 10 },
        { assignedAgent: "", count: 5 },
      ],
    });

    const result = await computeManagedComparison(ctx, stubProvider(), baseline, stores);

    expect(result).not.toBeNull();
    expect(result!.conversations).not.toBeNull();
    expect(result!.conversations!.managed.replies).toBe(30);
    expect(result!.conversations!.unmanaged.replies).toBe(15);
  });

  it("returns conversations=null when no Alex threads", async () => {
    const baseline = createInMemoryBaselineStore();
    await baseline.insertMany([
      {
        organizationId: "org-1",
        dimension: "ads",
        metric: "spend",
        value: 800,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-02-01"),
        capturedAt: new Date(),
      },
    ]);

    const stores = stubStores({
      alexSlug: "alex",
      threadCounts: [{ assignedAgent: "employee-a", count: 10 }],
    });

    const result = await computeManagedComparison(ctx, stubProvider(), baseline, stores);

    expect(result).not.toBeNull();
    expect(result!.conversations).toBeNull();
  });

  it("returns null when both dimensions are null", async () => {
    const baseline = createInMemoryBaselineStore();
    const result = await computeManagedComparison(ctx, stubProvider(), baseline, stubStores());
    // No baseline → ads null. No Alex slug → conversations null. Both null → section hidden.
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run managed-comparison-rollup`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement managed-comparison-rollup.ts**

Create `packages/core/src/reports/managed-comparison-rollup.ts`:

```ts
import type {
  ReportInsightsProvider,
  ManagedComparisonData,
  ManagedComparisonPair,
  Delta,
} from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { BaselineStore, ReportStores } from "./interfaces.js";
import { captureAdsBaseline } from "./baseline-capture.js";

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeDelta(managed: number, unmanaged: number): Delta {
  if (unmanaged === 0) return { kind: "flat", text: "No baseline to compare" };
  const pct = ((managed - unmanaged) / unmanaged) * 100;
  if (Math.abs(pct) < 1) return { kind: "flat", text: "~0% change" };
  const sign = pct > 0 ? "+" : "";
  if (pct > 0) return { kind: "pos", text: `${sign}${pct.toFixed(0)}% vs baseline` };
  return { kind: "neg", text: `${pct.toFixed(0)}% vs baseline` };
}

async function buildAdsComparison(
  ctx: RollupContext,
  provider: ReportInsightsProvider,
  baselineStore: BaselineStore,
  revenueStore: Pick<ReportStores["revenue"], "sumByOrg">,
): Promise<ManagedComparisonPair | null> {
  const baselineRows = await baselineStore.listByDimension(ctx.orgId, "ads");

  if (baselineRows.length === 0) {
    captureAdsBaseline(ctx.orgId, provider, baselineStore).catch((error) => {
      console.warn("Failed to capture ads baseline", { orgId: ctx.orgId, error });
    });
    return null;
  }

  const dateRange = {
    since: formatDate(ctx.current.start),
    until: formatDate(ctx.current.end),
  };
  const currentMetrics = await provider.getAggregateMetrics(dateRange);
  const currentRevenue = await revenueStore.sumByOrg(ctx.orgId, {
    from: ctx.current.start,
    to: ctx.current.end,
  });

  const baselineSpend =
    baselineRows.filter((r) => r.metric === "spend").reduce((sum, r) => sum + r.value, 0) /
    Math.max(baselineRows.filter((r) => r.metric === "spend").length, 1);

  const managed = {
    spend: currentMetrics.spend,
    revenue: currentRevenue.totalAmount,
    roas: currentMetrics.spend > 0 ? currentRevenue.totalAmount / currentMetrics.spend : undefined,
  };

  const unmanaged = { spend: baselineSpend };
  const delta = computeDelta(managed.spend, unmanaged.spend);

  return { managed, unmanaged, delta };
}

async function buildConversationsComparison(
  ctx: RollupContext,
  stores: Pick<ReportStores, "conversations" | "deployment">,
): Promise<ManagedComparisonPair | null> {
  const alexSlug = await stores.deployment.getAlexSlug(ctx.orgId);
  if (!alexSlug) return null;

  const threadCounts = await stores.conversations.threadCountsByAgent({
    orgId: ctx.orgId,
    from: ctx.current.start,
    to: ctx.current.end,
  });

  const alexCount = threadCounts.find((t) => t.assignedAgent === alexSlug)?.count ?? 0;
  if (alexCount === 0) return null;

  const operatorCount = threadCounts
    .filter((t) => t.assignedAgent !== alexSlug)
    .reduce((sum, t) => sum + t.count, 0);

  const managed = { spend: 0, replies: alexCount };
  const unmanaged = { spend: 0, replies: operatorCount };
  const delta = computeDelta(alexCount, operatorCount);

  return { managed, unmanaged, delta };
}

export async function computeManagedComparison(
  ctx: RollupContext,
  insightsProvider: ReportInsightsProvider | null,
  baselineStore: BaselineStore,
  stores: Pick<ReportStores, "conversations" | "deployment" | "revenue">,
): Promise<ManagedComparisonData | null> {
  const [ads, conversations] = await Promise.all([
    insightsProvider
      ? buildAdsComparison(ctx, insightsProvider, baselineStore, stores.revenue)
      : Promise.resolve(null),
    buildConversationsComparison(ctx, stores),
  ]);

  if (!ads && !conversations) return null;

  return {
    ads,
    conversations,
    source: ads ? "pre-switchboard-baseline" : "in-period-cohort",
    emptyMessage: !ads && !conversations ? "Comparison unlocks after 30 days." : undefined,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run managed-comparison-rollup`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/managed-comparison-rollup.ts packages/core/src/reports/managed-comparison-rollup.test.ts
git commit -m "feat(core): managed-comparison-rollup — ads baseline + conversations cohort"
```

---

## Task 7: PrismaBaselineStore + db store extensions

**Files:**

- Create: `packages/db/src/stores/prisma-baseline-store.ts`
- Modify: `packages/db/src/stores/prisma-thread-store.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Create PrismaBaselineStore**

Create `packages/db/src/stores/prisma-baseline-store.ts`:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { BaselineStore, BaselineRow, BaselineDimension } from "@switchboard/core/reports";

export class PrismaBaselineStore implements BaselineStore {
  constructor(private prisma: PrismaDbClient) {}

  async listByDimension(orgId: string, dimension: BaselineDimension): Promise<BaselineRow[]> {
    const rows = await this.prisma.preSwitchboardBaseline.findMany({
      where: { organizationId: orgId, dimension },
      orderBy: { periodStart: "asc" },
    });

    return rows.map((r) => ({
      organizationId: r.organizationId,
      dimension: r.dimension as BaselineDimension,
      metric: r.metric,
      value: r.value,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      capturedAt: r.capturedAt,
    }));
  }

  async insertMany(rows: ReadonlyArray<BaselineRow>): Promise<void> {
    if (rows.length === 0) return;
    await this.prisma.preSwitchboardBaseline.createMany({
      data: rows.map((r) => ({
        organizationId: r.organizationId,
        dimension: r.dimension,
        metric: r.metric,
        value: r.value,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        capturedAt: r.capturedAt,
      })),
      skipDuplicates: true,
    });
  }
}
```

- [ ] **Step 2: Add revenueByCampaign wrapper to PrismaRevenueStore**

In `packages/db/src/stores/prisma-revenue-store.ts`, add method to the `PrismaRevenueStore` class and its `RevenueStore` interface:

Add to `RevenueStore` interface:

```ts
  revenueByCampaign(input: { orgId: string; from: Date; to: Date }): Promise<
    Array<{ sourceCampaignId: string; totalAmount: number }>
  >;
```

Add method to `PrismaRevenueStore`:

```ts
  async revenueByCampaign(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ sourceCampaignId: string; totalAmount: number }>> {
    const results = await this.sumByCampaign(input.orgId, {
      from: input.from,
      to: input.to,
    });
    return results.map((r) => ({
      sourceCampaignId: r.sourceCampaignId,
      totalAmount: r.totalAmount,
    }));
  }
```

- [ ] **Step 3: Add threadCountsByAgent to PrismaConversationThreadStore**

In `packages/db/src/stores/prisma-thread-store.ts`, add method to the `PrismaConversationThreadStore` class:

```ts
  async threadCountsByAgent(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ assignedAgent: string; count: number }>> {
    const results = await this.prisma.conversationThread.groupBy({
      by: ["assignedAgent"],
      where: {
        organizationId: input.orgId,
        createdAt: { gte: input.from, lt: input.to },
      },
      _count: { id: true },
    });

    return results.map((r) => ({
      assignedAgent: r.assignedAgent,
      count: r._count.id,
    }));
  }
```

- [ ] **Step 4: Export PrismaBaselineStore from db index**

In `packages/db/src/index.ts`, add:

```ts
export { PrismaBaselineStore } from "./stores/prisma-baseline-store.js";
```

- [ ] **Step 5: Verify db package builds**

Run: `npx pnpm@9.15.4 --filter @switchboard/db build`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-baseline-store.ts packages/db/src/stores/prisma-revenue-store.ts packages/db/src/stores/prisma-thread-store.ts packages/db/src/index.ts
git commit -m "feat(db): PrismaBaselineStore + revenueByCampaign + threadCountsByAgent"
```

---

## Task 8: Period rollup integration — wire campaign + managed comparison

**Files:**

- Modify: `packages/core/src/reports/period-rollup.ts`
- Modify: `packages/core/src/reports/index.ts`

- [ ] **Step 1: Update period-rollup.ts to call live rollups**

Replace the full content of `packages/core/src/reports/period-rollup.ts`:

```ts
import type { PullQuoteCopy, ReportInsightsProvider } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores, ReportCacheStore, BaselineStore } from "./interfaces.js";
import type { PeriodRollup } from "./interfaces.js";
import { formatDateFolio } from "./period-helpers.js";
import { computeAttribution } from "./attribution-rule.js";
import { computeFunnel } from "./funnel-rollup.js";
import { computeCostVsValue } from "./cost-vs-value-rule.js";
import { computeCampaignRollup } from "./campaign-rollup.js";
import { computeManagedComparison } from "./managed-comparison-rollup.js";

export interface ReportDependencies {
  stores: ReportStores;
  insightsProvider: ReportInsightsProvider | null;
  reportCache: ReportCacheStore;
  baselineStore: BaselineStore;
  planMonthlyUSD: number;
}

const STUB_PULLQUOTE: PullQuoteCopy = {
  pre: "This period, your team generated",
  value: "—",
  mid: "in revenue, with Switchboard costing",
  cost: "—",
  post: "compared to a traditional stack.",
};

export function createPeriodRollup(deps: ReportDependencies): PeriodRollup {
  return async ({ orgId, current, prior, computedAt }) => {
    if (!current.window) {
      throw new Error("current report window is required");
    }

    const ctx: RollupContext = { orgId, current, prior, computedAt };

    const [attribution, funnelResult, costResult, campaigns, managedComparison] = await Promise.all(
      [
        computeAttribution(ctx, deps.stores),
        computeFunnel(ctx, deps.stores, deps.insightsProvider),
        computeCostVsValue(ctx, deps.planMonthlyUSD),
        computeCampaignRollup(ctx, deps.insightsProvider, deps.stores.revenue),
        computeManagedComparison(ctx, deps.insightsProvider, deps.baselineStore, deps.stores),
      ],
    );

    return {
      label: current.window,
      period: formatDateFolio(current),
      dateFolio: formatDateFolio(current),
      pullquote: STUB_PULLQUOTE,
      attribution,
      funnel: funnelResult.funnel,
      funnelNarrative: funnelResult.funnelNarrative,
      campaigns,
      cost: costResult.cost,
      costNarrative: costResult.costNarrative,
      managedComparison,
    };
  };
}
```

- [ ] **Step 2: Update exports in index.ts**

In `packages/core/src/reports/index.ts`, add after the existing exports:

```ts
export { computeCampaignRollup } from "./campaign-rollup.js";
export { computeManagedComparison } from "./managed-comparison-rollup.js";
export { captureAdsBaseline } from "./baseline-capture.js";
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run`

Expected: All existing tests PASS. The `period-rollup` tests may need updates if they assert on `campaigns` being `[]` — update them to provide the new `baselineStore` dependency and a `revenueByCampaign` method on the stores mock.

- [ ] **Step 4: Fix any period-rollup test failures**

If `period-rollup.test.ts` exists and fails because `ReportDependencies` now requires `baselineStore`, add to the test's dependency mock:

```ts
baselineStore: createInMemoryBaselineStore(),
```

And add `revenueByCampaign` to any mocked `stores.revenue`:

```ts
revenueByCampaign: async () => [],
```

And add `conversations`, `deployment`, `connection` to mocked stores:

```ts
conversations: { threadCountsByAgent: async () => [] },
deployment: { getAlexSlug: async () => null },
connection: { findMetaConnection: async () => null },
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/period-rollup.ts packages/core/src/reports/index.ts
git commit -m "feat(core): period-rollup wires live campaign + managed comparison rollups"
```

---

## Task 9: API route — per-org provider wiring + baseline store

**Files:**

- Modify: `apps/api/src/routes/dashboard-reports.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Update app.ts — remove hardcoded null, add baseline store**

In `apps/api/src/app.ts`:

Remove line 532 (`app.decorate("reportInsightsProvider", null);`).

Remove `reportInsightsProvider` from the Fastify type declaration (the `interface` block near line 80).

Inside the `if (prismaClient)` block that creates report stores (around line 500-529), add after `app.decorate("reportStores", reportStores)`:

```ts
const { PrismaBaselineStore } = await import("@switchboard/db");
app.decorate("baselineStore", new PrismaBaselineStore(prismaClient));
```

Add `baselineStore` to the Fastify type declaration:

```ts
    baselineStore?: import("@switchboard/core/reports").BaselineStore;
```

Update the `reportStores` object to include the new sub-interfaces. Add to the object:

```ts
const reportStores = {
  revenue: new PrismaRevenueStore(prismaClient),
  bookings: new PrismaBookingStore(prismaClient),
  opportunities: new PrismaOpportunityStore(prismaClient),
  conversions: new PrismaConversionRecordStore(prismaClient),
  recommendations: new PrismaRecStore(prismaClient),
  orgConfig: {
    getStripePriceId: async (orgId: string) => {
      const config = await prismaClient.organizationConfig.findUnique({
        where: { id: orgId },
        select: { stripePriceId: true },
      });
      return config?.stripePriceId ?? null;
    },
  },
  conversations: new PrismaConversationThreadStore(prismaClient),
  deployment: {
    getAlexSlug: async (orgId: string) => {
      const dep = await prismaClient.agentDeployment.findFirst({
        where: { organizationId: orgId },
        include: { listing: { select: { slug: true } } },
      });
      return dep?.listing?.slug ?? null;
    },
  },
  connection: {
    findMetaConnection: async (orgId: string) => {
      const conn = await prismaClient.connection.findFirst({
        where: { organizationId: orgId, serviceId: "meta", status: "connected" },
        select: { externalAccountId: true, credentials: true },
      });
      if (!conn?.externalAccountId || !conn.credentials) return null;
      return {
        externalAccountId: conn.externalAccountId,
        credentials:
          typeof conn.credentials === "string"
            ? conn.credentials
            : JSON.stringify(conn.credentials),
      };
    },
  },
};
```

Make sure `PrismaConversationThreadStore` is imported in the destructured import block.

- [ ] **Step 2: Update dashboard-reports.ts — per-org provider construction**

In `apps/api/src/routes/dashboard-reports.ts`:

Add imports at top:

```ts
import { MetaReportInsightsProvider } from "@switchboard/ad-optimizer";
import { MetaAdsClient } from "@switchboard/ad-optimizer";
import { decryptCredentials } from "@switchboard/db";
import { createInMemoryBaselineStore } from "@switchboard/core/reports";
```

Update `computeReport` signature to accept `baselineStore`:

```ts
async function computeReport(
  orgId: string,
  window: ReportWindow,
  reportCacheStore: ReportCacheStore,
  stores: ReportStores,
  insightsProvider: ReportInsightsProvider | null,
  baselineStore: import("@switchboard/core/reports").BaselineStore,
) {
```

Add `baselineStore` to the `deps` object:

```ts
const deps: ReportDependencies = {
  stores,
  insightsProvider,
  reportCache: reportCacheStore,
  baselineStore,
  planMonthlyUSD,
};
```

In both route handlers (GET and POST), replace `app.reportInsightsProvider ?? null` with per-org resolution:

```ts
let insightsProvider: ReportInsightsProvider | null = null;
if (app.reportStores) {
  const metaConn = await app.reportStores.connection.findMetaConnection(orgId);
  if (metaConn) {
    try {
      const creds = decryptCredentials(metaConn.credentials);
      const adsClient = new MetaAdsClient({
        accountId: metaConn.externalAccountId,
        accessToken: String(creds.accessToken ?? ""),
      });
      insightsProvider = new MetaReportInsightsProvider(adsClient);
    } catch {
      // Invalid credentials — fall back to null provider
    }
  }
}

const baselineStore = app.baselineStore ?? createInMemoryBaselineStore();
```

Pass `insightsProvider` and `baselineStore` to `computeReport()`.

- [ ] **Step 3: Verify API compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/api build`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/dashboard-reports.ts apps/api/src/app.ts
git commit -m "feat(api): wire MetaReportInsightsProvider per-org + BaselineStore for reports"
```

---

## Task 10: Dashboard — update Campaigns component

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/reports/components/campaigns.tsx`

- [ ] **Step 1: Remove stage references, add new columns**

Replace the full content of `apps/dashboard/src/app/(auth)/reports/components/campaigns.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { CampaignRow } from "../fixtures";
import { fmtMoney } from "./format";
import styles from "../reports.module.css";

type SortKey = "name" | "spend" | "leads" | "cpl" | "revenue" | "roas";
type SortDir = "asc" | "desc";

interface ColDef {
  key: SortKey;
  label: string;
  numeric: boolean;
}

const COLS: ColDef[] = [
  { key: "name", label: "Campaign", numeric: false },
  { key: "spend", label: "Spend", numeric: true },
  { key: "leads", label: "Leads", numeric: true },
  { key: "cpl", label: "CPL", numeric: true },
  { key: "revenue", label: "Revenue", numeric: true },
  { key: "roas", label: "ROAS", numeric: true },
];

function fmtCpl(val: number | null): string {
  return val !== null ? fmtMoney(val) : "—";
}

interface CampaignsProps {
  data: CampaignRow[];
  period: string;
}

export function Campaigns({ data, period }: CampaignsProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "spend",
    dir: "desc",
  });

  function clickHeader(key: SortKey) {
    setSort((s) => {
      if (s.key === key) return { key, dir: s.dir === "asc" ? "desc" : "asc" };
      const col = COLS.find((c) => c.key === key);
      return { key, dir: col?.numeric ? "desc" : "asc" };
    });
  }

  const sorted = useMemo(() => {
    const arr = [...data];
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") {
        return sort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = (av as number) ?? 0;
      const bn = (bv as number) ?? 0;
      return sort.dir === "asc" ? an - bn : bn - an;
    });
    return arr;
  }, [data, sort]);

  const totals = useMemo(() => {
    const sum = { spend: 0, leads: 0, revenue: 0 };
    for (const r of data) {
      sum.spend += r.spend;
      sum.leads += r.leads;
      sum.revenue += r.revenue;
    }
    return {
      ...sum,
      cpl: sum.leads > 0 ? sum.spend / sum.leads : null,
      roas: sum.spend ? sum.revenue / sum.spend : 0,
    };
  }, [data]);

  return (
    <>
      <div className={styles.folio}>
        <span className={styles.folioL}>Where the money came from</span>
        <span className={styles.folioR}>{period}</span>
      </div>

      <div className={styles.campaignsWrap}>
        <table className={styles.campaigns}>
          <thead>
            <tr>
              {COLS.map((c) => {
                const headerCls = [
                  c.numeric ? styles.isNumeric : "",
                  sort.key === c.key ? styles.isActive : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const glyphCls = sort.dir === "asc" ? styles.isAsc : "";
                return (
                  <th
                    key={c.key}
                    className={headerCls}
                    onClick={() => clickHeader(c.key)}
                    scope="col"
                  >
                    {c.label}
                    <span className={`${styles.sortGlyph} ${glyphCls}`}>↓</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className={styles.isNumeric}>{fmtMoney(r.spend)}</td>
                <td className={styles.isNumeric}>{r.leads.toLocaleString()}</td>
                <td className={styles.isNumeric}>{fmtCpl(r.cpl)}</td>
                <td className={styles.isNumeric}>{fmtMoney(r.revenue)}</td>
                <td className={styles.isNumeric}>{r.roas.toFixed(1)}×</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={styles.label}>Total</td>
              <td className={styles.isNumeric}>{fmtMoney(totals.spend)}</td>
              <td className={styles.isNumeric}>{totals.leads.toLocaleString()}</td>
              <td className={styles.isNumeric}>{fmtCpl(totals.cpl)}</td>
              <td className={styles.isNumeric}>{fmtMoney(totals.revenue)}</td>
              <td className={styles.isNumeric}>{totals.roas.toFixed(1)}×</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className={styles.campaignsCards}>
        {sorted.map((r) => (
          <div key={r.name} className={styles.campaignCard}>
            <div className={styles.ccName}>{r.name}</div>
            <div className={styles.ccGrid}>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>Spend</span>
                <span className={styles.val}>{fmtMoney(r.spend)}</span>
              </div>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>Leads</span>
                <span className={styles.val}>{r.leads}</span>
              </div>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>CPL</span>
                <span className={styles.val}>{fmtCpl(r.cpl)}</span>
              </div>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>Revenue</span>
                <span className={styles.val}>{fmtMoney(r.revenue)}</span>
              </div>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>ROAS</span>
                <span className={styles.val}>{r.roas.toFixed(1)}×</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Remove stageSquare CSS references if present in reports.module.css**

Check `apps/dashboard/src/app/(auth)/reports/reports.module.css` for `.stageSquare`, `.isHot`, `.isWarm`, `.isCool` classes. If they exist and are only used by the old Campaigns component, remove them. If used elsewhere, leave them.

- [ ] **Step 3: Verify dashboard compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/reports/components/campaigns.tsx
git commit -m "feat(dashboard): update Campaigns table — remove stage, add CPL column"
```

---

## Task 11: Dashboard — operator reports page + ManagedComparison component

**Files:**

- Create: `apps/dashboard/src/app/(auth)/operator/reports/page.tsx`
- Create: `apps/dashboard/src/app/(auth)/operator/reports/operator-reports-page.tsx`
- Create: `apps/dashboard/src/app/(auth)/operator/reports/components/managed-comparison.tsx`
- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`

- [ ] **Step 1: Create operator reports page.tsx**

Create `apps/dashboard/src/app/(auth)/operator/reports/page.tsx`:

```tsx
import type { Metadata } from "next";
import { OperatorReportsPage } from "./operator-reports-page";

export const metadata: Metadata = { title: "Operator Reports — Switchboard" };
export default function Page() {
  return <OperatorReportsPage />;
}
```

- [ ] **Step 2: Create ManagedComparison component**

Create `apps/dashboard/src/app/(auth)/operator/reports/components/managed-comparison.tsx`:

```tsx
"use client";

import type { ManagedComparisonData, ManagedComparisonPair } from "@switchboard/schemas";
import styles from "../../../reports/reports.module.css";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function PairRow({ label, pair }: { label: string; pair: ManagedComparisonPair }) {
  return (
    <div className={styles.ccGrid}>
      <div className={styles.folio}>
        <span className={styles.folioL}>{label}</span>
      </div>
      <table className={styles.campaigns} style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th scope="col">Cohort</th>
            <th className={styles.isNumeric} scope="col">
              Spend
            </th>
            {pair.managed.replies !== undefined && (
              <th className={styles.isNumeric} scope="col">
                Threads
              </th>
            )}
            {pair.managed.revenue !== undefined && (
              <th className={styles.isNumeric} scope="col">
                Revenue
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Switchboard-managed</td>
            <td className={styles.isNumeric}>{fmtMoney(pair.managed.spend)}</td>
            {pair.managed.replies !== undefined && (
              <td className={styles.isNumeric}>{pair.managed.replies}</td>
            )}
            {pair.managed.revenue !== undefined && (
              <td className={styles.isNumeric}>{fmtMoney(pair.managed.revenue)}</td>
            )}
          </tr>
          <tr>
            <td>Baseline / Unmanaged</td>
            <td className={styles.isNumeric}>{fmtMoney(pair.unmanaged.spend)}</td>
            {pair.unmanaged.replies !== undefined && (
              <td className={styles.isNumeric}>{pair.unmanaged.replies}</td>
            )}
            {pair.unmanaged.revenue !== undefined && (
              <td className={styles.isNumeric}>{fmtMoney(pair.unmanaged.revenue)}</td>
            )}
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 4, fontSize: "0.85em", opacity: 0.7 }}>{pair.delta.text}</div>
    </div>
  );
}

interface ManagedComparisonProps {
  data: ManagedComparisonData;
  period: string;
}

export function ManagedComparison({ data, period }: ManagedComparisonProps) {
  const sourceLabel =
    data.source === "pre-switchboard-baseline"
      ? "vs pre-Switchboard baseline (not a controlled holdout)"
      : "vs in-period unmanaged";

  return (
    <>
      <div className={styles.folio}>
        <span className={styles.folioL}>Switchboard Impact</span>
        <span className={styles.folioR}>{period}</span>
      </div>
      <div style={{ fontSize: "0.85em", opacity: 0.7, marginBottom: 12 }}>{sourceLabel}</div>
      {data.ads ? (
        <PairRow label="Ads (Riley-managed)" pair={data.ads} />
      ) : (
        <div style={{ opacity: 0.5, padding: "8px 0" }}>Not enough ad data yet</div>
      )}
      {data.conversations ? (
        <PairRow label="Conversations (Alex-managed)" pair={data.conversations} />
      ) : (
        <div style={{ opacity: 0.5, padding: "8px 0" }}>
          Not enough Alex-managed conversation data yet
        </div>
      )}
      {data.emptyMessage && (
        <div style={{ opacity: 0.5, padding: "8px 0" }}>{data.emptyMessage}</div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Create OperatorReportsPage**

Create `apps/dashboard/src/app/(auth)/operator/reports/operator-reports-page.tsx`:

```tsx
"use client";

import { useReportWindow } from "../../reports/hooks/use-report-window";
import { useReportData } from "../../reports/hooks/use-report-data";
import { ReportsHeader } from "../../reports/components/header";
import { TitleControls } from "../../reports/components/title-controls";
import { PullQuote } from "../../reports/components/pull-quote";
import { Attribution } from "../../reports/components/attribution";
import { Funnel } from "../../reports/components/funnel";
import { Campaigns } from "../../reports/components/campaigns";
import { CostVsValue } from "../../reports/components/cost-vs-value";
import { ReportFooter } from "../../reports/components/report-footer";
import { Disclosure } from "../../reports/components/disclosure";
import { ManagedComparison } from "./components/managed-comparison";
import styles from "../../reports/reports.module.css";

export function OperatorReportsPage() {
  const { window: activeWindow, setWindow } = useReportWindow();
  const { data: fx } = useReportData(activeWindow);

  if (!fx) return null;

  return (
    <div className={styles.reportsPage}>
      <ReportsHeader />

      <section className={`${styles.section} ${styles.page}`}>
        <TitleControls
          dateFolio={fx.dateFolio}
          activeWindow={activeWindow}
          onSelectWindow={setWindow}
        />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <PullQuote q={fx.pullquote} />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <Attribution data={fx.attribution} period={fx.period} />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <Funnel data={fx.funnel} narrative={fx.funnelNarrative} period={fx.period} />
      </section>

      {fx.managedComparison && (
        <section className={`${styles.section} ${styles.page}`}>
          <ManagedComparison data={fx.managedComparison} period={fx.period} />
        </section>
      )}

      <section className={`${styles.section} ${styles.page}`}>
        <Campaigns data={fx.campaigns} period={fx.period} />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
        <ReportFooter activeWindow={activeWindow} cost={fx.cost} />
      </section>

      <section className={`${styles.section} ${styles.page}`}>
        <Disclosure />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Add /operator/reports to CHROME_HIDDEN_PATHS**

In `apps/dashboard/src/components/layout/app-shell.tsx`, find the `CHROME_HIDDEN_PATHS` array and add `"/operator/reports"`:

```ts
// Before:
const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup", "/reports"];

// After:
const CHROME_HIDDEN_PATHS = ["/login", "/onboarding", "/setup", "/reports", "/operator/reports"];
```

- [ ] **Step 5: Verify dashboard compiles**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard build`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/operator/reports/ apps/dashboard/src/components/layout/app-shell.tsx
git commit -m "feat(dashboard): operator reports page with Switchboard Impact comparison section"
```

---

## Task 12: Full build + typecheck + test sweep

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `npx pnpm@9.15.4 typecheck`

Expected: All packages pass. If errors, fix them (most likely missing store interface members in mocks).

- [ ] **Step 2: Run full test suite**

Run: `npx pnpm@9.15.4 test`

Expected: All tests pass. Fix any failures from the new `ReportStores` shape in existing tests by adding the missing sub-interface stubs.

- [ ] **Step 3: Run full build**

Run: `npx pnpm@9.15.4 build`

Expected: Clean build across all packages.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve typecheck and test issues from PR-R4 integration"
```
