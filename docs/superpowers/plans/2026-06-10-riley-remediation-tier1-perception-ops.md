# Tier 1: "The audit survives a real account" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read [`2026-06-10-riley-remediation-00-overview.md`](./2026-06-10-riley-remediation-00-overview.md) first for the shared guardrails, the answered open decisions, and the cross-slice integration review. They are not repeated here. This tier is **blocked-by Tier 0** for the one live-verify task (a credentialed org); all code below can be built in parallel against recorded fixtures.

**Goal:** Make Riley's weekly audit survive first contact with a real Meta account. Today the audit requests fields Meta's `/insights` edge does not return (silently zeroing money), re-fetches the whole account once per campaign behind a 60s limiter (timing the Inngest step out), serializes a cleartext token into step state, halts the entire fleet on the first org's error, never alerts on failure or zero output, and runs on zero-data orgs because the coverage gate is wired nowhere. Every fix here is "the audit is honest and resilient under a real load," not "the audit does more."

**Architecture:** Six concrete fixes plus one producer, sequenced so the riskiest assumption (the `/insights` field set) is settled FIRST because it reshapes the call-count math the batching (D2-7) and step-split (D2-1) fixes depend on. D2-2 carries a one-time MANUAL live-verify task (the only Tier-0-dependent step). Batching collapses the per-campaign account re-fetches from 2N calls to 2, which erases most of D2-1 before any step-splitting is attempted. Tokens move out of step state into the consuming step (the creative-publish pattern). The fleet loop gains per-deployment isolation. The failure contract (already SHIPPED) gets two `alert:false → true` flips plus a new zero-output signal. The coverage validator (which already exists) gets a production producer wired with `listCampaigns` + an intake store.

**Tech Stack:** TypeScript (packages/ad-optimizer Layer 2, packages/core Layer 3, apps/api Layer 5), Inngest, Vitest, `node:fetch`, the existing `makeOnFailureHandler`/`OperatorAlerter` failure contract, Prisma (intake store for coverage).

---

## Verified findings (this tier)

All re-verified at file:line against current `main` on 2026-06-10.

| #                     | Status               | Pinned location                                                                                                                                                                                                                                                                                                                                                                                                                           | Plan owner                                  |
| --------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| D2-2                  | CONFIRMED            | `INSIGHT_FIELDS` `packages/ad-optimizer/src/audit-runner.ts:209-222` (has `status`, `revenue`); sent to `/insights` via `getCampaignInsights` `audit-runner.ts:375-376` → `meta-ads-client.ts:135`; provider also requests `effective_status` `meta-campaign-insights-provider.ts:37`; mapper reads `raw.status`/`raw.revenue` `meta-ads-client.ts:456-479`; the only test INVENTS those fields `__tests__/meta-ads-client.test.ts:36,42` | PR 1.1 (FIRST)                              |
| D2-7                  | CONFIRMED            | account-level re-fetch per campaign: `getCampaignLearningData` `meta-campaign-insights-provider.ts:35-40`, `getTargetBreachStatus` `:107-118`; both filter client-side by `campaignId`; called once-per-campaign in the loop `audit-runner.ts:512,544`; `getCampaignInsights` already returns all campaigns `meta-ads-client.ts:109-138`                                                                                                  | PR 1.2                                      |
| D2-1                  | CONFIRMED            | ~5-7 + 4N serial Graph calls × 60s limiter (`meta-ads-client.ts:10` `RATE_LIMIT_MS`, applied `:446-454`) inside ONE step `inngest-functions.ts:176`; code's own `TODO(scale)` `:148-158`                                                                                                                                                                                                                                                  | PR 1.2 (mostly resolved by D2-7)            |
| D2-5                  | CONFIRMED            | one undifferentiated `!response.ok` throw `meta-ads-client.ts:430-444`; no 429/Retry-After/backoff                                                                                                                                                                                                                                                                                                                                        | PR 1.3                                      |
| D2-4                  | CONFIRMED            | token resolved in step `creds-${id}` `inngest-functions.ts:165-167`, consumed in step `audit-${id}` via closure `:176-177`; correct pattern (re-resolve inside fn) `bootstrap/inngest.ts:494-509`                                                                                                                                                                                                                                         | PR 1.3                                      |
| D2-3 (isolation half) | CONFIRMED            | fleet `for` loop has no per-step try/catch `inngest-functions.ts:164-281`; the `needs_reauth`-skip half is Tier 0 PR 0.1's resolver `USABLE` filter (cross-ref, do not duplicate)                                                                                                                                                                                                                                                         | PR 1.4                                      |
| D2-9 / D9-3           | SUPERSEDED-machinery | `makeOnFailureHandler` attached to every ad-optimizer cron with `alert:false` `bootstrap/inngest.ts:1138-1173`; handler fires `OperatorAlerter` only when `alert:true` `packages/core/src/observability/async-failure-handler.ts:134`; `saveAuditReport` marks `completed` regardless of content `bootstrap/inngest.ts:412-428`                                                                                                           | PR 1.4 (flip + zero-output)                 |
| D9-4 / D1-9           | CONFIRMED            | Gate-0 seam `inngest-functions.ts:214-216` (optional `createCoverageValidator`); prod deps `adOptimizerDeps` omit it `bootstrap/inngest.ts:376-441`; `CoverageValidator` already exists `onboarding/coverage-validator.ts:45-73` (needs `listCampaigns` + intake `hasRecentLead`)                                                                                                                                                         | PR 1.5 (depends on Tier 0 credentialed org) |

**Sequencing note (load-bearing):** D2-2 ships **first** because if its assumption is wrong (Meta does return `status`/`revenue` on `/insights`), the whole tier's call-count and money-source math reshapes. D2-7 ships **before** D2-1 because the batching collapses 2N account-level calls to 2, which is most of the D2-1 timeout. The `needs_reauth` half of D2-3 is **already done** in Tier 0 PR 0.1 (`buildRileyCredentialResolver`'s `USABLE` filter). This tier only adds the fleet-isolation half.

---

## File structure (what each PR creates/modifies)

- **PR 1.1:** `packages/ad-optimizer/src/audit-runner.ts` (`INSIGHT_FIELDS` minus `status`/`revenue`), `packages/ad-optimizer/src/meta-campaign-insights-provider.ts:37` (drop `effective_status` from the learning fetch or source status from the campaign-object edge), `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts` (replace the invented-field fixture with a recorded `/insights` shape), `packages/ad-optimizer/src/__tests__/meta-ads-client-insights-fixture.test.ts` (new recorded-fixture integration test), `docs/runbooks/riley-meta-insights-live-verify.md` (new, the one-time manual task).
- **PR 1.2:** `packages/ad-optimizer/src/audit-runner.ts` (hoist account-level insights + breach-window fetch above the per-campaign loop, index by `campaignId`), `packages/schemas/src/crm-outcome.ts` (extend `CampaignInsightsProvider` with optional pre-fetched rows), `packages/ad-optimizer/src/meta-campaign-insights-provider.ts` (accept pre-fetched rows, skip the re-fetch), tests in `__tests__/`.
- **PR 1.3:** `packages/ad-optimizer/src/meta-ads-client.ts` (`handleResponse` 429 classification + `RateLimitError`, bounded backoff), `apps/api/src/bootstrap/inngest.ts:160-281` consumption pattern (re-resolve creds inside `audit-${id}`; new `getDeploymentCredentials` call moves into the step), `packages/ad-optimizer/src/inngest-functions.ts` (signature: pass `deploymentId` not `creds` into the audit step), tests.
- **PR 1.4:** `packages/ad-optimizer/src/inngest-functions.ts` (per-deployment try/catch in `executeWeeklyAudit` + a failure-signal callback), `apps/api/src/bootstrap/inngest.ts:1138-1173` (flip `alert:true` on weekly + signal-health), `apps/api/src/bootstrap/inngest.ts:412-428` (`saveAuditReport` zero-output alert), tests in `packages/ad-optimizer/src/__tests__/` + `apps/api/src/bootstrap/__tests__/`.
- **PR 1.5:** `apps/api/src/bootstrap/inngest.ts` (wire `createCoverageValidator` into `adOptimizerDeps`), `apps/api/src/bootstrap/coverage-validator-factory.ts` (new: `listCampaigns` adapter over `MetaAdsClient` + a Prisma intake store), `packages/db/src/...intake-store` (or reuse the existing lead store, grep first), tests.

---

## PR 1.1: Fix `INSIGHT_FIELDS` + recorded-fixture test + live-verify (D2-2, FIRST)

**Why first:** `INSIGHT_FIELDS` (`audit-runner.ts:209-222`) requests `status` and `revenue`, and the provider's learning fetch (`meta-campaign-insights-provider.ts:37`) requests `effective_status`: all three are **invalid on the AdsInsights `/insights` edge** (they belong to the campaign-object edge, not the insights report; Meta typically returns Graph error #100). The mapper (`meta-ads-client.ts:456-479`) reads `raw.status`/`raw.revenue`, so on the real edge they silently coerce to `""`/`0`. The _only_ test (`__tests__/meta-ads-client.test.ts:26-91`) hand-authors a mock that **invents** `status: "ACTIVE"`, `effective_status: "ACTIVE"`, and `revenue: "2250.00"` in the response, so the bad request was never caught. Money/revenue must come from `action_values`/`purchase_roas` (already surfaced via the `actions` passthrough at `meta-ads-client.ts:475-477`), not a `revenue` field that does not exist on this edge.

This is FIRST because the whole tier's call-count and money math assume this field set. If the live-verify (Step 6) shows Meta _does_ return these on `/insights`, D2-7/D2-1 re-plan.

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts:209-222` (`INSIGHT_FIELDS`), `packages/ad-optimizer/src/meta-campaign-insights-provider.ts:37`
- Modify: `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts:26-91` (the invented-field fixture)
- Create: `packages/ad-optimizer/src/__tests__/meta-ads-client-insights-fixture.test.ts`
- Create: `docs/runbooks/riley-meta-insights-live-verify.md`

Current `INSIGHT_FIELDS` (verified `audit-runner.ts:209-222`):

```ts
const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "status",
  "impressions",
  "inline_link_clicks",
  "spend",
  "conversions",
  "revenue",
  "frequency",
  "cpm",
  "inline_link_click_ctr",
  "cost_per_inline_link_click",
];
```

- [ ] **Step 1: Write the failing recorded-fixture test.** `meta-ads-client-insights-fixture.test.ts`. This is the new "what Meta actually returns" pin. The fixture is a REAL `/insights` response shape (no `status`/`revenue` keys; `actions`/`action_values` instead). It asserts the mapper does NOT silently fabricate a status and that money is sourced from `action_values`, not a missing `revenue`.

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { MetaAdsClient } from "../meta-ads-client.js";

// Recorded shape of a real GET /act_X/insights?level=campaign response. The
// AdsInsights edge does NOT return `status`/`effective_status`/`revenue`; it
// returns `actions` and `action_values` for conversion + value. Captured from a
// live Graph v21.0 response (see docs/runbooks/riley-meta-insights-live-verify.md).
const RECORDED_INSIGHTS_RESPONSE = {
  data: [
    {
      campaign_id: "23851234567890123",
      campaign_name: "SG-Botox-Lunchtime",
      impressions: "48211",
      inline_link_clicks: "1043",
      spend: "612.40",
      frequency: "1.92",
      cpm: "12.70",
      inline_link_click_ctr: "2.16",
      cost_per_inline_link_click: "0.59",
      actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "11" }],
      action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "3300.00" }],
      date_start: "2026-05-25",
      date_stop: "2026-05-31",
    },
  ],
};

describe("MetaAdsClient — real /insights edge shape (no status/revenue field)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does NOT request the invalid status/revenue fields on /insights", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(RECORDED_INSIGHTS_RESPONSE),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });

    // Drive it through the same field list the audit runner uses.
    const { INSIGHT_FIELDS } = await import("../audit-runner.js");
    await client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-05-31" },
      fields: INSIGHT_FIELDS,
    });

    const url = String(fetchSpy.mock.calls[0]![0]);
    const fields = new URL(url).searchParams.get("fields") ?? "";
    expect(fields).not.toContain("status");
    expect(fields).not.toContain("revenue");
    expect(fields).not.toContain("effective_status");
  });

  it("maps a recorded response without fabricating a status, and sources money from action_values", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(RECORDED_INSIGHTS_RESPONSE),
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });

    const [row] = await client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-05-31" },
      fields: ["campaign_id", "spend", "actions", "action_values"],
    });

    // status/effectiveStatus stay empty (honest "unknown"), NOT a fabricated "ACTIVE".
    expect(row!.status).toBe("");
    expect(row!.effectiveStatus).toBe("");
    // revenue is no longer read off a missing field; the value lives in action_values.
    expect(row!.actionValues?.find((a) => a.action_type.includes("purchase"))?.value).toBe(
      "3300.00",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** `pnpm --filter @switchboard/ad-optimizer test meta-ads-client-insights-fixture`. Expected fails: (a) `INSIGHT_FIELDS` is not exported and still contains `status`/`revenue`; (b) `actionValues` is not surfaced by the mapper. This pins both the field-set bug and the missing money source.

- [ ] **Step 3: Fix `INSIGHT_FIELDS`** (`audit-runner.ts:209-222`). Remove `status` and `revenue`; export the const (for the test). If campaign status is needed downstream (it is read by `handoffContextFromInsight` and the report builders), source it from the campaign-object edge, NOT the insights edge. Add a small `getCampaignStatuses(campaignIds)` batch on `MetaAdsClient` over `/{account}/campaigns?fields=id,status,effective_status` and join by id, OR confirm via grep that the consumers tolerate `status:""` (the mapper already defaults to `""`, and `aggregateMetrics` `audit-runner.ts:248-255` never reads `status`). Default to the simpler path (tolerate `""`) unless a consumer hard-requires status; document the choice inline.

```ts
const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "impressions",
  "inline_link_clicks",
  "spend",
  "conversions",
  "frequency",
  "cpm",
  "inline_link_click_ctr",
  "cost_per_inline_link_click",
  "action_values", // money source on the insights edge (NOT `revenue`)
];
export { INSIGHT_FIELDS }; // pinned by the recorded-fixture test
```

- [ ] **Step 4: Drop `effective_status` from the learning fetch** (`meta-campaign-insights-provider.ts:37`). The current fetch is `["campaign_id", "effective_status", "conversions"]`. `effective_status` is invalid on `/insights`; the provider reads `match?.effectiveStatus` (`:45`) which would always be `""`. Since the audit's learning phase is authoritatively derived from `learning_stage_info` (`deriveLearningPhase`, `:52-75`), the `effectiveStatus` read here is advisory. Replace with `["campaign_id", "conversions"]` and default `effectiveStatus` to `"UNKNOWN"` (already its fallback at `:45`). Update the existing test at `meta-campaign-insights-provider.test.ts:142-173` which asserts `effectiveStatus === "ACTIVE"` from an invented mock. Change it to assert the `"UNKNOWN"` fallback (honest) and that `optimizationEvents` still reads from `conversions`.

- [ ] **Step 5: Surface `action_values` in the mapper** (`meta-ads-client.ts:456-479`). The mapper already surfaces `actions`; add the parallel `action_values` passthrough so `action_values` reaches `CampaignInsight`:

```ts
...(Array.isArray(raw.action_values)
  ? { actionValues: raw.action_values as { action_type: string; value: string }[] }
  : {}),
```

Add `actionValues?: { action_type: string; value: string }[]` to `CampaignInsightSchema` in `packages/schemas/src/ad-optimizer.ts` (mirror the existing `actions` field). Then point `aggregateMetrics`' `roas` (`audit-runner.ts:263`) and the `totalRevenue` accumulation (`:253`) at the configured purchase `action_values` entry instead of the now-removed `insight.revenue`; gate with `Number.isFinite` (cross-ref Tier 2 D1-4 NaN-guard rule). Keep a documented default (sum the purchase `action_values`) so analysis-only callers are unaffected.

- [ ] **Step 6: Replace the invented-field fixture in the legacy test** (`__tests__/meta-ads-client.test.ts:26-91`). Remove `status`, `effective_status`, `revenue` from the mock response object and from the asserted mapped result; add `actions`/`action_values`. This is the fixture that hid the bug; it must now reflect the real edge.

- [ ] **Step 7: Write the one-time live-verify runbook.** `docs/runbooks/riley-meta-insights-live-verify.md`. **This is the only Tier-0-dependent step.** It is a MANUAL task (needs real Meta creds from a Tier-0-credentialed org): run a single `GET /act_<id>/insights?level=campaign&fields=campaign_id,spend,actions,action_values` against the pilot account, paste the response shape, and confirm: (a) no `status`/`revenue` keys appear; (b) `action_values` carries the purchase value. If the live response contradicts this (Meta DOES return them), STOP and re-plan D2-7/D2-1: the call-count math changes. Record the captured shape as the canonical fixture for Step 1.

- [ ] **Step 8: Run full ad-optimizer + schemas tests + typecheck.** `pnpm --filter @switchboard/ad-optimizer test`, `pnpm --filter @switchboard/schemas test`, `pnpm typecheck`. Commit: `git commit -m "fix(ad-optimizer): drop invalid status/revenue from insight fields, source money from action_values"`

**Acceptance:** `getCampaignInsights` no longer requests `status`/`effective_status`/`revenue` on `/insights`; the mapper surfaces `action_values` and never fabricates a status; the recorded-fixture test pins the real edge shape; a manual live-verify confirms the assumption against the pilot account. **Blocks D2-7/D2-1's call-count assumptions.**

---

## PR 1.2: Batch the per-campaign account re-fetches + collapse the step timeout (D2-7, then D2-1)

**Why second:** `getCampaignLearningData` (`meta-campaign-insights-provider.ts:35-40`) and `getTargetBreachStatus` (`:107-118`) each fetch ACCOUNT-level insights and filter client-side by `campaignId`, once **per campaign**, from the loop at `audit-runner.ts:512` and `:544`. That is 2N account-level Graph calls behind a 60s limiter (`meta-ads-client.ts:10`), which is the dominant term in the D2-1 step-timeout (the code's own `TODO(scale)` at `inngest-functions.ts:148-158` says total wall time ≈ N_campaigns × 60s). But `getCampaignInsights` already returns ALL campaigns in one call, and the audit-runner already holds `currentInsights` (all campaigns) at `:374`. So hoist a single account-level breach-window fetch (`time_increment=1`) above the loop, index by `campaignId` in a `Map`, and pass the pre-fetched rows into the provider methods. **2N → 2.** Once D2-7 lands, the residual D2-1 (the ~5-7 account-level calls) is well under the step budget; only relax the proactive limiter once D2-5's reactive 429 handling exists (PR 1.3).

**Files:**

- Modify: `packages/schemas/src/crm-outcome.ts:105-129` (`CampaignInsightsProvider`: add an optional `prefetchedDailyRows?: CampaignInsight[]` to `getTargetBreachStatus` and an optional `prefetchedLearningRows?` to `getCampaignLearningData`)
- Modify: `packages/ad-optimizer/src/meta-campaign-insights-provider.ts` (use pre-fetched rows when present, skip the account re-fetch)
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (hoist the two account-level fetches above the loop `:510`, build `Map<campaignId, CampaignInsight[]>`)
- Test: `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts` (extend), `packages/ad-optimizer/src/__tests__/audit-runner-batching.test.ts` (new)

- [ ] **Step 1: Failing provider test, pre-fetched rows skip the re-fetch** (`meta-campaign-insights-provider.test.ts`):

```ts
it("uses prefetched daily rows and does NOT re-fetch the account when they are provided", async () => {
  const getCampaignInsights = vi.fn(async () => []);
  const client = {
    getCampaignInsights,
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  } as unknown as AdsClientInterface;
  const prefetched = Array.from({ length: 14 }, (_, i) => ({
    campaignId: "c_1",
    campaignName: "C",
    status: "",
    effectiveStatus: "",
    impressions: 1000,
    inlineLinkClicks: 40,
    spend: 600,
    conversions: 1,
    revenue: 0,
    frequency: 1,
    cpm: 5,
    inlineLinkClickCtr: 1,
    costPerInlineLinkClick: 1,
    dateStart: `2026-05-${18 + i}`,
    dateStop: `2026-05-${18 + i}`,
  })) as never[];

  const r = await new MetaCampaignInsightsProvider(client).getTargetBreachStatus({
    orgId: "o",
    accountId: "a",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
    prefetchedDailyRows: prefetched,
  });

  expect(r.periodsAboveTarget).toBe(14); // 600/1 > 50 every day
  expect(getCampaignInsights).not.toHaveBeenCalled(); // the whole point: no per-campaign re-fetch
});
```

- [ ] **Step 2: Verify fail.** `pnpm --filter @switchboard/ad-optimizer test meta-campaign-insights-provider` → fails: `prefetchedDailyRows` is ignored, `getCampaignInsights` is still called.

- [ ] **Step 3: Implement pre-fetch consumption in the provider.** In `getTargetBreachStatus`, branch: when `input.prefetchedDailyRows` is present, `const rows = input.prefetchedDailyRows` instead of the `await this.adsClient.getCampaignInsights({...timeIncrement:1...})` at `:107-116`; everything downstream (the `campaignDays` filter at `:118`, the volume gate, the denominator) is unchanged. Do the same for `getCampaignLearningData` (use `input.prefetchedLearningRows` in place of the `:35-38` fetch). The fetch path stays as the back-compat default (absent → fetch, exactly today's behavior, so the existing 20+ provider tests stay green).

- [ ] **Step 4: Extend the interface** (`crm-outcome.ts:105-129`). Add `prefetchedDailyRows?: CampaignInsight[]` to `getTargetBreachStatus`'s input and `prefetchedLearningRows?: CampaignInsight[]` to `getCampaignLearningData`'s input, both optional (back-compat). Note: `CampaignInsight` is already imported there as `CampaignInsightSchema`.

- [ ] **Step 5: Failing audit-runner test, one account-level breach fetch, not N** (`__tests__/audit-runner-batching.test.ts`). Mirror the existing `audit-runner.test.ts` harness style. Drive the runner with 3 campaigns and a spy `getCampaignInsights`; assert it is called a bounded number of times (the two window pulls at `:374-376` + ONE breach-window pull), NOT 2 + 2×3.

```ts
it("fetches the daily breach window once for the whole account, not once per campaign", async () => {
  const insightsCallArgs: Array<{ timeIncrement?: number }> = [];
  const getCampaignInsights = vi.fn(async (p: { timeIncrement?: number }) => {
    insightsCallArgs.push(p);
    // window pulls (no timeIncrement) return 3 campaigns; the breach pull (timeIncrement:1) returns daily rows
    return p.timeIncrement === 1 ? dailyRowsForThreeCampaigns() : threeCampaignsCurrentWindow();
  });
  // ...build runner with a MetaCampaignInsightsProvider over this client...
  await runner.run(weeklyRanges());

  const breachPulls = insightsCallArgs.filter((a) => a.timeIncrement === 1);
  expect(breachPulls).toHaveLength(1); // ONE account-level breach fetch for all 3 campaigns (was 3)
});
```

- [ ] **Step 6: Verify fail.** Currently 3 breach pulls (one per campaign).

- [ ] **Step 7: Hoist the account-level fetches in the audit-runner** (`audit-runner.ts`, above the loop at `:510`). After `currentInsights` is in hand (`:374-376`), if `this.insightsProvider` supports it, fetch the daily breach-window rows ONCE for the account (the same `time_increment=1` call `getTargetBreachStatus` makes internally, but un-filtered), and `getCampaignLearningData`'s account read ONCE, then build `Map<campaignId, CampaignInsight[]>`. In the loop, pass `prefetchedDailyRows: dailyByCampaign.get(insight.campaignId) ?? []` into `getTargetBreachStatus` (`:544`) and the prefetched learning rows into `getCampaignLearningData` (`:512`). Index by `campaignId`. Keep the hoist behind a capability check so the eval harness and analysis-only callers (which inject a fake provider) are unaffected: absent capability ⇒ the loop falls back to the per-campaign path (today's behavior).

- [ ] **Step 8: D2-1 residual.** With D2-7 collapsing 2N → 2 account-level calls, recompute the step budget in the `TODO(scale)` comment (`inngest-functions.ts:148-158`): the audit is now ~5-7 account-level calls flat, not 4N. Update the comment to reflect the new math and the remaining lever (split the residual account-level calls across `step.run` boundaries, or relax `RATE_LIMIT_MS` once 429 handling lands, PR 1.3). Do NOT split steps preemptively if the recomputed budget is under the Inngest step ceiling; the comment is the deliverable, plus a test asserting the per-deployment audit makes a bounded (≤ ~8) number of Graph calls regardless of campaign count.

- [ ] **Step 9: Run full ad-optimizer + schemas tests + typecheck.** Commit: `git commit -m "perf(ad-optimizer): batch account-level insights, collapse per-campaign re-fetch from 2N to 2"`

**Acceptance:** a 3-campaign (or N-campaign) audit makes ONE account-level breach-window fetch and ONE learning fetch, not N of each; total per-deployment Graph calls are bounded and independent of campaign count; existing provider tests (fetch path) stay green. **Erases most of D2-1.**

---

## PR 1.3: 429 classification + tokens out of step state (D2-5, D2-4)

**Why bundled:** Both touch the Meta client's request path and the cron's credential handling, and D2-1's "relax the proactive limiter" only becomes safe once reactive 429 handling exists. D2-4 is the security half (a cleartext token must not be serialized into Inngest step state); D2-5 is the resilience half (a 429 must back off, not abort).

**Files:**

- Modify: `packages/ad-optimizer/src/meta-ads-client.ts:430-444` (`handleResponse`)
- Modify: `packages/ad-optimizer/src/inngest-functions.ts:160-281` (`executeWeeklyAudit`: pass `deploymentId` into the audit step; resolve creds inside it) and the `executeDailyCheck`/`executeDailySignalHealthCheck` twins (`:284-298`, `:346-378`)
- Modify: `apps/api/src/bootstrap/inngest.ts:393-402` (the resolver is already `buildRileyCredentialResolver` from Tier 0; nothing changes there, only the _call site_ moves)
- Test: `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts` (extend error-handling block), `packages/ad-optimizer/src/__tests__/inngest-functions.test.ts` (extend: assert creds resolved inside the audit step, never passed across steps)

### 1.3a: 429 + Retry-After + bounded backoff (D2-5)

- [ ] **Step 1: Failing test.** `__tests__/meta-ads-client.test.ts` error-handling block:

```ts
it("classifies a 429 as a typed RateLimitError carrying Retry-After", async () => {
  const fetchSpy = vi.fn().mockResolvedValueOnce({
    ok: false,
    status: 429,
    headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? "42" : null) },
    json: () =>
      Promise.resolve({ error: { message: "rate limited", type: "OAuthException", code: 17 } }),
  });
  global.fetch = fetchSpy as unknown as typeof fetch;
  const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
  await expect(
    client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      fields: ["spend"],
    }),
  ).rejects.toMatchObject({ name: "RateLimitError", retryAfterSeconds: 42 });
});

it("keeps a 400 as a terminal (non-rate-limit) error", async () => {
  const fetchSpy = vi.fn().mockResolvedValueOnce({
    ok: false,
    status: 400,
    headers: { get: () => null },
    json: () =>
      Promise.resolve({
        error: { message: "Invalid parameter", type: "OAuthException", code: 100 },
      }),
  });
  global.fetch = fetchSpy as unknown as typeof fetch;
  const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
  await expect(
    client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      fields: ["spend"],
    }),
  ).rejects.toThrow("Meta API error (400): Invalid parameter");
});
```

(Note: the existing tests at `meta-ads-client.test.ts:453-492` mock `{ ok:false, status, json }` without `headers`; add a `headers: { get: () => null }` stub to those two so they keep passing once `handleResponse` reads `response.headers`.)

- [ ] **Step 2: Verify fail.** `RateLimitError` does not exist; the 429 currently throws a generic `Error("Meta API error (429): ...")`.

- [ ] **Step 3: Implement classification** in `handleResponse` (`meta-ads-client.ts:430-444`). Define `export class RateLimitError extends Error` with `name = "RateLimitError"` and a `retryAfterSeconds?: number` (parse `response.headers.get("retry-after")`, NaN-guard via `Number.isFinite`; Meta also signals throttling via code 17/4/32 and the `X-Business-Use-Case-Usage` header, so classify on status 429 first, fall back to those codes). For 429, throw `RateLimitError`; for everything else keep the existing `Error("Meta API error (status): message")`. Add a bounded retry inside `get`/`post`: on `RateLimitError`, wait `min(retryAfterSeconds ?? backoff, MAX_BACKOFF_MS)` and retry up to N=2 times, then rethrow (so an exhausted 429 still surfaces to the cron's onFailure → alert, PR 1.4). Keep it dependency-free (`setTimeout`).

- [ ] **Step 4: Verify pass.** Run the error-handling block.

### 1.3b: Resolve credentials inside the audit step (D2-4)

The current loop (`inngest-functions.ts:164-281`) resolves `creds` in step `creds-${deployment.id}` (`:165-167`) and consumes them in step `audit-${deployment.id}` (`:176-177`) via closure. Inngest memoizes step outputs as JSON, so the cleartext `accessToken` is serialized into step state (`feedback_inngest_step_state_json_only`). The correct pattern re-resolves creds INSIDE the consuming step (creative-publish: `bootstrap/inngest.ts:494-509` calls `assertPublishable`, which re-resolves fresh creds within the function).

- [ ] **Step 5: Failing test.** `__tests__/inngest-functions.test.ts`. With the fixed code, `getDeploymentCredentials` is invoked but its result is never the output of a `step.run`; it is called inside the `audit-${id}` step's function body. Pin that no step is named `creds-*` and that creds are resolved inside the audit step:

```ts
it("resolves credentials INSIDE the audit step, never as its own memoized step", async () => {
  const stepNames: string[] = [];
  const step = {
    run: vi.fn((name: string, fn: () => unknown) => {
      stepNames.push(name);
      return fn();
    }),
  };
  const getDeploymentCredentials = vi
    .fn()
    .mockResolvedValue({ accessToken: "secret", accountId: "act_1" });
  const deps = { ...baseWeeklyDeps(), getDeploymentCredentials };

  await executeWeeklyAudit(step as never, deps);

  // No step memoizes the cleartext token output.
  expect(stepNames.some((n) => n.startsWith("creds-"))).toBe(false);
  // The audit step still ran and the resolver was consulted from within it.
  expect(stepNames.some((n) => n.startsWith("audit-"))).toBe(true);
  expect(getDeploymentCredentials).toHaveBeenCalledWith("dep-1");
});
```

(Note: this replaces the existing "skips deployment when credentials are missing" test's mechanism: keep that behavior but move the null-check inside the audit step: a null resolve inside the step returns early without building a client. Update `inngest-functions.test.ts:127-135` accordingly.)

- [ ] **Step 6: Verify fail.** Today a `creds-dep-1` step exists.

- [ ] **Step 7: Implement.** In `executeWeeklyAudit`, delete the `creds-${deployment.id}` step. Inside `step.run("audit-${deployment.id}", async () => { ... })`, call `const creds = await deps.getDeploymentCredentials(deployment.id); if (!creds) return;` as the first lines, then build the client. The token now lives only in the step's local scope, never in the memoized step output (which is the report). Apply the SAME change to `executeDailyCheck` (`:284-298`, fold creds into `check-${id}`) and `executeDailySignalHealthCheck` (`:346-378`, fold into `signal-health-${id}`: note pixelId there is fine to keep as its own step; it is not a secret). The pixel step in the weekly loop (`:172-174`) stays separate (not a secret).

- [ ] **Step 8: Run full ad-optimizer tests + typecheck + the api package build** (untyped `vi.fn` greens vitest but reds the api/chat build, per `feedback_vitest_untyped_fn_breaks_chat_build`; the step spy arg is typed above). Commit: `git commit -m "fix(ad-optimizer): classify 429 with backoff, resolve meta creds inside the audit step (not step state)"`

**Acceptance:** a 429 surfaces as a `RateLimitError` with `Retry-After`, retries with bounded backoff, and a 400/500 stays terminal; the decrypted Meta token is never serialized into Inngest step state (no `creds-*` step). **Unblocks D2-1's limiter relaxation.**

---

## PR 1.4: Fleet isolation + failure/zero-output alerting (D2-3 isolation half, D2-9 flip)

**Why bundled:** Isolation and alerting are the same operability story: "one org's failure is recorded + alerted, but the fleet continues, and a silently-empty run is not silence." D2-3's `needs_reauth`-skip half is **already done** in Tier 0 PR 0.1 (the `USABLE` filter in `buildRileyCredentialResolver`). This PR adds only the per-deployment try/catch. D2-9's failure-contract machinery is **already SHIPPED**; this is two `alert:false → true` flips plus a zero-output signal. Frame both as EDITS, not new machinery.

**Files:**

- Modify: `packages/ad-optimizer/src/inngest-functions.ts:164-281` (per-deployment try/catch + an optional `onDeploymentFailure` callback) and `:346-378` (signal-health twin)
- Modify: `apps/api/src/bootstrap/inngest.ts:1140-1149` (weekly `alert:true`), `:1162-1173` (signal-health `alert:true`)
- Modify: `apps/api/src/bootstrap/inngest.ts:412-428` (`saveAuditReport`: zero-output alert before marking completed)
- Test: `packages/ad-optimizer/src/__tests__/inngest-functions.test.ts` (isolation), `apps/api/src/bootstrap/__tests__/ad-optimizer-alerting.test.ts` (new: flip + zero-output)

### 1.4a: Per-deployment isolation (D2-3 isolation half)

- [ ] **Step 1: Failing test.** `__tests__/inngest-functions.test.ts`. Today, a throw in deployment 1's `audit-${id}` step aborts the loop, so deployment 2 never runs. Pin "the fleet continues":

```ts
it("continues the fleet when one deployment's audit throws, recording the failure", async () => {
  const onDeploymentFailure = vi.fn();
  const deps = {
    ...baseWeeklyDeps(),
    // two deployments; dep-1's audit throws (e.g. an exhausted 429), dep-2 must still run
    createAdsClient: vi
      .fn()
      .mockReturnValueOnce({
        getCampaignInsights: vi.fn().mockRejectedValue(new Error("Graph 500 for dep-1")),
        getAdSetInsights: vi.fn().mockResolvedValue([]),
        getAccountSummary: vi.fn().mockResolvedValue(emptyAccountSummary()),
      })
      .mockReturnValueOnce(workingAdsClient()),
    onDeploymentFailure,
  };

  await expect(executeWeeklyAudit(step as never, deps)).resolves.toBeUndefined();

  // dep-2 still produced + saved a report despite dep-1 throwing.
  expect(deps.saveAuditReport).toHaveBeenCalledTimes(1);
  expect(deps.saveAuditReport).toHaveBeenCalledWith("dep-2", expect.any(Object));
  // dep-1's failure was recorded, not swallowed silently.
  expect(onDeploymentFailure).toHaveBeenCalledWith(
    expect.objectContaining({ deploymentId: "dep-1", organizationId: "org-1" }),
    expect.any(Error),
  );
});
```

- [ ] **Step 2: Verify fail.** Today the rejection propagates out of the loop; `saveAuditReport` is called 0 times and the test rejects.

- [ ] **Step 3: Implement isolation.** Wrap each deployment's body in `executeWeeklyAudit` in `try { ... } catch (err) { await deps.onDeploymentFailure?.({ deploymentId, organizationId }, err); }` so a single org's throw is recorded + surfaced and the loop continues. Add `onDeploymentFailure?: (ctx: { deploymentId: string; organizationId: string }, err: unknown) => void | Promise<void>` to `CronDependencies`. **Important (Inngest semantics):** the per-deployment work is already inside `step.run("audit-${id}", ...)`, which Inngest retries independently. The try/catch must wrap the `await step.run(...)` call so an exhausted step does not abort _siblings_, but each step still gets its own retry budget. Document that the cron-level `onFailure` (the alert, 1.4b) fires only when the whole function throws; per-deployment isolation means the function does NOT throw on a single org, so the per-deployment `onDeploymentFailure` is the signal that feeds the alert for that org. Wire `onDeploymentFailure` in `bootstrap/inngest.ts` to `safeAlert(asyncFailure.operatorAlerter, {...})` so a single failed org alerts without killing the fleet.

- [ ] **Step 4: Apply the same isolation to `executeDailySignalHealthCheck`** (`:346-378`). Its per-deployment `signal-health-${id}` step should not let one org abort the rest.

### 1.4b: Flip `alert:true` + zero-output alert (D2-9 / D9-3, integration seam #8)

- [ ] **Step 5: Failing alert-flip test.** `apps/api/src/bootstrap/__tests__/ad-optimizer-alerting.test.ts`. The cleanest pin without standing up the whole bootstrap is to assert the onFailure _config_ passed to each ad-optimizer cron now carries `alert:true`. Mirror the existing config-capture style in `inngest-functions.test.ts:587-604`. But the flip lives in `bootstrap/inngest.ts`, so this test exercises a small extracted helper that builds the ad-optimizer onFailure handlers. Extract `buildAdOptimizerFailureHandlers(asyncFailure)` (returns `{ weekly, daily, signalHealth }`, each via `makeOnFailureHandler`) and assert the weekly + signal-health params use `alert:true`:

```ts
it("weekly + signal-health crons alert on failure (alert:true)", () => {
  const alerter = { alert: vi.fn().mockResolvedValue(undefined) };
  const asyncFailure = makeAsyncFailureContext({ operatorAlerter: alerter });
  // Force a failure through the weekly handler and assert the alerter fired.
  const handlers = buildAdOptimizerFailureHandlers(asyncFailure);
  return handlers
    .weekly({ error: new Error("boom"), event: { data: { run_id: "r1" } } })
    .then(() => {
      expect(alerter.alert).toHaveBeenCalledWith(
        expect.objectContaining({ errorType: "async_job_retry_exhausted", severity: "critical" }),
      );
    });
});
```

(Driving the handler end-to-end and asserting `OperatorAlerter.alert` fired is stronger than a config snapshot: it proves the `alert:false → true` flip reaches `safeAlert` at `async-failure-handler.ts:134`.)

- [ ] **Step 6: Verify fail.** Today the weekly handler is built with `alert:false` (`bootstrap/inngest.ts:1145`), so `alerter.alert` is never called.

- [ ] **Step 7: Flip the two sites.** `bootstrap/inngest.ts:1140-1149` (weekly: `alert: false` → `alert: true`) and `:1162-1173` (signal-health: `alert: false` → `alert: true`). Leave the daily-check (`:1150-1161`, Class E, `emitEvent:false`) as `alert:false`: a daily account-summary ping failing is low-risk and self-heals next day; document that choice. Extract the three handlers into `buildAdOptimizerFailureHandlers` so the test above can drive them.

- [ ] **Step 8: Failing zero-output test.** `saveAuditReport` (`bootstrap/inngest.ts:412-428`) marks the task `completed` regardless of content, so a successful run that produces zero recommendations AND zero insights raises no signal. Extract `saveAuditReport` into a testable function `buildSaveAuditReport({ deploymentStore, taskStore, operatorAlerter })` and pin:

```ts
it("raises ONE operator alert when a successful audit produces zero recommendations and zero insights", async () => {
  const alerter = { alert: vi.fn().mockResolvedValue(undefined) };
  const save = buildSaveAuditReport({
    deploymentStore: stubDeploymentStore(),
    taskStore: stubTaskStore(),
    operatorAlerter: alerter,
  });
  await save("dep-1", { accountId: "act_1", insights: [], watches: [], recommendations: [] });
  expect(alerter.alert).toHaveBeenCalledTimes(1);
  expect(alerter.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: "warning" }));
});

it("does NOT alert when the audit produced recommendations", async () => {
  const alerter = { alert: vi.fn() };
  const save = buildSaveAuditReport({
    deploymentStore: stubDeploymentStore(),
    taskStore: stubTaskStore(),
    operatorAlerter: alerter,
  });
  await save("dep-1", {
    accountId: "act_1",
    insights: [],
    watches: [],
    recommendations: [
      {
        /* one rec */
      },
    ],
  });
  expect(alerter.alert).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Implement the zero-output alert.** In `buildSaveAuditReport`, after persisting the report and before/after `updateStatus(..., "completed")`, if `report.recommendations.length === 0 && report.insights.length === 0` (a genuinely empty run, not an abstention: an abstention has one explanatory insight, so `insights.length > 0` and is correctly NOT flagged), call `safeAlert(operatorAlerter, { errorType: "async_job_retry_exhausted", severity: "warning", errorMessage: "ad-optimizer weekly audit for dep <id> produced zero output", source: "inngest_function", retryable: false, occurredAt, deploymentId })`. Use `severity:"warning"` (a zero-output run is a signal, not a page). Wire the extracted `saveAuditReport` back into `adOptimizerDeps` with `operatorAlerter: asyncFailure.operatorAlerter`.

- [ ] **Step 10: Run `--filter api test` + `--filter @switchboard/ad-optimizer test` + typecheck + format.** Commit: `git commit -m "feat(api): isolate per-deployment audit failures, alert on failure + zero-output"`

**Acceptance:** one deployment's throw no longer aborts the fleet (later orgs still audit) and the failure is recorded + alerted; the weekly + signal-health crons fire an `OperatorAlerter` on exhausted retries; a successful-but-empty audit raises exactly one warning alert. **Closes D2-3 isolation half (the `needs_reauth` half is Tier 0 PR 0.1). Integration-review seam #8.**

---

## PR 1.5: Coverage-validator producer (D9-4 / D1-9)

**Why last + scoped tighter:** This is the only Tier-1 finding that genuinely depends on a credentialed org (Tier 0) and a data-presence store. The Gate-0 _seam_ already exists (`inngest-functions.ts:214-216`, optional `createCoverageValidator`) and the `CoverageValidator` _class_ already exists (`onboarding/coverage-validator.ts:45-73`). What is missing is the production producer: `adOptimizerDeps` (`bootstrap/inngest.ts:376-441`) never wires `createCoverageValidator`, so audits run on zero-data orgs. The validator needs two collaborators the cron ads client does NOT currently expose: `listCampaigns({ orgId, accountId })` (a `MetaAdsClient` method over `/{account}/campaigns?fields=id,destination_type` + insights spend) and `intakeStore.hasRecentLead(sourceType, days)` (a data-presence read; grep for an existing lead/intake store before building one).

**Files:**

- Create: `apps/api/src/bootstrap/coverage-validator-factory.ts` (assemble `new CoverageValidator({ adsClient: { listCampaigns }, intakeStore: { hasRecentLead } })`)
- Modify: `packages/ad-optimizer/src/meta-ads-client.ts` (add `listCampaigns` over the campaign-object edge: joins `/{account}/campaigns` config + spend; reuse `getCampaignInsights` for spend)
- Modify: `apps/api/src/bootstrap/inngest.ts:376-441` (wire `createCoverageValidator` into `adOptimizerDeps`)
- Reuse-or-create: a Prisma intake/data-presence store exposing `hasRecentLead(sourceType, days)`: **grep `packages/db/src` for an existing lead/intake/contact store first** (`feedback_audit_blockers_already_done`); only build a thin adapter if one exists, a new store if none does
- Test: `apps/api/src/bootstrap/__tests__/coverage-validator-factory.test.ts`, `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts` (extend: `listCampaigns`)

**Dependency:** Tier 0 (a credentialed org so `listCampaigns` resolves a real account) + a data-presence store. Acceptance is verifiable against mocked Prisma (CI has no Postgres, per `feedback_db_tests_mock_prisma`); the live behavior (a real zero-data org abstains) is a Tier-0 exit-walkthrough check, cross-referenced there.

- [ ] **Step 1: Failing factory test** (`coverage-validator-factory.test.ts`). Assert the assembled validator abstains (returns `coveragePct` below `MIN_COVERAGE_PCT`) when the intake store reports no recent leads, and passes when it does. Mock `listCampaigns` (returns CTWA campaigns with spend) and `hasRecentLead`:

```ts
it("abstains (coveragePct=0) when no source has recent leads", async () => {
  const validator = buildCoverageValidator({
    listCampaigns: vi
      .fn()
      .mockResolvedValue([{ id: "c1", destination_type: "WHATSAPP", spend: 500 }]),
    hasRecentLead: vi.fn().mockResolvedValue(false),
  });
  const report = await validator.validate({ orgId: "org_1", accountId: "act_1" });
  expect(isCoverageSufficient(report)).toBe(false); // tracking "no_recent_traffic" → covered spend uncredited
});

it("passes when a tracked source has recent leads covering enough spend", async () => {
  const validator = buildCoverageValidator({
    listCampaigns: vi
      .fn()
      .mockResolvedValue([{ id: "c1", destination_type: "WHATSAPP", spend: 500 }]),
    hasRecentLead: vi.fn().mockResolvedValue(true),
  });
  const report = await validator.validate({ orgId: "org_1", accountId: "act_1" });
  expect(isCoverageSufficient(report)).toBe(true);
});
```

- [ ] **Step 2: Verify fail.** `buildCoverageValidator` does not exist.

- [ ] **Step 3: Implement `listCampaigns` on `MetaAdsClient`.** `GET /{account}/campaigns?fields=id,name` for the entity list, then join spend from a `getCampaignInsights` window pull (campaign-level, `["campaign_id","spend"]`), returning `{ id, destination_type, spend }[]`. **`destination_type` is an ad-set property, not a campaign property**: verify how the existing `getAccountAdSetLearningInputs` (`:178-241`) reads `destination_type` off `/adsets` and source it the same way (the campaign's destination is its ad sets' destination). Reuse the existing 200-cap page-1 pattern; the same fail-safe applies (truncation → lower coverage → honest abstain).

- [ ] **Step 4: Implement `buildCoverageValidator`** in `coverage-validator-factory.ts`: thin wrapper that constructs `new CoverageValidator({ adsClient: { listCampaigns }, intakeStore: { hasRecentLead } })`.

- [ ] **Step 5: Resolve the intake store:** grep `packages/db/src` for an existing lead/contact/intake store with a recency read. If found, adapt it to `hasRecentLead(sourceType, days)`; if not, add a minimal `PrismaIntakeStore.hasRecentLead` (count of leads for `(orgId, sourceType)` within `days`, `> 0`). Mock Prisma in its test (mirror `prisma-workflow-store.test.ts`).

- [ ] **Step 6: Wire into `adOptimizerDeps`** (`bootstrap/inngest.ts:376-441`): add `createCoverageValidator: (deploymentId, creds) => buildCoverageValidator({ listCampaigns: (q) => new MetaAdsClient(creds).listCampaigns(q), hasRecentLead: (s, d) => intakeStore.hasRecentLead(orgIdFor(deploymentId), s, d) })`. The audit-runner's Gate-0 (`audit-runner.ts:334-356`) already consumes it: below the floor it returns a one-insight abstention report (which is correctly NOT a zero-output alert from PR 1.4, since `insights.length > 0`).

- [ ] **Step 7: Run `--filter api test` + `--filter @switchboard/ad-optimizer test` + typecheck.** Commit: `git commit -m "feat(api): wire production coverage validator so zero-data orgs abstain"`

**Acceptance:** the production `adOptimizerDeps` wires a real `CoverageValidator`; an org with no tracked-source leads abstains (one explanatory insight) instead of producing noise; a covered org analyzes normally. **Closes D9-4/D1-9. Depends on Tier 0 (credentialed org).**

---

## Tier 1 dependencies & sequencing

- **PR 1.1 is FIRST:** it settles the `/insights` field-set assumption that PR 1.2's batching and PR 1.2 Step 8's call-count math depend on. Its live-verify (Step 7) is the single step that needs a Tier-0-credentialed org; the code can land before the live-verify, but do NOT relax any limiter (PR 1.2/1.3) until the live response is confirmed.
- **PR 1.2 before any D2-1 step-splitting:** batching collapses 2N → 2, so the residual D2-1 is likely under the step budget with no step-splitting at all (PR 1.2 Step 8 is a comment + a bounded-call-count test, not a re-architecture).
- **PR 1.3 (429) before relaxing `RATE_LIMIT_MS`:** never relax the proactive limiter until reactive backoff exists.
- **PR 1.4** is independent of 1.1-1.3 in code (isolation + alert flip), but its zero-output detector reads the report shape and its 429-exhausted alert is the consumer of PR 1.3's `RateLimitError` surfacing: sequence after 1.3 so the failure paths it alerts on are the real ones.
- **PR 1.5 is last:** the only step that genuinely needs a credentialed org (Tier 0) plus a data-presence store.
- **Cross-tier:** the `needs_reauth` half of D2-3 is Tier 0 PR 0.1 (`buildRileyCredentialResolver`'s `USABLE` filter): do not re-implement it here; this tier adds only the fleet-isolation half. The alert flip (D2-9) is integration-review **seam #8** in the overview.
- **Exit criteria for Tier 1:** against a Tier-0-credentialed (or staging) Meta account, a weekly audit (a) makes a bounded number of Graph calls independent of campaign count, (b) sources money from `action_values` with no fabricated status, (c) survives a forced 429 with backoff, (d) does not serialize a token into step state, (e) continues the fleet past a single org's failure and alerts on it, and (f) abstains on a zero-data org. The live-verify of PR 1.1 Step 7 is the gating check; the rest are unit-verifiable today.

## Self-review (per writing-plans)

- **Spec coverage:** every Tier-1 finding in the overview table maps to a PR: D2-2→1.1, D2-7→1.2, D2-1→1.2 (residual), D2-5→1.3a, D2-4→1.3b, D2-3 isolation→1.4a, D2-9/D9-3→1.4b, D9-4/D1-9→1.5. The `needs_reauth` half of D2-3 is explicitly delegated to Tier 0 PR 0.1, not duplicated.
- **Placeholder scan:** no vague placeholders. The two tighter PRs are concrete: PR 1.2 Step 8 (D2-1) is "recompute the budget comment + a bounded-call-count test" because batching resolves the timeout, not a deferred re-architecture; PR 1.5 (D9-4) names the exact missing collaborators (`listCampaigns`, `hasRecentLead`) and the grep-first intake-store decision, with its Tier-0 dependency stated. The `destination_type`-is-ad-set-not-campaign caveat (PR 1.5 Step 3) and the `status:""`-tolerance-vs-campaign-edge choice (PR 1.1 Step 3) are flagged as execution-time decisions with a documented default, not hand-waves.
- **Type consistency:** `prefetchedDailyRows`/`prefetchedLearningRows` (`CampaignInsight[]`), `RateLimitError` (`name`/`retryAfterSeconds`), `onDeploymentFailure({ deploymentId, organizationId }, err)`, `buildAdOptimizerFailureHandlers`/`buildSaveAuditReport`/`buildCoverageValidator` factory shapes, and `actionValues` (mirroring the existing `actions` field) are used consistently across PRs and against the verified interfaces (`CampaignInsightsProvider` `crm-outcome.ts:105-129`, `OperatorAlerter` `operator-alerter.ts:24-26`, `CoverageValidatorDeps` `coverage-validator.ts:36-43`).
- **Guardrails honored:** tests mock Prisma (PR 1.5 intake store); `vi.fn` step/handler args are typed (PR 1.3 Step 5, PR 1.4); no class instance crosses an Inngest step boundary (PR 1.3b moves cred resolution into the step, per `feedback_inngest_step_state_json_only`); no new env var is introduced (the alert flip reuses the existing `OperatorAlerter` wiring: if PR 1.3's backoff ever gets a `META_MAX_BACKOFF_MS` knob, route it through `scripts/env-allowlist.local-readiness.json`); no em-dashes.
- **Open risk flagged for execution:** PR 1.1 Step 7's live-verify can invalidate the field-set assumption: if Meta DOES return `status`/`revenue` on `/insights`, STOP and re-plan D2-7/D2-1 (call-count math changes). PR 1.5's intake store may already exist (grep first). PR 1.4's per-deployment try/catch must wrap `await step.run(...)` so siblings survive while each step keeps its own retry budget: verify the Inngest step-retry semantics at execution time.
