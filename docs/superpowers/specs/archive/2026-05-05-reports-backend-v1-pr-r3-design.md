# PR-R3 Design: Period Rollup (Attribution + 6-Stage Funnel + Cost-vs-Value + Cache + Live API)

**Parent spec:** `2026-05-05-reports-backend-v1-design.md` §9 PR-R3
**Status:** Approved with corrections
**Date:** 2026-05-05

---

## 1. What PR-R3 Delivers

PR-R3 makes `/reports` partly live. Three sections render real data; three remain stubbed:

| Section            | Status   | Source                                |
| ------------------ | -------- | ------------------------------------- |
| Attribution        | **Live** | First-touch bucketing via store joins |
| Funnel (6 stages)  | **Live** | Meta insights API + store queries     |
| Cost-vs-Value      | **Live** | Price-id-derived estimate + constants |
| Campaigns          | Stub     | Fixture data from orchestrator        |
| Managed Comparison | Stub     | `null`                                |
| Pull Quote         | Stub     | Deterministic template                |

The dashboard hook (`useReportData`) gains a react-query live branch gated by `NEXT_PUBLIC_REPORTS_LIVE` (remains `false` in prod). API endpoints: `GET /api/dashboard/reports?window=…` and `POST /api/dashboard/reports/refresh?window=…`. Results cached for 1h in `ReportCache`.

---

## 2. Architecture (Layer Compliance)

```
schemas (L1)    → ReportInsightsProvider interface, ReportInsightsMetrics type
ad-optimizer (L2) → MetaReportInsightsProvider implementation (uses AdsClientInterface)
core (L3)       → ReportStores interfaces, rollup functions (attribution, funnel, cost-vs-value, period-rollup)
db (L4)         → Prisma store implementations satisfying ReportStores + PrismaReportCacheStore
apps/api (L5)   → Route handler: wires stores + provider + cache, calls period-rollup
apps/dashboard  → Hook live branch (react-query), no component changes
```

Core does not import db or ad-optimizer. All dependencies injected at the API route layer.

---

## 3. New Interfaces

### 3.1 `ReportInsightsProvider` — in `packages/schemas/src/reports/v1.ts`

Cross-package provider interface (follows `CampaignInsightsProvider` convention in schemas). The implementation in ad-optimizer is pre-bound to an account at construction time — core only supplies a date range.

```ts
export interface ReportInsightsProvider {
  getAggregateMetrics(dateRange: { since: string; until: string }): Promise<ReportInsightsMetrics>;
}

export interface ReportInsightsMetrics {
  impressions: number;
  clicks: number;
  landingPageViews: number;
  spend: number;
}
```

If the org has no connected Meta account, the API route passes `null` for the provider. The funnel rollup renders the top 3 rows as `n: 0` with a "No ad account connected" narrative.

### 3.2 `ReportStores` — in `packages/core/src/reports/interfaces.ts`

Core-owned thin read-only interfaces. Each sub-object defines only the methods the rollups need. Prisma stores in `packages/db` implement them; `apps/api` wires the concrete implementations.

```ts
export interface ReportStores {
  revenue: {
    /** Existing method — positional args match PrismaRevenueStore.sumByOrg. */
    sumByOrg(
      orgId: string,
      dateRange: { from: Date; to: Date },
    ): Promise<{ totalAmount: number; count: number }>;

    /**
     * Revenue events joined with first-touch attribution data.
     * Prisma join: LifecycleRevenueEvent.contactId → first ConversionRecord
     *   per contactId (oldest createdAt). Direct join — no Opportunity hop needed.
     * Returns null firstTouch fields when no ConversionRecord exists (manual entry).
     */
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
    /** closedAt NOT NULL AND lostReason IS NULL, closedAt within [from, to). */
    countClosedWon(input: { orgId: string; from: Date; to: Date }): Promise<number>;
  };

  conversions: {
    /** Existing method — positional args match PrismaConversionRecordStore.countByType. */
    countByType(orgId: string, type: string, from: Date, to: Date): Promise<number>;

    /** Leads in period with source fields for attribution caption counting. */
    leadsBySource(input: { orgId: string; from: Date; to: Date }): Promise<
      Array<{
        sourceAdId: string | null;
        sourceCampaignId: string | null;
        sourceChannel: string | null;
      }>
    >;
  };

  recommendations: {
    /** Latest PendingActionRecord for agentKey (sourceAgent) in the period. */
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

### 3.3 `ReportDependencies` — in `packages/core/src/reports/period-rollup.ts`

Dependency bag for the period-rollup factory:

```ts
export interface ReportDependencies {
  stores: ReportStores;
  insightsProvider: ReportInsightsProvider | null;
  reportCache: ReportCacheStore;
  planMonthlyUSD: number;
}
```

`planMonthlyUSD` is resolved at the API route layer: `stripePriceId → plan name → monthly USD` using the existing `resolvePlanName` billing logic + a plan-to-price config. Core receives a plain number and does the proration math. This is a price-id-derived estimate, not Stripe invoice data (labeled as such in the cost narrative; invoice-based `paid` is a Phase D upgrade).

### 3.4 Locked types and closure pattern

The locked function types in `interfaces.ts` (`AttributionRule`, `FunnelRollup`, `CostVsValueRule`) take only `(ctx: RollupContext)`. The implementation functions need additional dependencies (stores, provider, pricing config). Resolution: each implementation is a module-internal function with its full parameter list. The period-rollup orchestrator calls them directly, passing the dependencies from `ReportDependencies`. The locked types document the input/output contract (what goes in, what comes out) — the orchestrator satisfies them implicitly.

Additionally, PR-R3 updates the `FunnelRollup` JSDoc in `interfaces.ts` from "5-stage" to "6-stage" to reflect the approved spec change (§3 Decision #2b).

---

## 4. Implementation Files

### 4.1 `core/reports/attribution-rule.ts`

Implements the locked `AttributionRule` type. First-touch bucketing per spec §3 Decision #1.

**Input:** `RollupContext` + `ReportStores`

**Logic:**

1. Call `stores.revenue.revenueWithFirstTouch` for current and prior periods
2. Bucket each event:
   - `firstTouchSourceAdId || firstTouchSourceCampaignId` → Riley
   - Everything else (chat-sourced or null/manual-entry) → Alex
3. Call `stores.conversions.leadsBySource` for current period
4. Count leads per bucket (same bucketing rule) + count distinct `sourceCampaignId` for Riley
5. Build captions:
   - Riley: `"{N} campaigns · {M} leads"`
   - Alex: `"chat · {M} leads"`
6. Compute delta: percentage change of total revenue vs prior period total
   - Prior total zero → `delta: { kind: "flat", text: "no prior data" }`

**Returns:** `AttributionData` (`{ total, delta, riley: { value, caption }, alex: { value, caption } }`)

### 4.2 `core/reports/funnel-rollup.ts`

Implements the locked `FunnelRollup` type. 6-stage funnel per spec §3 Decision #2/#2b.

**Input:** `RollupContext` + `ReportStores` + `ReportInsightsProvider | null`

**6 stages, each queried for current and prior period:**

| #   | Stage              | Label                  | Source                                                                              |
| --- | ------------------ | ---------------------- | ----------------------------------------------------------------------------------- |
| 1   | Impressions        | `"Impressions"`        | `provider.getAggregateMetrics(dateRange).impressions`                               |
| 2   | Clicks             | `"Clicks"`             | `provider.getAggregateMetrics(dateRange).clicks`                                    |
| 3   | Landing Page Views | `"Landing page views"` | `provider.getAggregateMetrics(dateRange).landingPageViews`                          |
| 4   | Leads              | `"Leads"`              | `stores.conversions.countByType(orgId, "lead", from, to)`                           |
| 5   | Bookings           | `"Bookings"`           | `stores.bookings.countExcludingStatuses({orgId, ["cancelled","failed"], from, to})` |
| 6   | Customers          | `"Customers"`          | `stores.opportunities.countClosedWon({orgId, from, to})`                            |

Stage labels are per spec: Customers = closed-won opportunities (not "Revenue", not "Attended").

`getAggregateMetrics` is called once per period (returns all three Meta metrics in one call). If `provider` is null (no Meta account), stages 1-3 render `n: 0, delta: null`.

**Delta per stage:** `{ kind: "pos"|"neg"|"flat", text: "+N%" }` from `(current - prior) / prior * 100`. Prior zero → `delta: null` (renders "no prior data").

**Funnel narrative:** Queries `stores.recommendations.latestByAgent({orgId, agentKey: "riley", from, to})`. Formats as `{ marker: "Riley", text: "{date} — {humanSummary}" }`. Static fallback: `{ marker: "Riley", text: "No analysis available for this period." }`.

**Landing Page Views disclosure:** The cost narrative or funnel footnote includes: _"Landing Page Views are from Meta ad events. First-party website tracking is planned for a future release."_

### 4.3 `core/reports/cost-vs-value-rule.ts`

Implements the locked `CostVsValueRule` type. Per spec §3 Decision #6.

**Input:** `RollupContext` + `planMonthlyUSD: number`

**Constants:**

```ts
export const SDR_MONTHLY_USD = 5000;
export const AGENCY_MONTHLY_USD = 3000;
export const COST_VS_VALUE_FOOTNOTE =
  "Based on US SMB hiring averages — junior SDR ~$5,000/mo, ad agency retainer ~$3,000/mo.";
```

**Logic:**

1. `daysInWindow = (current.end.getTime() - current.start.getTime()) / MS_PER_DAY`
2. `paid = planMonthlyUSD * (daysInWindow / 30)` (prorated to window)
3. `alt = (SDR_MONTHLY_USD + AGENCY_MONTHLY_USD) * (daysInWindow / 30)`
4. `saving = alt - paid`
5. Narrative: deterministic template interpolating `formatCurrencyUSD(paid)`, `formatCurrencyUSD(alt)`, `formatCurrencyUSD(saving)`
6. If `planMonthlyUSD === 0` → `paid = 0`, narrative notes "No active subscription detected."

**Estimate label:** Narrative includes: _"Switchboard cost is estimated from your subscription plan. Actual invoice amounts may vary."_

**Returns:** `{ cost: CostBreakdown, costNarrative: string }`

### 4.4 `core/reports/period-rollup.ts`

Implements the locked `PeriodRollup` type. Factory function that takes `ReportDependencies` and returns a `PeriodRollup` function.

```ts
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

The three live sections run in `Promise.all` (no data dependency between them). Stub constants are minimal valid `ReportDataV1` fragments: empty `CampaignRow[]` for campaigns, `null` for managedComparison, deterministic template for pullquote. Current window is guarded explicitly — no non-null assertion.

---

## 5. Prisma Store Implementations (`packages/db/`)

### 5.1 New file: `prisma-report-cache-store.ts`

Implements `ReportCacheStore` from `core/reports/interfaces.ts`. Simple CRUD on the `ReportCache` table:

- `findByKey(orgId, window)` → `findUnique` on composite `@@unique([organizationId, window])`
- `upsert(row)` → `upsert` with the same composite key
- `invalidate(orgId, window)` → `deleteMany` matching key (idempotent)

### 5.2 Existing stores gain new methods

| Store                         | New Method                 | Implementation                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PrismaRevenueStore`          | `revenueWithFirstTouch()`  | Join `LifecycleRevenueEvent.contactId` → subquery for first `ConversionRecord` per `contactId` ordered by `createdAt ASC LIMIT 1`. Direct join — both tables have `contactId` with indexes. Returns amount + first-touch source fields. |
| `PrismaBookingStore`          | `countExcludingStatuses()` | `count({ where: { organizationId, status: { notIn }, createdAt: { gte: from, lt: to } } })`                                                                                                                                             |
| `PrismaOpportunityStore`      | `countClosedWon()`         | `count({ where: { organizationId, closedAt: { not: null, gte: from, lt: to }, lostReason: null } })`                                                                                                                                    |
| `PrismaConversionRecordStore` | `leadsBySource()`          | `findMany({ where: { organizationId, type: "lead", createdAt: { gte: from, lt: to } }, select: { sourceAdId, sourceCampaignId, sourceChannel } })`                                                                                      |
| `PrismaRecommendationStore`   | `latestByAgent()`          | `findFirst({ where: { organizationId, sourceAgent: agentKey, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "desc" } })` → maps to `{ date, humanSummary }`                                                                  |

Additionally, a thin `OrgConfigReader` (or method on an existing store): `getStripePriceId(orgId)` → `findUnique` on `OrganizationConfig` returning `stripePriceId`.

### 5.3 New file: `packages/ad-optimizer/src/meta-report-insights-provider.ts`

Implements `ReportInsightsProvider`. Constructor takes `AdsClientInterface` + `accountId`.

```ts
export class MetaReportInsightsProvider implements ReportInsightsProvider {
  constructor(
    private adsClient: AdsClientInterface,
    private accountId: string,
  ) {}

  async getAggregateMetrics(dateRange: { since: string; until: string }) {
    const rows = await this.adsClient.getCampaignInsights({
      dateRange,
      fields: ["impressions", "clicks", "spend", "actions"],
    });

    let impressions = 0,
      clicks = 0,
      landingPageViews = 0,
      spend = 0;
    for (const row of rows) {
      impressions += Number(row.impressions ?? 0);
      clicks += Number(row.clicks ?? 0);
      spend += Number(row.spend ?? 0);
      // Extract landing_page_view from actions array
      const actions = (row as Record<string, unknown>).actions as
        | Array<{ action_type: string; value: string }>
        | undefined;
      const lpv = actions?.find((a) => a.action_type === "landing_page_view");
      landingPageViews += Number(lpv?.value ?? 0);
    }

    return { impressions, clicks, landingPageViews, spend };
  }
}
```

The raw `actions` field is not in the current `CampaignInsight` mapped type — the provider accesses it from the raw response before the mapper discards it. Implementation detail: either bypass `mapCampaignInsight` or extend the mapper to preserve `actions`. The interface contract (`ReportInsightsMetrics`) is stable either way.

---

## 6. API Route

### 6.1 `apps/api/src/routes/dashboard-reports.ts`

Fastify plugin, registered in `bootstrap/routes.ts`.

```
GET /api/dashboard/reports?window=THIS_MONTH
  → requireOrganizationScope(request, reply) → orgId (403 if missing)
  → validate window ∈ ["THIS WEEK", "THIS MONTH", "THIS QUARTER"] (400 if invalid)
  → reportCacheStore.findByKey(orgId, window)
    → if row exists AND expiresAt > now → return row.payload
  → on cache miss:
    → resolve Connection (orgId, serviceId='meta') → accountId (nullable)
    → build insightsProvider: accountId ? new MetaReportInsightsProvider(adsClient, accountId) : null
    → resolve planMonthlyUSD from stripePriceId + env-driven plan pricing
    → build ReportDependencies { stores, insightsProvider, reportCache, planMonthlyUSD }
    → createPeriodRollup(deps)({ orgId, current, prior, computedAt: now })
    → reportCacheStore.upsert({ orgId, window, payload, computedAt: now, expiresAt: now + 1h })
    → return payload

POST /api/dashboard/reports/refresh?window=THIS_MONTH
  → requireOrganizationScope → orgId
  → validate window
  → reportCacheStore.invalidate(orgId, window)
  → same computation as cache-miss path
  → return fresh payload
```

**Plan pricing resolution** (in the route, not in core):

```ts
// Values are illustrative — confirm against live Stripe dashboard before shipping.
const PLAN_MONTHLY_USD: Record<string, number> = {
  Starter: 299,
  Pro: 499,
  Scale: 799,
};

function resolvePlanMonthlyUSD(stripePriceId: string | null): number {
  if (!stripePriceId) return 0;
  const planName = resolvePlanName(stripePriceId); // existing billing.ts helper
  return PLAN_MONTHLY_USD[planName ?? ""] ?? 0;
}
```

### 6.2 Wiring in `apps/api/src/app.ts`

Decorate `reportCacheStore` on the Fastify instance (same pattern as `recommendationStore`):

```ts
if (prismaClient) {
  const { PrismaReportCacheStore } = await import("@switchboard/db");
  app.decorate("reportCacheStore", new PrismaReportCacheStore(prismaClient));
}
```

Add type augmentation for `reportCacheStore` in the FastifyInstance module declaration.

### 6.3 Registration in `apps/api/src/bootstrap/routes.ts`

```ts
const { default: dashboardReportsRoutes } = await import("../routes/dashboard-reports.js");
await app.register(dashboardReportsRoutes);
```

---

## 7. Dashboard Hook Live Branch

### 7.1 `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts`

The hook gains a react-query branch when `NEXT_PUBLIC_REPORTS_LIVE === "true"`:

```ts
const isLive = process.env.NEXT_PUBLIC_REPORTS_LIVE === "true";

if (isLive) {
  const { data, isLoading, error, refetch } = useQuery<ReportDataV1>({
    queryKey: ["reports", window],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/reports?window=${encodeURIComponent(window)}`);
      if (!res.ok) throw new Error(`Failed to load report: ${res.status}`);
      return res.json();
    },
  });

  return {
    data,
    isLoading,
    error: error as Error | null,
    refresh: async () => {
      await fetch(`/api/dashboard/reports/refresh?window=${encodeURIComponent(window)}`, {
        method: "POST",
      });
      await refetch();
    },
  };
}
// else: existing fixture path unchanged
```

`res.ok` is checked — non-200 responses throw rather than silently parsing error HTML/JSON.

### 7.2 No component changes

The page, funnel, attribution, cost-vs-value, and all other components consume `ReportDataV1` from the hook. The hook's return type (`UseReportData`) is unchanged. The funnel component already renders `data.map(row => ...)` dynamically — a 6th row (Customers) renders automatically with no CSS changes needed. Verify during implementation and adjust only if visual balance requires it.

---

## 8. Testing

All core tests use in-memory store implementations (from `in-memory-store.ts`) + jest mocks for the insights provider.

| File                                     | Cases                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attribution-rule.test.ts`               | Table-driven: (1) ad-first lead → Riley, (2) chat-first lead → Alex, (3) manual-entry revenue (no ConversionRecord) → Alex, (4) no conversions in period → zeroed. Edge cases: multiple opportunities for one contact, zero-revenue opportunity.                    |
| `funnel-rollup.test.ts`                  | (1) Full data across 6 stages, (2) null provider (no Meta account) → top 3 rows zeroed, (3) zero leads, (4) zero impressions, (5) prior-period zero → delta null.                                                                                                   |
| `cost-vs-value-rule.test.ts`             | (1) Monthly plan prorated to week/month/quarter, (2) planMonthlyUSD = 0 (no subscription), (3) saving computation correctness.                                                                                                                                      |
| `period-rollup.test.ts`                  | Orchestrator with mocked section rollups. Verifies: (1) all three live sections called, (2) stub sections produce valid ReportDataV1 fragments, (3) current.window null → throws, (4) Promise.all parallelism (sections don't block each other).                    |
| `apps/api/__tests__/api-reports.test.ts` | `buildTestServer` with mocked Prisma stores: (1) cache hit returns payload, (2) cache miss computes + caches, (3) refresh invalidates then computes, (4) invalid window → 400, (5) no org scope → 403, (6) no Meta connection → provider null, funnel top 3 zeroed. |
| `use-report-data.test.ts`                | (1) Fixture branch (flag off) returns fixture data, (2) live branch (flag on) calls fetch + returns data, (3) live branch non-OK response → error state, (4) refresh calls POST then refetches.                                                                     |

---

## 9. Corrections Applied (vs. initial design)

| #   | Correction                   | Resolution                                                                                                                    |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | 6-stage funnel vs 5-stage    | Kept 6 stages per approved spec §3 Decision #2b. Customers = closed-won Opportunity.                                          |
| 2   | Landing Page Views source    | Meta insights `landing_page_view` for v1. First-party pixel deferred to Phase D per approved spec. Disclosure footnote added. |
| 3   | Cost-vs-value estimate label | `paid` is price-id-derived estimate, labeled as such in narrative. Invoice-based paid is Phase D.                             |
| 4   | `current.window!` unsafe     | Replaced with explicit guard: `if (!current.window) throw`.                                                                   |
| 5   | Hook `res.ok` handling       | Added `if (!res.ok) throw new Error(...)` before `.json()`.                                                                   |

---

## 10. Files Changed (Summary)

**New files:**

- `packages/schemas/src/reports/v1.ts` — add `ReportInsightsProvider`, `ReportInsightsMetrics`
- `packages/core/src/reports/attribution-rule.ts` + `.test.ts`
- `packages/core/src/reports/funnel-rollup.ts` + `.test.ts`
- `packages/core/src/reports/cost-vs-value-rule.ts` + `.test.ts`
- `packages/core/src/reports/period-rollup.ts` + `.test.ts`
- `packages/db/src/stores/prisma-report-cache-store.ts`
- `packages/ad-optimizer/src/meta-report-insights-provider.ts`
- `apps/api/src/routes/dashboard-reports.ts`
- `apps/api/src/__tests__/api-reports.test.ts`

**Modified files:**

- `packages/core/src/reports/interfaces.ts` — add `ReportStores`
- `packages/core/src/reports/index.ts` — export new modules
- `packages/db/src/stores/prisma-revenue-store.ts` — add `revenueWithFirstTouch()`
- `packages/db/src/stores/prisma-booking-store.ts` — add `countExcludingStatuses()`
- `packages/db/src/stores/prisma-opportunity-store.ts` — add `countClosedWon()`
- `packages/db/src/stores/prisma-conversion-record-store.ts` — add `leadsBySource()`
- `packages/db/src/recommendation-store.ts` — add `latestByAgent()`
- `packages/db/src/index.ts` — export `PrismaReportCacheStore`
- `packages/ad-optimizer/src/index.ts` — export `MetaReportInsightsProvider`
- `apps/api/src/app.ts` — decorate `reportCacheStore`, type augmentation
- `apps/api/src/bootstrap/routes.ts` — register dashboard-reports route
- `apps/dashboard/src/app/(auth)/reports/hooks/use-report-data.ts` — live branch
- `apps/dashboard/src/app/(auth)/reports/hooks/__tests__/use-report-data.test.ts` — live branch tests
