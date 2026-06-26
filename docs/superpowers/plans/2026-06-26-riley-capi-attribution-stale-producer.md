# Riley CAPI-attribution-stale producer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a real, account-level producer for `capiAttributionStale` so Riley's `harden_capi_attribution` safety advisory actually fires when account-wide CAPI/pixel attribution has gone stale, closing a shipped-but-inert gate.

**Architecture:** Reuse the weekly audit's existing account-level denominator step-change detector. Its "zero attributed conversions despite sustained real traffic" signature is precisely a suspected account-wide pixel/CAPI conversion outage. Tag that signature, surface it as `capiAttributionStale` from `evaluateDenominatorStepChange` (the same producer that yields `measurementTrusted`/`accountWatch`), and emit ONE account-level `harden_capi_attribution` recommendation from `AuditRunner.run()` (mirroring how `signalHealthRecs`/`accountWatch` are produced once). The current per-campaign consumer is relocated to account level (the prior placement would emit N duplicate recs).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Vitest, `@switchboard/ad-optimizer` (Layer 2).

## Global Constraints

- ESM only; `.js` extension on every relative import.
- No `any`; no `console.log` (use `console.warn`/`console.error`).
- Prettier: semicolons, double quotes, 2-space indent, trailing commas, 100-char width.
- Conventional Commits, lowercase subject, no em-dashes (`--`) in prose or comments.
- Every touched package typechecks (`pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit`) and its tests pass before commit.
- `pnpm eval:riley` must stay green (this plan does NOT modify `decideForCampaign`, so the eval is unaffected by construction).
- The advisory is account-level (CAPI is account-level); it must be emitted exactly once per audit, never per-campaign.
- Fail-closed abstention: missing/thin/NaN signal must NOT assert "stale" (no spam) and must NOT assert "fresh" (no suppression). It simply does not fire.

## Design decision record (why this signal)

Three candidate sources were evaluated against current `main`:

1. **`SignalHealthChecker.capiHealth`** (the obvious lead) — REJECTED as the trigger. It is optional (only wired when `signalHealthChecker` + `config.pixelId` are present), largely redundant with the existing `freshness_stale` (1h) and `server_to_browser_low` breaches, and when CAPI is truly dead the audit short-circuits on `score==="red"` (`buildSignalHealthCriticalReport`) before any account/per-campaign rec path runs. It would rarely fire additively.
2. **Our own "Schedule"-event CAPI dispatch ledger** — REJECTED, not sourceable. The `OutcomeDispatcher` (`booked -> "Schedule"`) is explicitly DORMANT in production (`outcome-dispatcher.ts`, `apps/api/src/bootstrap/outcome-wiring.ts`); the live deep-conversion path is `MetaCAPIDispatcher` (`booked -> "ConvertedLead"`), which records no queryable per-event dispatch timestamp ledger. Reviving it is new infrastructure, out of scope.
3. **The denominator step-change "zero conversions despite sustained traffic" signature** (`detectDenominatorStepChange`, Signature 2) — CHOSEN. Always available (derived from `currentInsights`/`previousInsights`, always fetched), abstains by construction (requires >= 50 clicks in BOTH windows; `NaN === 0` is false so NaN/garbage fail closed), semantically equals "no attributed conversions are reaching Meta despite ad traffic," and is architecturally pre-aligned: `campaign-decision.ts` already allowlists `harden_capi_attribution` to keep flowing when `measurementTrusted === false`, and the original field comment calls this a "heuristic input rather than computed." Requires NO new dependency injection and touches no shared bootstrap/inngest files.

The detector also fires a second, distinct signature (rate-collapse with flat clicks = an attribution-window/reporting shift). That has a different remediation (re-check the window, not harden CAPI), so the advisory must fire ONLY on the zero-despite-traffic signature. A typed `signature` discriminator separates them.

## File Structure

- `packages/ad-optimizer/src/denominator-step-change.ts` — add a typed `signature` discriminator to `StepChangeResult` (which signature fired). Modify.
- `packages/ad-optimizer/src/denominator-step-change.test.ts` — cover the discriminator + abstention. Modify (extend).
- `packages/ad-optimizer/src/audit-report-builders.ts` — `evaluateDenominatorStepChange` returns `capiAttributionStale`. Modify.
- `packages/ad-optimizer/src/audit-report-builders.test.ts` — cover `capiAttributionStale`. Modify (extend).
- `packages/ad-optimizer/src/recommendation-engine.ts` — add account-level `generateCapiAttributionStaleRecommendation`; remove the per-campaign `capiAttributionStale` input + consumer. Modify.
- `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts` — replace the 2 per-campaign tests with account-level producer tests. Modify.
- `packages/ad-optimizer/src/audit-runner.ts` — thread `capiAttributionStale`, emit the account-level rec once. Modify.
- `packages/ad-optimizer/src/__tests__/audit-runner-capi-stale.test.ts` — end-to-end fire/no-fire/abstain proof (the producer-population gate). Create.

---

### Task 1: Tag the denominator step-change signature

**Files:**

- Modify: `packages/ad-optimizer/src/denominator-step-change.ts`
- Test: `packages/ad-optimizer/src/denominator-step-change.test.ts`

**Interfaces:**

- Produces: `StepChangeResult.signature?: "rate_collapse" | "zero_despite_traffic"` — set only when `suspected` is true; identifies which signature fired. `"zero_despite_traffic"` is the suspected account-wide pixel/CAPI conversion outage.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ad-optimizer/src/denominator-step-change.test.ts`:

```typescript
describe("detectDenominatorStepChange signature", () => {
  it("tags the zero-conversions-despite-traffic outage as zero_despite_traffic", () => {
    const result = detectDenominatorStepChange({
      current: { clicks: 60, conversions: 0, spend: 500 },
      previous: { clicks: 60, conversions: 0, spend: 500 },
    });
    expect(result.suspected).toBe(true);
    expect(result.signature).toBe("zero_despite_traffic");
  });

  it("tags a rate collapse with flat clicks as rate_collapse (not the CAPI outage)", () => {
    const result = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 5, spend: 500 },
      previous: { clicks: 1000, conversions: 50, spend: 500 },
    });
    expect(result.suspected).toBe(true);
    expect(result.signature).toBe("rate_collapse");
  });

  it("leaves signature undefined when nothing is suspected", () => {
    const result = detectDenominatorStepChange({
      current: { clicks: 1000, conversions: 50, spend: 500 },
      previous: { clicks: 1000, conversions: 50, spend: 500 },
    });
    expect(result.suspected).toBe(false);
    expect(result.signature).toBeUndefined();
  });

  it("abstains (no signature) when zero conversions but traffic is below the floor", () => {
    const result = detectDenominatorStepChange({
      current: { clicks: 10, conversions: 0, spend: 500 },
      previous: { clicks: 10, conversions: 0, spend: 500 },
    });
    expect(result.suspected).toBe(false);
    expect(result.signature).toBeUndefined();
  });
});
```

If `denominator-step-change.test.ts` lacks the import, ensure the top of the file has:
`import { describe, it, expect } from "vitest";` and `import { detectDenominatorStepChange } from "./denominator-step-change.js";`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/denominator-step-change.test.ts`
Expected: FAIL on the `signature` assertions (`signature` is undefined / not present).

- [ ] **Step 3: Add the discriminator to the interface**

In `packages/ad-optimizer/src/denominator-step-change.ts`, extend `StepChangeResult`:

```typescript
export interface StepChangeResult {
  suspected: boolean;
  reason: string;
  /**
   * Which signature fired (set only when `suspected`). "zero_despite_traffic" is the
   * suspected account-wide pixel/CAPI conversion outage: zero attributed conversions across
   * both windows despite sustained real traffic. It is the signal Riley's
   * harden_capi_attribution advisory keys on. "rate_collapse" is a conversion-rate drop with
   * flat clicks (an attribution-window/reporting shift) whose remediation is to re-check the
   * window, NOT to harden CAPI, so it must NOT trigger that advisory.
   */
  signature?: "rate_collapse" | "zero_despite_traffic";
}
```

- [ ] **Step 4: Set the signature in each suspected branch**

In `detectDenominatorStepChange`, the Signature-2 (zero-despite-traffic) suspected return becomes:

```typescript
if (sustainedZeroDespiteTraffic) {
  return {
    suspected: true,
    signature: "zero_despite_traffic",
    reason:
      "zero attributed conversions across both windows despite sustained real traffic — suspected account-wide conversion-tracking outage (verify pixel/CAPI)",
  };
}
```

And the final (Signature-1) return becomes:

```typescript
const suspected = clicksFlat && rateCollapsed;
return {
  suspected,
  ...(suspected ? { signature: "rate_collapse" as const } : {}),
  reason: suspected
    ? `conversion rate fell ${(prevRate ? (1 - curRate / prevRate) * 100 : 0).toFixed(0)}% with flat clicks — suspected denominator/window shift`
    : "no step-change",
};
```

(The two early `{ suspected: false, reason: ... }` returns are left unchanged — no signature on an abstention.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/denominator-step-change.test.ts`
Expected: PASS (all, including pre-existing cases).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit`
Expected: no errors.

```bash
git add packages/ad-optimizer/src/denominator-step-change.ts packages/ad-optimizer/src/denominator-step-change.test.ts
git commit -m "feat(ad-optimizer): tag denominator step-change signature (capi-outage vs window-shift)"
```

---

### Task 2: Surface capiAttributionStale from the account-level evaluator

**Files:**

- Modify: `packages/ad-optimizer/src/audit-report-builders.ts:56-84`
- Test: `packages/ad-optimizer/src/audit-report-builders.test.ts`

**Interfaces:**

- Consumes: `StepChangeResult.signature` (Task 1).
- Produces: `evaluateDenominatorStepChange(...)` returns `{ measurementTrusted: boolean; accountWatch?: WatchOutput; capiAttributionStale: boolean }`. `capiAttributionStale` is true only when the suspected signature is `"zero_despite_traffic"`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ad-optimizer/src/audit-report-builders.test.ts` (mirror the file's existing `makeInsight`/helper style; if no insight helper exists, construct `CampaignInsightSchema` objects inline with the fields below):

```typescript
describe("evaluateDenominatorStepChange capiAttributionStale", () => {
  const row = (over: Partial<CampaignInsight>): CampaignInsight => ({
    campaignId: "c1",
    campaignName: "C1",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 10_000,
    inlineLinkClicks: 60,
    spend: 500,
    conversions: 0,
    revenue: 0,
    frequency: 1,
    cpm: 50,
    inlineLinkClickCtr: 1,
    costPerInlineLinkClick: 8,
    dateStart: "2026-05-01",
    dateStop: "2026-05-07",
    ...over,
  });

  it("is true on the zero-conversions-despite-traffic outage signature", () => {
    const out = evaluateDenominatorStepChange({
      currentInsights: [row({})],
      previousInsights: [row({})],
      nextCycleDate: "2026-05-14",
    });
    expect(out.measurementTrusted).toBe(false);
    expect(out.capiAttributionStale).toBe(true);
  });

  it("is false on a rate-collapse (window shift), even though measurement is untrusted", () => {
    const out = evaluateDenominatorStepChange({
      currentInsights: [row({ inlineLinkClicks: 1000, conversions: 5 })],
      previousInsights: [row({ inlineLinkClicks: 1000, conversions: 50, revenue: 5000 })],
      nextCycleDate: "2026-05-14",
    });
    expect(out.measurementTrusted).toBe(false);
    expect(out.capiAttributionStale).toBe(false);
  });

  it("is false when measurement is trusted", () => {
    const out = evaluateDenominatorStepChange({
      currentInsights: [row({ inlineLinkClicks: 1000, conversions: 50, revenue: 5000 })],
      previousInsights: [row({ inlineLinkClicks: 1000, conversions: 50, revenue: 5000 })],
      nextCycleDate: "2026-05-14",
    });
    expect(out.measurementTrusted).toBe(true);
    expect(out.capiAttributionStale).toBe(false);
  });
});
```

Ensure the test file imports `CampaignInsightSchema as CampaignInsight` from `@switchboard/schemas` and `evaluateDenominatorStepChange` from `./audit-report-builders.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/audit-report-builders.test.ts`
Expected: FAIL — `capiAttributionStale` is `undefined` on the returned object.

- [ ] **Step 3: Implement**

In `packages/ad-optimizer/src/audit-report-builders.ts`, change the return type and both returns of `evaluateDenominatorStepChange`:

```typescript
export function evaluateDenominatorStepChange(args: {
  currentInsights: CampaignInsight[];
  previousInsights: CampaignInsight[];
  nextCycleDate: string;
}): { measurementTrusted: boolean; accountWatch?: WatchOutput; capiAttributionStale: boolean } {
  const sumTotals = (rows: CampaignInsight[]) => ({
    clicks: rows.reduce((s, r) => s + r.inlineLinkClicks, 0),
    conversions: rows.reduce((s, r) => s + r.conversions, 0),
    spend: rows.reduce((s, r) => s + r.spend, 0),
  });
  const stepChange = detectDenominatorStepChange({
    current: sumTotals(args.currentInsights),
    previous: sumTotals(args.previousInsights),
  });
  if (!stepChange.suspected) {
    return { measurementTrusted: true, capiAttributionStale: false };
  }
  return {
    measurementTrusted: false,
    capiAttributionStale: stepChange.signature === "zero_despite_traffic",
    accountWatch: {
      type: "watch",
      campaignId: "account",
      campaignName: "Account-wide signal",
      pattern: "conversion_denominator_step_change",
      message: `Suspected account-wide conversion-reporting shift: ${stepChange.reason}. Budget actions are held this cycle; verify the pixel/attribution window.`,
      checkBackDate: args.nextCycleDate,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/audit-report-builders.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit`
Expected: errors in `audit-runner.ts` are EXPECTED here only if you destructure early; you have not yet. There should be no errors (the new field is additive). If `tsc` reports an unrelated pre-existing error, stop and report.

```bash
git add packages/ad-optimizer/src/audit-report-builders.ts packages/ad-optimizer/src/audit-report-builders.test.ts
git commit -m "feat(ad-optimizer): surface capiAttributionStale from denominator evaluator"
```

---

### Task 3: Account-level producer; remove the per-campaign consumer

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-engine.ts` (remove input field lines 59-65; remove consumer lines 426-442; add producer near `generateSignalHealthRecommendations`)
- Test: `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts:369-404` (replace the two per-campaign tests)

**Interfaces:**

- Produces: `generateCapiAttributionStaleRecommendation(capiAttributionStale: boolean): RecommendationOutput | null` — returns a single account-scoped `harden_capi_attribution` rec (`campaignId: "account"`) when stale, else `null`.

- [ ] **Step 1: Replace the two per-campaign tests with account-level tests**

In `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts`, DELETE the two tests titled `"emits harden_capi_attribution when capiAttributionStale flag is true"` and `"does NOT emit harden_capi_attribution when capiAttributionStale is unset"` (the blocks asserting on `RecommendationInput.capiAttributionStale`). Add, in a new `describe` near the signal-health tests:

```typescript
describe("generateCapiAttributionStaleRecommendation", () => {
  it("emits one account-level harden_capi_attribution rec when attribution is stale", () => {
    const rec = generateCapiAttributionStaleRecommendation(true);
    expect(rec).not.toBeNull();
    expect(rec?.action).toBe("harden_capi_attribution");
    expect(rec?.campaignId).toBe("account");
    expect(rec?.urgency).toBe("this_week");
  });

  it("returns null when attribution is not stale", () => {
    expect(generateCapiAttributionStaleRecommendation(false)).toBeNull();
  });
});
```

Ensure `generateCapiAttributionStaleRecommendation` is added to the existing import from `../recommendation-engine.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/__tests__/recommendation-engine.test.ts`
Expected: FAIL — `generateCapiAttributionStaleRecommendation` is not exported.

- [ ] **Step 3: Remove the per-campaign input field**

In `packages/ad-optimizer/src/recommendation-engine.ts`, delete the `capiAttributionStale` doc comment and field from `RecommendationInput` (the block that reads):

```typescript
  /**
   * Optional flag set externally (e.g. by CAPI dispatch tracker) when no
   * Schedule events have been received in 7+ days for a CTWA campaign.
   * The recommendation engine itself does not have visibility into CAPI
   * dispatch state, so this is a heuristic input rather than computed.
   */
  capiAttributionStale?: boolean;
```

- [ ] **Step 4: Remove the per-campaign consumer**

In `generateRecommendations`, delete the block:

```typescript
// CAPI attribution stale — externally flagged, no internal computation
if (input.capiAttributionStale) {
  results.push(
    makeRec(
      base,
      "harden_capi_attribution",
      0.7,
      "this_week",
      "No CAPI Schedule events received in 7+ days — Meta cannot optimize without signal",
      [
        "Verify CAPI access token and Pixel ID configuration",
        "Re-run a Schedule test event from the booking system",
        "Confirm event_id deduplication matches browser pixel",
      ],
    ),
  );
}
```

- [ ] **Step 5: Add the account-level producer**

Add near `generateSignalHealthRecommendations` (after the `SIGNAL_HEALTH_CAMPAIGN_ID_PREFIX` export):

```typescript
/**
 * Account-level campaignId for the CAPI-attribution-stale advisory. CAPI is account-level,
 * not campaign-level. This is the same literal the source-reallocation analyzer uses for its
 * account-scope recs, so the emission/report/arbitration pipeline already handles it; it is
 * duplicated here (not imported) to keep the one-way import graph intact — analyzers depend on
 * this engine, never the reverse.
 */
const CAPI_ATTRIBUTION_CAMPAIGN_ID = "account";

/**
 * Account-level "CAPI attribution stale" advisory (Riley). Fires when the weekly audit's
 * denominator step-change detector reports the "zero attributed conversions despite sustained
 * real traffic" signature, i.e. a suspected account-wide pixel/CAPI conversion outage: Meta is
 * receiving ad traffic but no attributed conversions, so it cannot optimize. Produced ONCE per
 * account (mirroring generateSignalHealthRecommendations), never per-campaign. Returns null when
 * attribution is not stale, so the caller appends nothing. Non-mutating and measurement-family,
 * so it survives the measurement_untrusted demotion the same outage triggers and is the
 * actionable fix paired with that hold.
 */
export function generateCapiAttributionStaleRecommendation(
  capiAttributionStale: boolean,
): RecommendationOutput | null {
  if (!capiAttributionStale) return null;
  return makeRec(
    { campaignId: CAPI_ATTRIBUTION_CAMPAIGN_ID, campaignName: "the ad account" },
    "harden_capi_attribution",
    0.7,
    "this_week",
    "No attributed conversions are reaching Meta despite sustained ad traffic — the pixel/CAPI conversion signal appears stale, so Meta cannot optimize",
    [
      "Verify the CAPI access token and Pixel ID configuration",
      "Re-run a test conversion event from the booking system and confirm it lands in Events Manager",
      "Confirm event_id deduplication matches the browser pixel",
    ],
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/__tests__/recommendation-engine.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit`
Expected: no errors (no caller sets `RecommendationInput.capiAttributionStale`; `decideForCampaign` never passed it).

```bash
git add packages/ad-optimizer/src/recommendation-engine.ts packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts
git commit -m "feat(ad-optimizer): relocate harden_capi_attribution to an account-level producer"
```

---

### Task 4: Thread the producer into the live audit path (producer-population)

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts:26` (import), `:530` (destructure), `~:753-755` (emit once)
- Test: `packages/ad-optimizer/src/__tests__/audit-runner-capi-stale.test.ts` (create)

**Interfaces:**

- Consumes: `evaluateDenominatorStepChange(...).capiAttributionStale` (Task 2); `generateCapiAttributionStaleRecommendation(...)` (Task 3).
- Produces: at most one `harden_capi_attribution` recommendation (`campaignId: "account"`) in `AuditReport.recommendations`, present iff the account shows the zero-conversions-despite-traffic outage.

- [ ] **Step 1: Write the failing integration test**

Create `packages/ad-optimizer/src/__tests__/audit-runner-capi-stale.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import type { AuditDependencies, AdsClientInterface, AuditConfig } from "../audit-runner.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  AccountSummarySchema as AccountSummary,
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  MediaBenchmarks,
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
} from "@switchboard/schemas";

function insight(over: Partial<CampaignInsight> = {}): CampaignInsight {
  return {
    campaignId: "camp-1",
    campaignName: "Test Campaign",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 100_000,
    inlineLinkClicks: 2_000,
    spend: 5_000,
    conversions: 50,
    revenue: 15_000,
    frequency: 2.5,
    cpm: 50,
    inlineLinkClickCtr: 2.0,
    costPerInlineLinkClick: 2.5,
    dateStart: "2026-03-01",
    dateStop: "2026-03-31",
    ...over,
  };
}

function funnelData(): CrmFunnelData {
  return {
    campaignIds: ["camp-1"],
    leads: 0,
    qualified: 0,
    opportunities: 0,
    bookings: 0,
    closed: 0,
    revenue: 0,
    rates: { leadToQualified: 0, qualifiedToBooking: 0, bookingToClosed: 0, leadToClosed: 0 },
    coverage: {
      attributedContacts: 0,
      contactsWithEmailOrPhone: 0,
      contactsWithOpportunity: 0,
      contactsWithBooking: 0,
      contactsWithRevenueEvent: 0,
    },
  };
}

function crmBenchmarks(): FunnelBenchmarks {
  return {
    leadToQualifiedRate: 0.4,
    qualifiedToBookingRate: 0.5,
    bookingToClosedRate: 0.25,
    leadToClosedRate: 0.06,
  };
}

function mediaBenchmarks(): MediaBenchmarks {
  return { inlineLinkClickCtr: 2.0, landingPageViewRate: 0.85, clickToLeadRate: 0.05 };
}

function accountSummary(): AccountSummary {
  return {
    accountId: "act-123",
    accountName: "Test Account",
    currency: "USD",
    totalSpend: 10_000,
    totalImpressions: 200_000,
    totalClicks: 4_000,
    activeCampaigns: 1,
  };
}

function learningInput(): CampaignLearningInput {
  return {
    effectiveStatus: "ACTIVE",
    learningPhase: false,
    lastModifiedDays: 14,
    optimizationEvents: 100,
  };
}

function targetBreach(): TargetBreachResult {
  return { periodsAboveTarget: 0, granularity: "daily", isApproximate: false };
}

function deps(current: CampaignInsight[], previous: CampaignInsight[]): AuditDependencies {
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(previous),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(accountSummary()),
  };
  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(funnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(crmBenchmarks()),
  };
  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue(learningInput()),
    getTargetBreachStatus: vi.fn().mockResolvedValue(targetBreach()),
  };
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 100,
    targetROAS: 3.0,
    mediaBenchmarks: mediaBenchmarks(),
  };
  return { adsClient, crmDataProvider, insightsProvider, config };
}

const RANGE = {
  dateRange: { since: "2026-03-25", until: "2026-03-31" },
  previousDateRange: { since: "2026-03-18", until: "2026-03-24" },
};

function hardenCount(recs: { action: string }[]): number {
  return recs.filter((r) => r.action === "harden_capi_attribution").length;
}

describe("AuditRunner CAPI-attribution-stale advisory", () => {
  it("fires exactly one account-level harden rec on a stale account (zero conv, real traffic)", async () => {
    const stale = [insight({ conversions: 0, inlineLinkClicks: 60, revenue: 0 })];
    const report = await new AuditRunner(deps(stale, stale)).run(RANGE);
    const harden = report.recommendations.filter((r) => r.action === "harden_capi_attribution");
    expect(harden).toHaveLength(1);
    expect(harden[0]?.campaignId).toBe("account");
  });

  it("does NOT fire on a healthy account (conversions flowing)", async () => {
    const healthy = [insight({ conversions: 50, inlineLinkClicks: 2_000 })];
    const report = await new AuditRunner(deps(healthy, healthy)).run(RANGE);
    expect(hardenCount(report.recommendations)).toBe(0);
  });

  it("abstains on an unmeasured account (zero conv but traffic below the floor)", async () => {
    const thin = [insight({ conversions: 0, inlineLinkClicks: 10, revenue: 0 })];
    const report = await new AuditRunner(deps(thin, thin)).run(RANGE);
    expect(hardenCount(report.recommendations)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/__tests__/audit-runner-capi-stale.test.ts`
Expected: FAIL on the first case — `harden` has length 0 (producer not yet wired).

- [ ] **Step 3: Import the producer**

In `packages/ad-optimizer/src/audit-runner.ts`, extend the existing import from `./recommendation-engine.js`:

```typescript
import {
  generateSignalHealthRecommendations,
  generateCapiAttributionStaleRecommendation,
} from "./recommendation-engine.js";
```

- [ ] **Step 4: Destructure capiAttributionStale**

At the `evaluateDenominatorStepChange` call (Step 4a, ~line 530), add the field:

```typescript
const { measurementTrusted, accountWatch, capiAttributionStale } = evaluateDenominatorStepChange({
  currentInsights,
  previousInsights,
  nextCycleDate,
});
```

- [ ] **Step 5: Emit the account-level rec once**

Immediately AFTER the Step 8c block that appends `signalHealthRecs` (the `if (signalHealthRecs.length > 0) { recommendations.push(...signalHealthRecs); }` block, ~line 753-755) and BEFORE the Step 8d arbitration block, insert:

```typescript
// Step 8c-bis: account-level CAPI-attribution-stale advisory. Fires when the denominator
// step-change detector reported the zero-conversions-despite-traffic signature (a suspected
// account-wide pixel/CAPI conversion outage). Produced ONCE here (CAPI is account-level),
// mirroring signalHealthRecs; the same outage set measurementTrusted=false above (demoting
// cost recs to measurement_untrusted watches), and this is the paired actionable fix. Placed
// before arbitration so it is ranked as the single measurement fix.
const capiAttributionRec = generateCapiAttributionStaleRecommendation(capiAttributionStale);
if (capiAttributionRec) {
  recommendations.push(capiAttributionRec);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/ad-optimizer exec vitest run src/__tests__/audit-runner-capi-stale.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 7: Run the full ad-optimizer suite + typecheck**

Run: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit`
Run: `pnpm --filter @switchboard/ad-optimizer test`
Run: `pnpm eval:riley`
Expected: all green. `eval:riley` is unaffected (no `decideForCampaign` change).

- [ ] **Step 8: Commit**

```bash
git add packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/__tests__/audit-runner-capi-stale.test.ts
git commit -m "feat(ad-optimizer): emit account-level harden_capi_attribution on stale attribution"
```

---

## Self-Review

- **Spec coverage:** signal source (Task 1-2), account-level single emission (Task 3-4), abstention/fail-closed (Task 1 thin-traffic case + Task 4 abstain case), producer-population on the live cron path (Task 4 — `AuditRunner.run` is the cron entry via `inngest-functions.ts`), honest copy (Task 3). Fire/no-fire/abstain proof (Task 4). Covered.
- **No new DI / no shared-file edits:** confirmed — only `packages/ad-optimizer/src/*` is touched; no `apps/api/src/bootstrap/inngest.ts` or `inngest-functions.ts` change.
- **Type consistency:** `signature` (Task 1) -> read in Task 2; `capiAttributionStale` returned by `evaluateDenominatorStepChange` (Task 2) -> destructured in Task 4; `generateCapiAttributionStaleRecommendation(boolean)` (Task 3) -> called in Task 4. Names/types match.
- **Redundancy guard:** harden fires only on `zero_despite_traffic`, never on `rate_collapse`; account-level single emission avoids N per-campaign duplicates; the arbitrator already caps measurement fixes to one for ranking.
