# Riley Phase 1 — Superhuman Advice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Riley's weekly-audit recommendations outperform a human media buyer's first-pass diagnosis — see real data (Eyes), aim at booked customers (Target), use its orphaned analyzers (Brain) — with **zero mutating paths**.

**Architecture:** Riley is a deterministic rules engine in `packages/ad-optimizer`, run by a weekly Inngest cron wired in `apps/api/src/bootstrap/inngest.ts`. Today the cron injects a **stub** `CampaignInsightsProvider` that hardcodes `periodsAboveTarget: 0` / `learningPhase: false`, so the kill/scale/learning rules can never fire. Phase 1 replaces the stub with the real `MetaCampaignInsightsProvider` (PR1), recalibrates the target from booking economics behind a strict fallback ladder (PR2), promotes the orphaned analyzers + actions detected budget imbalance (PR3), and proves the recommendation-quality contract incl. no-ghost-execution (PR4). Spec: `docs/superpowers/specs/2026-06-01-riley-phase1-superhuman-advice-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), pnpm + Turborepo, Vitest, Zod schemas. Meta Graph API v21.0. Layer rule: `ad-optimizer` (Layer 2) imports `schemas` only — never `core`/`db`.

**Baseline (verified 2026-06-01, worktree `riley-phase1-superhuman-advice` off `main` `42b99b74`):** `pnpm build` clean; `@switchboard/ad-optimizer` 322 tests pass (33 files).

**Incremental execution note:** PR1 below is code-complete. PR2–PR4 are structural task outlines with their open interface questions flagged; **expand each into code-complete TDD tasks just-in-time after the prior PR lands and is verified** (per the approved "prove Riley can see correctly before it aims, aims before it sharpens" sequencing). Do not batch all four.

---

## File Structure (PR1 · Eyes)

- **Modify** `packages/ad-optimizer/src/audit-runner.ts` — extend `AdsClientInterface`: add `timeIncrement?` to `getCampaignInsights` params; add optional `getAdSetLearningInputs?(campaignId)`.
- **Modify** `packages/ad-optimizer/src/meta-ads-client.ts` — support `time_increment` query param; add `getAdSetLearningInputs(campaignId)` (entity-edge learning + insights spend).
- **Rewrite** `packages/ad-optimizer/src/meta-campaign-insights-provider.ts` — real daily breach + real learning-phase aggregation.
- **Modify** `apps/api/src/bootstrap/inngest.ts:241-254` — swap stub for `new MetaCampaignInsightsProvider(adsClient)`.
- **Test** `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts` (extend existing 5-test file) and `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts`.

Each unit has one responsibility: the **client** does Meta I/O + field mapping; the **provider** does the breach/learning _logic_ over client data (this is the high-value, fully-unit-tested seam — tested with a fake `AdsClientInterface`); the **cron** only wires.

---

## PR1 · Eyes — turn the existing brain back on

### Task 1: `AdsClientInterface` carries `timeIncrement` + optional ad-set learning read

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts:44-54`

- [ ] **Step 1: Extend the interface.** In `audit-runner.ts`, change the `AdsClientInterface`:

```ts
export interface AdsClientInterface {
  getCampaignInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
    timeIncrement?: number;
  }): Promise<CampaignInsight[]>;
  getAdSetInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<unknown[]>;
  getAccountSummary(): Promise<AccountSummary>;
  /**
   * Optional: per-ad-set learning status + spend for a campaign, read from the
   * Meta entity edge (`learning_stage_info`) joined with insights spend. Used by
   * MetaCampaignInsightsProvider to derive campaign-level learning phase. Optional
   * so existing fakes/clients that don't implement it degrade to learningPhase:false.
   */
  getAdSetLearningInputs?(campaignId: string): Promise<AdSetLearningInput[]>;
}
```

`AdSetLearningInput` is already imported at `audit-runner.ts:12`. No other change in this file.

- [ ] **Step 2: Verify it compiles (no behavior change yet).**

Run: `pnpm --filter @switchboard/ad-optimizer build`
Expected: PASS (additive optional members; `MetaAdsClient` still structurally satisfies the interface for existing call sites).

- [ ] **Step 3: Commit.**

```bash
git add packages/ad-optimizer/src/audit-runner.ts
git commit -m "feat(ad-optimizer): widen AdsClientInterface for daily increment + ad-set learning"
```

### Task 2: `MetaAdsClient` sends `time_increment` and reads ad-set learning

**Files:**

- Modify: `packages/ad-optimizer/src/meta-ads-client.ts`
- Test: `packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts`

- [ ] **Step 1: Write failing tests.** Append to `meta-ads-client.test.ts` (it already mocks `global.fetch`; mirror its existing mock pattern):

```ts
describe("getCampaignInsights time_increment", () => {
  it("adds time_increment to the query when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    await client.getCampaignInsights({
      dateRange: { since: "2026-05-18", until: "2026-06-01" },
      fields: ["campaign_id", "spend", "conversions"],
      timeIncrement: 1,
    });
    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("time_increment=1");
  });

  it("omits time_increment when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });
    await client.getCampaignInsights({
      dateRange: { since: "2026-05-25", until: "2026-06-01" },
      fields: ["campaign_id"],
    });
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("time_increment");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test meta-ads-client`
Expected: FAIL — `time_increment=1` not found in URL.

- [ ] **Step 3: Implement `time_increment`.** In `meta-ads-client.ts`, add the field to `CampaignInsightsParams` (line ~21-25) and set it in `getCampaignInsights` (after line 78):

```ts
interface CampaignInsightsParams {
  dateRange: DateRange;
  fields: string[];
  breakdowns?: string[];
  timeIncrement?: number;
}
```

```ts
// inside getCampaignInsights, after the breakdowns block:
if (params.timeIncrement !== undefined) {
  queryParams.set("time_increment", String(params.timeIncrement));
}
```

- [ ] **Step 4: Run to verify pass.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test meta-ads-client`
Expected: PASS (both new tests + all prior).

- [ ] **Step 5: Add `getAdSetLearningInputs` with a failing test.** Append:

```ts
describe("getAdSetLearningInputs", () => {
  it("maps entity learning_stage_info + insights spend into AdSetLearningInput[]", async () => {
    const fetchMock = vi
      .fn()
      // 1st call: adsets entity edge (learning_stage_info + effective_status)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "as_1",
              name: "AdSet 1",
              campaign_id: "c_1",
              learning_stage_info: { status: "LEARNING" },
            },
            {
              id: "as_2",
              name: "AdSet 2",
              campaign_id: "c_1",
              learning_stage_info: { status: "SUCCESS" },
            },
          ],
        }),
      })
      // 2nd call: adset insights (spend etc.)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              adset_id: "as_1",
              spend: "300",
              conversions: "2",
              frequency: "1.5",
              inline_link_click_ctr: "1.0",
            },
            {
              adset_id: "as_2",
              spend: "100",
              conversions: "5",
              frequency: "1.2",
              inline_link_click_ctr: "1.4",
            },
          ],
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new MetaAdsClient({ accessToken: "t", accountId: "act_1" });

    const rows = await client.getAdSetLearningInputs("c_1");

    expect(rows).toHaveLength(2);
    const as1 = rows.find((r) => r.adSetId === "as_1")!;
    expect(as1.learningStageStatus).toBe("LEARNING");
    expect(as1.spend).toBe(300);
    expect(as1.campaignId).toBe("c_1");
    expect(rows.find((r) => r.adSetId === "as_2")!.learningStageStatus).toBe("SUCCESS");
  });
});
```

- [ ] **Step 6: Run to verify it fails.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test meta-ads-client`
Expected: FAIL — `client.getAdSetLearningInputs is not a function`.

- [ ] **Step 7: Implement `getAdSetLearningInputs`.** Add to `MetaAdsClient` (after `getAdSetInsights`, ~line 106). Reads the adsets **entity** edge for learning status, then the **insights** edge for spend/metrics, and joins by ad-set id:

```ts
async getAdSetLearningInputs(campaignId: string): Promise<AdSetLearningInput[]> {
  const filtering = JSON.stringify([
    { field: "campaign.id", operator: "EQUAL", value: campaignId },
  ]);
  const entityResp = await this.get(
    `/${this.accountId}/adsets?fields=id,name,campaign_id,effective_status,learning_stage_info&filtering=${encodeURIComponent(filtering)}`,
  );
  const entities = (entityResp.data as Record<string, unknown>[]) ?? [];

  const insights = await this.getAdSetInsights({
    dateRange: this.last7DayRange(),
    fields: ["adset_id", "spend", "conversions", "frequency", "inline_link_click_ctr"],
    campaignId,
  });
  const spendByAdSet = new Map<string, AdSetInsight>();
  for (const ins of insights) spendByAdSet.set(ins.adSetId, ins);

  return entities.map((e) => {
    const id = String(e.id ?? "");
    const ins = spendByAdSet.get(id);
    const rawStatus = ((e.learning_stage_info as { status?: string } | undefined)?.status ?? "UNKNOWN").toUpperCase();
    const learningStageStatus = (["LEARNING", "SUCCESS", "FAIL"].includes(rawStatus)
      ? rawStatus
      : "UNKNOWN") as AdSetLearningInput["learningStageStatus"];
    const spend = ins?.spend ?? 0;
    const conversions = ins?.conversions ?? 0;
    return {
      adSetId: id,
      adSetName: String(e.name ?? ""),
      campaignId: String(e.campaign_id ?? campaignId),
      learningStageStatus,
      frequency: ins?.frequency ?? 0,
      spend,
      conversions,
      cpa: conversions > 0 ? spend / conversions : 0,
      roas: 0,
      inlineLinkClickCtr: ins?.inlineLinkClickCtr ?? 0,
    };
  });
}

private last7DayRange(): { since: string; until: string } {
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - 7);
  const f = (d: Date) => d.toISOString().split("T")[0]!;
  return { since: f(since), until: f(now) };
}
```

Add the type import at the top: extend the existing import block to include `AdSetInsightSchema as AdSetInsight` (already imported) and add `AdSetLearningInput` from `@switchboard/schemas`.

- [ ] **Step 8: Run to verify pass.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test meta-ads-client`
Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add packages/ad-optimizer/src/meta-ads-client.ts packages/ad-optimizer/src/__tests__/meta-ads-client.test.ts
git commit -m "feat(ad-optimizer): MetaAdsClient daily increment + ad-set learning read"
```

### Task 3: Provider computes a **real daily breach**

**Files:**

- Modify: `packages/ad-optimizer/src/meta-campaign-insights-provider.ts:40-63`
- Test: `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts`

- [ ] **Step 1: Write failing tests.** Add to the existing test file. Build a fake client that returns 14 daily rows; helper to make a day:

```ts
function dailyRow(campaignId: string, date: string, spend: number, conversions: number) {
  return {
    campaignId,
    campaignName: "C",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 1000,
    inlineLinkClicks: 50,
    spend,
    conversions,
    revenue: 0,
    frequency: 1.2,
    cpm: 5,
    inlineLinkClickCtr: 1,
    costPerInlineLinkClick: 1,
    dateStart: date,
    dateStop: date,
  };
}

it("counts daily periods above target from time_increment=1 rows", async () => {
  // 9 of 14 days have cpa = spend/conversions > targetCPA(=50): spend 600/conv 1 = 600 > 50
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = `2026-05-${String(18 + i).padStart(2, "0")}`;
    return i < 9 ? dailyRow("c_1", date, 600, 1) : dailyRow("c_1", date, 40, 4); // 10 <= 50
  });
  const adsClient = {
    getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
      p.timeIncrement === 1 ? days : [],
    ),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const provider = new MetaCampaignInsightsProvider(adsClient as never);
  const result = await provider.getTargetBreachStatus({
    orgId: "o",
    accountId: "act_1",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
  });
  expect(result.granularity).toBe("daily");
  expect(result.periodsAboveTarget).toBe(9);
  expect(adsClient.getCampaignInsights).toHaveBeenCalledWith(
    expect.objectContaining({ timeIncrement: 1 }),
  );
});

it("treats a day with spend but zero conversions as above target", async () => {
  const days = [dailyRow("c_1", "2026-05-31", 100, 0), dailyRow("c_1", "2026-06-01", 0, 0)];
  const adsClient = {
    getCampaignInsights: vi.fn(async () => days),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const provider = new MetaCampaignInsightsProvider(adsClient as never);
  const r = await provider.getTargetBreachStatus({
    orgId: "o",
    accountId: "a",
    campaignId: "c_1",
    targetCPA: 50,
    startDate: new Date("2026-05-25"),
    endDate: new Date("2026-06-01"),
  });
  expect(r.periodsAboveTarget).toBe(1); // spend>0,conv=0 counts; zero-spend day ignored
});
```

- [ ] **Step 2: Run to verify fail.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test meta-campaign-insights-provider`
Expected: FAIL — current impl returns `granularity: "weekly"`, `periodsAboveTarget: 0`.

- [ ] **Step 3: Implement daily breach.** Replace `getTargetBreachStatus` body:

```ts
async getTargetBreachStatus(input: {
  orgId: string; accountId: string; campaignId: string; targetCPA: number;
  startDate: Date; endDate: Date; snapshots?: WeeklyCampaignSnapshot[];
}): Promise<TargetBreachResult> {
  const BREACH_WINDOW_DAYS = 14;
  const until = input.endDate;
  const since = new Date(until);
  since.setDate(since.getDate() - BREACH_WINDOW_DAYS);

  const rows = await this.adsClient.getCampaignInsights({
    dateRange: { since: fmt(since), until: fmt(until) },
    fields: ["campaign_id", "spend", "conversions"],
    timeIncrement: 1,
  });

  const campaignDays = rows.filter((r) => r.campaignId === input.campaignId);
  let periodsAboveTarget = 0;
  for (const day of campaignDays) {
    if (day.spend <= 0) continue; // no spend → not a breach day
    const dayCpa = day.conversions > 0 ? day.spend / day.conversions : Infinity;
    if (dayCpa > input.targetCPA) periodsAboveTarget++;
  }

  return { periodsAboveTarget, granularity: "daily", isApproximate: false };
}
```

(The `snapshots` param stays in the signature for back-compat but is no longer the data source.)

- [ ] **Step 4: Run to verify pass.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test meta-campaign-insights-provider`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/ad-optimizer/src/meta-campaign-insights-provider.ts packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts
git commit -m "feat(ad-optimizer): real daily target-breach from time_increment insights"
```

### Task 4: Provider derives **real learning phase** via material-child aggregation

**Files:**

- Modify: `packages/ad-optimizer/src/meta-campaign-insights-provider.ts:16-38`
- Test: `packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts`

- [ ] **Step 1: Write failing tests.**

```ts
function adset(id: string, status: "LEARNING" | "SUCCESS" | "FAIL" | "UNKNOWN", spend: number) {
  return {
    adSetId: id,
    adSetName: id,
    campaignId: "c_1",
    learningStageStatus: status,
    frequency: 1,
    spend,
    conversions: 1,
    cpa: spend,
    roas: 0,
    inlineLinkClickCtr: 1,
  };
}
function providerWithAdSets(rows: ReturnType<typeof adset>[]) {
  const adsClient = {
    getCampaignInsights: vi.fn(async () => [
      { campaignId: "c_1", effectiveStatus: "ACTIVE", conversions: 7 } as never,
    ]),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
    getAdSetLearningInputs: vi.fn(async () => rows),
  };
  return new MetaCampaignInsightsProvider(adsClient as never);
}

it("learningPhase=true when a material child ad set is LEARNING", async () => {
  const p = providerWithAdSets([adset("a", "LEARNING", 300), adset("b", "SUCCESS", 700)]); // a=30% share
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(true);
});

it("learningPhase=true when status coverage < 80% of spend", async () => {
  const p = providerWithAdSets([adset("a", "UNKNOWN", 500), adset("b", "SUCCESS", 500)]); // 50% known
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(true);
});

it("learningPhase=false when all material children SUCCESS and coverage ok", async () => {
  const p = providerWithAdSets([adset("a", "SUCCESS", 600), adset("b", "SUCCESS", 400)]);
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(false);
  expect(out.optimizationEvents).toBe(7); // still read from insights
});

it("learningPhase=false when client lacks getAdSetLearningInputs (graceful)", async () => {
  const adsClient = {
    getCampaignInsights: vi.fn(async () => [
      { campaignId: "c_1", effectiveStatus: "ACTIVE", conversions: 3 } as never,
    ]),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(),
  };
  const p = new MetaCampaignInsightsProvider(adsClient as never);
  const out = await p.getCampaignLearningData({ orgId: "o", accountId: "x", campaignId: "c_1" });
  expect(out.learningPhase).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test meta-campaign-insights-provider`
Expected: FAIL — current impl hardcodes `learningPhase: false`.

- [ ] **Step 3: Implement aggregation.** Add constants + replace `getCampaignLearningData`:

```ts
const MATERIAL_CHILD_SPEND_SHARE = 0.1;
const MIN_LEARNING_COVERAGE = 0.8;

// ...inside the class:
async getCampaignLearningData(input: {
  orgId: string; accountId: string; campaignId: string;
}): Promise<CampaignLearningInput> {
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - 7);
  const insights = await this.adsClient.getCampaignInsights({
    dateRange: { since: fmt(since), until: fmt(now) },
    fields: ["campaign_id", "effective_status", "conversions"],
  });
  const match = insights.find((i) => i.campaignId === input.campaignId);

  const learningPhase = await this.deriveLearningPhase(input.campaignId);

  return {
    effectiveStatus: match?.effectiveStatus ?? "UNKNOWN",
    learningPhase,
    lastModifiedDays: 0,
    optimizationEvents: match?.conversions ?? 0,
  };
}

private async deriveLearningPhase(campaignId: string): Promise<boolean> {
  if (!this.adsClient.getAdSetLearningInputs) return false;
  const adSets = await this.adsClient.getAdSetLearningInputs(campaignId);
  const totalSpend = adSets.reduce((s, a) => s + a.spend, 0);
  if (totalSpend <= 0 || adSets.length === 0) return false;

  const knownSpend = adSets
    .filter((a) => a.learningStageStatus !== "UNKNOWN")
    .reduce((s, a) => s + a.spend, 0);
  if (knownSpend / totalSpend < MIN_LEARNING_COVERAGE) return true; // incomplete coverage ⇒ protect

  const anyMaterialChildLearning = adSets.some(
    (a) => a.spend / totalSpend >= MATERIAL_CHILD_SPEND_SHARE && a.learningStageStatus === "LEARNING",
  );
  return anyMaterialChildLearning;
}
```

`this.adsClient` is typed `AdsClientInterface`, which now declares the optional `getAdSetLearningInputs` (Task 1).

- [ ] **Step 4: Run to verify pass.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test meta-campaign-insights-provider`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/ad-optimizer/src/meta-campaign-insights-provider.ts packages/ad-optimizer/src/meta-campaign-insights-provider.test.ts
git commit -m "feat(ad-optimizer): derive campaign learning phase from material child ad sets"
```

### Task 5: Swap the production stub for the real provider

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts:241-254`

- [ ] **Step 1: Replace the stub.** Change the `createInsightsProvider` factory in `adOptimizerDeps`:

```ts
createInsightsProvider: (adsClient) => new MetaCampaignInsightsProvider(adsClient),
```

Add `MetaCampaignInsightsProvider` to the existing `@switchboard/ad-optimizer` import block at the top of `inngest.ts` (grep `from "@switchboard/ad-optimizer"`). The `adsClient` arg is the `MetaAdsClient` from `createAdsClient` — it now satisfies the widened `AdsClientInterface` incl. `getAdSetLearningInputs`.

- [ ] **Step 2: Typecheck the app.** (Apps aren't built by `pnpm reset`; the stub→class swap is the only change.)

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS — `MetaCampaignInsightsProvider` is `CampaignInsightsProvider`; `MetaAdsClient` satisfies `AdsClientInterface`.

- [ ] **Step 3: Commit.**

```bash
git add apps/api/src/bootstrap/inngest.ts
git commit -m "feat(api): wire real MetaCampaignInsightsProvider into the weekly audit cron"
```

### Task 6: Integration proof — the un-blindfolded brain fires correctly

**Files:**

- Test: `packages/ad-optimizer/src/__tests__/audit-runner.test.ts` (extend; if absent, create)

- [ ] **Step 1: Write failing integration tests** driving `AuditRunner` with the real `MetaCampaignInsightsProvider` over a fake `AdsClientInterface`:

```ts
it("fires a pause recommendation on a durable daily breach (real provider, no stub)", async () => {
  const campaign = "c_dur";
  // current+previous aggregate insight: cpa = 6000/10 = 600 >> targetCPA 50, frequency etc.
  const aggInsight = {
    campaignId: campaign,
    campaignName: "Durable",
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    impressions: 10000,
    inlineLinkClicks: 200,
    spend: 6000,
    conversions: 10,
    revenue: 0,
    frequency: 1.3,
    cpm: 5,
    inlineLinkClickCtr: 1,
    costPerInlineLinkClick: 1,
    dateStart: "2026-05-25",
    dateStop: "2026-06-01",
  };
  const dailyRows = Array.from({ length: 14 }, (_, i) => ({
    ...aggInsight,
    spend: i < 8 ? 600 : 30,
    conversions: i < 8 ? 1 : 3,
    dateStart: `2026-05-${String(18 + i).padStart(2, "0")}`,
    dateStop: `2026-05-${String(18 + i).padStart(2, "0")}`,
  }));
  const adsClient = {
    getCampaignInsights: vi.fn(async (p: { timeIncrement?: number }) =>
      p.timeIncrement === 1 ? dailyRows : [aggInsight],
    ),
    getAdSetInsights: vi.fn(async () => []),
    getAccountSummary: vi.fn(async () => ({
      accountId: "a",
      accountName: "n",
      currency: "USD",
      totalSpend: 6000,
      totalImpressions: 10000,
      totalClicks: 200,
      activeCampaigns: 1,
    })),
    getAdSetLearningInputs: vi.fn(async () => [
      {
        adSetId: "as",
        adSetName: "as",
        campaignId: campaign,
        learningStageStatus: "SUCCESS",
        frequency: 1,
        spend: 6000,
        conversions: 10,
        cpa: 600,
        roas: 0,
        inlineLinkClickCtr: 1,
      },
    ]),
  };
  const runner = new AuditRunner({
    adsClient: adsClient as never,
    crmDataProvider: fakeCrm(), // returns empty CrmFunnelData (see helper below)
    insightsProvider: new MetaCampaignInsightsProvider(adsClient as never),
    config: {
      accountId: "a",
      orgId: "o",
      targetCPA: 50,
      targetROAS: 2,
      mediaBenchmarks: { inlineLinkClickCtr: 1, landingPageViewRate: 0.5 },
    },
  });
  const report = await runner.run({
    dateRange: { since: "2026-05-25", until: "2026-06-01" },
    previousDateRange: { since: "2026-05-18", until: "2026-05-25" },
  });
  const actions = report.recommendations.map((r) => r.action);
  expect(actions).toContain("pause");
});

it("downgrades to watch when a material child ad set is LEARNING", async () => {
  // same shape, but getAdSetLearningInputs returns a LEARNING material child ⇒
  // learningPhase=true ⇒ LearningPhaseGuard converts pause → watch
  // assert: report.recommendations has NO 'pause' and report.watches is non-empty
});
```

Define the small `fakeCrm()` helper returning a zero-filled `CrmFunnelData` (so the audit runs without per-source data). Mirror the existing test helpers in the file if present.

- [ ] **Step 2: Run to verify fail (first test), then implement nothing — the production code already exists from Tasks 1–4.** This task is a _characterization/integration_ guard: if it fails, the bug is in Tasks 1–4. Expected after Tasks 1–4: PASS for the pause test; write the watch test and make it pass by confirming the learning-guard path.

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test audit-runner`
Expected: PASS (pause fires; learning downgrades to watch).

- [ ] **Step 3: Full-package + build gate.**

Run: `CI=true pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/ad-optimizer build`
Expected: PASS, ≥ 322 + new tests, 0 failures.

- [ ] **Step 4: Commit.**

```bash
git add packages/ad-optimizer/src/__tests__/audit-runner.test.ts
git commit -m "test(ad-optimizer): integration proof — real provider fires pause + learning watch"
```

### PR1 close-out

- [ ] Run `pnpm --filter @switchboard/ad-optimizer test`, `pnpm --filter @switchboard/api typecheck`, `pnpm lint`, `pnpm format:check`.
- [ ] Open PR `feat/riley-eyes` → `main`. Title: `feat(ad-optimizer): un-blindfold Riley — real daily breach + learning phase (Phase 1 PR1)`. Body: link the spec, note "no mutating paths; swaps prod stub for real insights provider."

---

## PR2 · Target — aim at customers, not clicks _(outline — expand to TDD tasks after PR1 lands)_

**Goal:** Riley judges campaigns against **booking economics**, not raw cost-per-lead, behind the strict fallback ladder (spec §5).

**Open design decision to resolve first (read before planning):** per-campaign booking attribution is **not** currently available — `CrmDataProvider.getFunnelData({ campaignIds })` returns one aggregate `CrmFunnelData`, and `sourceComparison` is per-_source_. Two options, pick during PR2 planning:

- **(A) Account-level target calibration (recommended, low-churn):** derive `effectiveTargetCPA = targetCostPerBooked × accountLeadToBooked` from the already-pulled aggregate `crmData` (`bookings/leads`, `revenue/spend`). The per-campaign engine keeps judging CPL but against a _booking-grounded_ target. Catches "cheap leads that don't book" at the account level (rate drops → target tightens → campaigns flagged).
- **(B) Per-campaign attribution:** call `getFunnelData` once per campaign (N parallel calls in the audit loop) for true per-campaign `costPerBooked`. Higher fidelity, more CRM calls + a per-campaign provider contract to confirm. Satisfies "identical raw metrics, different recs per campaign."

Decide A vs B by checking whether `RealCrmDataProvider.getFunnelData` correctly attributes when passed a single-campaign `campaignIds`. If yes and volumes are low, B; else A.

**Tasks (to detail):**

- Schema: add `economicTier: "booked_cac" | "cpl" | "cpc"` and `marginBasis: "configured" | "unavailable"` to `RecommendationOutputSchema` (`packages/schemas/src/ad-optimizer.ts:168`). Both optional for back-compat; populate going forward.
- New pure module `packages/ad-optimizer/src/analyzers/economic-target.ts`:
  - `selectEconomicTier({ bookings, leads, minBooked, minLeads }): EconomicTier` — Tier 1 if `bookings ≥ minBooked` (default 10 account / TBD per-campaign), Tier 2 if `leads ≥ minLeads` (30), else Tier 3. **Pure, fully unit-tested both branches.**
  - `calibrateTargetFromBooking({ targetCostPerBooked, leadToBooked }): number` — effective per-lead target. **Pure, unit-tested.**
  - `applyTier(rec, tier)` — Tier 2 → `confidence − 0.15`, urgency one band lower, `economicTier` tag; Tier 3 → strip destructive/spend-increasing actions to `watch`. **Pure, unit-tested incl. the action-family constraint (spec §5).**
- Wire into `audit-runner.ts` per-campaign loop (compute tier + effective target, pass to `generateRecommendations`, post-process with `applyTier`) and thread `marginBasis` (configured margin/AOV when present in `AuditConfig`; else `"unavailable"` per spec §3.4 — never silently `marginAware`).
- `metrics-riley.ts`: relabel the ROI comparator to reflect the active basis ("cost per booked" / "cost per lead (booking data thin)") and surface CAC-vs-target **only if** `MetricsSignalStore` exposes a booked count (verify the interface in `metrics-types.ts`; if absent, limit to honest relabel + tier annotation and defer a true CAC surface — do not add a store-schema change in PR2).

**Acceptance:** the target Riley compares against is booking-derived (option A: account-calibrated; option B: per-campaign cost-per-booked); a tier downgrade visibly lowers action strength **and** narrows the allowed action set; `marginBasis:"unavailable"` set when no margin configured. Tests pin Tier 1/2/3 selection, calibration math, and the action-family constraint.

---

## PR3 · Brain — use the sharp tools it already owns _(outline — expand after PR2 lands)_

**Goal:** the weekly audit runs Riley's best analyzers and acts on imbalance it already detects.

**Tasks (to detail):**

- **Promote orphaned analyzers into `audit-runner.ts`:** the audit already imports `detectTrends` and `analyzeBudgetDistribution`; additionally wire `analyzeCreative` (`creative-analyzer.ts` — dedup/spend-concentration/CPA-outlier) and `detectSaturation` (`saturation-detector.ts`) into the run, emitting their findings as `insight`/`watch`/recommendation outputs. (These have existing tests — `saturation-detector.test.ts`, etc. — confirm their exact exported signatures when planning.)
- **Action the budget imbalance:** today `analyzeBudgetDistribution` (audit-runner.ts:489-507) produces `budgetDistribution` but emits no recommendation. Convert a detected over-funded-loser / under-funded-winner pair into a `shift_budget_to_source` recommendation **reusing the existing action enum** (no new `AdRecommendationAction` value — keeps the no-fallback switches in `recommendation-sink.ts` exhaustive). **Materiality guardrails** (spec §4·PR3): source spend share ≥ 10%, CPA/ROAS delta above a minimum, source not in learning, destination passes the evidence gate — else `watch`.
- **Transcribe guard thresholds** from `claude-ads` into named constants in `recommendation-engine.ts` (already has `KILL_DAYS_THRESHOLD = 7`): add a min-clicks guard (≥20) to the pause/add-creative rules; keep the ≤20% scale step (already `MAX_BUDGET_INCREASE_PERCENT = 20`); add the creative-fatigue CTR-drop>20%/14d framing where the diagnostician keys it.

**Acceptance:** the audit's recommendation set includes creative-dedup/saturation/forecast findings; a material imbalance now yields a `shift_budget_to_source` rec (and a non-material one does not); pause requires ≥20 clicks AND the durable breach.

---

## PR4 · Verify — prove the recommendation-quality contract _(outline — expand after PR3 lands)_

**Goal:** encode spec §3 as executable checks, including principled abstention and **no ghost execution**.

**Tasks (to detail):**

- A `recommendation-quality.test.ts` asserting, over a real-shaped audit run, that every emitted recommendation carries `economicTier`, `marginBasis`, an evidence summary, and (for actionable recs) a `candidateAction` descriptor — and dispatches nothing.
- **Three abstention cases** each yielding `watch`/no-action, not a kill: (a) thin data (< min clicks/leads), (b) active learning material child, (c) a one-off (non-durable) CPA spike (e.g., 1 of 14 days breached).
- **No-ghost-execution assertion (spec §4·PR4):** spy that a Phase-1 audit run makes **no** call to any `MetaAdsClient` mutating method (`updateCampaignStatus`/`updateCampaignBudget`/`createDraft*`/`uploadCreativeAsset`), emits no `operator.apply_ad_action`, and writes no ad-action `WorkTrace` mutation. (Confirms `candidateAction` stays inert and #788's no-scrape invariant holds.)

**Acceptance:** the suite is green and is the regression lock for "Riley advises, never acts" in Phase 1.

---

## Self-Review (against spec)

- **Spec coverage:** §3 contract → PR4 + per-PR acceptance; §4 PR1 Eyes → PR1 Tasks 1–6 (daily breach Task 3, learning aggregation Task 4, stub swap Task 5); §4 PR2 Target → PR2 outline (+ open A/B decision surfaced, not hidden); §4 PR3 Brain → PR3 outline (analyzer promotion, imbalance action, enum reuse, guard thresholds); §5 fallback ladder → PR2 `applyTier` (confidence **and** action-family); §6 `candidateAction` inert + #788 no-scrape → PR4 no-ghost-execution; learning aggregation rule → PR1 Task 4. **No gap.**
- **Placeholder scan:** PR1 has complete code per step. PR2–4 are explicitly _outlines to expand just-in-time_ (a deliberate, stated decision — not a hidden TODO), with their open interface questions named.
- **Type consistency:** `AdSetLearningInput`/`CampaignLearningInput`/`TargetBreachResult` used as defined in `crm-outcome.ts`; `AdsClientInterface.getAdSetLearningInputs?` (Task 1) is the method the provider calls (Task 4) and `MetaAdsClient` implements (Task 2) — names match. `economicTier`/`marginBasis` introduced in PR2 schema, consumed by PR2/PR4 only.

---

## Execution Handoff

PR1 is code-complete and ready to build now. PR2–4 expand just-in-time. Recommended: **subagent-driven-development** — fresh subagent per task, two-stage review between tasks, starting at PR1 Task 1.
