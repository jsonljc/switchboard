# PR-R6 — Attribution Accuracy + Metrics Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 upstream data-path issues that cause reports to show incorrect attribution, inflated click metrics, and zero Alex-managed conversations.

**Architecture:** Each fix is independent — they touch different packages and can be committed/reverted separately. Fix order: 3 (smallest), 2 (small), 1 (medium), 4 (largest blast radius). This puts the riskiest change last so earlier commits are stable if Fix 4 needs revision.

**Tech Stack:** TypeScript, Vitest, Zod schemas, Meta Graph API v21.0, Prisma (no migration needed)

**Spec:** `docs/superpowers/specs/2026-05-06-reports-backend-v1-pr-r6-design.md`

---

## File Structure

**Fix 1 — CTWA campaign attribution:**

- Modify: `packages/ad-optimizer/src/meta-ads-client.ts` (add `getAdCampaignId`)
- Modify: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` (add `resolveCampaignId` dep)
- Modify: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts` (new test cases)

**Fix 2 — Instant form sourceCampaignId bug:**

- Modify: `apps/api/src/services/workflows/meta-lead-intake-workflow.ts` (add `campaignId` param)
- Modify: `apps/api/src/services/workflows/meta-lead-record-inquiry-workflow.ts` (add to input + outbox)

**Fix 3 — assignedAgent default:**

- Modify: `packages/core/src/conversations/thread.ts` (1-line change)
- Modify: `packages/core/src/lifecycle/stage-handler-map.ts` (8-line change)

**Fix 4 — inline_link_clicks rename (27 files):**

- Schemas (5): `ad-optimizer.ts`, `ad-optimizer-v2.ts`, `ad-optimizer-shared.ts`, `crm-outcome.ts`, `reports/v1.ts`
- Ad-optimizer (11): `meta-ads-client.ts`, `audit-runner.ts`, `meta-report-insights-provider.ts`, `funnel-analyzer.ts`, `creative-analyzer.ts`, `period-comparator.ts`, `metric-diagnostician.ts`, `trend-engine.ts`, `learning-phase-guard.ts`, `saturation-detector.ts`, `inngest-functions.ts`
- Core/reports (3): `campaign-rollup.ts`, `funnel-rollup.ts`, `baseline-capture.ts`
- Dashboard (1): `fixtures.ts`
- Tests (7): provider test, spend-attributor test, campaign-rollup test, funnel-rollup test, baseline-capture test, period-rollup test, managed-comparison-rollup test

---

## Pre-flight

- [ ] **Step 1: Create feature branch**

```bash
git checkout main && git pull
git checkout -b feat/reports-backend-v1-r6
```

- [ ] **Step 2: Verify clean state**

```bash
npx pnpm@9.15.4 typecheck
npx pnpm@9.15.4 test
```

Expected: all pass, no errors.

---

## Task 1: Fix 3 — assignedAgent default to "alex"

**Files:**

- Modify: `packages/core/src/conversations/thread.ts:18`
- Modify: `packages/core/src/lifecycle/stage-handler-map.ts:6-14`

- [ ] **Step 1: Update `createDefaultThread` default**

In `packages/core/src/conversations/thread.ts`, change line 18:

```ts
// Before:
assignedAgent: "employee-a",

// After:
assignedAgent: "alex",
```

- [ ] **Step 2: Update stage handler map**

In `packages/core/src/lifecycle/stage-handler-map.ts`, replace lines 6-14:

```ts
export const DEFAULT_STAGE_HANDLER_MAP: StageHandlerMap = {
  interested: { preferredAgent: "alex", fallbackType: "fallback_handoff" },
  qualified: { preferredAgent: "alex", fallbackType: "fallback_handoff" },
  quoted: { preferredAgent: "alex", fallbackType: "fallback_handoff" },
  booked: { preferredAgent: "alex", fallbackType: "none" },
  showed: { preferredAgent: "alex", fallbackType: "fallback_handoff" },
  won: { preferredAgent: "alex", fallbackType: "fallback_handoff" },
  lost: { preferredAgent: "alex", fallbackType: "fallback_handoff" },
  nurturing: { preferredAgent: "alex", fallbackType: "fallback_handoff" },
};
```

- [ ] **Step 3: Run affected tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/core test -- --run
```

Expected: tests pass. If any assertions check for `"employee-a"` or `"employee-b"` etc., update them to `"alex"`.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/conversations/thread.ts packages/core/src/lifecycle/stage-handler-map.ts
git commit -m "fix(core): default assignedAgent to 'alex'

All inbound leads go straight to Alex — 'employee-a' was a placeholder
that caused R4's managed comparison to show 0 Alex-managed threads."
```

---

## Task 2: Fix 2 — Instant form sourceCampaignId bug

**Files:**

- Modify: `apps/api/src/services/workflows/meta-lead-intake-workflow.ts:168-179`
- Modify: `apps/api/src/services/workflows/meta-lead-record-inquiry-workflow.ts:8-24`

- [ ] **Step 1: Add `campaignId` to inquiry child work params**

In `apps/api/src/services/workflows/meta-lead-intake-workflow.ts`, find the `meta.lead.inquiry.record` child work submission (~line 170). Change the `parameters` object:

```ts
const inquiryResult = await services.submitChildWork({
  intent: "meta.lead.inquiry.record",
  organizationId: workUnit.organizationId,
  actor: workUnit.actor,
  parentWorkUnitId: workUnit.id,
  parameters: {
    contactId: ingestResult.contactId,
    leadId: lead.leadId,
    organizationId: workUnit.organizationId,
    adId: lead.adId ?? null,
    campaignId: campaignId ?? null,
  },
});
```

The only change is adding `campaignId: campaignId ?? null,` after the `adId` line. The `campaignId` variable is already in scope from line 95.

- [ ] **Step 2: Add `campaignId` to inquiry workflow input type and outbox write**

In `apps/api/src/services/workflows/meta-lead-record-inquiry-workflow.ts`, update the input type and outbox write:

```ts
export function buildMetaLeadRecordInquiryWorkflow(_prisma: unknown): WorkflowHandler {
  return {
    async execute(workUnit) {
      const input = workUnit.parameters as {
        leadId: string;
        organizationId: string;
        adId: string | null;
        campaignId: string | null;
      };

      const { PrismaOutboxStore } = await import("@switchboard/db");
      const prisma = _prisma as import("@switchboard/db").PrismaClient;
      const outboxStore = new PrismaOutboxStore(prisma);
      await outboxStore.write(`evt_lead_${input.leadId}`, "inquiry", {
        type: "inquiry",
        contactId: input.leadId,
        organizationId: input.organizationId,
        value: 0,
        sourceAdId: input.adId,
        sourceCampaignId: input.campaignId,
        occurredAt: new Date().toISOString(),
        source: "meta-webhook",
        metadata: {},
      });

      return { outcome: "completed", summary: "Inquiry recorded", outputs: {} };
    },
  };
}
```

Changes: added `campaignId: string | null` to input type, added `sourceCampaignId: input.campaignId,` to outbox write.

- [ ] **Step 3: Run affected tests**

```bash
npx pnpm@9.15.4 --filter api test -- --run
```

Expected: pass. If there are existing tests for these workflows, verify `campaignId` is now expected in the params.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/workflows/meta-lead-intake-workflow.ts apps/api/src/services/workflows/meta-lead-record-inquiry-workflow.ts
git commit -m "fix(api): propagate campaignId through instant form inquiry workflow

campaignId was fetched from Meta but not passed to the inquiry child
work — outbox events were missing sourceCampaignId, breaking campaign
revenue attribution."
```

---

## Task 3: Fix 1 — CTWA campaign attribution

**Files:**

- Modify: `packages/ad-optimizer/src/meta-ads-client.ts` (add method + cache)
- Modify: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` (add dep + resolution)
- Modify: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts` (new tests)

### 3a. Add `getAdCampaignId` to MetaAdsClient

- [ ] **Step 1: Add the cache and method**

In `packages/ad-optimizer/src/meta-ads-client.ts`, add after the `private lastCallAt: number = 0;` line (~line 66):

```ts
  private readonly adCampaignCache = new Map<string, string>();
```

Then add this method after `updateCampaignStatus` (~after line 181):

```ts
  async getAdCampaignId(adId: string): Promise<string | null> {
    const cached = this.adCampaignCache.get(adId);
    if (cached !== undefined) return cached;

    try {
      const response = await this.get(`/${adId}?fields=campaign_id`);
      const campaignId = response.campaign_id as string | undefined;
      if (campaignId) {
        this.adCampaignCache.set(adId, campaignId);
        return campaignId;
      }
      return null;
    } catch {
      return null;
    }
  }
```

### 3b. Extend CTWA adapter

- [ ] **Step 2: Add `resolveCampaignId` to `CtwaAdapterDeps`**

In `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts`, add to the `CtwaAdapterDeps` interface:

```ts
export interface CtwaAdapterDeps {
  ingress: IngressLike;
  now: () => Date;
  resolveCampaignId?: (adId: string) => Promise<string | null>;
}
```

- [ ] **Step 3: Add campaign resolution in `CtwaAdapter.ingest()`**

In the `ingest` method, after `const intake = buildCtwaIntake(msg, { now: this.deps.now });` and before `await this.deps.ingress.submit(...)`, add resolution logic:

```ts
  async ingest(
    msg: ParsedWhatsappMessage,
    opts: { parentWorkUnitId?: string } = {},
  ): Promise<void> {
    const intake = buildCtwaIntake(msg, { now: this.deps.now });
    if (!intake) return;

    if (
      intake.attribution.sourceAdId &&
      msg.metadata["adSourceType"] === "ad" &&
      this.deps.resolveCampaignId
    ) {
      try {
        const campaignId = await this.deps.resolveCampaignId(
          intake.attribution.sourceAdId,
        );
        if (campaignId) {
          intake.attribution.sourceCampaignId = campaignId;
        }
      } catch {
        // Non-blocking — continue without sourceCampaignId
      }
    }

    await this.deps.ingress.submit({
      intent: "lead.intake",
      payload: intake,
      idempotencyKey: intake.idempotencyKey,
      ...(opts.parentWorkUnitId ? { parentWorkUnitId: opts.parentWorkUnitId } : {}),
    });
  }
```

### 3c. Add tests

- [ ] **Step 4: Add test cases to `ctwa-adapter.test.ts`**

In `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts`, add these tests inside the `CtwaAdapter` describe block:

```ts
it("resolves sourceCampaignId when adSourceType is 'ad' and resolver is provided", async () => {
  const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
  const resolveCampaignId = vi.fn().mockResolvedValue("campaign_123");
  const adapter = new CtwaAdapter({
    ingress: { submit },
    now: () => new Date("2026-04-26T00:00:00Z"),
    resolveCampaignId,
  });
  await adapter.ingest(
    makeMessage({ metadata: { ctwaClid: "ARxx_abc", sourceAdId: "ad_456", adSourceType: "ad" } }),
  );
  expect(resolveCampaignId).toHaveBeenCalledWith("ad_456");
  const payload = submit.mock.calls[0][0].payload;
  expect(payload.attribution.sourceCampaignId).toBe("campaign_123");
});

it("skips campaign resolution when adSourceType is not 'ad'", async () => {
  const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
  const resolveCampaignId = vi.fn();
  const adapter = new CtwaAdapter({
    ingress: { submit },
    now: () => new Date("2026-04-26T00:00:00Z"),
    resolveCampaignId,
  });
  await adapter.ingest(
    makeMessage({
      metadata: { ctwaClid: "ARxx_abc", sourceAdId: "post_789", adSourceType: "post" },
    }),
  );
  expect(resolveCampaignId).not.toHaveBeenCalled();
});

it("continues without sourceCampaignId when resolver throws", async () => {
  const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
  const resolveCampaignId = vi.fn().mockRejectedValue(new Error("API error"));
  const adapter = new CtwaAdapter({
    ingress: { submit },
    now: () => new Date("2026-04-26T00:00:00Z"),
    resolveCampaignId,
  });
  await adapter.ingest(
    makeMessage({ metadata: { ctwaClid: "ARxx_abc", sourceAdId: "ad_456", adSourceType: "ad" } }),
  );
  expect(submit).toHaveBeenCalled();
  const payload = submit.mock.calls[0][0].payload;
  expect(payload.attribution.sourceCampaignId).toBeUndefined();
});

it("skips resolution when no resolveCampaignId dep is provided", async () => {
  const submit = vi.fn().mockResolvedValue({ ok: true, result: {} } as unknown);
  const adapter = new CtwaAdapter({
    ingress: { submit },
    now: () => new Date("2026-04-26T00:00:00Z"),
  });
  await adapter.ingest(
    makeMessage({ metadata: { ctwaClid: "ARxx_abc", sourceAdId: "ad_456", adSourceType: "ad" } }),
  );
  expect(submit).toHaveBeenCalled();
});
```

- [ ] **Step 5: Run tests**

```bash
npx pnpm@9.15.4 --filter @switchboard/ad-optimizer test -- --run
```

Expected: all pass including new tests.

- [ ] **Step 6: Commit**

```bash
git add packages/ad-optimizer/src/meta-ads-client.ts packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts
git commit -m "fix(ad-optimizer): CTWA campaign attribution via Graph API

Meta CTWA webhook provides source_id (ad_id) but not campaign_id.
Add getAdCampaignId() to MetaAdsClient with in-memory cache, and
resolve sourceCampaignId in CtwaAdapter when adSourceType === 'ad'."
```

---

## Task 4: Fix 4 — inline_link_clicks rename

This is the largest change (27+ files). Execute in sub-steps: schemas first, then ad-optimizer, then core/reports, then dashboard, then tests.

### 4a. Rename schema fields

**Files:**

- Modify: `packages/schemas/src/ad-optimizer.ts`
- Modify: `packages/schemas/src/ad-optimizer-v2.ts`
- Modify: `packages/schemas/src/ad-optimizer-shared.ts`
- Modify: `packages/schemas/src/crm-outcome.ts`
- Modify: `packages/schemas/src/reports/v1.ts`

- [ ] **Step 1: Update `CampaignInsightSchema` and `AdSetInsightSchema`**

In `packages/schemas/src/ad-optimizer.ts`:

`CampaignInsightSchema` (~line 47): change:

- `clicks: z.number()` → `inlineLinkClicks: z.number()`
- `ctr: z.number()` → `inlineLinkClickCtr: z.number()`
- `cpc: z.number()` → `costPerInlineLinkClick: z.number()`

`AdSetInsightSchema` (~line 66): change:

- `clicks: z.number()` → `inlineLinkClicks: z.number()`
- `ctr: z.number()` → `inlineLinkClickCtr: z.number()`
- `cpc: z.number()` → `costPerInlineLinkClick: z.number()`

- [ ] **Step 2: Update `MetricSnapshotSchema` and `CreativeEntrySchema`**

In `packages/schemas/src/ad-optimizer-v2.ts`:

`MetricSnapshotSchema` (~line 7): change:

- `ctr: z.number()` → `inlineLinkClickCtr: z.number()`
- `cpc: z.number()` → `costPerInlineLinkClick: z.number()`

`CreativeEntrySchema` (~line 97): change:

- `clicks: z.number()` → `inlineLinkClicks: z.number()`
- `ctr: z.number()` → `inlineLinkClickCtr: z.number()`
- `cpc: z.number()` → `costPerInlineLinkClick: z.number()`

- [ ] **Step 3: Update `LearningPhaseStatusSchema`**

In `packages/schemas/src/ad-optimizer-shared.ts`:

In `metricsSnapshot` object (~line 18-25): change `ctr: z.number()` → `inlineLinkClickCtr: z.number()`
In `postExitSnapshot` object (~line 27-34): change `ctr: z.number()` → `inlineLinkClickCtr: z.number()`

- [ ] **Step 4: Update `MediaBenchmarks` and `AdSetLearningInput`**

In `packages/schemas/src/crm-outcome.ts`:

`MediaBenchmarks` interface (~line 39-45): change `ctr: number` → `inlineLinkClickCtr: number`

`AdSetLearningInput` interface (~line 90-103): change `ctr: number` → `inlineLinkClickCtr: number`

- [ ] **Step 5: Update reports v1 types**

In `packages/schemas/src/reports/v1.ts`:

`CampaignRow` interface (~line 65-77): change:

- `clicks: number` → `inlineLinkClicks: number`
- `cpc: number` → `costPerInlineLinkClick: number`
- `ctr: number` → `inlineLinkClickCtr: number`

`ReportCampaignInsight` interface (~line 79-88): change:

- `clicks: number` → `inlineLinkClicks: number`
- `cpc: number` → `costPerInlineLinkClick: number`
- `ctr: number` → `inlineLinkClickCtr: number`

`ReportInsightsMetrics` interface (~line 124-129): change:

- `clicks: number` → `inlineLinkClicks: number`

### 4b. Update ad-optimizer implementations

- [ ] **Step 6: Update `MetaAdsClient` field mapping**

In `packages/ad-optimizer/src/meta-ads-client.ts`:

In `mapCampaignInsight` (~line 238-255): change:

- `clicks: parseInt(raw.clicks ?? "0", 10)` → `inlineLinkClicks: parseInt(raw.inline_link_clicks ?? "0", 10)`
- `ctr: parseFloat(raw.ctr ?? "0")` → `inlineLinkClickCtr: parseFloat(raw.inline_link_click_ctr ?? "0")`
- `cpc: parseFloat(raw.cpc ?? "0")` → `costPerInlineLinkClick: parseFloat(raw.cost_per_inline_link_click ?? "0")`

In `mapAdSetInsight` (~line 257-274): same renames:

- `clicks:` → `inlineLinkClicks:` with `raw.inline_link_clicks`
- `ctr:` → `inlineLinkClickCtr:` with `raw.inline_link_click_ctr`
- `cpc:` → `costPerInlineLinkClick:` with `raw.cost_per_inline_link_click`

- [ ] **Step 7: Update `audit-runner.ts`**

In `packages/ad-optimizer/src/audit-runner.ts`:

`INSIGHT_FIELDS` array (~line 86-99): change:

- `"clicks"` → `"inline_link_clicks"`
- `"ctr"` → `"inline_link_click_ctr"`
- `"cpc"` → `"cost_per_inline_link_click"`

`insightToMetrics` (~line 105-116): change destructuring:

- `const { spend, impressions, clicks, conversions, revenue, frequency } = insight;` →
  `const { spend, impressions, inlineLinkClicks, conversions, revenue, frequency } = insight;`
- `ctr: safeDivide(clicks, impressions) * 100` → `inlineLinkClickCtr: safeDivide(inlineLinkClicks, impressions) * 100`
- `cpc: safeDivide(spend, clicks)` → `costPerInlineLinkClick: safeDivide(spend, inlineLinkClicks)`

`aggregateMetrics` (~line 118-148): change:

- `let totalClicks = 0;` → `let totalInlineLinkClicks = 0;`
- `totalClicks += insight.clicks;` → `totalInlineLinkClicks += insight.inlineLinkClicks;`
- `ctr: safeDivide(totalClicks, totalImpressions) * 100` → `inlineLinkClickCtr: safeDivide(totalInlineLinkClicks, totalImpressions) * 100`
- `cpc: safeDivide(totalSpend, totalClicks)` → `costPerInlineLinkClick: safeDivide(totalSpend, totalInlineLinkClicks)`

- [ ] **Step 8: Update `meta-report-insights-provider.ts`**

In `packages/ad-optimizer/src/meta-report-insights-provider.ts`:

`getAggregateMetrics` (~line 20-42):

- Change field request: `fields: ["impressions", "clicks", "spend", "actions"]` → `fields: ["impressions", "inline_link_clicks", "spend", "actions"]`
- Change variable: `let clicks = 0;` → `let inlineLinkClicks = 0;`
- Change accumulator: `clicks += Number(row.clicks ?? 0);` → `inlineLinkClicks += Number(row.inlineLinkClicks ?? 0);`
- Change return: `return { impressions, clicks, landingPageViews, spend };` → `return { impressions, inlineLinkClicks, landingPageViews, spend };`

`getCampaignMetrics` (~line 44-64):

- Change field request: `fields: ["impressions", "clicks", "spend", "conversions", "cpc", "ctr"]` → `fields: ["impressions", "inline_link_clicks", "spend", "conversions", "cost_per_inline_link_click", "inline_link_click_ctr"]`
- Change mapping:
  - `clicks: Number(row.clicks ?? 0)` → `inlineLinkClicks: Number(row.inlineLinkClicks ?? 0)`
  - `cpc: Number(row.cpc ?? 0)` → `costPerInlineLinkClick: Number(row.costPerInlineLinkClick ?? 0)`
  - `ctr: Number(row.ctr ?? 0)` → `inlineLinkClickCtr: Number(row.inlineLinkClickCtr ?? 0)`

- [ ] **Step 9: Update `funnel-analyzer.ts`**

In `packages/ad-optimizer/src/funnel-analyzer.ts`:

- Line 29: `insights.reduce((sum, i) => sum + i.clicks, 0)` → `insights.reduce((sum, i) => sum + i.inlineLinkClicks, 0)`
- Line 31: `mediaBenchmarks.ctr / 100` → `mediaBenchmarks.inlineLinkClickCtr / 100`

- [ ] **Step 10: Update `creative-analyzer.ts`**

In `packages/ad-optimizer/src/creative-analyzer.ts`:

`RawAdData` interface (~line 12-28): change:

- `clicks: number` → `inlineLinkClicks: number`
- `ctr: number` → `inlineLinkClickCtr: number`
- `cpc: number` → `costPerInlineLinkClick: number`

`deduplicateCreatives` (~line 35-98): update all references:

- `const clicks = ads.reduce((s, a) => s + a.clicks, 0);` → `const inlineLinkClicks = ads.reduce((s, a) => s + a.inlineLinkClicks, 0);`
- `const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;` → `const inlineLinkClickCtr = impressions > 0 ? (inlineLinkClicks / impressions) * 100 : 0;`
- `const cpc = clicks > 0 ? spend / clicks : 0;` → `const costPerInlineLinkClick = inlineLinkClicks > 0 ? spend / inlineLinkClicks : 0;`
- In the `entries.push` object: `clicks,` → `inlineLinkClicks,`, `ctr,` → `inlineLinkClickCtr,`, `cpc,` → `costPerInlineLinkClick,`

- [ ] **Step 11: Update `period-comparator.ts`**

In `packages/ad-optimizer/src/period-comparator.ts`:

`MetricSet` interface (~line 9-17): change:

- `ctr: number` → `inlineLinkClickCtr: number`
- `cpc: number` → `costPerInlineLinkClick: number`

`comparePeriods` function (~line 47-49): update the metrics array:

```ts
const metrics: (keyof MetricSet)[] = [
  "cpm",
  "inlineLinkClickCtr",
  "costPerInlineLinkClick",
  "cpl",
  "cpa",
  "roas",
  "frequency",
];
```

- [ ] **Step 12: Update `metric-diagnostician.ts`**

In `packages/ad-optimizer/src/metric-diagnostician.ts`:

- Line 14: `const COST_METRICS = new Set(["cpm", "cpc", "cpl", "cpa"]);` → `const COST_METRICS = new Set(["cpm", "costPerInlineLinkClick", "cpl", "cpa"]);`
- Line 15: `const PERFORMANCE_METRICS = new Set(["ctr", "roas"]);` → `const PERFORMANCE_METRICS = new Set(["inlineLinkClickCtr", "roas"]);`
- All `map.get("ctr")` → `map.get("inlineLinkClickCtr")` (lines 41, 46, 58, 61, 72, 73, 96, 97, 107, 108)
- All `map.get("cpc")` → `map.get("costPerInlineLinkClick")` (none found in current code — only `ctr` is used in map.get calls, `cpc` appears only in the COST_METRICS set)

- [ ] **Step 13: Update `trend-engine.ts`**

In `packages/ad-optimizer/src/trend-engine.ts`:

Line 7: `const METRIC_KEYS: (keyof MetricSnapshot)[] = ["cpm", "ctr", "cpc", "cpl", "cpa", "roas"];` → `const METRIC_KEYS: (keyof MetricSnapshot)[] = ["cpm", "inlineLinkClickCtr", "costPerInlineLinkClick", "cpl", "cpa", "roas"];`

- [ ] **Step 14: Update `learning-phase-guard.ts`**

In `packages/ad-optimizer/src/learning-phase-guard.ts`:

In `classifyState` (~line 130-137): change `ctr: input.ctr` → `inlineLinkClickCtr: input.inlineLinkClickCtr` (appears twice — once in `metricsSnapshot` block).

- [ ] **Step 15: Update `saturation-detector.ts`**

In `packages/ad-optimizer/src/saturation-detector.ts`:

Line 17: `const ctrTrend = trends.find((t) => t.metric === "ctr");` → `const ctrTrend = trends.find((t) => t.metric === "inlineLinkClickCtr");`

- [ ] **Step 16: Update `inngest-functions.ts`**

In `packages/ad-optimizer/src/inngest-functions.ts`:

Line 78: `mediaBenchmarks: { ctr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 }` → `mediaBenchmarks: { inlineLinkClickCtr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 }`

### 4c. Update core/reports

- [ ] **Step 17: Update `campaign-rollup.ts`**

In `packages/core/src/reports/campaign-rollup.ts`:

In the `campaigns.map` (~line 35-49): change:

- `clicks: c.clicks` → `inlineLinkClicks: c.inlineLinkClicks`
- `cpc: c.cpc` → `costPerInlineLinkClick: c.costPerInlineLinkClick`
- `ctr: c.ctr` → `inlineLinkClickCtr: c.inlineLinkClickCtr`
- `clickToLeadRate: c.clicks > 0 ? c.conversions / c.clicks : null` → `clickToLeadRate: c.inlineLinkClicks > 0 ? c.conversions / c.inlineLinkClicks : null`

- [ ] **Step 18: Update `funnel-rollup.ts`**

In `packages/core/src/reports/funnel-rollup.ts`:

In `fetchMetrics` fallback (~line 38): change:

- `return { impressions: 0, clicks: 0, landingPageViews: 0, spend: 0 };` → `return { impressions: 0, inlineLinkClicks: 0, landingPageViews: 0, spend: 0 };`

Find where `currentMetrics.clicks` is used for the "Clicks" funnel row and change to `currentMetrics.inlineLinkClicks`. The label should stay "Clicks" (it's a UI label, not a field name).

- [ ] **Step 19: Update `baseline-capture.ts`**

In `packages/core/src/reports/baseline-capture.ts`:

In the metric array (~line 34-38): change:

```ts
    for (const [metric, value] of [
      ["spend", metrics.spend],
      ["impressions", metrics.impressions],
      ["inlineLinkClicks", metrics.inlineLinkClicks],
    ] as const) {
```

### 4d. Update dashboard fixtures

- [ ] **Step 20: Update `fixtures.ts`**

In `apps/dashboard/src/app/(auth)/reports/fixtures.ts`:

For every `CampaignRow` object (14 total across `goodFixture`, `quietFixture`, `problemFixture`), rename:

- `clicks:` → `inlineLinkClicks:`
- `cpc:` → `costPerInlineLinkClick:`
- `ctr:` → `inlineLinkClickCtr:`

### 4e. Update all test files

- [ ] **Step 21: Update `meta-report-insights-provider.test.ts`**

In `packages/ad-optimizer/src/meta-report-insights-provider.test.ts`:

All fixture objects and assertions: rename `clicks` → `inlineLinkClicks`, `cpc` → `costPerInlineLinkClick`, `ctr` → `inlineLinkClickCtr`.

- [ ] **Step 22: Update `spend-attributor.test.ts`**

In `packages/ad-optimizer/src/analyzers/spend-attributor.test.ts`:

In `insight()` helper (~line 8-26): change `clicks: 0` → `inlineLinkClicks: 0`, `ctr: 0` → `inlineLinkClickCtr: 0`, `cpc: 0` → `costPerInlineLinkClick: 0`

In `adSet()` helper (~line 28-48): change `ctr: 0` → `inlineLinkClickCtr: 0`

- [ ] **Step 23: Update core/reports test files**

In each of these files, rename fixture field names from `clicks`/`cpc`/`ctr` to `inlineLinkClicks`/`costPerInlineLinkClick`/`inlineLinkClickCtr`:

- `packages/core/src/reports/campaign-rollup.test.ts` — all `ReportCampaignInsight` fixtures and `CampaignRow` assertions
- `packages/core/src/reports/funnel-rollup.test.ts` — all `ReportInsightsMetrics` fixtures (`clicks:` → `inlineLinkClicks:`)
- `packages/core/src/reports/baseline-capture.test.ts` — all provider fixtures and metric name assertions
- `packages/core/src/reports/period-rollup.test.ts` — stubProvider fixtures (`clicks:` → `inlineLinkClicks:`)
- `packages/core/src/reports/managed-comparison-rollup.test.ts` — stubProvider fixtures (`clicks:` → `inlineLinkClicks:`)

### 4f. Verify

- [ ] **Step 24: Run typecheck**

```bash
npx pnpm@9.15.4 typecheck
```

Expected: no errors. This is the primary verification that no rename was missed — any stale `clicks`/`cpc`/`ctr` reference on a renamed type will cause a type error.

- [ ] **Step 25: Run all tests**

```bash
npx pnpm@9.15.4 test
```

Expected: all pass.

- [ ] **Step 26: Stale-reference sweep**

```bash
rg "\.clicks[^T]|clicks:|\"clicks\"|\.ctr[^A-Z]|[^k]ctr:|\"ctr\"|\.cpc[^A-Z]|[^e]cpc:|\"cpc\"" packages apps --glob '*.ts' --glob '*.tsx' | grep -v node_modules | grep -v totalClicks | grep -v clickToLead | grep -v 'action_type' | grep -v dist/
```

Manually review each hit. Expected intentional survivors:

- `AccountSummarySchema.totalClicks` — unchanged by design
- `clickToLeadRate` — different metric, not part of this rename
- String literals in `INSIGHT_FIELDS` arrays — should now be `inline_link_clicks` etc., flag if still `clicks`/`cpc`/`ctr`

- [ ] **Step 27: Commit**

```bash
git add -A
git commit -m "refactor(schemas): rename clicks/cpc/ctr to inline link click metrics

Meta's clicks counts all engagement (likes, comments, profile clicks).
inline_link_clicks counts only link clicks — the metric that matters
for lead-to-booking businesses. The old fields were deprecated in
Meta API v2.4 — inline_link_clicks is the modern replacement.

Renames across schemas, ad-optimizer, core/reports, dashboard fixtures,
and all test files (27 files total)."
```

---

## Post-flight

- [ ] **Step 1: Final verification**

```bash
npx pnpm@9.15.4 typecheck && npx pnpm@9.15.4 test
```

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/reports-backend-v1-r6
```

- [ ] **Step 3: Create PR**

Title: `fix(reports): PR-R6 — attribution accuracy + metrics upgrade`

Body should reference the spec and list the 4 fixes with their commit messages.

---

## Appendix: MetricSet rename reference

The `MetricSet` interface in `period-comparator.ts` is used by `insightToMetrics` and `aggregateMetrics` in `audit-runner.ts`. After the rename:

```ts
export interface MetricSet {
  cpm: number;
  inlineLinkClickCtr: number;
  costPerInlineLinkClick: number;
  cpl: number;
  cpa: number;
  roas: number;
  frequency: number;
}
```

The `comparePeriods` function iterates this interface's keys, so the `MetricDelta.metric` string values passed to `metric-diagnostician.ts` will now be `"inlineLinkClickCtr"` and `"costPerInlineLinkClick"` instead of `"ctr"` and `"cpc"`. The diagnostician's `COST_METRICS` and `PERFORMANCE_METRICS` sets and all `map.get()` calls must match.
