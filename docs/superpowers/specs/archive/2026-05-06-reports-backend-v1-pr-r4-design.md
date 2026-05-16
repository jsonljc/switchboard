# PR-R4 — Campaign Rollup + Managed-vs-Unmanaged Comparison

**Date:** 2026-05-06
**Branch:** `feat/reports-backend-v1-r4` (from `main`)
**Depends on:** PR-R3 (#370, merged)

---

## 1. Summary

PR-R4 replaces the two remaining stubs in `period-rollup.ts` (`campaigns: []` and `managedComparison: null`) with live data. It also wires `MetaReportInsightsProvider` per-org in the API route (fixing PR-R3's I1 — funnel top 3 stages showing zero), and adds an operator-only `/operator/reports` dashboard page that shows everything `/reports` shows plus the managed-vs-unmanaged comparison section.

---

## 2. Key Decisions (from brainstorming)

| #   | Decision                                                       | Rationale                                                                                                                                                                   |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Extend `ReportInsightsProvider` with `getCampaignMetrics`      | Provider already fetches per-campaign rows and discards them; expose instead of introducing a second provider                                                               |
| D2  | Remove `CampaignStage` and `stage` from `CampaignRow`          | No product reason for hot/warm/cool in v1; YAGNI                                                                                                                            |
| D3  | Lazy-pull baseline instead of Inngest event                    | Simpler — no onboarding code coupling, self-healing on retry. Baseline is operator-only so no customer-facing latency concern                                               |
| D4  | Managed comparison is operator-only                            | Lives on `/operator/reports`, never on customer-facing `/reports`                                                                                                           |
| D5  | Ads comparison always uses baseline                            | Riley manages whole account; no in-period unmanaged cohort. Per-campaign tagging deferred                                                                                   |
| D6  | Conversations comparison uses in-period cohort                 | `ConversationThread.assignedAgent` splits Alex-managed vs operator-managed                                                                                                  |
| D7  | Revenue lags spend — show as-is                                | CPL is the actionable early metric; ROAS becomes meaningful when revenue data accumulates                                                                                   |
| D8  | Leads from Meta Insights, revenue from `sourceCampaignId` join | Meta's per-campaign `conversions` count includes all attributed leads (CTWA, instant form, CAPI/website). Revenue still joins via `LifecycleRevenueEvent.sourceCampaignId`. |
| D9  | Wire provider per-org via Connection lookup                    | `Connection` with `serviceId='meta'` + `status='connected'` → `externalAccountId` → decrypt credentials → `MetaAdsClient` → `MetaReportInsightsProvider`                    |

---

## 3. Schema Changes

### 3.1 `packages/schemas/src/reports/v1.ts`

**Remove:**

- `CampaignStage` type
- `stage` field from `CampaignRow`

**Add:**

```ts
export interface ReportCampaignInsight {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
}
```

**Extend `ReportInsightsProvider`:**

```ts
export interface ReportInsightsProvider {
  getAggregateMetrics(dateRange: { since: string; until: string }): Promise<ReportInsightsMetrics>;
  getCampaignMetrics(dateRange: { since: string; until: string }): Promise<ReportCampaignInsight[]>;
}
```

### 3.2 `CampaignRow` after change

```ts
export interface CampaignRow {
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number; // Meta-native (spend / clicks)
  ctr: number; // Meta-native (clicks / impressions)
  leads: number;
  revenue: number;
  cpl: number | null; // spend / Switchboard leads (null when leads=0)
  clickToLeadRate: number | null; // Switchboard leads / Meta clicks (null when clicks=0)
  roas: number;
}
```

**Why `cpl` and `clickToLeadRate` are computed, not Meta-native:**
Meta's `cost_per_action_type[lead]` counts pixel-fire events. Switchboard's lead count comes from `ConversionRecord` — actual pipeline entries (WhatsApp conversations, instant form submissions). For lead-to-booking businesses, Switchboard leads are the actionable number. `clickToLeadRate` is a cross-system metric (Switchboard leads / Meta clicks) that Meta cannot provide.

**Why `cpc` and `ctr` are Meta-native:**
Already computed by Meta in `CampaignInsight.cpc` and `CampaignInsight.ctr`. No reason to recompute.

---

## 4. Provider Wiring (PR-R3 I1 fix)

### 4.1 `MetaReportInsightsProvider` — add `getCampaignMetrics`

`packages/ad-optimizer/src/meta-report-insights-provider.ts`

Add method that calls `adsClient.getCampaignInsights()` and returns per-campaign rows as `ReportCampaignInsight[]` (same API call as `getAggregateMetrics`, but returns rows instead of summing).

### 4.2 Per-org wiring in `apps/api/src/app.ts`

Replace `app.decorate("reportInsightsProvider", null)` with per-request resolution:

The current hardcoded `null` must be replaced. However, `reportInsightsProvider` is per-org (each org has its own Meta ad account). The Fastify decorator is app-level, not request-level.

**Approach:** Change `ReportDependencies.insightsProvider` from a static value to a factory:

```ts
// In dashboard-reports.ts computeReport():
// 1. Look up Connection where serviceId='meta', organizationId=orgId, status='connected'
// 2. If found: decrypt credentials, construct MetaAdsClient, construct MetaReportInsightsProvider
// 3. If not found: insightsProvider = null (funnel top 3 show zero, campaigns empty)
```

This resolution happens in the route handler, not the app decorator. The app-level `reportInsightsProvider` decorator is removed; instead the route constructs the provider per-request using the org's Connection row.

**New dependencies needed in the route:**

- `prismaClient` (already available via `app.prisma`)
- `decryptCredentials` utility (already exists in the codebase for Connection credential handling)
- `MetaAdsClient` constructor from `@switchboard/ad-optimizer`
- `MetaReportInsightsProvider` constructor from `@switchboard/ad-optimizer`

---

## 5. Campaign Rollup

### 5.1 `packages/core/src/reports/campaign-rollup.ts`

**Signature:** `CampaignRollup` (already locked in `interfaces.ts`)

```ts
export type CampaignRollup = (ctx: RollupContext) => Promise<ReportDataV1["campaigns"]>;
```

**Input dependencies (via closure):**

- `insightsProvider: ReportInsightsProvider | null`
- `stores.revenue.revenueByCampaign(orgId, from, to)` — new store method

**Logic:**

1. If `insightsProvider` is null → return `[]`
2. Call `insightsProvider.getCampaignMetrics({ since, until })` → `ReportCampaignInsight[]`
3. Call `stores.revenue.revenueByCampaign(orgId, from, to)` → `Map<campaignId, revenueAmount>`
4. For each campaign insight row:
   - `name` = `campaignName`
   - `spend` = Meta `spend`
   - `impressions` = Meta `impressions`
   - `clicks` = Meta `clicks`
   - `cpc` = Meta `cpc`
   - `ctr` = Meta `ctr`
   - `leads` = Meta `conversions` (Meta-attributed, includes CTWA + instant form + CAPI/website)
   - `cpl` = leads > 0 ? spend / leads : null
   - `clickToLeadRate` = clicks > 0 ? leads / clicks : null
   - `revenue` = from LifecycleRevenueEvent (0 if no match)
   - `roas` = spend > 0 ? revenue / spend : 0
5. Sort by spend descending
6. Return `CampaignRow[]`

### 5.2 `ReportCampaignInsight` — extended

Since leads now come from Meta's conversion count, extend the type to carry that data:

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

`MetaReportInsightsProvider.getCampaignMetrics` maps directly from `CampaignInsight` fields.

### 5.3 New store method

**`ReportStores.revenue`** — add:

```ts
revenueByCampaign(input: { orgId: string; from: Date; to: Date }): Promise<
  Array<{ sourceCampaignId: string; totalAmount: number }>
>;
```

Prisma: `GROUP BY sourceCampaignId WHERE sourceCampaignId IS NOT NULL` on `LifecycleRevenueEvent`.

**Note:** `leadsByCampaign` is no longer needed — leads come from Meta's per-campaign conversion count instead of `ConversionRecord` joins.

---

## 6. Managed-vs-Unmanaged Comparison Rollup

### 6.1 `packages/core/src/reports/managed-comparison-rollup.ts`

**Signature:** `ManagedComparisonRollup` (already locked in `interfaces.ts`)

**Input dependencies (via closure):**

- `insightsProvider: ReportInsightsProvider | null`
- `baselineStore: BaselineStore`
- `stores` — for conversation metrics
- New store sub-interfaces (see §6.3)

**Logic:**

#### Ads dimension (always baseline per D5):

1. Fetch current-period aggregate ad metrics from `insightsProvider.getAggregateMetrics()` → managed cohort `{ spend, revenue (from stores), roas }`
2. Fetch baseline from `baselineStore.listByDimension(orgId, "ads")`
3. If no baseline exists → trigger lazy-pull (§7), return `ads: null` for this request
4. If baseline exists → compute unmanaged cohort from baseline rows, compute delta
5. Return `ManagedComparisonPair` with `source: "pre-switchboard-baseline"`

#### Conversations dimension (in-period cohort per D6):

1. Query conversation thread counts and metrics, split by `assignedAgent`:
   - Alex-managed: `assignedAgent` matches the org's Alex deployment slug
   - Operator-managed: `assignedAgent` is empty string or does not match
2. Resolve Alex slug: `AgentDeployment` where `organizationId = orgId` → join `AgentListing` → `slug`
3. Compute per-cohort metrics: `replies`, `conversionRate`, `replyMinutesP50`
4. If no operator-managed threads exist → fall back to baseline for conversations dimension
5. Compute delta between cohorts
6. Return `ManagedComparisonPair` with `source: "in-period-cohort"` or `"pre-switchboard-baseline"`

#### Section visibility:

- If both `ads` and `conversations` are null → return `null` (section hidden)
- If at least one is non-null → return `ManagedComparisonData` with `emptyMessage` for the null dimension

### 6.2 Alex thread identification

`ConversationThread.assignedAgent` is a free-form string defaulting to `"employee-a"`. The canonical agent key for Alex is `"alex"` (from `AGENT_REGISTRY` in `packages/schemas/src/agents.ts`). However, `assignedAgent` is not validated against `AgentKey` at write time.

**Approach:** Query `threadCountsByAgent`, then classify:

- **Alex-managed:** `assignedAgent === "alex"` (the `AgentKey` value)
- **Operator-managed:** everything else (including `"employee-a"`, empty string, or any non-Alex value)

If no threads have `assignedAgent === "alex"`, the conversations dimension returns null (Alex not yet active for this org). This is correct behavior — no comparison to show.

**Known limitation:** If the thread update path doesn't consistently write `"alex"` to `assignedAgent`, conversation counts will undercount Alex-managed threads. This is acceptable for an operator-only view; fixing the write path is out of scope for PR-R4.

### 6.3 New conversation store methods

```ts
conversations: {
  threadCountsByAgent(input: {
    orgId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ assignedAgent: string; count: number }>>;

  medianFirstReplyMinutes(input: {
    orgId: string;
    assignedAgent: string;
    from: Date;
    to: Date;
  }): Promise<number | null>;
};
```

---

## 7. Baseline Lazy-Pull

### 7.1 `packages/core/src/reports/baseline-capture.ts`

Instead of an Inngest event, baseline capture is triggered lazily by `managed-comparison-rollup` when it detects no baseline rows exist.

**Function:**

```ts
export async function captureAdsBaseline(
  orgId: string,
  insightsProvider: ReportInsightsProvider,
  baselineStore: BaselineStore,
): Promise<void>;
```

**Logic:**

1. Compute date range: 90 days before today
2. Call `insightsProvider.getAggregateMetrics({ since, until })` for each of 3 monthly buckets within the 90-day window
3. Persist `BaselineRow[]` with dimension `"ads"`, metrics: `spend`, `impressions`, `clicks`
4. Idempotent: `insertMany` uses composite unique `(orgId, dimension, metric, periodStart, periodEnd)`

**Conversations baseline:** deferred — conversation history before Switchboard isn't available in our system (we only have threads created after deployment). Conversations dimension falls back to empty state if no in-period operator cohort exists.

### 7.2 Lazy-pull trigger in managed-comparison-rollup

```
if (no baseline rows for ads) {
  // Fire-and-forget: capture baseline in background, log failures
  captureAdsBaseline(orgId, insightsProvider, baselineStore).catch((error) => {
    logger.warn({ orgId, error }, "Failed to capture ads baseline");
  });
  // Return ads: null for this request
  // Next request will have baseline data
}
```

---

## 8. Period-Rollup Integration

### 8.1 `ReportDependencies` — extend

```ts
export interface ReportDependencies {
  stores: ReportStores;
  insightsProvider: ReportInsightsProvider | null;
  reportCache: ReportCacheStore;
  baselineStore: BaselineStore;
  planMonthlyUSD: number;
}
```

### 8.2 `period-rollup.ts` — replace stubs

```ts
// Before (PR-R3):
campaigns: STUB_CAMPAIGNS,
managedComparison: null,

// After (PR-R4):
const [attribution, funnelResult, costResult, campaigns, managedComparison] =
  await Promise.all([
    computeAttribution(ctx, deps.stores),
    computeFunnel(ctx, deps.stores, deps.insightsProvider),
    computeCostVsValue(ctx, deps.planMonthlyUSD),
    computeCampaignRollup(ctx, deps.insightsProvider, deps.stores),
    computeManagedComparison(ctx, deps.insightsProvider, deps.baselineStore, deps.stores),
  ]);
```

Remove `STUB_CAMPAIGNS` constant.

---

## 9. API Route Changes

### 9.1 `dashboard-reports.ts` — per-org provider construction

Provider construction moves from the app-level decorator to the route handler. In each route handler (GET and POST), before calling `computeReport()`:

```ts
// Resolve Meta connection for this org
const connection = await app.prisma.connection.findFirst({
  where: { organizationId: orgId, serviceId: "meta", status: "connected" },
});

let insightsProvider: ReportInsightsProvider | null = null;
if (connection?.externalAccountId && connection.credentials) {
  const creds = decryptCredentials(connection.credentials);
  const adsClient = new MetaAdsClient(connection.externalAccountId, creds.accessToken);
  insightsProvider = new MetaReportInsightsProvider(adsClient);
}
```

Then pass `insightsProvider` to `computeReport()` as before (the function signature already accepts it as a parameter).

### 9.2 `app.ts` — remove hardcoded null, add BaselineStore

- Remove `app.decorate("reportInsightsProvider", null)` and the associated Fastify type declaration
- Add `app.decorate("baselineStore", new PrismaBaselineStore(prismaClient))` alongside the existing store decorators
- The `computeReport` function receives `baselineStore` as a new parameter (or via the existing `app` reference)

---

## 10. Dashboard — Operator Reports Page

### 10.1 Route: `/operator/reports`

**File:** `apps/dashboard/src/app/(auth)/operator/reports/page.tsx`

- Renders `<OperatorReportsPage />`
- Same `useReportData` hook as `/reports`
- Same sections as `/reports` (Header, TitleControls, PullQuote, Attribution, Funnel, Campaigns, CostVsValue, Footer, Disclosure)
- Plus `<ManagedComparison>` component mounted between Funnel and Campaigns
- Gated on `data.managedComparison !== null`

### 10.2 `<ManagedComparison>` component

**File:** `apps/dashboard/src/app/(auth)/operator/reports/components/managed-comparison.tsx`

**Props:** `{ data: ManagedComparisonData; period: string }`

**Renders:**

- Section heading: "Switchboard Impact" (not "Managed vs Unmanaged" — avoids implying causal proof)
- Source badge: "vs pre-Switchboard baseline (not a controlled holdout)" or "vs in-period unmanaged"
- Two sub-sections (ads, conversations), each showing:
  - Managed metrics column
  - Unmanaged metrics column
  - Delta indicator
- If a dimension is null, show inline copy: "Not enough data yet"
- If `emptyMessage` is set, show it as the section empty state

### 10.3 Routing config

Add `/operator/reports` to `CHROME_HIDDEN_PATHS` in `app-shell.tsx` (same treatment as `/reports` — no nav chrome, full editorial layout).

---

## 11. Prisma / DB Layer

### 11.1 `PrismaBaselineStore`

**File:** `packages/db/src/prisma-baseline-store.ts`

Implements `BaselineStore` from `@switchboard/core/reports`:

- `listByDimension` → `prisma.preSwitchboardBaseline.findMany({ where: { organizationId, dimension } })`
- `insertMany` → `prisma.preSwitchboardBaseline.createMany()` with `skipDuplicates: true` (composite unique handles idempotency)

### 11.2 New Prisma store methods

**`PrismaRevenueStore`** (or equivalent) — add `revenueByCampaign`:

```sql
SELECT "sourceCampaignId", SUM("amount") as "totalAmount"
FROM "LifecycleRevenueEvent"
WHERE "organizationId" = $1
  AND "sourceCampaignId" IS NOT NULL
  AND "createdAt" >= $2 AND "createdAt" < $3
GROUP BY "sourceCampaignId"
```

**`PrismaConversationThreadStore`** — add `threadCountsByAgent` and `medianFirstReplyMinutes`.

**`PrismaAgentDeploymentStore`** — add `getAlexSlug` (or add to an existing store).

No schema migration needed — `PreSwitchboardBaseline` model already exists.

---

## 12. Test Plan

### 12.1 `campaign-rollup.test.ts`

- Campaigns with spend + Meta conversions + revenue → correct CPL, clickToLeadRate, ROAS
- Campaigns with spend + conversions but no revenue → ROAS 0, CPL and clickToLeadRate populated
- Campaigns with zero conversions → CPL null, clickToLeadRate null
- Campaigns with zero clicks → clickToLeadRate null
- No provider (null) → empty array
- Sorted by spend descending

### 12.2 `managed-comparison-rollup.test.ts`

- Ads: baseline exists → comparison pair with delta
- Ads: no baseline, provider available → lazy-pull triggered, returns ads null
- Ads: no provider → ads null, no lazy-pull
- Conversations: both cohorts exist → in-period comparison
- Conversations: only Alex threads → falls back to baseline (or null)
- Both dimensions null → returns null (section hidden)

### 12.3 `baseline-capture.test.ts`

- Captures 3 monthly buckets of metrics
- Idempotent on re-run
- Handles provider error gracefully

### 12.4 `meta-report-insights-provider.test.ts`

- `getCampaignMetrics` returns per-campaign rows with conversions, cpc, ctr
- Existing `getAggregateMetrics` tests still pass

### 12.5 Provider wiring

- Connected org with valid credentials → provider constructed, campaigns populated
- Connected org with invalid/expired credentials → graceful fallback to null provider, report still renders (campaigns empty, no crash)
- No Meta connection → null provider, campaigns empty

### 12.6 Dashboard

- `<ManagedComparison>` renders both dimensions
- `<ManagedComparison>` handles null dimensions
- `<ManagedComparison>` not rendered when `managedComparison` is null
- `/operator/reports` renders all sections from `/reports` plus comparison

---

## 13. Files Changed

| File                                                                               | Action                                                                                        |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/schemas/src/reports/v1.ts`                                               | Remove `CampaignStage`, `stage`; add `ReportCampaignInsight`, extend `ReportInsightsProvider` |
| `packages/ad-optimizer/src/meta-report-insights-provider.ts`                       | Add `getCampaignMetrics` method                                                               |
| `packages/core/src/reports/campaign-rollup.ts`                                     | **New** — implements `CampaignRollup`                                                         |
| `packages/core/src/reports/managed-comparison-rollup.ts`                           | **New** — implements `ManagedComparisonRollup`                                                |
| `packages/core/src/reports/baseline-capture.ts`                                    | **New** — lazy-pull baseline function                                                         |
| `packages/core/src/reports/interfaces.ts`                                          | Extend `ReportStores` with new sub-interfaces                                                 |
| `packages/core/src/reports/period-rollup.ts`                                       | Replace stubs with live calls; extend `ReportDependencies`                                    |
| `packages/core/src/reports/index.ts`                                               | Export new modules                                                                            |
| `packages/db/src/prisma-baseline-store.ts`                                         | **New** — `PrismaBaselineStore`                                                               |
| `packages/db/src/prisma-revenue-store.ts`                                          | Add `revenueByCampaign`                                                                       |
| `packages/db/src/prisma-conversation-thread-store.ts`                              | Add `threadCountsByAgent`, `medianFirstReplyMinutes`                                          |
| `apps/api/src/routes/dashboard-reports.ts`                                         | Per-org provider construction, BaselineStore wiring                                           |
| `apps/api/src/app.ts`                                                              | Remove hardcoded `reportInsightsProvider` null; add BaselineStore decorator                   |
| `apps/dashboard/src/app/(auth)/operator/reports/page.tsx`                          | **New** — operator reports page                                                               |
| `apps/dashboard/src/app/(auth)/operator/reports/operator-reports-page.tsx`         | **New** — page component                                                                      |
| `apps/dashboard/src/app/(auth)/operator/reports/components/managed-comparison.tsx` | **New** — comparison component                                                                |
| `apps/dashboard/src/components/layout/app-shell.tsx`                               | Add `/operator/reports` to `CHROME_HIDDEN_PATHS`                                              |
| Co-located test files                                                              | **New** — per §12                                                                             |

---

## 14. What PR-R4 Does NOT Do

- No Inngest event emission at onboarding sites (replaced by lazy-pull)
- No `baseline-capture` Inngest function
- No per-campaign management tagging (Riley manages whole account)
- No `CampaignStage` classification
- No multi-touch attribution
- No conversation baseline (pre-Switchboard conversation data not available)
- No pull-quote generation (remains stub, deferred to PR-R5)
