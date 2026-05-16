# PR-R6 — Attribution Accuracy + Metrics Upgrade

**Date:** 2026-05-06
**Branch:** `feat/reports-backend-v1-r6` (from `main`)
**Depends on:** PR-R3 (#370, merged), PR-R4 (#371, merged). Lands on top of both — fixes upstream data paths that R4's campaign rollup and managed comparison depend on.

---

## 1. Summary

PR-R6 delivers 4 independent data-path fixes that improve attribution accuracy and metric quality for the `/reports` surface. These fix upstream inputs (lead intake, thread labeling, Meta API field selection) so that campaign rollup, managed comparison, and funnel metrics produce correct numbers when R4 and subsequent PRs land.

---

## 2. Key Decisions

| #   | Decision                                                             | Rationale                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | CTWA campaign resolution via `GET /{ad_id}?fields=campaign_id`       | Meta's CTWA webhook only provides `source_id` (ad_id), not `campaign_id`. Confirmed via Meta internal docs — no loophole, no planned additions. Separate Graph API call is the only path.                                                                                                                  |
| D2  | Guard CTWA resolution on `source_type === "ad"`                      | `source_id` can be a post ID for organic posts. Only resolve campaign for actual ads.                                                                                                                                                                                                                      |
| D3  | Cache ad→campaign mapping in-memory                                  | Mapping is immutable (an ad's parent campaign never changes). In-memory `Map` on `MetaAdsClient` instance is sufficient for v1.                                                                                                                                                                            |
| D4  | `ads_management` permission required (not just `ads_read`)           | `ads_read` only covers Insights API. Reading Ad object fields like `campaign_id` requires `ads_management`. Existing `MetaAdsClient` already uses this permission for campaign management calls.                                                                                                           |
| D5  | Default `assignedAgent` to `"alex"`                                  | All inbound leads (CTWA, instant form) go straight to Alex. No human triage step exists today. `"employee-a"` was a meaningless placeholder that caused the managed comparison to show 0 Alex-managed threads.                                                                                             |
| D6  | Rename `clicks`→`inlineLinkClicks` in place (option A)               | `clicks` counts all engagement (likes, comments, profile clicks). `inline_link_clicks` counts link clicks only. The old fields were deprecated in Meta API v2.4/v2.5 — `inline_link_clicks` is the modern replacement. Rename across both data layer and computed metric layer to avoid semantic mismatch. |
| D7  | Rename touches both `CampaignInsightSchema` and `AdSetInsightSchema` | Both schemas represent Meta API data with the same field mapping. Renaming one without the other creates inconsistency.                                                                                                                                                                                    |
| D8  | `AccountSummarySchema.totalClicks` unchanged                         | Different API call, different purpose (account-level aggregate). Not part of this rename.                                                                                                                                                                                                                  |

---

## 3. Fix 1 — CTWA Campaign Attribution

### 3.1 Problem

CTWA webhook provides `source_id` (ad_id) via `referral.source_id`, extracted by `extractReferralData()` in `apps/chat/src/adapters/whatsapp-parsers.ts` as `metadata.sourceAdId`. The `buildCtwaIntake()` function in `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` maps this to `attribution.sourceAdId` but cannot populate `attribution.sourceCampaignId` because the webhook doesn't carry it.

Without `sourceCampaignId`, CTWA leads can't be attributed to campaigns in the reports campaign rollup — revenue from CTWA leads shows $0 against the campaign that generated them.

### 3.2 Changes

**`packages/ad-optimizer/src/meta-ads-client.ts`** — Add method:

```ts
private readonly adCampaignCache = new Map<string, string>();

async getAdCampaignId(adId: string): Promise<string | null> {
  const cached = this.adCampaignCache.get(adId);
  if (cached) return cached;

  const response = await this.get(`/${adId}?fields=campaign_id`);
  const campaignId = response.campaign_id as string | undefined;
  if (campaignId) {
    this.adCampaignCache.set(adId, campaignId);
  }
  return campaignId ?? null;
}
```

**`packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts`** — Extend deps and builder:

Add `resolveCampaignId?: (adId: string) => Promise<string | null>` to `CtwaAdapterDeps`.

In `CtwaAdapter.ingest()`, after building the intake, resolve campaign if conditions are met:

```ts
if (
  intake.attribution.sourceAdId &&
  msg.metadata["adSourceType"] === "ad" &&
  this.deps.resolveCampaignId
) {
  try {
    const campaignId = await this.deps.resolveCampaignId(intake.attribution.sourceAdId);
    if (campaignId) {
      intake.attribution.sourceCampaignId = campaignId;
    }
  } catch {
    // Non-blocking — log warning, continue without sourceCampaignId
  }
}
```

**`apps/chat/` (wiring layer)** — When constructing `CtwaAdapter`, inject `resolveCampaignId` bound to the org's `MetaAdsClient.getAdCampaignId`.

### 3.3 Guards

- Skip if `adSourceType !== "ad"` (organic post — `source_id` is a post ID, not ad ID)
- Skip if `sourceAdId` is missing (~1-2% of webhooks per Meta docs)
- On API error (deleted/purged ad, permissions), log warning and continue — attribution is best-effort, not blocking

### 3.4 Tests

- `meta-ads-client.test.ts`: `getAdCampaignId` returns campaign_id, caches result, returns null on missing
- `ctwa-adapter.test.ts`: intake includes `sourceCampaignId` when resolver succeeds, skips when `adSourceType !== "ad"`, continues on resolver error

---

## 4. Fix 2 — Instant Form sourceCampaignId Bug

### 4.1 Problem

In `apps/api/src/services/workflows/meta-lead-intake-workflow.ts`, the workflow fetches `campaignId` from `fetchLeadDetail()` (line 99) and passes it to `InstantFormAdapter.ingest()` — so `Contact.attribution.sourceCampaignId` is populated correctly. But the child work `meta.lead.inquiry.record` (line 168-179) only receives `adId`, not `campaignId`. The inquiry workflow (`meta-lead-record-inquiry-workflow.ts`) only writes `sourceAdId` to the outbox event — `sourceCampaignId` is lost.

Revenue joins via `sourceCampaignId` on `LifecycleRevenueEvent`. Without it on the outbox event, any revenue flowing through instant form inquiry events can't be attributed to the right campaign.

### 4.2 Changes

**`apps/api/src/services/workflows/meta-lead-intake-workflow.ts`** ~line 177:

```ts
// Before:
parameters: {
  contactId: ingestResult.contactId,
  leadId: lead.leadId,
  organizationId: workUnit.organizationId,
  adId: lead.adId ?? null,
},

// After:
parameters: {
  contactId: ingestResult.contactId,
  leadId: lead.leadId,
  organizationId: workUnit.organizationId,
  adId: lead.adId ?? null,
  campaignId: campaignId ?? null,
},
```

**`apps/api/src/services/workflows/meta-lead-record-inquiry-workflow.ts`** ~line 9-24:

```ts
// Before:
const input = workUnit.parameters as {
  leadId: string;
  organizationId: string;
  adId: string | null;
};

// After:
const input = workUnit.parameters as {
  leadId: string;
  organizationId: string;
  adId: string | null;
  campaignId: string | null;
};

// And in the outbox write, add:
sourceCampaignId: input.campaignId,
```

### 4.3 Tests

- Verify `campaignId` flows from workflow params through to outbox event's `sourceCampaignId`
- Verify null `campaignId` writes null `sourceCampaignId` (no crash)

---

## 5. Fix 3 — assignedAgent Default

### 5.1 Problem

`createDefaultThread()` in `packages/core/src/conversations/thread.ts` hardcodes `assignedAgent: "employee-a"`. No code path ever updates this to `"alex"`. The R4 managed comparison splits conversations on `assignedAgent === "alex"` — with the current default, it always shows 0 Alex-managed threads, making the proof-of-value metric useless.

### 5.2 Changes

**`packages/core/src/conversations/thread.ts`** line 18:

```ts
// Before:
assignedAgent: "employee-a",

// After:
assignedAgent: "alex",
```

**`packages/core/src/lifecycle/stage-handler-map.ts`** lines 6-14:

Update `preferredAgent` values from legacy `"employee-*"` identifiers to canonical `AgentKey` values:

```ts
// Before:
interested: { preferredAgent: "employee-a", ... }
qualified: { preferredAgent: "employee-b", ... }
quoted: { preferredAgent: "employee-b", ... }
booked: { preferredAgent: "system", ... }
showed: { preferredAgent: "employee-d", ... }
won: { preferredAgent: "employee-d", ... }
lost: { preferredAgent: "employee-e", ... }
nurturing: { preferredAgent: "employee-e", ... }

// After:
interested: { preferredAgent: "alex", ... }
qualified: { preferredAgent: "alex", ... }
quoted: { preferredAgent: "alex", ... }
booked: { preferredAgent: "alex", ... }
showed: { preferredAgent: "alex", ... }
won: { preferredAgent: "alex", ... }
lost: { preferredAgent: "alex", ... }
nurturing: { preferredAgent: "alex", ... }
```

### 5.3 What this does NOT do

- No write-time validation of `assignedAgent` against `AgentKey` — larger schema change, not this PR
- No change to `Opportunity.assignedAgent` — defaults to `null`, not used in conversation comparison
- No escalation flow (flip `assignedAgent` from `"alex"` to operator) — future feature

### 5.4 Tests

- Update assertions on `createDefaultThread()` return value
- Update any tests that assert `preferredAgent` values in the stage handler map

---

## 6. Fix 4 — inline_link_clicks Rename

### 6.1 Problem

Meta's `clicks` field counts every click on an ad — likes, comments, profile clicks, link clicks. For lead-to-booking businesses, only link clicks matter (people who clicked through to WhatsApp or the landing page). Using `clicks` inflates CTR, deflates CPC, and makes campaign performance look better than it is.

The `clicks`/`cpc`/`ctr` fields were deprecated in Meta API v2.4/v2.5. Their replacements — `inline_link_clicks`, `cost_per_inline_link_click`, `inline_link_click_ctr` — are the modern, correct fields. Confirmed active through API v22.0 (May 2025).

### 6.2 Field name mapping

| Old (Switchboard) | Old (Meta API) | New (Switchboard)        | New (Meta API)               |
| ----------------- | -------------- | ------------------------ | ---------------------------- |
| `clicks`          | `clicks`       | `inlineLinkClicks`       | `inline_link_clicks`         |
| `cpc`             | `cpc`          | `costPerInlineLinkClick` | `cost_per_inline_link_click` |
| `ctr`             | `ctr`          | `inlineLinkClickCtr`     | `inline_link_click_ctr`      |

### 6.3 Impact on `cpl` and `clickToLeadRate`

R4 added `cpl: number | null` and `clickToLeadRate: number | null` to `CampaignRow`. After R6's rename, the formulas in `campaign-rollup.ts` become:

```ts
cpl = leads > 0 ? spend / leads : null; // unchanged — uses leads, not clicks
clickToLeadRate = inlineLinkClicks > 0 ? leads / inlineLinkClicks : null; // now uses link clicks
```

`clickToLeadRate` is the key metric that improves — it now measures leads per link click (people who clicked through to WhatsApp/landing page), not leads per all-click (including likes, comments, profile clicks). This makes the rate higher and more meaningful.

### 6.4 Expected metric impact

After the rename, numbers change because `inline_link_clicks < clicks`:

- **CPC goes UP** — same spend / fewer clicks = higher cost per meaningful click
- **CTR goes DOWN** — fewer clicks / same impressions = lower rate
- **clickToLeadRate goes UP** — same leads / fewer (meaningful) clicks = higher conversion rate
- This is correct and more honest for reporting

### 6.4 Changes by file

**Schemas (5 files):**

| File                                          | Change                                                                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/ad-optimizer.ts`        | `CampaignInsightSchema`: `clicks`→`inlineLinkClicks`, `cpc`→`costPerInlineLinkClick`, `ctr`→`inlineLinkClickCtr`. Same for `AdSetInsightSchema`.                                                    |
| `packages/schemas/src/ad-optimizer-v2.ts`     | `MetricSnapshotSchema`: `cpc`→`costPerInlineLinkClick`, `ctr`→`inlineLinkClickCtr`. `CreativeEntrySchema`: `clicks`→`inlineLinkClicks`, `cpc`→`costPerInlineLinkClick`, `ctr`→`inlineLinkClickCtr`. |
| `packages/schemas/src/ad-optimizer-shared.ts` | `LearningPhaseStatusSchema.metricsSnapshot` and `postExitSnapshot`: `ctr`→`inlineLinkClickCtr`                                                                                                      |
| `packages/schemas/src/crm-outcome.ts`         | `MediaBenchmarks`: `ctr`→`inlineLinkClickCtr`. `AdSetLearningInput`: `ctr`→`inlineLinkClickCtr`.                                                                                                    |
| `packages/schemas/src/reports/v1.ts`          | `CampaignRow`: `clicks`→`inlineLinkClicks`, `cpc`→`costPerInlineLinkClick`, `ctr`→`inlineLinkClickCtr`. `ReportCampaignInsight`: same. `ReportInsightsMetrics`: `clicks`→`inlineLinkClicks`.        |

**Ad-optimizer (11 files):**

| File                               | Change                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta-ads-client.ts`               | `mapCampaignInsight`: read `raw.inline_link_clicks`, `raw.cost_per_inline_link_click`, `raw.inline_link_click_ctr`. Same for `mapAdSetInsight`.                                               |
| `audit-runner.ts`                  | `INSIGHT_FIELDS`: `"clicks"`→`"inline_link_clicks"`, `"cpc"`→`"cost_per_inline_link_click"`, `"ctr"`→`"inline_link_click_ctr"`. Update `insightToMetrics` destructuring + `aggregateMetrics`. |
| `meta-report-insights-provider.ts` | Field request arrays + field mapping.                                                                                                                                                         |
| `funnel-analyzer.ts`               | `.clicks`→`.inlineLinkClicks`, benchmark ref.                                                                                                                                                 |
| `creative-analyzer.ts`             | `RawAdData` interface + computed field names.                                                                                                                                                 |
| `period-comparator.ts`             | `MetricSet` interface fields + `metrics` string array.                                                                                                                                        |
| `metric-diagnostician.ts`          | `COST_METRICS`/`PERFORMANCE_METRICS` sets + all `map.get()` string keys.                                                                                                                      |
| `trend-engine.ts`                  | `METRIC_KEYS` array.                                                                                                                                                                          |
| `learning-phase-guard.ts`          | Input field mapping.                                                                                                                                                                          |
| `saturation-detector.ts`           | Trend metric lookup string.                                                                                                                                                                   |
| `inngest-functions.ts`             | `mediaBenchmarks` field reference.                                                                                                                                                            |

**Core/reports (3 files):**

| File                  | Change                                                       |
| --------------------- | ------------------------------------------------------------ |
| `campaign-rollup.ts`  | Field mapping from `ReportCampaignInsight` to `CampaignRow`. |
| `funnel-rollup.ts`    | `clicks` reference in `ReportInsightsMetrics` usage.         |
| `baseline-capture.ts` | Metric name string `"clicks"`→`"inlineLinkClicks"`.          |

**Dashboard (1 file):**

| File          | Change                                                                   |
| ------------- | ------------------------------------------------------------------------ |
| `fixtures.ts` | All `CampaignRow` fixture data (14 campaign rows across 3 fixture sets). |

**Tests (7 files):**

All fixture data and assertions updated:

- `meta-report-insights-provider.test.ts`
- `spend-attributor.test.ts`
- `campaign-rollup.test.ts`
- `funnel-rollup.test.ts`
- `baseline-capture.test.ts`
- `period-rollup.test.ts`
- `managed-comparison-rollup.test.ts`

### 6.5 Unchanged

- `AccountSummarySchema.totalClicks` — different API call, account-level aggregate
- Meta API field names in request strings change (we request different fields), but the `raw.*` keys in `mapCampaignInsight`/`mapAdSetInsight` are the Meta API response keys, which are the snake_case versions

### 6.6 Gotcha: `actions` array `link_click` vs `inline_link_clicks`

The Meta API also exposes `link_click` in the `actions` array with attribution windows (1d view + 7d click). This can be GREATER than `inline_link_clicks` (0-day attribution). We use inline (direct on-ad clicks only), which is correct for measuring ad engagement rather than attributed later activity. This distinction should not be confused in code or comments.

---

## 7. Commit Structure

One PR with 4 atomic commits:

| #   | Commit                                                                  | Scope |
| --- | ----------------------------------------------------------------------- | ----- |
| 1   | `fix(ad-optimizer): CTWA campaign attribution via Graph API`            | Fix 1 |
| 2   | `fix(api): propagate campaignId through instant form inquiry workflow`  | Fix 2 |
| 3   | `fix(core): default assignedAgent to "alex"`                            | Fix 3 |
| 4   | `refactor(schemas): rename clicks/cpc/ctr to inline link click metrics` | Fix 4 |

Commits are independent — can be reviewed/reverted individually.

---

## 8. Test Plan

### 8.1 Fix 1 — CTWA campaign attribution

- `getAdCampaignId`: returns campaign_id from Graph API, caches on second call, returns null on 404/error
- `CtwaAdapter.ingest`: intake includes `sourceCampaignId` when resolver succeeds; skips resolution when `adSourceType !== "ad"`; continues without `sourceCampaignId` on resolver error
- Integration: end-to-end from CTWA webhook → intake → `sourceCampaignId` populated

### 8.2 Fix 2 — Instant form sourceCampaignId

- `campaignId` flows from workflow params to outbox `sourceCampaignId`
- null `campaignId` writes null — no crash
- Existing test coverage for the greeting child work remains passing

### 8.3 Fix 3 — assignedAgent default

- `createDefaultThread()` returns `assignedAgent: "alex"`
- Stage handler map entries all use `"alex"`
- Thread creation flow produces threads with correct agent label

### 8.4 Fix 4 — inline_link_clicks rename

- `MetaAdsClient.mapCampaignInsight` reads `raw.inline_link_clicks`, `raw.cost_per_inline_link_click`, `raw.inline_link_click_ctr`
- `MetaAdsClient.mapAdSetInsight` same
- `MetaReportInsightsProvider.getAggregateMetrics` requests and sums `inlineLinkClicks`
- `MetaReportInsightsProvider.getCampaignMetrics` returns renamed fields
- Audit runner `INSIGHT_FIELDS` requests correct Meta API field names
- All existing ad-optimizer tests pass with renamed fields
- All existing core/reports tests pass with renamed fields
- `pnpm typecheck` passes (verifies no missed rename across the codebase)
- **Stale-reference sweep:** After all renames, run `rg "\.clicks|clicks:|\"clicks\"|\.ctr|ctr:|\"ctr\"|\.cpc|cpc:|\"cpc\"" packages apps` and manually classify each hit as either intentionally unchanged (e.g. `AccountSummarySchema.totalClicks`, `clickToLeadRate`) or a missed migration. This is the final gate before committing Fix 4.

---

## 9. Files Changed (complete list)

| #   | File                                                                   | Fix  | Action                                                                           |
| --- | ---------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| 1   | `packages/ad-optimizer/src/meta-ads-client.ts`                         | 1, 4 | Add `getAdCampaignId`; rename field mapping                                      |
| 2   | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts`                | 1    | Add `resolveCampaignId` dep, call in `ingest()`                                  |
| 3   | `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts`           | 1    | New tests for campaign resolution                                                |
| 4   | `apps/api/src/services/workflows/meta-lead-intake-workflow.ts`         | 2    | Add `campaignId` to inquiry child work params                                    |
| 5   | `apps/api/src/services/workflows/meta-lead-record-inquiry-workflow.ts` | 2    | Add `campaignId` to input type + outbox write                                    |
| 6   | `packages/core/src/conversations/thread.ts`                            | 3    | `"employee-a"` → `"alex"`                                                        |
| 7   | `packages/core/src/lifecycle/stage-handler-map.ts`                     | 3    | `"employee-*"` → `"alex"`                                                        |
| 8   | `packages/schemas/src/ad-optimizer.ts`                                 | 4    | Rename fields in `CampaignInsightSchema`, `AdSetInsightSchema`                   |
| 9   | `packages/schemas/src/ad-optimizer-v2.ts`                              | 4    | Rename fields in `MetricSnapshotSchema`, `CreativeEntrySchema`                   |
| 10  | `packages/schemas/src/ad-optimizer-shared.ts`                          | 4    | Rename `ctr` in `LearningPhaseStatusSchema`                                      |
| 11  | `packages/schemas/src/crm-outcome.ts`                                  | 4    | Rename `ctr` in `MediaBenchmarks`, `AdSetLearningInput`                          |
| 12  | `packages/schemas/src/reports/v1.ts`                                   | 4    | Rename fields in `CampaignRow`, `ReportCampaignInsight`, `ReportInsightsMetrics` |
| 13  | `packages/ad-optimizer/src/audit-runner.ts`                            | 4    | Update `INSIGHT_FIELDS`, `insightToMetrics`, `aggregateMetrics`                  |
| 14  | `packages/ad-optimizer/src/meta-report-insights-provider.ts`           | 4    | Update field requests + mapping                                                  |
| 15  | `packages/ad-optimizer/src/funnel-analyzer.ts`                         | 4    | `.clicks` → `.inlineLinkClicks`                                                  |
| 16  | `packages/ad-optimizer/src/creative-analyzer.ts`                       | 4    | `RawAdData` interface + computed fields                                          |
| 17  | `packages/ad-optimizer/src/period-comparator.ts`                       | 4    | `MetricSet` interface + string array                                             |
| 18  | `packages/ad-optimizer/src/metric-diagnostician.ts`                    | 4    | Metric sets + `map.get()` keys                                                   |
| 19  | `packages/ad-optimizer/src/trend-engine.ts`                            | 4    | `METRIC_KEYS` array                                                              |
| 20  | `packages/ad-optimizer/src/learning-phase-guard.ts`                    | 4    | Input mapping                                                                    |
| 21  | `packages/ad-optimizer/src/saturation-detector.ts`                     | 4    | Trend lookup string                                                              |
| 22  | `packages/ad-optimizer/src/inngest-functions.ts`                       | 4    | Benchmark field ref                                                              |
| 23  | `packages/core/src/reports/campaign-rollup.ts`                         | 4    | Field mapping                                                                    |
| 24  | `packages/core/src/reports/funnel-rollup.ts`                           | 4    | Metrics usage                                                                    |
| 25  | `packages/core/src/reports/baseline-capture.ts`                        | 4    | Metric name string                                                               |
| 26  | `apps/dashboard/src/app/(auth)/reports/fixtures.ts`                    | 4    | All fixture data                                                                 |
| 27  | `packages/ad-optimizer/src/meta-report-insights-provider.test.ts`      | 4    | Fixtures + assertions                                                            |
| 28  | `packages/ad-optimizer/src/analyzers/spend-attributor.test.ts`         | 4    | Fixture builder                                                                  |
| 29  | `packages/core/src/reports/campaign-rollup.test.ts`                    | 4    | Fixtures + assertions                                                            |
| 30  | `packages/core/src/reports/funnel-rollup.test.ts`                      | 4    | Fixtures                                                                         |
| 31  | `packages/core/src/reports/baseline-capture.test.ts`                   | 4    | Fixtures                                                                         |
| 32  | `packages/core/src/reports/period-rollup.test.ts`                      | 4    | Fixtures                                                                         |
| 33  | `packages/core/src/reports/managed-comparison-rollup.test.ts`          | 4    | Fixtures                                                                         |
| 34  | `apps/chat/` (wiring file TBD during implementation)                   | 1    | Inject `resolveCampaignId`                                                       |

---

## 10. What PR-R6 Does NOT Do

- No new Prisma schema migration
- No new API endpoints
- No dashboard UI changes (the renamed fields in `CampaignRow` are not displayed — campaigns component only renders `name`, `spend`, `leads`, `cpl`, `revenue`, `roas`)
- No `assignedAgent` write-time validation against `AgentKey`
- No escalation/handoff flow
- No persistent ad→campaign cache (in-memory is sufficient for v1)
- No batch Graph API calls for campaign resolution (single-call per CTWA lead is sufficient at current volume)
