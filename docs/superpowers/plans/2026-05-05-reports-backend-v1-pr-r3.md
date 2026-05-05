# PR-R3 Implementation Plan: Period Rollup (Attribution + 6-Stage Funnel + Cost-vs-Value + Cache + Live API)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/reports` partially live — attribution, funnel (6 stages), and cost-vs-value sections render real data behind a feature flag; campaigns/managed-comparison/pull-quote remain stubbed.

**Architecture:** Core defines thin `ReportStores` read interfaces + rollup functions (attribution, funnel, cost-vs-value, period-rollup orchestrator). Schemas defines `ReportInsightsProvider` interface. DB implements store methods via Prisma. Ad-optimizer implements `MetaReportInsightsProvider`. API route wires everything + 1h cache. Dashboard hook gains react-query live branch gated by `NEXT_PUBLIC_REPORTS_LIVE`.

**Tech Stack:** TypeScript, Prisma, Fastify, React Query v5, Vitest

**Design spec:** `docs/superpowers/specs/2026-05-05-reports-backend-v1-pr-r3-design.md`

---

## File Map

### New files

| File                                                         | Responsibility                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `packages/core/src/reports/attribution-rule.ts`              | First-touch revenue bucketing (Riley vs Alex)                |
| `packages/core/src/reports/attribution-rule.test.ts`         | Table-driven attribution tests                               |
| `packages/core/src/reports/funnel-rollup.ts`                 | 6-stage funnel counts + deltas + narrative                   |
| `packages/core/src/reports/funnel-rollup.test.ts`            | Funnel rollup tests                                          |
| `packages/core/src/reports/cost-vs-value-rule.ts`            | Paid (plan estimate) vs alt (constants)                      |
| `packages/core/src/reports/cost-vs-value-rule.test.ts`       | Cost-vs-value tests                                          |
| `packages/core/src/reports/period-rollup.ts`                 | Orchestrator: calls all sections, assembles ReportDataV1     |
| `packages/core/src/reports/period-rollup.test.ts`            | Orchestrator tests                                           |
| `packages/db/src/stores/prisma-report-cache-store.ts`        | ReportCacheStore Prisma implementation                       |
| `packages/ad-optimizer/src/meta-report-insights-provider.ts` | Meta API aggregate metrics (impressions, clicks, LPV, spend) |
| `apps/api/src/routes/dashboard-reports.ts`                   | GET + POST /api/dashboard/reports endpoints                  |
| `apps/api/src/__tests__/api-reports.test.ts`                 | API route tests                                              |

### Modified files

| File                                                             | Change                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/schemas/src/reports/v1.ts`                             | Add `ReportInsightsProvider`, `ReportInsightsMetrics`   |
| `packages/core/src/reports/interfaces.ts`                        | Add `ReportStores` interface, update FunnelRollup JSDoc |
| `packages/core/src/reports/index.ts`                             | Export new modules                                      |
| `packages/db/src/stores/prisma-revenue-store.ts`                 | Add `revenueWithFirstTouch()`                           |
| `packages/db/src/stores/prisma-booking-store.ts`                 | Add `countExcludingStatuses()`                          |
| `packages/db/src/stores/prisma-opportunity-store.ts`             | Add `countClosedWon()`                                  |
| `packages/db/src/stores/prisma-conversion-record-store.ts`       | Add `leadsBySource()`                                   |
| `packages/db/src/recommendation-store.ts`                        | Add `latestByAgent()`                                   |
| `packages/db/src/index.ts`                                       | Export `PrismaReportCacheStore`                         |
| `packages/ad-optimizer/src/index.ts`                             | Export `MetaReportInsightsProvider`                     |
| `apps/api/src/app.ts`                                            | Decorate `reportCacheStore` + type augmentation         |
| `apps/api/src/bootstrap/routes.ts`                               | Register dashboard-reports route                        |
| `apps/api/src/__tests__/test-server.ts`                          | Add report cache store + report stores to test context  |
| `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts` | React-query live branch                                 |
| `apps/dashboard/src/lib/query-keys.ts`                           | Add `reports` key factory                               |

---

## Task 1: Add `ReportInsightsProvider` to schemas

**Files:**

- Modify: `packages/schemas/src/reports/v1.ts`

- [ ] **Step 1: Add the provider interface and metrics type**

Open `packages/schemas/src/reports/v1.ts`. After the closing brace of `ReportDataV1` (line 118), add:

```ts
// ---------------------------------------------------------------------------
// Report insights provider — injected into core from ad-optimizer via apps/api
// ---------------------------------------------------------------------------

export interface ReportInsightsMetrics {
  impressions: number;
  clicks: number;
  landingPageViews: number;
  spend: number;
}

export interface ReportInsightsProvider {
  getAggregateMetrics(dateRange: { since: string; until: string }): Promise<ReportInsightsMetrics>;
}
```

Also update the module JSDoc at line 10 from `Funnel has 5 stages` to `Funnel has 6 stages`.

- [ ] **Step 2: Verify the build**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas build`

Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/schemas/src/reports/v1.ts
git commit -m "feat(schemas): add ReportInsightsProvider interface for report metrics"
```

---

## Task 2: Add `ReportStores` interface to core

**Files:**

- Modify: `packages/core/src/reports/interfaces.ts`

- [ ] **Step 1: Add the ReportStores interface**

Open `packages/core/src/reports/interfaces.ts`. After the `BaselineStore` interface (after line 57), add:

```ts
// ---------------------------------------------------------------------------
// Thin read-only store contracts for report rollups.
// Implemented by Prisma stores in packages/db; wired at the API route layer.
// ---------------------------------------------------------------------------

export interface ReportStores {
  revenue: {
    sumByOrg(
      orgId: string,
      dateRange: { from: Date; to: Date },
    ): Promise<{ totalAmount: number; count: number }>;

    revenueWithFirstTouch(input: { orgId: string; from: Date; to: Date }): Promise<
      Array<{
        amount: number;
        firstTouchSourceAdId: string | null;
        firstTouchSourceCampaignId: string | null;
        firstTouchSourceChannel: string | null;
      }>
    >;
  };

  bookings: {
    countExcludingStatuses(input: {
      orgId: string;
      excludeStatuses: readonly string[];
      from: Date;
      to: Date;
    }): Promise<number>;
  };

  opportunities: {
    countClosedWon(input: { orgId: string; from: Date; to: Date }): Promise<number>;
  };

  conversions: {
    countByType(orgId: string, type: string, from: Date, to: Date): Promise<number>;

    leadsBySource(input: { orgId: string; from: Date; to: Date }): Promise<
      Array<{
        sourceAdId: string | null;
        sourceCampaignId: string | null;
        sourceChannel: string | null;
      }>
    >;
  };

  recommendations: {
    latestByAgent(input: {
      orgId: string;
      agentKey: string;
      from: Date;
      to: Date;
    }): Promise<{ date: Date; humanSummary: string } | null>;
  };

  orgConfig: {
    getStripePriceId(orgId: string): Promise<string | null>;
  };
}
```

- [ ] **Step 2: Update `FunnelRollup` JSDoc from "5-stage" to "6-stage"**

Change the comment on line 67 from:

```ts
/** 5-stage funnel rows + narrative. Implemented in PR-R3. */
```

to:

```ts
/** 6-stage funnel rows + narrative. Implemented in PR-R3. */
```

- [ ] **Step 3: Verify the build**

Run: `npx pnpm@9.15.4 --filter @switchboard/core build`

Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/reports/interfaces.ts
git commit -m "feat(core): add ReportStores thin read-only interfaces for report rollups"
```

---

## Task 3: Implement `cost-vs-value-rule.ts` (TDD)

**Files:**

- Create: `packages/core/src/reports/cost-vs-value-rule.ts`
- Create: `packages/core/src/reports/cost-vs-value-rule.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reports/cost-vs-value-rule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeCostVsValue, SDR_MONTHLY_USD, AGENCY_MONTHLY_USD } from "./cost-vs-value-rule.js";
import type { RollupContext } from "./types.js";

function makeCtx(startISO: string, endISO: string): RollupContext {
  return {
    orgId: "org-1",
    current: {
      start: new Date(startISO),
      end: new Date(endISO),
      window: "THIS MONTH",
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  };
}

describe("computeCostVsValue", () => {
  it("prorates monthly plan to a 30-day window", async () => {
    const ctx = makeCtx("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z");
    const result = await computeCostVsValue(ctx, 299);

    expect(result.cost.paid).toBeCloseTo(299, 0);
    expect(result.cost.alt).toBeCloseTo(SDR_MONTHLY_USD + AGENCY_MONTHLY_USD, 0);
    expect(result.cost.saving).toBeCloseTo(result.cost.alt - result.cost.paid, 0);
  });

  it("prorates to a 7-day window", async () => {
    const ctx = makeCtx("2026-04-07T00:00:00Z", "2026-04-14T00:00:00Z");
    const result = await computeCostVsValue(ctx, 499);

    const days = 7;
    expect(result.cost.paid).toBeCloseTo(499 * (days / 30), 0);
    expect(result.cost.alt).toBeCloseTo((SDR_MONTHLY_USD + AGENCY_MONTHLY_USD) * (days / 30), 0);
  });

  it("returns zero paid when planMonthlyUSD is 0", async () => {
    const ctx = makeCtx("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z");
    const result = await computeCostVsValue(ctx, 0);

    expect(result.cost.paid).toBe(0);
    expect(result.cost.saving).toBe(result.cost.alt);
    expect(result.costNarrative).toContain("No active subscription");
  });

  it("narrative mentions estimate disclaimer", async () => {
    const ctx = makeCtx("2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z");
    const result = await computeCostVsValue(ctx, 299);

    expect(result.costNarrative).toContain("estimated");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run cost-vs-value-rule`

Expected: FAIL — module `./cost-vs-value-rule.js` not found.

- [ ] **Step 3: Implement the rule**

Create `packages/core/src/reports/cost-vs-value-rule.ts`:

```ts
import type { CostBreakdown } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import { formatCurrencyUSD } from "./period-helpers.js";

export const SDR_MONTHLY_USD = 5000;
export const AGENCY_MONTHLY_USD = 3000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function computeCostVsValue(
  ctx: RollupContext,
  planMonthlyUSD: number,
): Promise<{ cost: CostBreakdown; costNarrative: string }> {
  const daysInWindow = (ctx.current.end.getTime() - ctx.current.start.getTime()) / MS_PER_DAY;
  const prorationFactor = daysInWindow / 30;

  const paid = planMonthlyUSD * prorationFactor;
  const alt = (SDR_MONTHLY_USD + AGENCY_MONTHLY_USD) * prorationFactor;
  const saving = alt - paid;

  let costNarrative: string;
  if (planMonthlyUSD === 0) {
    costNarrative =
      `No active subscription detected. ` +
      `A comparable in-house stack (junior SDR + ad agency retainer) ` +
      `would run ~${formatCurrencyUSD(alt)} for this period.`;
  } else {
    costNarrative =
      `Switchboard cost is estimated from your subscription plan at ~${formatCurrencyUSD(paid)} for this period. ` +
      `A comparable in-house stack would run ~${formatCurrencyUSD(alt)}, ` +
      `saving ~${formatCurrencyUSD(saving)}. ` +
      `Actual invoice amounts may vary.`;
  }

  return {
    cost: {
      paid: Math.round(paid * 100) / 100,
      alt: Math.round(alt * 100) / 100,
      saving: Math.round(saving * 100) / 100,
    },
    costNarrative,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run cost-vs-value-rule`

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/cost-vs-value-rule.ts packages/core/src/reports/cost-vs-value-rule.test.ts
git commit -m "feat(core): add cost-vs-value rule with proration and estimate disclaimer"
```

---

## Task 4: Implement `attribution-rule.ts` (TDD)

**Files:**

- Create: `packages/core/src/reports/attribution-rule.ts`
- Create: `packages/core/src/reports/attribution-rule.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reports/attribution-rule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeAttribution } from "./attribution-rule.js";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";

function makeCtx(): RollupContext {
  return {
    orgId: "org-1",
    current: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window: "THIS MONTH",
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  };
}

type RevenueRow = Awaited<ReturnType<ReportStores["revenue"]["revenueWithFirstTouch"]>>[number];
type LeadRow = Awaited<ReturnType<ReportStores["conversions"]["leadsBySource"]>>[number];

function makeStores(
  currentRevenue: RevenueRow[],
  priorRevenue: RevenueRow[],
  leads: LeadRow[],
): Pick<ReportStores, "revenue" | "conversions"> {
  return {
    revenue: {
      sumByOrg: async () => ({ totalAmount: 0, count: 0 }),
      revenueWithFirstTouch: async ({ from }) => {
        const isCurrentPeriod = from.getTime() === new Date("2026-04-01T00:00:00Z").getTime();
        return isCurrentPeriod ? currentRevenue : priorRevenue;
      },
    },
    conversions: {
      countByType: async () => 0,
      leadsBySource: async () => leads,
    },
  };
}

describe("computeAttribution", () => {
  it("buckets ad-sourced revenue to Riley", async () => {
    const stores = makeStores(
      [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "camp-1",
          firstTouchSourceChannel: null,
        },
      ],
      [],
      [{ sourceAdId: "ad-1", sourceCampaignId: "camp-1", sourceChannel: null }],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.riley.value).toBe(5000);
    expect(result.alex.value).toBe(0);
    expect(result.total).toBe(5000);
  });

  it("buckets chat-sourced revenue to Alex", async () => {
    const stores = makeStores(
      [
        {
          amount: 2000,
          firstTouchSourceAdId: null,
          firstTouchSourceCampaignId: null,
          firstTouchSourceChannel: "whatsapp",
        },
      ],
      [],
      [{ sourceAdId: null, sourceCampaignId: null, sourceChannel: "whatsapp" }],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.riley.value).toBe(0);
    expect(result.alex.value).toBe(2000);
  });

  it("buckets manual-entry revenue (no ConversionRecord) to Alex", async () => {
    const stores = makeStores(
      [
        {
          amount: 1000,
          firstTouchSourceAdId: null,
          firstTouchSourceCampaignId: null,
          firstTouchSourceChannel: null,
        },
      ],
      [],
      [],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.alex.value).toBe(1000);
    expect(result.riley.value).toBe(0);
  });

  it("returns zeroed values with flat delta when no revenue exists", async () => {
    const stores = makeStores([], [], []);
    const result = await computeAttribution(makeCtx(), stores);

    expect(result.total).toBe(0);
    expect(result.riley.value).toBe(0);
    expect(result.alex.value).toBe(0);
    expect(result.delta.kind).toBe("flat");
  });

  it("computes positive delta when current > prior", async () => {
    const stores = makeStores(
      [
        {
          amount: 10000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "camp-1",
          firstTouchSourceChannel: null,
        },
      ],
      [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "camp-1",
          firstTouchSourceChannel: null,
        },
      ],
      [{ sourceAdId: "ad-1", sourceCampaignId: "camp-1", sourceChannel: null }],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.delta.kind).toBe("pos");
    expect(result.delta.text).toContain("100");
  });

  it("builds Riley caption with campaign count and lead count", async () => {
    const stores = makeStores(
      [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "camp-1",
          firstTouchSourceChannel: null,
        },
      ],
      [],
      [
        { sourceAdId: "ad-1", sourceCampaignId: "camp-1", sourceChannel: null },
        { sourceAdId: "ad-2", sourceCampaignId: "camp-1", sourceChannel: null },
        { sourceAdId: "ad-3", sourceCampaignId: "camp-2", sourceChannel: null },
      ],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.riley.caption).toBe("2 campaigns · 3 leads");
  });

  it("builds Alex caption with lead count", async () => {
    const stores = makeStores(
      [
        {
          amount: 2000,
          firstTouchSourceAdId: null,
          firstTouchSourceCampaignId: null,
          firstTouchSourceChannel: "whatsapp",
        },
      ],
      [],
      [
        { sourceAdId: null, sourceCampaignId: null, sourceChannel: "whatsapp" },
        { sourceAdId: null, sourceCampaignId: null, sourceChannel: "telegram" },
      ],
    );

    const result = await computeAttribution(makeCtx(), stores);
    expect(result.alex.caption).toBe("chat · 2 leads");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run attribution-rule`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the rule**

Create `packages/core/src/reports/attribution-rule.ts`:

```ts
import type { AttributionData, Delta } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";

function isRiley(row: {
  firstTouchSourceAdId: string | null;
  firstTouchSourceCampaignId: string | null;
}): boolean {
  return !!(row.firstTouchSourceAdId || row.firstTouchSourceCampaignId);
}

function computeDelta(current: number, prior: number): Delta {
  if (prior === 0 && current === 0) return { kind: "flat", text: "no prior data" };
  if (prior === 0) return { kind: "pos", text: "new" };
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct > 0) return { kind: "pos", text: `+${pct} %` };
  if (pct < 0) return { kind: "neg", text: `${pct} %` };
  return { kind: "flat", text: "0 %" };
}

export async function computeAttribution(
  ctx: RollupContext,
  stores: Pick<ReportStores, "revenue" | "conversions">,
): Promise<AttributionData> {
  const [currentRevenue, priorRevenue, currentLeads] = await Promise.all([
    stores.revenue.revenueWithFirstTouch({
      orgId: ctx.orgId,
      from: ctx.current.start,
      to: ctx.current.end,
    }),
    stores.revenue.revenueWithFirstTouch({
      orgId: ctx.orgId,
      from: ctx.prior.start,
      to: ctx.prior.end,
    }),
    stores.conversions.leadsBySource({
      orgId: ctx.orgId,
      from: ctx.current.start,
      to: ctx.current.end,
    }),
  ]);

  let rileyRevenue = 0;
  let alexRevenue = 0;
  for (const e of currentRevenue) {
    if (isRiley(e)) {
      rileyRevenue += e.amount;
    } else {
      alexRevenue += e.amount;
    }
  }

  let priorTotal = 0;
  for (const e of priorRevenue) {
    priorTotal += e.amount;
  }

  const total = rileyRevenue + alexRevenue;
  const delta = computeDelta(total, priorTotal);

  const rileyLeads = currentLeads.filter((l) => !!(l.sourceAdId || l.sourceCampaignId));
  const alexLeads = currentLeads.filter((l) => !l.sourceAdId && !l.sourceCampaignId);
  const campaignIds = new Set(rileyLeads.map((l) => l.sourceCampaignId).filter(Boolean));

  return {
    total,
    delta,
    riley: {
      value: rileyRevenue,
      caption: `${campaignIds.size} campaign${campaignIds.size !== 1 ? "s" : ""} · ${rileyLeads.length} lead${rileyLeads.length !== 1 ? "s" : ""}`,
    },
    alex: {
      value: alexRevenue,
      caption: `chat · ${alexLeads.length} lead${alexLeads.length !== 1 ? "s" : ""}`,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run attribution-rule`

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/attribution-rule.ts packages/core/src/reports/attribution-rule.test.ts
git commit -m "feat(core): add first-touch attribution rule (Riley vs Alex bucketing)"
```

---

## Task 5: Implement `funnel-rollup.ts` (TDD)

**Files:**

- Create: `packages/core/src/reports/funnel-rollup.ts`
- Create: `packages/core/src/reports/funnel-rollup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reports/funnel-rollup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeFunnel } from "./funnel-rollup.js";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";
import type { ReportInsightsProvider } from "@switchboard/schemas";

function makeCtx(): RollupContext {
  return {
    orgId: "org-1",
    current: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window: "THIS MONTH",
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  };
}

function makeProvider(
  current: { impressions: number; clicks: number; landingPageViews: number; spend: number },
  prior: { impressions: number; clicks: number; landingPageViews: number; spend: number },
): ReportInsightsProvider {
  return {
    getAggregateMetrics: async (dateRange) => {
      const isCurrent = dateRange.since === "2026-04-01";
      return isCurrent ? current : prior;
    },
  };
}

function makeStores(opts: {
  currentLeads?: number;
  priorLeads?: number;
  currentBookings?: number;
  priorBookings?: number;
  currentCustomers?: number;
  priorCustomers?: number;
  narrative?: { date: Date; humanSummary: string } | null;
}): Pick<ReportStores, "conversions" | "bookings" | "opportunities" | "recommendations"> {
  return {
    conversions: {
      countByType: async (_orgId, _type, from) => {
        const isCurrent = from.getTime() === new Date("2026-04-01T00:00:00Z").getTime();
        return isCurrent ? (opts.currentLeads ?? 0) : (opts.priorLeads ?? 0);
      },
      leadsBySource: async () => [],
    },
    bookings: {
      countExcludingStatuses: async ({ from }) => {
        const isCurrent = from.getTime() === new Date("2026-04-01T00:00:00Z").getTime();
        return isCurrent ? (opts.currentBookings ?? 0) : (opts.priorBookings ?? 0);
      },
    },
    opportunities: {
      countClosedWon: async ({ from }) => {
        const isCurrent = from.getTime() === new Date("2026-04-01T00:00:00Z").getTime();
        return isCurrent ? (opts.currentCustomers ?? 0) : (opts.priorCustomers ?? 0);
      },
    },
    recommendations: {
      latestByAgent: async () => opts.narrative ?? null,
    },
  };
}

describe("computeFunnel", () => {
  it("returns 6 stages with correct labels", async () => {
    const provider = makeProvider(
      { impressions: 1000, clicks: 200, landingPageViews: 150, spend: 500 },
      { impressions: 800, clicks: 160, landingPageViews: 120, spend: 400 },
    );
    const stores = makeStores({
      currentLeads: 50,
      priorLeads: 40,
      currentBookings: 10,
      priorBookings: 8,
      currentCustomers: 3,
      priorCustomers: 2,
    });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnel).toHaveLength(6);
    expect(result.funnel.map((r) => r.stage)).toEqual([
      "Impressions",
      "Clicks",
      "Landing page views",
      "Leads",
      "Bookings",
      "Customers",
    ]);
  });

  it("computes correct counts from provider and stores", async () => {
    const provider = makeProvider(
      { impressions: 5000, clicks: 1000, landingPageViews: 800, spend: 2000 },
      { impressions: 0, clicks: 0, landingPageViews: 0, spend: 0 },
    );
    const stores = makeStores({ currentLeads: 100, currentBookings: 25, currentCustomers: 5 });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnel[0].n).toBe(5000);
    expect(result.funnel[1].n).toBe(1000);
    expect(result.funnel[2].n).toBe(800);
    expect(result.funnel[3].n).toBe(100);
    expect(result.funnel[4].n).toBe(25);
    expect(result.funnel[5].n).toBe(5);
  });

  it("renders top 3 rows as zero with null delta when provider is null", async () => {
    const stores = makeStores({
      currentLeads: 50,
      priorLeads: 40,
      currentBookings: 10,
      priorBookings: 8,
      currentCustomers: 3,
      priorCustomers: 2,
    });

    const result = await computeFunnel(makeCtx(), stores, null);

    expect(result.funnel[0].n).toBe(0);
    expect(result.funnel[0].delta).toBeNull();
    expect(result.funnel[1].n).toBe(0);
    expect(result.funnel[2].n).toBe(0);
    expect(result.funnel[3].n).toBe(50);
    expect(result.funnel[3].delta).not.toBeNull();
  });

  it("returns null delta when prior is zero", async () => {
    const provider = makeProvider(
      { impressions: 1000, clicks: 200, landingPageViews: 150, spend: 500 },
      { impressions: 0, clicks: 0, landingPageViews: 0, spend: 0 },
    );
    const stores = makeStores({ currentLeads: 50, currentBookings: 10, currentCustomers: 3 });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnel[0].delta).toBeNull();
  });

  it("uses Riley narrative from recommendations when available", async () => {
    const provider = makeProvider(
      { impressions: 1000, clicks: 200, landingPageViews: 150, spend: 500 },
      { impressions: 800, clicks: 160, landingPageViews: 120, spend: 400 },
    );
    const stores = makeStores({
      currentLeads: 50,
      priorLeads: 40,
      currentBookings: 10,
      priorBookings: 8,
      currentCustomers: 3,
      priorCustomers: 2,
      narrative: {
        date: new Date("2026-04-10T00:00:00Z"),
        humanSummary: "Fatigued creatives reducing engagement",
      },
    });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnelNarrative.marker).toBe("Riley");
    expect(result.funnelNarrative.text).toContain("Fatigued creatives");
  });

  it("falls back to static narrative when no recommendation exists", async () => {
    const provider = makeProvider(
      { impressions: 1000, clicks: 200, landingPageViews: 150, spend: 500 },
      { impressions: 800, clicks: 160, landingPageViews: 120, spend: 400 },
    );
    const stores = makeStores({
      currentLeads: 50,
      priorLeads: 40,
      currentBookings: 10,
      priorBookings: 8,
      currentCustomers: 3,
      priorCustomers: 2,
    });

    const result = await computeFunnel(makeCtx(), stores, provider);

    expect(result.funnelNarrative.marker).toBe("Riley");
    expect(result.funnelNarrative.text).toContain("No analysis available");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run funnel-rollup`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the rollup**

Create `packages/core/src/reports/funnel-rollup.ts`:

```ts
import type {
  FunnelRowData,
  FunnelNarrative,
  Delta,
  ReportInsightsProvider,
  ReportInsightsMetrics,
} from "@switchboard/schemas";
import type { RollupContext } from "./types.js";
import type { ReportStores } from "./interfaces.js";

function formatDateShort(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDelta(current: number, prior: number): Delta | null {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct > 0) return { kind: "pos", text: `+${pct} %` };
  if (pct < 0) return { kind: "neg", text: `${pct} %` };
  return { kind: "flat", text: "0 %" };
}

function fmtLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

async function fetchMetrics(
  provider: ReportInsightsProvider | null,
  start: Date,
  end: Date,
): Promise<ReportInsightsMetrics> {
  if (!provider) {
    return { impressions: 0, clicks: 0, landingPageViews: 0, spend: 0 };
  }
  return provider.getAggregateMetrics({
    since: formatDateShort(start),
    until: formatDateShort(end),
  });
}

export async function computeFunnel(
  ctx: RollupContext,
  stores: Pick<ReportStores, "conversions" | "bookings" | "opportunities" | "recommendations">,
  provider: ReportInsightsProvider | null,
): Promise<{ funnel: FunnelRowData[]; funnelNarrative: FunnelNarrative }> {
  const noProvider = provider === null;

  const [
    currentMetrics,
    priorMetrics,
    currentLeads,
    priorLeads,
    currentBookings,
    priorBookings,
    currentCustomers,
    priorCustomers,
    narrative,
  ] = await Promise.all([
    fetchMetrics(provider, ctx.current.start, ctx.current.end),
    fetchMetrics(provider, ctx.prior.start, ctx.prior.end),
    stores.conversions.countByType(ctx.orgId, "lead", ctx.current.start, ctx.current.end),
    stores.conversions.countByType(ctx.orgId, "lead", ctx.prior.start, ctx.prior.end),
    stores.bookings.countExcludingStatuses({
      orgId: ctx.orgId,
      excludeStatuses: ["cancelled", "failed"],
      from: ctx.current.start,
      to: ctx.current.end,
    }),
    stores.bookings.countExcludingStatuses({
      orgId: ctx.orgId,
      excludeStatuses: ["cancelled", "failed"],
      from: ctx.prior.start,
      to: ctx.prior.end,
    }),
    stores.opportunities.countClosedWon({
      orgId: ctx.orgId,
      from: ctx.current.start,
      to: ctx.current.end,
    }),
    stores.opportunities.countClosedWon({
      orgId: ctx.orgId,
      from: ctx.prior.start,
      to: ctx.prior.end,
    }),
    stores.recommendations.latestByAgent({
      orgId: ctx.orgId,
      agentKey: "riley",
      from: ctx.current.start,
      to: ctx.current.end,
    }),
  ]);

  const stages: Array<{ stage: string; current: number; prior: number; noProvider: boolean }> = [
    {
      stage: "Impressions",
      current: currentMetrics.impressions,
      prior: priorMetrics.impressions,
      noProvider,
    },
    { stage: "Clicks", current: currentMetrics.clicks, prior: priorMetrics.clicks, noProvider },
    {
      stage: "Landing page views",
      current: currentMetrics.landingPageViews,
      prior: priorMetrics.landingPageViews,
      noProvider,
    },
    { stage: "Leads", current: currentLeads, prior: priorLeads, noProvider: false },
    { stage: "Bookings", current: currentBookings, prior: priorBookings, noProvider: false },
    { stage: "Customers", current: currentCustomers, prior: priorCustomers, noProvider: false },
  ];

  const funnel: FunnelRowData[] = stages.map((s) => ({
    stage: s.stage,
    n: s.current,
    label: fmtLabel(s.current),
    delta: s.noProvider ? null : fmtDelta(s.current, s.prior),
  }));

  const funnelNarrative: FunnelNarrative = narrative
    ? {
        marker: "Riley",
        text: `${formatDateShort(narrative.date)} — ${narrative.humanSummary}`,
      }
    : {
        marker: "Riley",
        text: "No analysis available for this period.",
      };

  return { funnel, funnelNarrative };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run funnel-rollup`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reports/funnel-rollup.ts packages/core/src/reports/funnel-rollup.test.ts
git commit -m "feat(core): add 6-stage funnel rollup with Meta insights + store queries"
```

---

## Task 6: Implement `period-rollup.ts` orchestrator (TDD)

**Files:**

- Create: `packages/core/src/reports/period-rollup.ts`
- Create: `packages/core/src/reports/period-rollup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/reports/period-rollup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createPeriodRollup, type ReportDependencies } from "./period-rollup.js";
import { createInMemoryReportCacheStore } from "./in-memory-store.js";
import type { ReportStores } from "./interfaces.js";
import type { ReportInsightsProvider } from "@switchboard/schemas";

function stubStores(): ReportStores {
  return {
    revenue: {
      sumByOrg: async () => ({ totalAmount: 5000, count: 3 }),
      revenueWithFirstTouch: async () => [
        {
          amount: 5000,
          firstTouchSourceAdId: "ad-1",
          firstTouchSourceCampaignId: "c-1",
          firstTouchSourceChannel: null,
        },
      ],
    },
    bookings: {
      countExcludingStatuses: async () => 10,
    },
    opportunities: {
      countClosedWon: async () => 3,
    },
    conversions: {
      countByType: async () => 50,
      leadsBySource: async () => [
        { sourceAdId: "ad-1", sourceCampaignId: "c-1", sourceChannel: null },
      ],
    },
    recommendations: {
      latestByAgent: async () => null,
    },
    orgConfig: {
      getStripePriceId: async () => null,
    },
  };
}

function stubProvider(): ReportInsightsProvider {
  return {
    getAggregateMetrics: async () => ({
      impressions: 1000,
      clicks: 200,
      landingPageViews: 150,
      spend: 500,
    }),
  };
}

function makeDeps(overrides?: Partial<ReportDependencies>): ReportDependencies {
  return {
    stores: stubStores(),
    insightsProvider: stubProvider(),
    reportCache: createInMemoryReportCacheStore(),
    planMonthlyUSD: 299,
    ...overrides,
  };
}

describe("createPeriodRollup", () => {
  it("returns a complete ReportDataV1 with all required fields", async () => {
    const rollup = createPeriodRollup(makeDeps());

    const result = await rollup({
      orgId: "org-1",
      current: {
        start: new Date("2026-04-01T00:00:00Z"),
        end: new Date("2026-05-01T00:00:00Z"),
        window: "THIS MONTH",
      },
      prior: {
        start: new Date("2026-03-01T00:00:00Z"),
        end: new Date("2026-04-01T00:00:00Z"),
        window: null,
      },
      computedAt: new Date("2026-04-15T00:00:00Z"),
    });

    expect(result.label).toBe("THIS MONTH");
    expect(result.funnel).toHaveLength(6);
    expect(result.attribution.total).toBe(5000);
    expect(result.cost.paid).toBeGreaterThan(0);
    expect(result.campaigns).toEqual([]);
    expect(result.managedComparison).toBeNull();
    expect(result.pullquote).toBeDefined();
  });

  it("throws when current.window is null", async () => {
    const rollup = createPeriodRollup(makeDeps());

    await expect(
      rollup({
        orgId: "org-1",
        current: {
          start: new Date("2026-04-01T00:00:00Z"),
          end: new Date("2026-05-01T00:00:00Z"),
          window: null,
        },
        prior: {
          start: new Date("2026-03-01T00:00:00Z"),
          end: new Date("2026-04-01T00:00:00Z"),
          window: null,
        },
        computedAt: new Date("2026-04-15T00:00:00Z"),
      }),
    ).rejects.toThrow("current report window is required");
  });

  it("handles null insights provider gracefully", async () => {
    const rollup = createPeriodRollup(makeDeps({ insightsProvider: null }));

    const result = await rollup({
      orgId: "org-1",
      current: {
        start: new Date("2026-04-01T00:00:00Z"),
        end: new Date("2026-05-01T00:00:00Z"),
        window: "THIS MONTH",
      },
      prior: {
        start: new Date("2026-03-01T00:00:00Z"),
        end: new Date("2026-04-01T00:00:00Z"),
        window: null,
      },
      computedAt: new Date("2026-04-15T00:00:00Z"),
    });

    expect(result.funnel[0].n).toBe(0);
    expect(result.funnel[3].n).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run period-rollup`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `packages/core/src/reports/period-rollup.ts`:

```ts
import type {
  ReportDataV1,
  PullQuoteCopy,
  CampaignRow,
  ReportInsightsProvider,
} from "@switchboard/schemas";
import type { RollupContext, PeriodRange } from "./types.js";
import type { ReportStores, ReportCacheStore } from "./interfaces.js";
import type { PeriodRollup } from "./interfaces.js";
import { formatDateFolio } from "./period-helpers.js";
import { computeAttribution } from "./attribution-rule.js";
import { computeFunnel } from "./funnel-rollup.js";
import { computeCostVsValue } from "./cost-vs-value-rule.js";

export interface ReportDependencies {
  stores: ReportStores;
  insightsProvider: ReportInsightsProvider | null;
  reportCache: ReportCacheStore;
  planMonthlyUSD: number;
}

const STUB_PULLQUOTE: PullQuoteCopy = {
  pre: "This period, your team generated",
  value: "—",
  mid: "in revenue, with Switchboard costing",
  cost: "—",
  post: "compared to a traditional stack.",
};

const STUB_CAMPAIGNS: CampaignRow[] = [];

export function createPeriodRollup(deps: ReportDependencies): PeriodRollup {
  return async ({ orgId, current, prior, computedAt }) => {
    if (!current.window) {
      throw new Error("current report window is required");
    }

    const ctx: RollupContext = { orgId, current, prior, computedAt };

    const [attribution, funnelResult, costResult] = await Promise.all([
      computeAttribution(ctx, deps.stores),
      computeFunnel(ctx, deps.stores, deps.insightsProvider),
      computeCostVsValue(ctx, deps.planMonthlyUSD),
    ]);

    return {
      label: current.window,
      period: formatDateFolio(current),
      dateFolio: formatDateFolio(current),
      pullquote: STUB_PULLQUOTE,
      attribution,
      funnel: funnelResult.funnel,
      funnelNarrative: funnelResult.funnelNarrative,
      campaigns: STUB_CAMPAIGNS,
      cost: costResult.cost,
      costNarrative: costResult.costNarrative,
      managedComparison: null,
    };
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run period-rollup`

Expected: All 3 tests PASS.

- [ ] **Step 5: Update barrel exports**

In `packages/core/src/reports/index.ts`, add after the existing exports:

```ts
export { computeAttribution } from "./attribution-rule.js";
export { computeFunnel } from "./funnel-rollup.js";
export { computeCostVsValue, SDR_MONTHLY_USD, AGENCY_MONTHLY_USD } from "./cost-vs-value-rule.js";
export { createPeriodRollup, type ReportDependencies } from "./period-rollup.js";
```

- [ ] **Step 6: Build core to verify exports**

Run: `npx pnpm@9.15.4 --filter @switchboard/core build`

Expected: Clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/reports/period-rollup.ts packages/core/src/reports/period-rollup.test.ts packages/core/src/reports/index.ts
git commit -m "feat(core): add period-rollup orchestrator assembling ReportDataV1"
```

---

## Task 7: Add new store methods to Prisma stores

**Files:**

- Modify: `packages/db/src/stores/prisma-revenue-store.ts`
- Modify: `packages/db/src/stores/prisma-booking-store.ts`
- Modify: `packages/db/src/stores/prisma-opportunity-store.ts`
- Modify: `packages/db/src/stores/prisma-conversion-record-store.ts`
- Modify: `packages/db/src/recommendation-store.ts`

- [ ] **Step 1: Add `revenueWithFirstTouch` to PrismaRevenueStore**

In `packages/db/src/stores/prisma-revenue-store.ts`, add the following method to the `PrismaRevenueStore` class (before the closing brace of the class, around line 168):

```ts
  async revenueWithFirstTouch(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<
    Array<{
      amount: number;
      firstTouchSourceAdId: string | null;
      firstTouchSourceCampaignId: string | null;
      firstTouchSourceChannel: string | null;
    }>
  > {
    const events = await this.prisma.lifecycleRevenueEvent.findMany({
      where: {
        organizationId: input.orgId,
        status: "confirmed",
        recordedAt: { gte: input.from, lt: input.to },
      },
      select: {
        amount: true,
        contactId: true,
      },
    });

    if (events.length === 0) return [];

    const contactIds = [...new Set(events.map((e) => e.contactId))];

    const firstTouches = await this.prisma.conversionRecord.findMany({
      where: {
        contactId: { in: contactIds },
        organizationId: input.orgId,
      },
      orderBy: { createdAt: "asc" },
      select: {
        contactId: true,
        sourceAdId: true,
        sourceCampaignId: true,
        sourceChannel: true,
      },
    });

    const firstByContact = new Map<
      string,
      { sourceAdId: string | null; sourceCampaignId: string | null; sourceChannel: string | null }
    >();
    for (const cr of firstTouches) {
      if (!firstByContact.has(cr.contactId)) {
        firstByContact.set(cr.contactId, {
          sourceAdId: cr.sourceAdId,
          sourceCampaignId: cr.sourceCampaignId,
          sourceChannel: cr.sourceChannel,
        });
      }
    }

    return events.map((e) => {
      const ft = firstByContact.get(e.contactId);
      return {
        amount: e.amount,
        firstTouchSourceAdId: ft?.sourceAdId ?? null,
        firstTouchSourceCampaignId: ft?.sourceCampaignId ?? null,
        firstTouchSourceChannel: ft?.sourceChannel ?? null,
      };
    });
  }
```

- [ ] **Step 2: Add `countExcludingStatuses` to PrismaBookingStore**

In `packages/db/src/stores/prisma-booking-store.ts`, add to the class (before closing brace, around line 111):

```ts
  async countExcludingStatuses(input: {
    orgId: string;
    excludeStatuses: readonly string[];
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.prisma.booking.count({
      where: {
        organizationId: input.orgId,
        status: { notIn: [...input.excludeStatuses] },
        createdAt: { gte: input.from, lt: input.to },
      },
    });
  }
```

- [ ] **Step 3: Add `countClosedWon` to PrismaOpportunityStore**

In `packages/db/src/stores/prisma-opportunity-store.ts`, add to the class (before closing brace, around line 189):

```ts
  async countClosedWon(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.prisma.opportunity.count({
      where: {
        organizationId: input.orgId,
        closedAt: { not: null, gte: input.from, lt: input.to },
        lostReason: null,
      },
    });
  }
```

- [ ] **Step 4: Add `leadsBySource` to PrismaConversionRecordStore**

In `packages/db/src/stores/prisma-conversion-record-store.ts`, add to the class (before closing brace, around line 188):

```ts
  async leadsBySource(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<
    Array<{
      sourceAdId: string | null;
      sourceCampaignId: string | null;
      sourceChannel: string | null;
    }>
  > {
    return this.prisma.conversionRecord.findMany({
      where: {
        organizationId: input.orgId,
        type: "lead",
        occurredAt: { gte: input.from, lt: input.to },
      },
      select: {
        sourceAdId: true,
        sourceCampaignId: true,
        sourceChannel: true,
      },
    });
  }
```

- [ ] **Step 5: Add `latestByAgent` to PrismaRecommendationStore**

In `packages/db/src/recommendation-store.ts`, add to the `PrismaRecommendationStore` class (before closing brace, around line 216):

```ts
  async latestByAgent(input: {
    orgId: string;
    agentKey: string;
    from: Date;
    to: Date;
  }): Promise<{ date: Date; humanSummary: string } | null> {
    const row = await this.prisma.pendingActionRecord.findFirst({
      where: {
        organizationId: input.orgId,
        sourceAgent: input.agentKey,
        intent: { startsWith: "recommendation." },
        createdAt: { gte: input.from, lt: input.to },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, humanSummary: true },
    });
    if (!row) return null;
    return { date: row.createdAt, humanSummary: row.humanSummary };
  }
```

- [ ] **Step 6: Build db package**

Run: `npx pnpm@9.15.4 --filter @switchboard/db build`

Expected: Clean build.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/stores/prisma-revenue-store.ts packages/db/src/stores/prisma-booking-store.ts packages/db/src/stores/prisma-opportunity-store.ts packages/db/src/stores/prisma-conversion-record-store.ts packages/db/src/recommendation-store.ts
git commit -m "feat(db): add report-specific store methods for attribution, funnel, and cost queries"
```

---

## Task 8: Create `PrismaReportCacheStore` and `MetaReportInsightsProvider`

**Files:**

- Create: `packages/db/src/stores/prisma-report-cache-store.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/ad-optimizer/src/meta-report-insights-provider.ts`
- Modify: `packages/ad-optimizer/src/index.ts`

- [ ] **Step 1: Create `PrismaReportCacheStore`**

Create `packages/db/src/stores/prisma-report-cache-store.ts`:

```ts
import type { PrismaDbClient } from "../prisma-db.js";
import type { ReportCacheStore, ReportCacheRow } from "@switchboard/core";

export class PrismaReportCacheStore implements ReportCacheStore {
  constructor(private prisma: PrismaDbClient) {}

  async findByKey(orgId: string, window: string): Promise<ReportCacheRow | null> {
    const row = await this.prisma.reportCache.findUnique({
      where: {
        organizationId_window: { organizationId: orgId, window },
      },
    });
    if (!row) return null;
    return {
      organizationId: row.organizationId,
      window: row.window,
      payload: row.payload as ReportCacheRow["payload"],
      computedAt: row.computedAt,
      expiresAt: row.expiresAt,
    };
  }

  async upsert(row: ReportCacheRow): Promise<void> {
    await this.prisma.reportCache.upsert({
      where: {
        organizationId_window: {
          organizationId: row.organizationId,
          window: row.window,
        },
      },
      create: {
        organizationId: row.organizationId,
        window: row.window,
        payload: row.payload as object,
        computedAt: row.computedAt,
        expiresAt: row.expiresAt,
      },
      update: {
        payload: row.payload as object,
        computedAt: row.computedAt,
        expiresAt: row.expiresAt,
      },
    });
  }

  async invalidate(orgId: string, window: string): Promise<void> {
    await this.prisma.reportCache.deleteMany({
      where: { organizationId: orgId, window },
    });
  }
}
```

- [ ] **Step 2: Export from db barrel**

In `packages/db/src/index.ts`, add after line 119 (`PrismaRecommendationStore`):

```ts
export { PrismaReportCacheStore } from "./stores/prisma-report-cache-store.js";
```

- [ ] **Step 3: Create `MetaReportInsightsProvider`**

Create `packages/ad-optimizer/src/meta-report-insights-provider.ts`:

```ts
import type { ReportInsightsProvider, ReportInsightsMetrics } from "@switchboard/schemas";
import type { AdsClientInterface } from "./audit-runner.js";

interface MetaAction {
  action_type: string;
  value: string;
}

export class MetaReportInsightsProvider implements ReportInsightsProvider {
  constructor(
    private adsClient: AdsClientInterface,
    private _accountId: string,
  ) {}

  async getAggregateMetrics(dateRange: {
    since: string;
    until: string;
  }): Promise<ReportInsightsMetrics> {
    const rows = await this.adsClient.getCampaignInsights({
      dateRange,
      fields: ["impressions", "clicks", "spend", "actions"],
    });

    let impressions = 0;
    let clicks = 0;
    let landingPageViews = 0;
    let spend = 0;

    for (const row of rows) {
      impressions += Number(row.impressions ?? 0);
      clicks += Number(row.clicks ?? 0);
      spend += Number(row.spend ?? 0);

      const actions = (row as unknown as Record<string, unknown>).actions as
        | MetaAction[]
        | undefined;
      const lpv = actions?.find((a) => a.action_type === "landing_page_view");
      landingPageViews += Number(lpv?.value ?? 0);
    }

    return { impressions, clicks, landingPageViews, spend };
  }
}
```

- [ ] **Step 4: Export from ad-optimizer barrel**

In `packages/ad-optimizer/src/index.ts`, add after line 34 (`MetaCampaignInsightsProvider`):

```ts
export { MetaReportInsightsProvider } from "./meta-report-insights-provider.js";
```

- [ ] **Step 5: Build both packages**

Run: `npx pnpm@9.15.4 --filter @switchboard/db build && npx pnpm@9.15.4 --filter @switchboard/ad-optimizer build`

Expected: Clean builds.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-report-cache-store.ts packages/db/src/index.ts packages/ad-optimizer/src/meta-report-insights-provider.ts packages/ad-optimizer/src/index.ts
git commit -m "feat(db,ad-optimizer): add PrismaReportCacheStore and MetaReportInsightsProvider"
```

---

## Task 9: Create API route `dashboard-reports.ts`

**Files:**

- Create: `apps/api/src/routes/dashboard-reports.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Create the route handler**

Create `apps/api/src/routes/dashboard-reports.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";
import {
  createPeriodRollup,
  windowToRange,
  priorPeriodRange,
  type ReportDependencies,
  type ReportStores,
  type ReportCacheStore,
} from "@switchboard/core";
import type { ReportInsightsProvider, ReportWindow } from "@switchboard/schemas";

const VALID_WINDOWS = new Set<string>(["THIS WEEK", "THIS MONTH", "THIS QUARTER"]);
const CACHE_TTL_MS = 60 * 60 * 1000;

const PLAN_MONTHLY_USD: Record<string, number> = {
  Starter: 299,
  Pro: 499,
  Scale: 799,
};

function resolvePlanName(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  const mapping: Record<string, string> = {};
  if (process.env["STRIPE_PRICE_STARTER"]) mapping[process.env["STRIPE_PRICE_STARTER"]] = "Starter";
  if (process.env["STRIPE_PRICE_PRO"]) mapping[process.env["STRIPE_PRICE_PRO"]] = "Pro";
  if (process.env["STRIPE_PRICE_SCALE"]) mapping[process.env["STRIPE_PRICE_SCALE"]] = "Scale";
  return mapping[priceId] ?? null;
}

function resolvePlanMonthlyUSD(stripePriceId: string | null): number {
  const planName = resolvePlanName(stripePriceId);
  return PLAN_MONTHLY_USD[planName ?? ""] ?? 0;
}

async function computeReport(
  orgId: string,
  window: ReportWindow,
  reportCacheStore: ReportCacheStore,
  stores: ReportStores,
  insightsProvider: ReportInsightsProvider | null,
) {
  const now = new Date();
  const current = windowToRange(window, now);
  const prior = priorPeriodRange(current);

  const stripePriceId = await stores.orgConfig.getStripePriceId(orgId);
  const planMonthlyUSD = resolvePlanMonthlyUSD(stripePriceId);

  const deps: ReportDependencies = {
    stores,
    insightsProvider,
    reportCache: reportCacheStore,
    planMonthlyUSD,
  };

  const rollup = createPeriodRollup(deps);
  const payload = await rollup({ orgId, current, prior, computedAt: now });

  await reportCacheStore.upsert({
    organizationId: orgId,
    window,
    payload,
    computedAt: now,
    expiresAt: new Date(now.getTime() + CACHE_TTL_MS),
  });

  return payload;
}

export const dashboardReportsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/dashboard/reports", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { window } = request.query as { window?: string };
    if (!window || !VALID_WINDOWS.has(window)) {
      return reply
        .code(400)
        .send({ error: "Invalid window. Use THIS WEEK, THIS MONTH, or THIS QUARTER." });
    }
    const reportWindow = window as ReportWindow;

    if (!app.reportCacheStore || !app.reportStores) {
      return reply.code(503).send({ error: "Report dependencies not available" });
    }

    const cached = await app.reportCacheStore.findByKey(orgId, reportWindow);
    if (cached && cached.expiresAt > new Date()) {
      return cached.payload;
    }

    const payload = await computeReport(
      orgId,
      reportWindow,
      app.reportCacheStore,
      app.reportStores,
      app.reportInsightsProvider ?? null,
    );

    return payload;
  });

  app.post("/api/dashboard/reports/refresh", async (request, reply) => {
    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const { window } = request.query as { window?: string };
    if (!window || !VALID_WINDOWS.has(window)) {
      return reply
        .code(400)
        .send({ error: "Invalid window. Use THIS WEEK, THIS MONTH, or THIS QUARTER." });
    }
    const reportWindow = window as ReportWindow;

    if (!app.reportCacheStore || !app.reportStores) {
      return reply.code(503).send({ error: "Report dependencies not available" });
    }

    await app.reportCacheStore.invalidate(orgId, reportWindow);

    const payload = await computeReport(
      orgId,
      reportWindow,
      app.reportCacheStore,
      app.reportStores,
      app.reportInsightsProvider ?? null,
    );

    return payload;
  });
};
```

- [ ] **Step 2: Wire stores and cache in `app.ts`**

In `apps/api/src/app.ts`, after the orgAgentEnablementStore block (around line 495), add:

```ts
// Report cache store + report projection stores for /api/dashboard/reports
if (prismaClient) {
  const {
    PrismaReportCacheStore,
    PrismaRevenueStore,
    PrismaBookingStore,
    PrismaOpportunityStore,
    PrismaConversionRecordStore,
    PrismaRecommendationStore: PrismaRecStore,
  } = await import("@switchboard/db");

  app.decorate("reportCacheStore", new PrismaReportCacheStore(prismaClient));

  const reportStores = {
    revenue: new PrismaRevenueStore(prismaClient),
    bookings: new PrismaBookingStore(prismaClient),
    opportunities: new PrismaOpportunityStore(prismaClient),
    conversions: new PrismaConversionRecordStore(prismaClient),
    recommendations: new PrismaRecStore(prismaClient),
    orgConfig: {
      getStripePriceId: async (orgId: string) => {
        const config = await prismaClient.organizationConfig.findUnique({
          where: { organizationId: orgId },
          select: { stripePriceId: true },
        });
        return config?.stripePriceId ?? null;
      },
    },
  };
  app.decorate("reportStores", reportStores);
}

// Report insights provider — constructed per-org at request time in the route,
// but the MetaAdsClient factory needs to be available. For now, decorator is
// null; the route constructs the provider per-request from Connection data.
app.decorate("reportInsightsProvider", null);
```

Also add the type augmentation in the `declare module "fastify"` block in `app.ts`. Find the existing FastifyInstance augmentation and add:

```ts
    reportCacheStore?: import("@switchboard/core").ReportCacheStore;
    reportStores?: import("@switchboard/core").ReportStores;
    reportInsightsProvider?: import("@switchboard/schemas").ReportInsightsProvider | null;
```

- [ ] **Step 3: Register the route**

In `apps/api/src/bootstrap/routes.ts`, add the import at the top:

```ts
import { dashboardReportsRoutes } from "../routes/dashboard-reports.js";
```

Add the registration in `registerRoutes`, after the `billingRoutes` line (line 131):

```ts
await app.register(dashboardReportsRoutes);
```

- [ ] **Step 4: Build the API**

Run: `npx pnpm@9.15.4 --filter @switchboard/api build`

Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/dashboard-reports.ts apps/api/src/app.ts apps/api/src/bootstrap/routes.ts
git commit -m "feat(api): add GET/POST /api/dashboard/reports with 1h cache"
```

---

## Task 10: Add API route tests

**Files:**

- Create: `apps/api/src/__tests__/api-reports.test.ts`
- Modify: `apps/api/src/__tests__/test-server.ts`

- [ ] **Step 1: Extend test-server with report dependencies**

In `apps/api/src/__tests__/test-server.ts`, you need to:

1. Add to the `declare module "fastify"` block (around line 86):

```ts
    reportCacheStore?: import("@switchboard/core").ReportCacheStore;
    reportStores?: import("@switchboard/core").ReportStores;
    reportInsightsProvider?: import("@switchboard/schemas").ReportInsightsProvider | null;
```

2. In the `buildTestServer` function, after the existing store decorations, add:

```ts
const { createInMemoryReportCacheStore } = await import("@switchboard/core");

app.decorate("reportCacheStore", createInMemoryReportCacheStore());
app.decorate("reportStores", {
  revenue: {
    sumByOrg: async () => ({ totalAmount: 5000, count: 3 }),
    revenueWithFirstTouch: async () => [
      {
        amount: 5000,
        firstTouchSourceAdId: "ad-1",
        firstTouchSourceCampaignId: "c-1",
        firstTouchSourceChannel: null,
      },
    ],
  },
  bookings: { countExcludingStatuses: async () => 10 },
  opportunities: { countClosedWon: async () => 3 },
  conversions: {
    countByType: async () => 50,
    leadsBySource: async () => [
      { sourceAdId: "ad-1", sourceCampaignId: "c-1", sourceChannel: null },
    ],
  },
  recommendations: { latestByAgent: async () => null },
  orgConfig: { getStripePriceId: async () => null },
});
app.decorate("reportInsightsProvider", {
  getAggregateMetrics: async () => ({
    impressions: 1000,
    clicks: 200,
    landingPageViews: 150,
    spend: 500,
  }),
});
```

3. Register the route in the test server:

```ts
const { dashboardReportsRoutes } = await import("../routes/dashboard-reports.js");
await app.register(dashboardReportsRoutes);
```

- [ ] **Step 2: Write the API tests**

Create `apps/api/src/__tests__/api-reports.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildTestServer, type TestContext } from "./test-server.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await buildTestServer();
});

afterEach(async () => {
  await ctx.app.close();
});

describe("GET /api/dashboard/reports", () => {
  it("returns 400 for invalid window", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=INVALID",
      headers: { "x-organization-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns ReportDataV1 for valid window", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20MONTH",
      headers: { "x-organization-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.label).toBe("THIS MONTH");
    expect(body.funnel).toHaveLength(6);
    expect(body.attribution).toBeDefined();
    expect(body.cost).toBeDefined();
    expect(body.campaigns).toEqual([]);
    expect(body.managedComparison).toBeNull();
  });

  it("returns cached payload on second request", async () => {
    const res1 = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20MONTH",
      headers: { "x-organization-id": "org-test" },
    });
    const res2 = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard/reports?window=THIS%20MONTH",
      headers: { "x-organization-id": "org-test" },
    });
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.json().label).toBe(res2.json().label);
  });
});

describe("POST /api/dashboard/reports/refresh", () => {
  it("returns fresh data after cache bust", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/reports/refresh?window=THIS%20MONTH",
      headers: { "x-organization-id": "org-test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.label).toBe("THIS MONTH");
    expect(body.funnel).toHaveLength(6);
  });

  it("returns 400 for invalid window", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/dashboard/reports/refresh?window=NOPE",
      headers: { "x-organization-id": "org-test" },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run api-reports`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/__tests__/api-reports.test.ts apps/api/src/__tests__/test-server.ts
git commit -m "test(api): add api-reports tests for GET/POST /api/dashboard/reports"
```

---

## Task 11: Wire dashboard hook live branch + query keys

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Modify: `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts`

- [ ] **Step 1: Add reports key to query-keys.ts**

In `apps/dashboard/src/lib/query-keys.ts`, add a `reports` section to the `scopedKeys` factory. Find the factory and add alongside the existing keys:

```ts
  reports: {
    byWindow: (window: string) => [orgId, "reports", window] as const,
  },
```

- [ ] **Step 2: Rewrite useReportData with live branch**

Replace the entire contents of `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts`:

```ts
"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import { FIXTURES_BY_WINDOW, type ReportData, type ReportWindow } from "../fixtures";

export interface UseReportData {
  data: ReportData | undefined;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

const isLive = process.env.NEXT_PUBLIC_REPORTS_LIVE === "true";

export function useReportData(window: ReportWindow): UseReportData {
  const keys = useScopedQueryKeys();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<ReportData>({
    queryKey: keys?.reports.byWindow(window) ?? ["__disabled_reports__"],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/reports?window=${encodeURIComponent(window)}`);
      if (!res.ok) throw new Error(`Failed to load report: ${res.status}`);
      return res.json();
    },
    enabled: isLive && !!keys,
  });

  const refresh = useCallback(async () => {
    if (!isLive || !keys) return;
    await fetch(`/api/dashboard/reports/refresh?window=${encodeURIComponent(window)}`, {
      method: "POST",
    });
    await queryClient.invalidateQueries({
      queryKey: keys.reports.byWindow(window),
    });
  }, [window, keys, queryClient]);

  if (!isLive) {
    return {
      data: FIXTURES_BY_WINDOW[window],
      isLoading: false,
      error: null,
      refresh: async () => {},
    };
  }

  return {
    data,
    isLoading,
    error: error as Error | null,
    refresh,
  };
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard typecheck`

Expected: Clean typecheck (no errors related to reports hook).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/app/\(auth\)/reports/hooks/use-report-data.ts
git commit -m "feat(dashboard): wire useReportData live branch with react-query behind feature flag"
```

---

## Task 12: Run full test suite and typecheck

- [ ] **Step 1: Run all core tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run`

Expected: All tests pass, including attribution-rule, funnel-rollup, cost-vs-value-rule, period-rollup.

- [ ] **Step 2: Run API tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test -- --run`

Expected: All tests pass, including api-reports.

- [ ] **Step 3: Run full typecheck**

Run: `npx pnpm@9.15.4 typecheck`

Expected: Clean typecheck across all packages.

- [ ] **Step 4: Run lint**

Run: `npx pnpm@9.15.4 lint`

Expected: No lint errors.

- [ ] **Step 5: Fix any issues found, then commit**

If any issues were found in steps 1-4, fix them and commit:

```bash
git add -A
git commit -m "fix(reports): address lint and typecheck issues from PR-R3"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] `npx pnpm@9.15.4 typecheck` passes
- [ ] `npx pnpm@9.15.4 test` passes
- [ ] `npx pnpm@9.15.4 lint` passes
- [ ] With `NEXT_PUBLIC_REPORTS_LIVE=false` (default), `/reports` renders fixtures unchanged
- [ ] With `NEXT_PUBLIC_REPORTS_LIVE=true` + running API, `/reports` renders live attribution, funnel (6 stages), and cost-vs-value sections
- [ ] Campaigns section renders empty table (stub)
- [ ] Managed comparison section is hidden (null)
- [ ] Cache hit returns instantly on second page load within 1h
- [ ] Refresh button busts cache and produces fresh data
