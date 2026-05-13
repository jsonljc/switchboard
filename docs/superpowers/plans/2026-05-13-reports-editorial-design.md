# /reports Editorial Second-Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/reports` as an editorial renewal-statement page over the locked v1 backend schema, mirroring the Claude Design mockup at `docs/design-prompts/locked/switchboard/project/reports-v2/`.

**Architecture:** Frontend-heavy: rewrite the page shell + nine section components + CSS module under `apps/dashboard/src/app/(auth)/(mercury)/reports/`. One small backend change in `packages/core/src/reports/` swaps the currency formatter from USD to SGD so server-generated copy stays consistent with the redesigned UI. Backend schema, endpoints, and rollup logic are untouched.

**Tech Stack:** Next.js 14 App Router (React 18, TypeScript), CSS Modules with existing Mercury aliases (`--font-serif-mercury` = Source Serif 4; `--font-mono-mercury` = JetBrains Mono), TanStack React Query, Vitest + Testing Library, pnpm + Turborepo workspaces.

**Spec:** `docs/superpowers/specs/2026-05-13-reports-editorial-design.md` (in this same branch). Read it before starting any task.

**Mockup source:** `docs/design-prompts/locked/switchboard/project/reports-v2/` — `Reports.html`, `app.jsx`, `sections.jsx`, `data.js`, `styles.css`. The CSS module port and component visual structure track this directory.

---

## Codebase context (read before Task 1)

- **Worktree:** `/Users/jasonli/switchboard/.worktrees/reports-editorial`. Verify with `git rev-parse --show-toplevel` before any commit.
- **Branch:** `docs/reports-editorial-design-spec` (will receive the implementation commits on top of the spec commits).
- **Workspace package names you'll touch:** `@switchboard/dashboard`, `@switchboard/core`.
- **Test commands:**
  - Single core test file: `pnpm --filter @switchboard/core test packages/core/src/reports/period-helpers.test.ts`
  - Single dashboard test file: `pnpm --filter @switchboard/dashboard test apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/format.test.ts`
  - Full dashboard tests: `pnpm --filter @switchboard/dashboard test`
  - Type-check: `pnpm typecheck`
  - Dashboard build (NOT in CI; must run locally for Next code changes per project memory): `pnpm --filter @switchboard/dashboard build`
- **Existing reports files:**
  - Page: `apps/dashboard/src/app/(auth)/(mercury)/reports/page.tsx` (unchanged)
  - Shell: `apps/dashboard/src/app/(auth)/(mercury)/reports/reports-page.tsx` (rewrite in Task 16)
  - CSS module: `apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css` (rewrite in Task 4)
  - Fixtures: `apps/dashboard/src/app/(auth)/(mercury)/reports/fixtures.ts` (rewrite in Task 3)
  - Hooks (unchanged): `hooks/use-report-data.ts`, `hooks/use-report-window.ts`
  - Components to rewrite: `pull-quote.tsx`, `attribution.tsx`, `funnel.tsx`, `campaigns.tsx`, `cost-vs-value.tsx`, `format.ts`
  - Components to create: `topbar.tsx`, `page-head.tsx`, `colophon.tsx`, `managed-comparison.tsx`, `no-connection-banner.tsx`, `delta-badge.tsx`, `switchboard-mark.tsx`
  - Components to delete (Task 19): `header.tsx`, `title-controls.tsx`, `report-footer.tsx`, `disclosure.tsx`
- **Backend reports module:** `packages/core/src/reports/` — `period-helpers.ts`, `pull-quote-generator.ts`, `cost-vs-value-rule.ts` (only files touched).
- **Locked schema:** `packages/schemas/src/reports/v1.ts` — never modify.
- **CLAUDE.md doctrine highlights:** ESM only, `.js` extensions on relative imports (except Next.js), no `console.log` (use `console.warn`/`console.error`), no `any`, conventional commits, file size error at 600 LOC / warn at 400.

---

## File structure (full inventory before tasks)

```
packages/core/src/reports/
  period-helpers.ts                                                          # MODIFY — add formatCurrencySGD
  period-helpers.test.ts                                                     # MODIFY — add tests for formatCurrencySGD
  pull-quote-generator.ts                                                    # MODIFY — swap formatCurrencyUSD → formatCurrencySGD (2 lines)
  pull-quote-generator.test.ts                                               # MODIFY — update expected strings ($→S$)
  cost-vs-value-rule.ts                                                      # MODIFY — swap formatCurrencyUSD → formatCurrencySGD (3 lines)
  cost-vs-value-rule.test.ts                                                 # MODIFY — assertions tolerant or updated for new currency
  prompts/pull-quote-prompt.test.ts                                          # MODIFY — line 39 USD assertion → SGD

apps/dashboard/src/app/(auth)/(mercury)/reports/
  reports-page.tsx                                                           # REWRITE
  reports.module.css                                                         # REWRITE (port mockup styles.css)
  fixtures.ts                                                                # REWRITE (mockup data.js content; dollars not cents)
  components/
    format.ts                                                                # REWRITE — fmtSGD, fmtPct, fmtInt
    pull-quote.tsx                                                           # REWRITE
    attribution.tsx                                                          # REWRITE
    funnel.tsx                                                               # REWRITE
    campaigns.tsx                                                            # REWRITE
    cost-vs-value.tsx                                                        # REWRITE
    topbar.tsx                                                               # CREATE
    page-head.tsx                                                            # CREATE
    colophon.tsx                                                             # CREATE
    managed-comparison.tsx                                                   # CREATE
    no-connection-banner.tsx                                                 # CREATE
    delta-badge.tsx                                                          # CREATE
    switchboard-mark.tsx                                                     # CREATE
    header.tsx                                                               # DELETE in Task 19
    title-controls.tsx                                                       # DELETE in Task 19
    report-footer.tsx                                                        # DELETE in Task 19
    disclosure.tsx                                                           # DELETE in Task 19
    __tests__/
      format.test.ts                                                         # CREATE
      delta-badge.test.tsx                                                   # CREATE
      switchboard-mark.test.tsx                                              # CREATE
      topbar.test.tsx                                                        # CREATE
      page-head.test.tsx                                                     # CREATE
      colophon.test.tsx                                                      # CREATE
      pull-quote.test.tsx                                                    # CREATE
      attribution.test.tsx                                                   # CREATE
      cost-vs-value.test.tsx                                                 # CREATE
      funnel.test.tsx                                                        # CREATE
      campaigns.test.tsx                                                     # CREATE
      managed-comparison.test.tsx                                            # CREATE
      no-connection-banner.test.tsx                                          # CREATE
  __tests__/
    reports-page.test.tsx                                                    # CREATE — full-page integration sweep
```

---

## Pre-flight checklist (one-time before Task 1)

- [ ] Confirm worktree + branch:
  ```bash
  git rev-parse --show-toplevel  # Expected: /Users/jasonli/switchboard/.worktrees/reports-editorial
  git branch --show-current      # Expected: docs/reports-editorial-design-spec
  ```
- [ ] Confirm clean working tree: `git status --short` returns empty.
- [ ] Confirm baseline tests pass on the current commit: `pnpm --filter @switchboard/core test` and `pnpm --filter @switchboard/dashboard test`. (If they don't, fix or note the pre-existing failure before proceeding — per project memory, `prisma-work-trace-store-integrity` and a few sibling integrity tests are known-flaky and can be ignored, but other failures should be triaged first.)

---

## Task 1: Backend `formatCurrencySGD` helper + swap call sites

**Files:**
- Modify: `packages/core/src/reports/period-helpers.ts` (add helper alongside `formatCurrencyUSD` at lines 83-95)
- Modify: `packages/core/src/reports/period-helpers.test.ts` (add a `describe("formatCurrencySGD", …)` block at the end)
- Modify: `packages/core/src/reports/pull-quote-generator.ts:6,84-85` (import + call-site swap)
- Modify: `packages/core/src/reports/pull-quote-generator.test.ts` (update `$` → `S$` in assertions)
- Modify: `packages/core/src/reports/cost-vs-value-rule.ts:3,24-34` (import + call-site swap)
- Modify: `packages/core/src/reports/cost-vs-value-rule.test.ts` (tolerant on currency; update if a test asserts an exact narrative substring)
- Modify: `packages/core/src/reports/prompts/pull-quote-prompt.test.ts:39` (`$18,433` → `S$18,433`)

- [ ] **Step 1.1: Add the helper test (failing).** Append to `period-helpers.test.ts`:

  ```ts
  describe("formatCurrencySGD", () => {
    it("formats whole dollars without decimals when >= 1000", () => {
      expect(formatCurrencySGD(14700)).toBe("S$14,700");
    });
    it("formats sub-dollar with cents when under 1000", () => {
      expect(formatCurrencySGD(447.75)).toBe("S$447.75");
    });
    it("formats zero as S$0", () => {
      expect(formatCurrencySGD(0)).toBe("S$0");
    });
    it("formats negative numbers with a leading -", () => {
      expect(formatCurrencySGD(-200)).toBe("-S$200");
    });
    it("uses en-SG grouping for very large numbers", () => {
      // en-SG groups identically to en-US for this magnitude (1,234,567)
      expect(formatCurrencySGD(1234567)).toBe("S$1,234,567");
    });
  });
  ```

  Update the import at the top to include `formatCurrencySGD`:

  ```ts
  import {
    windowToRange,
    priorPeriodRange,
    formatCurrencyUSD,
    formatCurrencySGD,
    formatDateFolio,
  } from "./period-helpers.js";
  ```

- [ ] **Step 1.2: Run test, expect FAIL** (`formatCurrencySGD` not exported):

  ```bash
  pnpm --filter @switchboard/core test packages/core/src/reports/period-helpers.test.ts
  ```

  Expected: failure like `formatCurrencySGD is not defined` or import error.

- [ ] **Step 1.3: Implement the helper.** Add to `packages/core/src/reports/period-helpers.ts` directly below `formatCurrencyUSD` (lines 83-95):

  ```ts
  export function formatCurrencySGD(value: number): string {
    if (value === 0) return "S$0";
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(value);
    if (abs >= 1000) {
      const whole = Math.round(abs);
      return `${sign}S$${whole.toLocaleString("en-SG")}`;
    }
    if (Number.isInteger(abs)) {
      return `${sign}S$${abs.toLocaleString("en-SG")}`;
    }
    return `${sign}S$${abs.toFixed(2)}`;
  }
  ```

- [ ] **Step 1.4: Run test, expect PASS:**

  ```bash
  pnpm --filter @switchboard/core test packages/core/src/reports/period-helpers.test.ts
  ```

  Expected: all 5 new `formatCurrencySGD` assertions pass, plus the existing `formatCurrencyUSD` block still passes (unchanged).

- [ ] **Step 1.5: Swap pull-quote-generator call site.** In `packages/core/src/reports/pull-quote-generator.ts`:

  Line 6 — update import:

  ```ts
  import { formatCurrencySGD } from "./period-helpers.js";
  ```

  Lines 84-85 — replace:

  ```ts
  const value = formatCurrencySGD(facts.revenueUsd);
  const cost = formatCurrencySGD(facts.costUsd);
  ```

  (The `Usd` suffix on the facts field names is a stale label; leave field names alone — they're internal — but the formatter call uses SGD now.)

- [ ] **Step 1.6: Swap cost-vs-value-rule call sites.** In `packages/core/src/reports/cost-vs-value-rule.ts`:

  Line 3 — update import:

  ```ts
  import { formatCurrencySGD } from "./period-helpers.js";
  ```

  Replace every `formatCurrencyUSD(` call in the narrative-building block (lines 24-34) with `formatCurrencySGD(`. There are three call sites in that block.

- [ ] **Step 1.7: Update existing test expectations.**

  In `packages/core/src/reports/prompts/pull-quote-prompt.test.ts:39`, change:

  ```ts
  expect(prompt).toContain("$18,433"); // formatCurrencyUSD rounds >=1000
  ```

  to:

  ```ts
  expect(prompt).toContain("S$18,433"); // formatCurrencySGD rounds >=1000
  ```

  In `packages/core/src/reports/pull-quote-generator.test.ts`, grep for any `"$"` literal in assertions about `pullquote.value` / `pullquote.cost` and update to `"S$"`. (Run the test first to see which assertions fail, then update only those.)

  In `packages/core/src/reports/cost-vs-value-rule.test.ts`, the existing assertions check `costNarrative` contains substrings like `"estimated"` and `"No active subscription"` — neither contains a `$` literal at present, so no update needed. Run the test to confirm.

- [ ] **Step 1.8: Run the full core test suite, expect PASS:**

  ```bash
  pnpm --filter @switchboard/core test
  ```

  Expected: all reports tests pass. If a reports test fails on a currency string, update the expected string from `$X` to `S$X`.

- [ ] **Step 1.9: Commit.**

  ```bash
  git rev-parse --show-toplevel  # MUST be the worktree
  git branch --show-current      # MUST be docs/reports-editorial-design-spec
  git add packages/core/src/reports/period-helpers.ts \
          packages/core/src/reports/period-helpers.test.ts \
          packages/core/src/reports/pull-quote-generator.ts \
          packages/core/src/reports/pull-quote-generator.test.ts \
          packages/core/src/reports/cost-vs-value-rule.ts \
          packages/core/src/reports/prompts/pull-quote-prompt.test.ts
  git commit -m "feat(reports): swap report copy formatter from USD to SGD

  Backend rollups now emit pull quote and cost narrative strings in S\$.
  Adds formatCurrencySGD to period-helpers; swaps the two call sites in
  pull-quote-generator and cost-vs-value-rule. formatCurrencyUSD is
  retained for any historical consumers (none in /reports today)."
  ```

---

## Task 2: Frontend `fmtSGD` formatter

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/format.ts`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/format.test.ts`

- [ ] **Step 2.1: Create the test (failing).**

  ```ts
  // apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/format.test.ts
  import { describe, expect, it } from "vitest";
  import { fmtSGD, fmtPct, fmtInt } from "../format";

  describe("fmtSGD", () => {
    it("formats whole dollars without cents above 100", () => {
      expect(fmtSGD(14720)).toBe("S$14,720");
    });

    it("formats with cents when value < 100 (auto)", () => {
      expect(fmtSGD(47.5)).toBe("S$47.50");
    });

    it('honors withCents: "always"', () => {
      expect(fmtSGD(447.75, { withCents: "always" })).toBe("S$447.75");
    });

    it('honors withCents: "never"', () => {
      expect(fmtSGD(14720.42, { withCents: "never" })).toBe("S$14,720");
    });

    it("returns em-dash for null", () => {
      expect(fmtSGD(null)).toBe("—");
    });

    it("returns em-dash for undefined", () => {
      expect(fmtSGD(undefined)).toBe("—");
    });

    it("compact: renders k for >= 10,000", () => {
      expect(fmtSGD(28402, { compact: true })).toBe("S$28k");
    });

    it("compact: renders m for >= 1,000,000", () => {
      expect(fmtSGD(1_500_000, { compact: true })).toBe("S$1.5m");
    });

    it("never emits a bare $", () => {
      // Smoke-test: every output starts with S$ or - or —
      for (const v of [0, 1, 99.99, 100, 9999, 10_000, 999_999, 1_234_567]) {
        const out = fmtSGD(v);
        expect(out.startsWith("S$") || out.startsWith("-S$")).toBe(true);
      }
    });
  });

  describe("fmtInt", () => {
    it("formats with en-SG grouping", () => {
      expect(fmtInt(1234567)).toBe("1,234,567");
    });
    it("returns em-dash for null", () => {
      expect(fmtInt(null)).toBe("—");
    });
  });

  describe("fmtPct", () => {
    it("formats with two decimals by default", () => {
      expect(fmtPct(0.0133)).toBe("1.33%");
    });
    it("respects digits arg", () => {
      expect(fmtPct(0.0478, 1)).toBe("4.8%");
    });
    it("returns em-dash for null", () => {
      expect(fmtPct(null)).toBe("—");
    });
  });
  ```

- [ ] **Step 2.2: Run test, expect FAIL** (file doesn't yet export these):

  ```bash
  pnpm --filter @switchboard/dashboard test apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/format.test.ts
  ```

  Expected: `fmtSGD is not exported` or similar.

- [ ] **Step 2.3: Replace `components/format.ts`:**

  ```ts
  // apps/dashboard/src/app/(auth)/(mercury)/reports/components/format.ts
  // Money / int / percent formatters for /reports.
  // Currency is SGD; backend emits whole dollars (with optional decimals), NOT cents.

  export interface FmtSGDOptions {
    withCents?: "auto" | "always" | "never";
    compact?: boolean;
  }

  export function fmtSGD(value: number | null | undefined, opts: FmtSGDOptions = {}): string {
    if (value == null) return "—";
    const { withCents = "auto", compact = false } = opts;
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(value);

    if (compact && abs >= 1_000_000) {
      const m = abs / 1_000_000;
      const formatted = m.toFixed(1).replace(/\.0$/, "");
      return `${sign}S$${formatted}m`;
    }
    if (compact && abs >= 10_000) {
      return `${sign}S$${Math.round(abs / 1_000)}k`;
    }

    const showCents =
      withCents === "always" ? true : withCents === "never" ? false : abs < 100;

    return `${sign}S$${abs.toLocaleString("en-SG", {
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: showCents ? 2 : 0,
    })}`;
  }

  export function fmtInt(value: number | null | undefined): string {
    if (value == null) return "—";
    return value.toLocaleString("en-SG");
  }

  export function fmtPct(
    value: number | null | undefined,
    digits = 2,
  ): string {
    if (value == null) return "—";
    return `${(value * 100).toFixed(digits)}%`;
  }
  ```

- [ ] **Step 2.4: Run test, expect PASS:**

  ```bash
  pnpm --filter @switchboard/dashboard test apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/format.test.ts
  ```

- [ ] **Step 2.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/format.ts \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/format.test.ts
  git commit -m "feat(reports): replace fmtMoney with fmtSGD/fmtPct/fmtInt

  fmtSGD always emits S\$, returns em-dash for null, supports
  auto/always/never cents and a compact mode for k/m suffixes."
  ```

---

## Task 3: Fixtures rewrite (Aurora Aesthetics, S$, populated managedComparison)

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/fixtures.ts`

The fixture content tracks the mockup's `data.js`, but values stay in **dollars** (not cents) and the `managedComparison` shape uses the locked schema (see `packages/schemas/src/reports/v1.ts:113-118`), not the mockup's simplified shape.

- [ ] **Step 3.1: Read the source data carefully.** Open `docs/design-prompts/locked/switchboard/project/reports-v2/data.js`. The fixtures below are the same campaigns and copy, with `sgd(620)` (cents) converted back to `620` (dollars), and `managedComparison` reshaped to the locked schema.

- [ ] **Step 3.2: Replace `fixtures.ts` entirely:**

  ```ts
  // apps/dashboard/src/app/(auth)/(mercury)/reports/fixtures.ts
  // Three illustrative datasets for /reports. Aurora Aesthetics — Singapore medspa.
  // All monetary values are in DOLLARS (matches the backend), not cents.

  import {
    type ReportDataV1,
    type ReportWindow,
    REPORT_WINDOWS,
    DEFAULT_REPORT_WINDOW,
  } from "@switchboard/schemas";

  export type { ReportDataV1 as ReportData, ReportWindow } from "@switchboard/schemas";
  export type {
    Delta,
    DeltaKind,
    PullQuoteCopy,
    AttributionCell,
    AttributionData,
    FunnelRowData,
    FunnelNarrative,
    CampaignRow,
    ReportCampaignInsight,
    CostBreakdown,
    ManagedComparisonData,
    ManagedComparisonPair,
    ManagedComparisonMetrics,
    ManagedComparisonSource,
  } from "@switchboard/schemas";

  export { REPORT_WINDOWS, DEFAULT_REPORT_WINDOW };

  // ─── THIS MONTH — goodFixture (showcase, populated managedComparison) ──
  export const goodFixture: ReportDataV1 = {
    label: "THIS MONTH",
    period: "APR 1 — APR 30",
    dateFolio: "APR 1 — APR 30",
    pullquote: {
      pre: "Your team earned you ",
      value: "S$14,720",
      mid: " in attributed pipeline this month against ",
      cost: "S$612",
      post:
        " paid. Riley caught the creative-fatigue dip on Apr 8 before it cost you a weekend; Alex pulled three replies back from cold.",
    },
    attribution: {
      total: 14720,
      delta: { kind: "pos", text: "↑ 22% vs Mar" },
      riley: { value: 9180, caption: "ad-driven leads converted" },
      alex: { value: 5540, caption: "reply conversions" },
    },
    funnel: [
      { stage: "Impressions", n: 342000, label: "342k", delta: { kind: "pos", text: "↑ 8%" } },
      { stage: "Clicks", n: 4182, label: "4,182", delta: { kind: "pos", text: "↑ 3%" } },
      { stage: "Landing visits", n: 3896, label: "3,896", delta: { kind: "flat", text: "—" } },
      { stage: "Leads", n: 247, label: "247", delta: { kind: "pos", text: "↑ 14%" } },
      { stage: "Bookings", n: 47, label: "47", delta: { kind: "pos", text: "↑ 9%" } },
    ],
    funnelNarrative: {
      marker: "Riley · Apr 22",
      text:
        "CTR is sitting above the medspa benchmark of 1.1%. Spring-Hydrafacial is doing most of the lift; Q2-Lookalikes is dragging the average and probably wants pausing or fresh creative.",
    },
    campaigns: [
      { name: "Spring-Hydrafacial", spend: 620, impressions: 138400, inlineLinkClicks: 1842, costPerInlineLinkClick: 0.34, inlineLinkClickCtr: 0.0133, leads: 88, revenue: 6240, cpl: 7.05, clickToLeadRate: 0.0478, roas: 10.06 },
      { name: "Botox-Touchup-Q2", spend: 410, impressions: 76200, inlineLinkClicks: 982, costPerInlineLinkClick: 0.42, inlineLinkClickCtr: 0.0129, leads: 41, revenue: 2890, cpl: 10.0, clickToLeadRate: 0.0418, roas: 7.05 },
      { name: "Retargeting-30d", spend: 217, impressions: 41800, inlineLinkClicks: 612, costPerInlineLinkClick: 0.35, inlineLinkClickCtr: 0.0146, leads: 58, revenue: 3420, cpl: 3.74, clickToLeadRate: 0.0948, roas: 15.76 },
      { name: "Skin-Booster-Search", spend: 168, impressions: 22900, inlineLinkClicks: 384, costPerInlineLinkClick: 0.44, inlineLinkClickCtr: 0.0168, leads: 28, revenue: 1980, cpl: 6.0, clickToLeadRate: 0.0729, roas: 11.79 },
      { name: "Lookalike-Q2-Wide", spend: 412, impressions: 58900, inlineLinkClicks: 318, costPerInlineLinkClick: 1.30, inlineLinkClickCtr: 0.0054, leads: 9, revenue: 190, cpl: 45.78, clickToLeadRate: 0.0283, roas: 0.46 },
      { name: "TikTok-Discovery", spend: 285, impressions: 81400, inlineLinkClicks: 442, costPerInlineLinkClick: 0.64, inlineLinkClickCtr: 0.0054, leads: 6, revenue: 0, cpl: null, clickToLeadRate: 0.0136, roas: 0.0 },
    ],
    cost: { paid: 612, alt: 8000, saving: 7388 },
    costNarrative:
      "vs. an SDR at ~S$5,000/month plus a small ad-agency retainer at ~S$3,000. Your team replaces both, and they're on duty after hours.",
    managedComparison: {
      source: "in-period-cohort",
      ads: {
        managed: { spend: 2112, revenue: 14720, roas: 6.97 },
        unmanaged: { spend: 1840, revenue: 6420, roas: 3.49 },
        delta: { kind: "pos", text: "↑ 99% roas" },
      },
      conversations: {
        managed: { spend: 0, replies: 312, conversionRate: 0.221, replyMinutesP50: 4 },
        unmanaged: { spend: 0, replies: 156, conversionRate: 0.092, replyMinutesP50: 47 },
        delta: { kind: "pos", text: "↑ 140% conv" },
      },
    },
  };

  // ─── THIS WEEK — quietFixture (low numbers, flat, managedComparison null) ──
  export const quietFixture: ReportDataV1 = {
    label: "THIS WEEK",
    period: "APR 27 — MAY 3",
    dateFolio: "APR 27 — MAY 3",
    pullquote: {
      pre: "Quieter week — ",
      value: "S$3,184",
      mid: " of attributed pipeline against ",
      cost: "S$142",
      post:
        " paid. Mostly Spring-Hydrafacial. Worth a call about whether to scale into Mother's Day or hold flat.",
    },
    attribution: {
      total: 3184,
      delta: { kind: "flat", text: "— flat WoW" },
      riley: { value: 2104, caption: "ad-driven leads converted" },
      alex: { value: 1080, caption: "reply conversions" },
    },
    funnel: [
      { stage: "Impressions", n: 78400, label: "78k", delta: null },
      { stage: "Clicks", n: 924, label: "924", delta: null },
      { stage: "Landing visits", n: 871, label: "871", delta: null },
      { stage: "Leads", n: 54, label: "54", delta: { kind: "flat", text: "—" } },
      { stage: "Bookings", n: 9, label: "9", delta: { kind: "flat", text: "—" } },
    ],
    funnelNarrative: {
      marker: "Riley · Apr 30",
      text:
        "Volume is light because we paused TikTok-Discovery on Tuesday. CTR and conversion shape both look healthy underneath — this isn't a soft week, it's a smaller week.",
    },
    campaigns: [
      { name: "Spring-Hydrafacial", spend: 142, impressions: 31200, inlineLinkClicks: 412, costPerInlineLinkClick: 0.34, inlineLinkClickCtr: 0.0132, leads: 22, revenue: 1560, cpl: 6.45, clickToLeadRate: 0.0534, roas: 10.99 },
      { name: "Retargeting-30d", spend: 58, impressions: 9400, inlineLinkClicks: 138, costPerInlineLinkClick: 0.42, inlineLinkClickCtr: 0.0147, leads: 13, revenue: 820, cpl: 4.46, clickToLeadRate: 0.0942, roas: 14.14 },
      { name: "Botox-Touchup-Q2", spend: 94, impressions: 17800, inlineLinkClicks: 224, costPerInlineLinkClick: 0.42, inlineLinkClickCtr: 0.0126, leads: 8, revenue: 584, cpl: 11.75, clickToLeadRate: 0.0357, roas: 6.21 },
      { name: "Skin-Booster-Search", spend: 41, impressions: 4900, inlineLinkClicks: 86, costPerInlineLinkClick: 0.48, inlineLinkClickCtr: 0.0176, leads: 5, revenue: 220, cpl: 8.20, clickToLeadRate: 0.0581, roas: 5.37 },
    ],
    cost: { paid: 142, alt: 1846, saving: 1704 },
    costNarrative:
      "vs. an SDR + agency retainer pro-rated weekly. Even at low volume the base cost is a small fraction.",
    managedComparison: null,
  };

  // ─── THIS QUARTER — problemFixture (negative delta, populated managedComparison) ──
  export const problemFixture: ReportDataV1 = {
    label: "THIS QUARTER",
    period: "FEB 1 — APR 30",
    dateFolio: "FEB 1 — APR 30",
    pullquote: {
      pre: "Mixed quarter — ",
      value: "S$28,402",
      mid: " attributed against ",
      cost: "S$1,343",
      post:
        ". February was strong; March slipped on creative fatigue. Riley flagged it on Mar 14 and we recovered through April.",
    },
    attribution: {
      total: 28402,
      delta: { kind: "neg", text: "↓ 6% vs Q1" },
      riley: { value: 18620, caption: "ad-driven leads converted" },
      alex: { value: 9782, caption: "reply conversions" },
    },
    funnel: [
      { stage: "Impressions", n: 1020000, label: "1.02m", delta: { kind: "pos", text: "↑ 4%" } },
      { stage: "Clicks", n: 11842, label: "11.8k", delta: { kind: "neg", text: "↓ 9%" } },
      { stage: "Landing visits", n: 10948, label: "10.9k", delta: null },
      { stage: "Leads", n: 612, label: "612", delta: { kind: "neg", text: "↓ 12%" } },
      { stage: "Bookings", n: 118, label: "118", delta: { kind: "neg", text: "↓ 8%" } },
    ],
    funnelNarrative: {
      marker: "Riley · Mar 14",
      text:
        "Friction between clicks and leads. CTR was holding but conversion dropped — read as creative fatigue on the March wave. New Hydrafacial set went live Mar 22 and the rate came back.",
    },
    campaigns: [
      { name: "Spring-Hydrafacial", spend: 1820, impressions: 412000, inlineLinkClicks: 5482, costPerInlineLinkClick: 0.33, inlineLinkClickCtr: 0.0133, leads: 238, revenue: 16880, cpl: 7.65, clickToLeadRate: 0.0434, roas: 9.27 },
      { name: "Botox-Touchup-Q1", spend: 1240, impressions: 198000, inlineLinkClicks: 2412, costPerInlineLinkClick: 0.51, inlineLinkClickCtr: 0.0122, leads: 86, revenue: 6080, cpl: 14.42, clickToLeadRate: 0.0356, roas: 4.9 },
      { name: "Retargeting-30d", spend: 651, impressions: 122000, inlineLinkClicks: 1812, costPerInlineLinkClick: 0.36, inlineLinkClickCtr: 0.0149, leads: 142, revenue: 3920, cpl: 4.58, clickToLeadRate: 0.0784, roas: 6.02 },
      { name: "Skin-Booster-Search", spend: 504, impressions: 68400, inlineLinkClicks: 1142, costPerInlineLinkClick: 0.44, inlineLinkClickCtr: 0.0167, leads: 84, revenue: 1390, cpl: 6.0, clickToLeadRate: 0.0735, roas: 2.76 },
      { name: "Lookalike-Q2-Wide", spend: 285, impressions: 41200, inlineLinkClicks: 218, costPerInlineLinkClick: 1.31, inlineLinkClickCtr: 0.0053, leads: 12, revenue: 180, cpl: 23.75, clickToLeadRate: 0.0550, roas: 0.63 },
      { name: "TikTok-Discovery", spend: 412, impressions: 178400, inlineLinkClicks: 776, costPerInlineLinkClick: 0.53, inlineLinkClickCtr: 0.0044, leads: 28, revenue: 0, cpl: null, clickToLeadRate: 0.0361, roas: 0.0 },
      { name: "Mar-Creative-Test", spend: 248, impressions: 38800, inlineLinkClicks: 0, costPerInlineLinkClick: 0, inlineLinkClickCtr: 0, leads: 0, revenue: 0, cpl: null, clickToLeadRate: null, roas: 0.0 },
    ],
    cost: { paid: 1343, alt: 24000, saving: 22657 },
    costNarrative:
      "vs. SDR + agency retainer across three months. Even in a soft quarter the price gap is roughly one-eighteenth.",
    managedComparison: {
      source: "in-period-cohort",
      ads: {
        managed: { spend: 5160, revenue: 28402, roas: 5.5 },
        unmanaged: { spend: 4280, revenue: 12180, roas: 2.85 },
        delta: { kind: "pos", text: "↑ 93% roas" },
      },
      conversations: {
        managed: { spend: 0, replies: 842, conversionRate: 0.186, replyMinutesP50: 6 },
        unmanaged: { spend: 0, replies: 412, conversionRate: 0.078, replyMinutesP50: 62 },
        delta: { kind: "pos", text: "↑ 138% conv" },
      },
    },
  };

  export const FIXTURES_BY_WINDOW: Record<ReportWindow, ReportDataV1> = {
    "THIS WEEK": quietFixture,
    "THIS MONTH": goodFixture,
    "THIS QUARTER": problemFixture,
  };
  ```

  **Note on schema fit:** `ManagedComparisonMetrics.spend` is required (non-optional), so for the `conversations` pair we set `spend: 0` (conversations don't have a meaningful "spend"). The other conversational metrics (`replies`, `conversionRate`, `replyMinutesP50`) are optional and rendered.

- [ ] **Step 3.3: Typecheck.**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. If the schema doesn't accept the `costPerInlineLinkClick: 0` row (Mar-Creative-Test), check whether the schema requires it nullable — it's typed as `number` (not nullable) in `v1.ts:69`, so `0` is acceptable. The rendering layer treats `costPerInlineLinkClick === 0` as a dead-campaign signal (Task 14).

- [ ] **Step 3.4: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/fixtures.ts
  git commit -m "feat(reports): rewrite fixtures to mockup content with SGD + managed comparison

  Aurora Aesthetics (Singapore medspa) data from the locked mockup, kept
  in dollars not cents to match the backend. goodFixture and
  problemFixture populate managedComparison with source 'in-period-cohort';
  quietFixture leaves it null. Adds the dead-campaign row Mar-Creative-Test
  (zero clicks) to exercise the dead-row treatment in Task 14."
  ```

---

## Task 4: CSS module port (`reports.module.css`)

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/reports.module.css`

This is a near-mechanical port of `docs/design-prompts/locked/switchboard/project/reports-v2/styles.css` (~960 lines) into a CSS module, with three deliberate substitutions:

- Replace **`--font-display: "Cormorant Garamond", ...` / `--font-mono: "JetBrains Mono", ...`** with the existing Mercury aliases: `--serif: var(--font-serif-mercury); --mono: var(--font-mono-mercury);` (these resolve to Source Serif 4 + JetBrains Mono already loaded in `app/layout.tsx`).
- Replace mockup `--amber: hsl(30 55% 46%); --amber-deep: hsl(30 60% 32%);` declarations with `--accent: var(--char-accent); --accent-deep: hsl(30 60% 32%);` — `--char-accent` is already declared in `globals.css:142` with the matching hue.
- Drop `position: sticky` from `.topbar` (per spec §4.1; topbar is page-internal, not sticky).
- Drop the `--amber-paper`, `--amber-soft`, `--paper-warm`, `--paper-raised`, `--paper-deep`, `--hair-strong`, `--ink-5` declarations from the mockup's `:root` block and re-declare them inside the module's `:where(:root)` so they don't leak globally. Other tokens that already exist in `globals.css` (`--ink`, `--ink-2`, `--ink-3`, `--ink-4`, `--hair`, `--hair-soft`, `--hairline`) are reused via `var(--ink-2)` etc. — do not re-declare.

- [ ] **Step 4.1: Open both files side by side.** Read `docs/design-prompts/locked/switchboard/project/reports-v2/styles.css` top-to-bottom; read `apps/dashboard/src/app/globals.css:1-200` to know which tokens already exist.

- [ ] **Step 4.2: Replace `reports.module.css` with the ported content.** Start with this header block (replaces the mockup's `:root` plus a CSS Modules `:where(:root)` scope for the new shades):

  ```css
  /* /reports — Switchboard renewal-checkpoint statement.
     Editorial register: hairlines, Source Serif 4 display, JetBrains Mono
     numerals, muted operator amber accent. */

  .reportsPage {
    /* Alias chain — keep in sync with sibling Mercury modules. */
    --serif: var(--font-serif-mercury);
    --mono: var(--font-mono-mercury);

    /* Reports-only shade extensions. Promotion to globals is a
       shared-conventions decision (spec §10.4). */
    --paper: hsl(45 25% 98%);
    --paper-warm: hsl(42 32% 95%);
    --paper-raised: #FFFFFF;
    --paper-deep: hsl(40 22% 93%);
    --ink-5: #C8BEAE;
    --hair-strong: rgba(14, 12, 10, 0.16);

    /* Accent — muted operator amber (spec §10.9 — intentional exception). */
    --accent: var(--char-accent);
    --accent-deep: hsl(30 60% 32%);
    --accent-soft: hsl(38 70% 86%);
    --accent-paper: hsl(42 70% 92%);

    --duration: 280ms;
    --ease: cubic-bezier(0.4, 0, 0.2, 1);
    --page-x: 28px;
    --max-w: 74rem;

    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.55;
  }
  ```

  Then port each section block from the mockup's `styles.css`, **converting kebab-case global selectors to camelCase CSS Module exports**. Mapping table:

  | Mockup selector | Module class |
  | --- | --- |
  | `.eyebrow` | `.eyebrow` |
  | `.topbar`, `.topbar-row`, `.brand-cluster`, `.brand-mark`, etc. | `.topbar`, `.topbarRow`, `.brandCluster`, `.brandMark`, … |
  | `.page-head`, `.page-title`, `.page-sub`, `.date-folio` | `.pageHead`, `.pageTitle`, `.pageSub`, `.dateFolio` |
  | `.window-seg`, `.recompute` | `.windowSeg`, `.recompute` |
  | `.banner-noconn` | `.bannerNoconn` |
  | `.section`, `.section-head` | `.section`, `.sectionHead` |
  | `.pullquote-wrap`, `.pullquote` | `.pullquoteWrap`, `.pullquote` |
  | `.attr-block`, `.attr-hero`, `.attr-num`, `.attr-aside`, `.attr-split`, `.attr-card` | `.attrBlock`, `.attrHero`, …, `.attrCard` |
  | `.delta-badge`, `.delta-badge.pos`, `.delta-badge.neg`, `.delta-badge.flat` | `.deltaBadge`, `.deltaBadge.pos`, `.deltaBadge.neg`, `.deltaBadge.flat` |
  | `.funnel`, `.funnel-table`, `.funnel-stage`, `.funnel-bar`, `.funnel-num`, `.funnel-delta`, `.funnel-byline` | `.funnel`, `.funnelTable`, `.funnelStage`, `.funnelBar`, `.funnelNum`, `.funnelDelta`, `.funnelByline` |
  | `.tbl-wrap`, `.tbl-scroll`, `.tbl`, `.tbl-cards`, `.camp-card`, `.roas-cell` | `.tblWrap`, `.tblScroll`, `.tbl`, `.tblCards`, `.campCard`, `.roasCell` |
  | `.cost-block`, `.cost-three`, `.cost-cell`, `.cost-narrative` | `.costBlock`, `.costThree`, `.costCell`, `.costNarrative` |
  | `.mc-wrap`, `.mc-grid`, `.mc-col`, `.mc-metric`, `.mc-side` | `.mcWrap`, `.mcGrid`, `.mcCol`, `.mcMetric`, `.mcSide` |
  | `.colophon` | `.colophon` |
  | `.fade-in` | `.fadeIn` |

  Inside the ported rules:

  - Every `var(--font-display)` → `var(--serif)`.
  - Every `var(--font-mono)` → `var(--mono)`.
  - Every `var(--amber)` → `var(--accent)`.
  - Every `var(--amber-deep)` → `var(--accent-deep)`.
  - Every `var(--amber-soft)` → `var(--accent-soft)`.
  - Every `var(--amber-paper)` → `var(--accent-paper)`.
  - In `.topbar`, **drop** `position: sticky; top: 0; z-index: 30;` — keep `background`, `border-bottom`.
  - Drop `* { box-sizing: border-box; ... }` and `html, body { ... }` resets — those belong to the page-level `globals.css`, not a module.

- [ ] **Step 4.3: Add the funnel mobile breakpoint (new — not in mockup).** Append to the funnel section:

  ```css
  @media (max-width: 520px) {
    .funnelTable {
      grid-template-columns: 1fr auto;
      grid-template-rows: auto auto auto;
      row-gap: 6px;
    }
    .funnelTable .funnelStage { grid-row: 1; grid-column: 1; }
    .funnelTable .funnelDelta { grid-row: 1; grid-column: 2; text-align: right; }
    .funnelTable .funnelBar   { grid-row: 2; grid-column: 1 / -1; }
    .funnelTable .funnelNum   { grid-row: 3; grid-column: 1 / -1; text-align: left; }
  }
  ```

- [ ] **Step 4.4: Typecheck.**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. (Components that import old class names from this file haven't been rewritten yet — but they import `styles` as an opaque object, so the file just exposes a different set of keys. Existing components will fail at runtime in the dev server, but tests don't catch this until components run.)

  **Important:** the old `reports-page.tsx` and old components still reference v1 class names. After this commit, the live page will render with missing styles until Tasks 5-16 land. This is expected in TDD-style sequencing.

- [ ] **Step 4.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/reports.module.css
  git commit -m "feat(reports): port mockup styles.css to reports.module.css

  Editorial register with Source Serif 4 display and JetBrains Mono
  numerals via existing Mercury aliases. Topbar rendered non-sticky.
  Funnel mobile breakpoint added at <=520px. Reports-only shade
  extensions (--paper-warm, --paper-deep, --hair-strong, --ink-5,
  --accent-soft/paper) scoped via .reportsPage to avoid leaking."
  ```

---

## Task 5: Shared `DeltaBadge` component

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/delta-badge.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/delta-badge.test.tsx`

- [ ] **Step 5.1: Failing test:**

  ```tsx
  // delta-badge.test.tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { DeltaBadge } from "../delta-badge";

  describe("DeltaBadge", () => {
    it("renders pos with up arrow", () => {
      render(<DeltaBadge delta={{ kind: "pos", text: "↑ 22% vs Mar" }} />);
      expect(screen.getByText(/↑/)).toBeInTheDocument();
      expect(screen.getByText(/22% vs Mar/)).toBeInTheDocument();
    });

    it("renders neg with down arrow and no red class", () => {
      const { container } = render(<DeltaBadge delta={{ kind: "neg", text: "↓ 6% vs Q1" }} />);
      expect(screen.getByText(/↓/)).toBeInTheDocument();
      const el = container.querySelector('[class*="neg"]');
      expect(el).toBeTruthy();
      // No red color anywhere
      expect(container.innerHTML).not.toMatch(/red|#f00|#ff0000/i);
    });

    it("renders flat with em-dash", () => {
      render(<DeltaBadge delta={{ kind: "flat", text: "— flat WoW" }} />);
      expect(screen.getByText(/—/)).toBeInTheDocument();
    });

    it("returns null for null delta", () => {
      const { container } = render(<DeltaBadge delta={null} />);
      expect(container.firstChild).toBeNull();
    });
  });
  ```

- [ ] **Step 5.2: Run, expect FAIL** (component not found).

  ```bash
  pnpm --filter @switchboard/dashboard test apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/delta-badge.test.tsx
  ```

- [ ] **Step 5.3: Implement:**

  ```tsx
  // delta-badge.tsx
  import type { Delta } from "@switchboard/schemas";
  import styles from "../reports.module.css";

  export function DeltaBadge({ delta }: { delta: Delta | null }) {
    if (!delta) return null;
    const arrow = delta.kind === "pos" ? "↑" : delta.kind === "neg" ? "↓" : "—";
    const cleaned = delta.text.replace(/^[↑↓—]\s*/, "");
    return (
      <span className={`${styles.deltaBadge} ${styles[delta.kind]}`}>
        <span className={styles.arrow}>{arrow}</span>
        <span>{cleaned}</span>
      </span>
    );
  }
  ```

- [ ] **Step 5.4: Run test, expect PASS.**

- [ ] **Step 5.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/delta-badge.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/delta-badge.test.tsx
  git commit -m "feat(reports): add DeltaBadge component (pos/neg/flat, no red/green)"
  ```

---

## Task 6: `SwitchboardMark` SVG component

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/switchboard-mark.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/switchboard-mark.test.tsx`

- [ ] **Step 6.1: Failing test:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render } from "@testing-library/react";
  import { SwitchboardMark } from "../switchboard-mark";

  describe("SwitchboardMark", () => {
    it("renders a 20x20 svg with two eye circles", () => {
      const { container } = render(<SwitchboardMark />);
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute("width")).toBe("20");
      expect(svg?.getAttribute("height")).toBe("20");
      expect(container.querySelectorAll("circle").length).toBe(2);
    });
  });
  ```

- [ ] **Step 6.2: Run, expect FAIL.**

- [ ] **Step 6.3: Implement** (ported verbatim from mockup `app.jsx:7-16`):

  ```tsx
  // switchboard-mark.tsx
  export function SwitchboardMark() {
    return (
      <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
        <rect x="1.5" y="1.5" width="19" height="19" rx="4" fill="#0E0C0A" />
        <circle cx="7" cy="11" r="1.6" fill="#fff" />
        <circle cx="15" cy="11" r="1.6" fill="#fff" />
        <path
          d="M 7 11 Q 11 6.5, 15 11"
          stroke="hsl(30 55% 46%)"
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  ```

- [ ] **Step 6.4: Run test, expect PASS.**

- [ ] **Step 6.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/switchboard-mark.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/switchboard-mark.test.tsx
  git commit -m "feat(reports): add inline SwitchboardMark SVG"
  ```

---

## Task 7: `Topbar` component (non-sticky, brand + live pip + clock)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/topbar.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/topbar.test.tsx`

Org name and current-user initials come from props for now — wiring them to session context happens in Task 16. This keeps the component pure-presentational and easy to test.

- [ ] **Step 7.1: Failing test:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { Topbar } from "../topbar";

  describe("Topbar", () => {
    const baseProps = {
      org: "Aurora Aesthetics",
      currentUser: { display: "Mei Lin Tan", initials: "MT" },
      liveMode: false,
    };

    it("renders the brand breadcrumb", () => {
      render(<Topbar {...baseProps} />);
      expect(screen.getByText("Switchboard")).toBeInTheDocument();
      expect(screen.getByText("Aurora Aesthetics")).toBeInTheDocument();
      expect(screen.getByText("Reports")).toBeInTheDocument();
    });

    it("shows 'sample data' pip when liveMode is false", () => {
      render(<Topbar {...baseProps} liveMode={false} />);
      expect(screen.getByText(/sample data/i)).toBeInTheDocument();
    });

    it("shows 'live data' pip when liveMode is true", () => {
      render(<Topbar {...baseProps} liveMode={true} />);
      expect(screen.getByText(/live data/i)).toBeInTheDocument();
    });

    it("renders user initials in the avatar", () => {
      render(<Topbar {...baseProps} />);
      expect(screen.getByText("MT")).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 7.2: Run, expect FAIL.**

- [ ] **Step 7.3: Implement:**

  ```tsx
  // topbar.tsx
  "use client";
  import { useEffect, useState } from "react";
  import styles from "../reports.module.css";
  import { SwitchboardMark } from "./switchboard-mark";

  export interface TopbarProps {
    org: string;
    currentUser: { display: string; initials: string };
    liveMode: boolean;
  }

  export function Topbar({ org, currentUser, liveMode }: TopbarProps) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
      const t = setInterval(() => setNow(Date.now()), 30_000);
      return () => clearInterval(t);
    }, []);

    const time = new Date(now).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <header className={styles.topbar}>
        <div className={styles.topbarRow}>
          <div className={styles.brandCluster}>
            <span className={styles.brandMark}>
              <SwitchboardMark />
              Switchboard
            </span>
            <span className={styles.brandSep}>/</span>
            <span className={styles.brandOrg}>{org}</span>
            <span className={styles.brandSep}>/</span>
            <span className={styles.brandPage}>Reports</span>
          </div>
          <div className={styles.topbarRight}>
            <span className={`${styles.livePip} ${liveMode ? "" : styles.fixture}`}>
              {liveMode ? "live data" : "sample data"}
            </span>
            <span>SGT · {time}</span>
            <span className={styles.topbarUser}>
              <span className={styles.me}>{currentUser.initials}</span>
              <span>{currentUser.display}</span>
            </span>
          </div>
        </div>
      </header>
    );
  }
  ```

- [ ] **Step 7.4: Run test, expect PASS.**

- [ ] **Step 7.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/topbar.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/topbar.test.tsx
  git commit -m "feat(reports): add Topbar — non-sticky brand cluster + live pip + SGT clock"
  ```

---

## Task 8: `PageHead` component (title + folio + window selector; no refresh state yet)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/page-head.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/page-head.test.tsx`

Refresh-state machine (label transitions, in-flight handling) lands in Task 17. This task ships a minimum: title, page sub, date folio, three-button window selector, plain Refresh button that calls a passed-in onRefresh.

- [ ] **Step 8.1: Failing test:**

  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { PageHead } from "../page-head";

  describe("PageHead", () => {
    const baseProps = {
      dateFolio: "APR 1 — APR 30",
      activeWindow: "THIS MONTH" as const,
      onSelectWindow: vi.fn(),
      onRefresh: vi.fn(),
    };

    it("renders the editorial title and a Statement eyebrow (no '/reports' route)", () => {
      render(<PageHead {...baseProps} />);
      expect(screen.getByText("Statement")).toBeInTheDocument();
      expect(screen.queryByText(/\/reports/)).toBeNull();
      // Title contains "Operator's"
      expect(screen.getByText(/Operator's/)).toBeInTheDocument();
    });

    it("renders the date folio", () => {
      render(<PageHead {...baseProps} />);
      expect(screen.getByText("APR 1 — APR 30")).toBeInTheDocument();
    });

    it("shows '—' for date folio when null", () => {
      render(<PageHead {...baseProps} dateFolio={null} />);
      expect(screen.getByTestId("dateFolio")).toHaveTextContent("—");
    });

    it("renders three window buttons and marks the active one", () => {
      render(<PageHead {...baseProps} />);
      const wk = screen.getByRole("button", { name: "THIS WEEK" });
      const mo = screen.getByRole("button", { name: "THIS MONTH" });
      const qr = screen.getByRole("button", { name: "THIS QUARTER" });
      expect(mo.className).toMatch(/on/);
      expect(wk.className).not.toMatch(/on/);
      expect(qr.className).not.toMatch(/on/);
    });

    it("fires onSelectWindow when a window button is clicked", () => {
      const onSelectWindow = vi.fn();
      render(<PageHead {...baseProps} onSelectWindow={onSelectWindow} />);
      fireEvent.click(screen.getByRole("button", { name: "THIS QUARTER" }));
      expect(onSelectWindow).toHaveBeenCalledWith("THIS QUARTER");
    });

    it("Refresh button reads 'Refresh' (not 'Recompute')", () => {
      render(<PageHead {...baseProps} />);
      expect(screen.getByRole("button", { name: /^Refresh$/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Recompute/i })).toBeNull();
    });
  });
  ```

- [ ] **Step 8.2: Run, expect FAIL.**

- [ ] **Step 8.3: Implement:**

  ```tsx
  // page-head.tsx
  "use client";
  import styles from "../reports.module.css";
  import type { ReportWindow } from "@switchboard/schemas";

  export interface PageHeadProps {
    dateFolio: string | null;
    activeWindow: ReportWindow;
    onSelectWindow: (w: ReportWindow) => void;
    onRefresh: () => void;
  }

  const WINDOWS: ReportWindow[] = ["THIS WEEK", "THIS MONTH", "THIS QUARTER"];

  export function PageHead({
    dateFolio,
    activeWindow,
    onSelectWindow,
    onRefresh,
  }: PageHeadProps) {
    return (
      <div className={styles.pageHead}>
        <div className={styles.lead}>
          <span className={styles.eyebrow}>Statement</span>
          <h1 className={styles.pageTitle}>
            Operator's <span className={styles.accent}>Statement.</span>
          </h1>
          <p className={styles.pageSub}>
            A renewal-checkpoint reading of what your two agents earned you this period, what
            they cost, and what the equivalent in headcount would have run. Read top to
            bottom — the cost arithmetic sits near the end on purpose.
          </p>
        </div>
        <div className={styles.right}>
          <span className={styles.dateFolio} data-testid="dateFolio">
            {dateFolio ?? "—"}
          </span>
          <div className={styles.windowSeg} role="group" aria-label="Report window">
            {WINDOWS.map((w) => (
              <button
                key={w}
                className={activeWindow === w ? styles.on : ""}
                onClick={() => onSelectWindow(w)}
              >
                {w}
              </button>
            ))}
          </div>
          <div className={styles.recompute}>
            <button className={styles.btn} onClick={onRefresh}>
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 8.4: Run test, expect PASS.**

- [ ] **Step 8.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/page-head.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/page-head.test.tsx
  git commit -m "feat(reports): add PageHead with window selector and Refresh button

  Title + folio + segmented window selector. Refresh state machine
  lands in a subsequent task; this ships the static surface."
  ```

---

## Task 9: `Colophon` component (replaces report-footer + disclosure)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/colophon.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/colophon.test.tsx`

- [ ] **Step 9.1: Failing test:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { Colophon } from "../colophon";

  describe("Colophon", () => {
    const baseProps = {
      period: "APR 1 — APR 30",
      org: "Aurora Aesthetics",
      generatedAt: new Date("2026-05-09T09:14:22+08:00"),
      liveMode: false,
    };

    it("renders period in italic", () => {
      render(<Colophon {...baseProps} />);
      expect(screen.getByText("APR 1 — APR 30")).toBeInTheDocument();
    });

    it("renders 'Sample data' mode pip when liveMode false", () => {
      render(<Colophon {...baseProps} liveMode={false} />);
      expect(screen.getByText(/Sample data/i)).toBeInTheDocument();
    });

    it("renders 'Live data' mode pip when liveMode true", () => {
      render(<Colophon {...baseProps} liveMode={true} />);
      expect(screen.getByText(/Live data/i)).toBeInTheDocument();
    });

    it("renders the org name", () => {
      render(<Colophon {...baseProps} />);
      expect(screen.getByText("Aurora Aesthetics")).toBeInTheDocument();
    });

    it("never renders the developer schema label", () => {
      const { container } = render(<Colophon {...baseProps} />);
      expect(container.textContent).not.toMatch(/schema\s*·\s*reports/i);
      expect(container.textContent).not.toMatch(/reports\/v1/);
    });
  });
  ```

- [ ] **Step 9.2: Run, expect FAIL.**

- [ ] **Step 9.3: Implement:**

  ```tsx
  // colophon.tsx
  import styles from "../reports.module.css";

  export interface ColophonProps {
    period: string;
    org: string;
    generatedAt: Date;
    liveMode: boolean;
  }

  export function Colophon({ period, org, generatedAt, liveMode }: ColophonProps) {
    return (
      <footer className={styles.colophon}>
        <div className={styles.left}>
          <span className={styles.eyebrow}>Colophon</span>
          <span className={styles.period}>{period}</span>
          <span className={styles.caveat}>
            Attributed pipeline reflects bookings whose lead source resolved to a
            Switchboard-managed channel within the 30-day attribution window. Revenue is
            recognised at the point of booking, not the point of service. Cost comparisons
            are illustrative, based on Singapore-market median salary plus typical retainer.
          </span>
        </div>
        <div className={styles.right}>
          <span className={`${styles.mode} ${liveMode ? styles.live : ""}`}>
            <span className={styles.dot} /> {liveMode ? "Live data" : "Sample data"}
          </span>
          <span>
            generated{" "}
            <b>{generatedAt.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}</b>
          </span>
          <span>
            org · <b>{org}</b>
          </span>
        </div>
      </footer>
    );
  }
  ```

- [ ] **Step 9.4: Run test, expect PASS.**

- [ ] **Step 9.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/colophon.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/colophon.test.tsx
  git commit -m "feat(reports): add Colophon; drops schema · reports/v1 from customer DOM"
  ```

---

## Task 10: `PullQuote` rewrite

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/pull-quote.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/pull-quote.test.tsx`

- [ ] **Step 10.1: Failing test:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render } from "@testing-library/react";
  import { PullQuote } from "../pull-quote";

  const q = {
    pre: "Your team earned you ",
    value: "S$14,720",
    mid: " in attributed pipeline this month against ",
    cost: "S$612",
    post: " paid. Riley caught the dip.",
  };

  describe("PullQuote", () => {
    it("renders all five slots in order", () => {
      const { container } = render(<PullQuote q={q} />);
      const text = container.textContent ?? "";
      expect(text.indexOf("Your team earned you")).toBeLessThan(text.indexOf("S$14,720"));
      expect(text.indexOf("S$14,720")).toBeLessThan(text.indexOf("in attributed pipeline"));
      expect(text.indexOf("S$612")).toBeLessThan(text.indexOf("paid"));
    });

    it("wraps value and cost in em spans", () => {
      const { container } = render(<PullQuote q={q} />);
      const ems = container.querySelectorAll('[class*="em"]');
      expect(ems.length).toBe(2);
      expect(ems[0]?.textContent).toBe("S$14,720");
      expect(ems[1]?.textContent).toBe("S$612");
    });

    it("never renders a bare $", () => {
      const { container } = render(<PullQuote q={q} />);
      // Only S$, not bare $
      expect(container.textContent).not.toMatch(/(?<!S)\$/);
    });
  });
  ```

- [ ] **Step 10.2: Run, expect FAIL.**

- [ ] **Step 10.3: Replace `pull-quote.tsx`:**

  ```tsx
  // pull-quote.tsx
  import type { PullQuoteCopy } from "@switchboard/schemas";
  import styles from "../reports.module.css";

  export function PullQuote({ q }: { q: PullQuoteCopy }) {
    return (
      <div className={styles.pullquoteWrap}>
        <p className={`${styles.pullquote} ${styles.fadeIn}`} key={q.value + q.cost}>
          {q.pre}
          <span className={styles.em}>{q.value}</span>
          {q.mid}
          <span className={styles.em}>{q.cost}</span>
          {q.post}
        </p>
      </div>
    );
  }
  ```

- [ ] **Step 10.4: Run test, expect PASS.**

- [ ] **Step 10.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/pull-quote.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/pull-quote.test.tsx
  git commit -m "feat(reports): rewrite PullQuote — hairline-bordered with italic em spans"
  ```

---

## Task 11: `Attribution` rewrite (hero number + Riley/Alex split + share bars)

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/attribution.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/attribution.test.tsx`

- [ ] **Step 11.1: Failing test:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { Attribution } from "../attribution";

  const data = {
    total: 14720,
    delta: { kind: "pos" as const, text: "↑ 22% vs Mar" },
    riley: { value: 9180, caption: "ad-driven leads converted" },
    alex: { value: 5540, caption: "reply conversions" },
  };

  describe("Attribution", () => {
    it("renders the hero number with S$ superscript", () => {
      const { container } = render(<Attribution data={data} />);
      expect(container.textContent).toContain("14,720");
      expect(container.textContent).toContain("S$");
    });

    it("renders 'Revenue we drove' eyebrow (not 'Attributed pipeline')", () => {
      render(<Attribution data={data} />);
      expect(screen.getByText(/Revenue we drove/i)).toBeInTheDocument();
      expect(screen.queryByText(/Attributed pipeline/i)).toBeNull();
    });

    it("renders Riley and Alex cards with their captions", () => {
      render(<Attribution data={data} />);
      expect(screen.getByText("Riley")).toBeInTheDocument();
      expect(screen.getByText("Alex")).toBeInTheDocument();
      expect(screen.getByText("ad-driven leads converted")).toBeInTheDocument();
      expect(screen.getByText("reply conversions")).toBeInTheDocument();
    });

    it("share bar widths sum to roughly 100%", () => {
      const { container } = render(<Attribution data={data} />);
      const bars = container.querySelectorAll('[class*="shareBar"] > span');
      expect(bars.length).toBe(2);
      const widths = Array.from(bars).map((b) => parseFloat((b as HTMLElement).style.width));
      expect(widths[0] + widths[1]).toBeGreaterThan(99.5);
      expect(widths[0] + widths[1]).toBeLessThan(100.5);
    });

    it("renders the delta badge with positive arrow", () => {
      render(<Attribution data={data} />);
      expect(screen.getByText(/↑/)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 11.2: Run, expect FAIL.**

- [ ] **Step 11.3: Replace `attribution.tsx`:**

  ```tsx
  // attribution.tsx
  import type { AttributionData } from "@switchboard/schemas";
  import styles from "../reports.module.css";
  import { fmtSGD } from "./format";
  import { DeltaBadge } from "./delta-badge";

  export function Attribution({ data }: { data: AttributionData }) {
    const dollars = Math.round(data.total).toLocaleString("en-SG");
    const rileyShare = data.riley.value / Math.max(1, data.total);
    const alexShare = data.alex.value / Math.max(1, data.total);

    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>Revenue we drove</span>
          <span className={styles.right}>total this period</span>
        </div>

        <div className={styles.attrBlock}>
          <div className={styles.attrHero}>
            <div className={`${styles.attrNum} ${styles.fadeIn}`} key={data.total}>
              <span className={styles.sgd}>S$</span>
              {dollars}
            </div>
            <div className={styles.attrAside}>
              <span className={styles.label}>vs. previous period</span>
              <DeltaBadge delta={data.delta} />
              <p className={styles.desc}>
                Pipeline value attributed by closed bookings, weighted by service price at
                the point of sale.
              </p>
            </div>
          </div>

          <div className={styles.attrSplit}>
            <div className={`${styles.attrCard} ${styles.riley}`}>
              <div className={styles.who}>
                <span className={styles.whoGlyph}>R</span>
                <span className={styles.whoName}>Riley</span>
                <span className={styles.whoRole}>Ad-ops</span>
              </div>
              <div className={`${styles.val} ${styles.fadeIn}`} key={data.riley.value}>
                {fmtSGD(data.riley.value, { withCents: "never" })}
              </div>
              <div className={styles.cap}>{data.riley.caption}</div>
              <div className={styles.shareLine}>
                <div className={styles.shareBar}>
                  <span style={{ width: `${(rileyShare * 100).toFixed(1)}%` }} />
                </div>
                <span className={styles.sharePct}>{Math.round(rileyShare * 100)}%</span>
              </div>
            </div>
            <div className={`${styles.attrCard} ${styles.alex}`}>
              <div className={styles.who}>
                <span className={styles.whoGlyph}>A</span>
                <span className={styles.whoName}>Alex</span>
                <span className={styles.whoRole}>Conversations</span>
              </div>
              <div className={`${styles.val} ${styles.fadeIn}`} key={data.alex.value}>
                {fmtSGD(data.alex.value, { withCents: "never" })}
              </div>
              <div className={styles.cap}>{data.alex.caption}</div>
              <div className={styles.shareLine}>
                <div className={styles.shareBar}>
                  <span style={{ width: `${(alexShare * 100).toFixed(1)}%` }} />
                </div>
                <span className={styles.sharePct}>{Math.round(alexShare * 100)}%</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }
  ```

- [ ] **Step 11.4: Run test, expect PASS.**

- [ ] **Step 11.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/attribution.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/attribution.test.tsx
  git commit -m "feat(reports): rewrite Attribution with hero number, share bars, 'Revenue we drove' eyebrow"
  ```

---

## Task 12: `CostVsValue` rewrite (renewal punchline)

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/cost-vs-value.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/cost-vs-value.test.tsx`

- [ ] **Step 12.1: Failing test:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { CostVsValue } from "../cost-vs-value";

  describe("CostVsValue", () => {
    const baseProps = {
      cost: { paid: 612, alt: 8000, saving: 7388 },
      narrative: "vs. an SDR + agency retainer.",
    };

    it("renders 'Salesperson + ad agency' label (not 'SDR + agency alt.')", () => {
      render(<CostVsValue {...baseProps} />);
      expect(screen.getByText(/Salesperson \+ ad agency/i)).toBeInTheDocument();
      expect(screen.queryByText(/SDR \+ agency alt/i)).toBeNull();
    });

    it("renders You pay, Salesperson+, Monthly saving cells", () => {
      render(<CostVsValue {...baseProps} />);
      expect(screen.getByText(/You pay/i)).toBeInTheDocument();
      expect(screen.getByText(/Monthly saving/i)).toBeInTheDocument();
    });

    it("renders the saving with S$ prefix", () => {
      const { container } = render(<CostVsValue {...baseProps} />);
      expect(container.textContent).toContain("S$7,388");
    });

    it("alt cell has strikethrough class", () => {
      const { container } = render(<CostVsValue {...baseProps} />);
      expect(container.querySelector('[class*="alt"]')).toBeTruthy();
    });

    it("never emits a bare $", () => {
      const { container } = render(<CostVsValue {...baseProps} />);
      expect(container.textContent).not.toMatch(/(?<!S)\$/);
    });
  });
  ```

- [ ] **Step 12.2: Run, expect FAIL.**

- [ ] **Step 12.3: Replace `cost-vs-value.tsx`:**

  ```tsx
  // cost-vs-value.tsx
  import type { CostBreakdown } from "@switchboard/schemas";
  import styles from "../reports.module.css";
  import { fmtSGD } from "./format";

  export function CostVsValue({
    cost,
    narrative,
  }: {
    cost: CostBreakdown;
    narrative: string;
  }) {
    const savingDollars = Math.round(cost.saving).toLocaleString("en-SG");

    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>Cost vs. value</span>
          <span className={styles.right}>the renewal arithmetic</span>
        </div>

        <div className={styles.costBlock}>
          <div className={styles.costThree}>
            <div className={`${styles.costCell} ${styles.paid}`}>
              <span className={styles.label}>You pay</span>
              <span className={styles.v}>
                {fmtSGD(cost.paid, { withCents: cost.paid < 100 ? "always" : "never" })}
              </span>
              <span className={styles.sub}>Switchboard subscription, this period</span>
            </div>
            <div className={`${styles.costCell} ${styles.alt}`}>
              <span className={styles.label}>Salesperson + ad agency</span>
              <span className={styles.v}>{fmtSGD(cost.alt, { withCents: "never" })}</span>
              <span className={styles.sub}>market-rate equivalent</span>
            </div>
            <div className={`${styles.costCell} ${styles.saving}`}>
              <span className={styles.label}>Monthly saving</span>
              <span className={styles.v}>
                <span className={styles.sgd}>S$</span>
                {savingDollars}
              </span>
              <span className={styles.sub}>net to your P&amp;L</span>
            </div>
          </div>
          <p className={styles.costNarrative}>{narrative}</p>
        </div>
      </section>
    );
  }
  ```

- [ ] **Step 12.4: Run test, expect PASS.**

- [ ] **Step 12.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/cost-vs-value.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/cost-vs-value.test.tsx
  git commit -m "feat(reports): rewrite CostVsValue — 'Salesperson + ad agency' label, S\$ saving punchline"
  ```

---

## Task 13: `Funnel` rewrite (5-stage CSS bars + byline + mobile breakpoint)

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/funnel.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/funnel.test.tsx`

- [ ] **Step 13.1: Failing test:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { Funnel } from "../funnel";

  const rows = [
    { stage: "Impressions", n: 342000, label: "342k", delta: { kind: "pos" as const, text: "↑ 8%" } },
    { stage: "Clicks", n: 4182, label: "4,182", delta: { kind: "pos" as const, text: "↑ 3%" } },
    { stage: "Landing visits", n: 3896, label: "3,896", delta: null },
    { stage: "Leads", n: 247, label: "247", delta: { kind: "pos" as const, text: "↑ 14%" } },
    { stage: "Bookings", n: 47, label: "47", delta: { kind: "pos" as const, text: "↑ 9%" } },
  ];

  const narrative = { marker: "Riley · Apr 22", text: "CTR sitting above benchmark." };

  describe("Funnel", () => {
    it("renders five rows in order with their stages", () => {
      render(<Funnel rows={rows} narrative={narrative} />);
      expect(screen.getByText("Impressions")).toBeInTheDocument();
      expect(screen.getByText("Clicks")).toBeInTheDocument();
      expect(screen.getByText("Landing visits")).toBeInTheDocument();
      expect(screen.getByText("Leads")).toBeInTheDocument();
      expect(screen.getByText("Bookings")).toBeInTheDocument();
    });

    it("first row bar is at 100% width", () => {
      const { container } = render(<Funnel rows={rows} narrative={narrative} />);
      const fills = container.querySelectorAll('[class*="fill"]');
      expect(fills.length).toBe(5);
      expect((fills[0] as HTMLElement).style.width).toBe("100.00%");
    });

    it("last row bar width is proportional", () => {
      const { container } = render(<Funnel rows={rows} narrative={narrative} />);
      const fills = container.querySelectorAll('[class*="fill"]');
      const w = parseFloat((fills[4] as HTMLElement).style.width);
      // 47 / 342000 = 0.01374%
      expect(w).toBeCloseTo(0.01, 2);
    });

    it("renders the byline marker and text", () => {
      render(<Funnel rows={rows} narrative={narrative} />);
      expect(screen.getByText("Riley · Apr 22")).toBeInTheDocument();
      expect(screen.getByText(/CTR sitting above/)).toBeInTheDocument();
    });

    it("delta == null row renders an em-dash", () => {
      const { container } = render(<Funnel rows={rows} narrative={narrative} />);
      // The Landing visits row has delta=null
      expect(container.textContent).toContain("—");
    });
  });
  ```

- [ ] **Step 13.2: Run, expect FAIL.**

- [ ] **Step 13.3: Replace `funnel.tsx`:**

  ```tsx
  // funnel.tsx
  import type { FunnelRowData, FunnelNarrative } from "@switchboard/schemas";
  import styles from "../reports.module.css";

  export function Funnel({
    rows,
    narrative,
  }: {
    rows: FunnelRowData[];
    narrative: FunnelNarrative;
  }) {
    const maxN = Math.max(...rows.map((r) => r.n), 1);

    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>Funnel</span>
          <span className={styles.right}>five stages · proportional</span>
        </div>

        <div className={styles.funnel}>
          {rows.map((r, i) => {
            const pct = (r.n / maxN) * 100;
            const dKind = r.delta?.kind ?? "flat";
            return (
              <div className={styles.funnelTable} data-i={i} key={r.stage}>
                <span className={styles.funnelStage}>{r.stage}</span>
                <span className={styles.funnelBar} aria-hidden="true">
                  <span className={styles.fill} style={{ width: `${pct.toFixed(2)}%` }} />
                </span>
                <span className={styles.funnelNum}>{r.label}</span>
                <span className={`${styles.funnelDelta} ${styles[dKind]}`}>
                  {r.delta ? r.delta.text : "—"}
                </span>
              </div>
            );
          })}

          <div className={styles.funnelByline}>
            <span className={styles.marker}>{narrative.marker}</span>
            <p className={styles.text}>{narrative.text}</p>
          </div>
        </div>
      </section>
    );
  }
  ```

- [ ] **Step 13.4: Run test, expect PASS.**

- [ ] **Step 13.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/funnel.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/funnel.test.tsx
  git commit -m "feat(reports): rewrite Funnel — 5-stage CSS bars + byline; mobile breakpoint in CSS"
  ```

---

## Task 14: `Campaigns` rewrite (table + sort + ROAS depth + mobile cards)

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/campaigns.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/campaigns.test.tsx`

- [ ] **Step 14.1: Failing tests:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen, fireEvent, within } from "@testing-library/react";
  import { Campaigns } from "../campaigns";
  import type { CampaignRow } from "@switchboard/schemas";

  const rows: CampaignRow[] = [
    { name: "Spring-Hydrafacial", spend: 620, impressions: 138400, inlineLinkClicks: 1842, costPerInlineLinkClick: 0.34, inlineLinkClickCtr: 0.0133, leads: 88, revenue: 6240, cpl: 7.05, clickToLeadRate: 0.0478, roas: 10.06 },
    { name: "Lookalike-Q2-Wide", spend: 412, impressions: 58900, inlineLinkClicks: 318, costPerInlineLinkClick: 1.30, inlineLinkClickCtr: 0.0054, leads: 9, revenue: 190, cpl: 45.78, clickToLeadRate: 0.0283, roas: 0.46 },
    { name: "Dead-Row", spend: 248, impressions: 38800, inlineLinkClicks: 0, costPerInlineLinkClick: 0, inlineLinkClickCtr: 0, leads: 0, revenue: 0, cpl: null, clickToLeadRate: null, roas: 0.0 },
  ];

  describe("Campaigns", () => {
    it("renders rows default-sorted by revenue desc", () => {
      render(<Campaigns campaigns={rows} />);
      const dataRows = screen.getAllByRole("row").slice(1, 1 + rows.length);
      expect(dataRows[0]?.textContent).toContain("Spring-Hydrafacial");
      // Dead-Row (revenue 0) comes last
      expect(dataRows[dataRows.length - 1]?.textContent).toContain("Dead-Row");
    });

    it("flips sort direction when the active header is clicked twice", () => {
      render(<Campaigns campaigns={rows} />);
      const spendHeader = screen.getByRole("columnheader", { name: /Spend/i });
      fireEvent.click(spendHeader); // desc
      let dataRows = screen.getAllByRole("row").slice(1, 1 + rows.length);
      expect(dataRows[0]?.textContent).toContain("Spring-Hydrafacial");
      fireEvent.click(spendHeader); // asc
      dataRows = screen.getAllByRole("row").slice(1, 1 + rows.length);
      expect(dataRows[0]?.textContent).toContain("Dead-Row");
    });

    it("dead row gets the muted treatment, not red", () => {
      const { container } = render(<Campaigns campaigns={rows} />);
      expect(container.innerHTML).not.toMatch(/red|#f00/i);
      // The dead row's ROAS cell has class with "dead"
      expect(container.querySelector('[class*="dead"]')).toBeTruthy();
    });

    it("totals row renders without S\\$NaN for null CPC/CPL handling", () => {
      const onlyNullCpcRow: CampaignRow[] = [
        { name: "All-Null", spend: 100, impressions: 1000, inlineLinkClicks: 0, costPerInlineLinkClick: 0, inlineLinkClickCtr: 0, leads: 0, revenue: 0, cpl: null, clickToLeadRate: null, roas: 0 },
      ];
      const { container } = render(<Campaigns campaigns={onlyNullCpcRow} />);
      expect(container.textContent).not.toContain("NaN");
      expect(container.textContent).not.toContain("S$NaN");
    });

    it("never emits a bare $", () => {
      const { container } = render(<Campaigns campaigns={rows} />);
      expect(container.textContent).not.toMatch(/(?<!S)\$/);
    });

    it("renders revenue '—' for zero revenue", () => {
      render(<Campaigns campaigns={rows} />);
      const deadRow = screen.getByText("Dead-Row").closest("tr");
      expect(deadRow).toBeTruthy();
      // The revenue cell in the dead row contains the em-dash
      expect(within(deadRow as HTMLElement).getAllByText(/—/).length).toBeGreaterThan(0);
    });
  });
  ```

- [ ] **Step 14.2: Run, expect FAIL.**

- [ ] **Step 14.3: Replace `campaigns.tsx`:**

  ```tsx
  // campaigns.tsx
  "use client";
  import { useMemo, useState } from "react";
  import type { CampaignRow } from "@switchboard/schemas";
  import styles from "../reports.module.css";
  import { fmtSGD, fmtPct, fmtInt } from "./format";

  type SortDir = "asc" | "desc";

  interface Column {
    id: keyof CampaignRow;
    label: string;
    sub: string | null;
    num: boolean;
  }

  const COLS: Column[] = [
    { id: "name", label: "Campaign", sub: null, num: false },
    { id: "spend", label: "Spend", sub: "SGD", num: true },
    { id: "impressions", label: "Impr.", sub: null, num: true },
    { id: "inlineLinkClicks", label: "Clicks", sub: "CTR", num: true },
    { id: "costPerInlineLinkClick", label: "CPC", sub: null, num: true },
    { id: "leads", label: "Leads", sub: "Click→Lead", num: true },
    { id: "cpl", label: "CPL", sub: null, num: true },
    { id: "revenue", label: "Revenue", sub: "SGD", num: true },
    { id: "roas", label: "ROAS", sub: "rev/spend", num: true },
  ];

  export function Campaigns({ campaigns }: { campaigns: CampaignRow[] }) {
    const [sortCol, setSortCol] = useState<keyof CampaignRow>("revenue");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    const roasMax = Math.max(...campaigns.map((c) => c.roas ?? 0), 1);

    const sorted = useMemo(() => {
      const arr = [...campaigns];
      arr.sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "string" && typeof bv === "string") {
          return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        return sortDir === "asc"
          ? (av as number) - (bv as number)
          : (bv as number) - (av as number);
      });
      return arr;
    }, [campaigns, sortCol, sortDir]);

    function clickHeader(col: Column) {
      if (sortCol === col.id) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col.id);
        setSortDir(col.num ? "desc" : "asc");
      }
    }

    // Totals
    const tot = campaigns.reduce(
      (a, c) => ({
        spend: a.spend + (c.spend || 0),
        impressions: a.impressions + (c.impressions || 0),
        inlineLinkClicks: a.inlineLinkClicks + (c.inlineLinkClicks || 0),
        leads: a.leads + (c.leads || 0),
        revenue: a.revenue + (c.revenue || 0),
      }),
      { spend: 0, impressions: 0, inlineLinkClicks: 0, leads: 0, revenue: 0 },
    );
    const totRoas = tot.spend > 0 ? tot.revenue / tot.spend : 0;
    const totCpc = tot.inlineLinkClicks > 0 ? tot.spend / tot.inlineLinkClicks : null;
    const totCpl = tot.leads > 0 ? tot.spend / tot.leads : null;
    const totCtr = tot.impressions > 0 ? tot.inlineLinkClicks / tot.impressions : 0;
    const totC2L = tot.inlineLinkClicks > 0 ? tot.leads / tot.inlineLinkClicks : 0;

    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>Campaigns</span>
          <span className={styles.right}>
            {campaigns.length} · sort by revenue (default)
          </span>
        </div>

        <div className={styles.tblWrap}>
          <div className={styles.tblScroll}>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  {COLS.map((c) => {
                    const isActive = sortCol === c.id;
                    return (
                      <th
                        key={c.id}
                        className={[
                          c.id === "name" ? styles.name : "",
                          styles.sortable,
                          isActive ? `${styles.active} ${styles[sortDir]}` : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => clickHeader(c)}
                      >
                        {c.label}
                        <span className={styles.arrow}>↓</span>
                        {c.sub && <span className={styles.sub}>{c.sub}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => {
                  const roasDepth = c.roas != null ? Math.min(1, c.roas / roasMax) : 0;
                  const isDead =
                    c.inlineLinkClicks === 0 || (c.roas === 0 && c.leads === 0);
                  return (
                    <tr key={c.name}>
                      <td className={styles.name}>{c.name}</td>
                      <td>{fmtSGD(c.spend, { withCents: "never" })}</td>
                      <td>{fmtInt(c.impressions)}</td>
                      <td>
                        {fmtInt(c.inlineLinkClicks)}
                        <span className={styles.submetric}>
                          {fmtPct(c.inlineLinkClickCtr, 2)} CTR
                        </span>
                      </td>
                      <td className={c.costPerInlineLinkClick === 0 ? styles.muted : ""}>
                        {c.costPerInlineLinkClick === 0
                          ? "—"
                          : fmtSGD(c.costPerInlineLinkClick, { withCents: "always" })}
                      </td>
                      <td>
                        {fmtInt(c.leads)}
                        <span className={styles.submetric}>{fmtPct(c.clickToLeadRate, 1)}</span>
                      </td>
                      <td className={c.cpl == null ? styles.muted : ""}>
                        {c.cpl == null
                          ? "—"
                          : fmtSGD(c.cpl, { withCents: c.cpl < 100 ? "always" : "never" })}
                      </td>
                      <td>{c.revenue > 0 ? fmtSGD(c.revenue, { withCents: "never" }) : "—"}</td>
                      <td>
                        <span className={`${styles.roasCell} ${isDead ? styles.dead : ""}`}>
                          <span
                            className={styles.v}
                            style={{ "--roas-depth": roasDepth.toFixed(2) } as React.CSSProperties}
                          >
                            {(c.roas ?? 0).toFixed(2)}×
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className={styles.name}>TOTAL · {campaigns.length} campaigns</td>
                  <td>{fmtSGD(tot.spend, { withCents: "never" })}</td>
                  <td>{fmtInt(tot.impressions)}</td>
                  <td>
                    {fmtInt(tot.inlineLinkClicks)}
                    <span className={styles.submetric}>{fmtPct(totCtr, 2)}</span>
                  </td>
                  <td>{totCpc == null ? "—" : fmtSGD(totCpc, { withCents: "always" })}</td>
                  <td>
                    {fmtInt(tot.leads)}
                    <span className={styles.submetric}>{fmtPct(totC2L, 1)}</span>
                  </td>
                  <td>{totCpl == null ? "—" : fmtSGD(totCpl, { withCents: totCpl < 100 ? "always" : "never" })}</td>
                  <td>{fmtSGD(tot.revenue, { withCents: "never" })}</td>
                  <td>
                    <span className={styles.roasCell}>
                      <span
                        className={styles.v}
                        style={{ "--roas-depth": Math.min(1, totRoas / roasMax).toFixed(2) } as React.CSSProperties}
                      >
                        {totRoas.toFixed(2)}×
                      </span>
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile fallback — card list */}
          <div className={styles.tblCards}>
            {sorted.map((c) => (
              <div className={styles.campCard} key={c.name}>
                <div className={styles.top}>
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.roasCell}>
                    <span
                      className={styles.v}
                      style={{ "--roas-depth": Math.min(1, (c.roas ?? 0) / roasMax).toFixed(2) } as React.CSSProperties}
                    >
                      {(c.roas ?? 0).toFixed(2)}×
                    </span>
                  </span>
                </div>
                <div className={styles.grid}>
                  <div>
                    <label>Spend</label>
                    <span className={styles.v}>{fmtSGD(c.spend, { withCents: "never" })}</span>
                  </div>
                  <div>
                    <label>Revenue</label>
                    <span className={styles.v}>
                      {c.revenue > 0 ? fmtSGD(c.revenue, { withCents: "never" }) : "—"}
                    </span>
                  </div>
                  <div>
                    <label>Clicks · CTR</label>
                    <span className={styles.v}>
                      {fmtInt(c.inlineLinkClicks)} · {fmtPct(c.inlineLinkClickCtr, 1)}
                    </span>
                  </div>
                  <div>
                    <label>Leads · CPL</label>
                    <span className={styles.v}>
                      {fmtInt(c.leads)} · {c.cpl == null ? "—" : fmtSGD(c.cpl, { withCents: "always" })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }
  ```

- [ ] **Step 14.4: Run test, expect PASS.**

- [ ] **Step 14.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/campaigns.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/campaigns.test.tsx
  git commit -m "feat(reports): rewrite Campaigns — sortable, sticky col, ROAS depth, mobile cards

  Dead campaigns (clicks=0 OR (roas=0 AND leads=0)) render muted, not red.
  Totals row handles null CPC/CPL without producing S\$NaN."
  ```

---

## Task 15: `ManagedComparison` component (NEW)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/managed-comparison.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/managed-comparison.test.tsx`

The component handles the **locked schema** shape (independently nullable `ads` / `conversations` pairs, per-pair `delta`, `source` and `emptyMessage` fields) — not the mockup's simplified shape.

- [ ] **Step 15.1: Failing tests:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { ManagedComparison } from "../managed-comparison";
  import type { ManagedComparisonData } from "@switchboard/schemas";

  const full: ManagedComparisonData = {
    source: "in-period-cohort",
    ads: {
      managed: { spend: 2112, revenue: 14720, roas: 6.97 },
      unmanaged: { spend: 1840, revenue: 6420, roas: 3.49 },
      delta: { kind: "pos", text: "↑ 99% roas" },
    },
    conversations: {
      managed: { spend: 0, replies: 312, conversionRate: 0.221, replyMinutesP50: 4 },
      unmanaged: { spend: 0, replies: 156, conversionRate: 0.092, replyMinutesP50: 47 },
      delta: { kind: "pos", text: "↑ 140% conv" },
    },
  };

  describe("ManagedComparison", () => {
    it("renders both columns when both pairs are populated", () => {
      render(<ManagedComparison data={full} />);
      expect(screen.getByText("Ads")).toBeInTheDocument();
      expect(screen.getByText("Conversations")).toBeInTheDocument();
    });

    it("uses 'How you're doing with us vs. without' eyebrow (not 'Managed vs unmanaged')", () => {
      render(<ManagedComparison data={full} />);
      expect(screen.getByText(/How you're doing with us vs\. without/i)).toBeInTheDocument();
      expect(screen.queryByText(/Managed vs\. unmanaged/i)).toBeNull();
    });

    it("shows the friendlier source caption", () => {
      render(<ManagedComparison data={full} />);
      expect(screen.getByText(/Compared to similar accounts this period/i)).toBeInTheDocument();
    });

    it("renders only Ads column when conversations is null", () => {
      const data = { ...full, conversations: null };
      render(<ManagedComparison data={data} />);
      expect(screen.getByText("Ads")).toBeInTheDocument();
      expect(screen.queryByText("Conversations")).toBeNull();
    });

    it("renders only Conversations column when ads is null", () => {
      const data = { ...full, ads: null };
      render(<ManagedComparison data={data} />);
      expect(screen.queryByText("Ads")).toBeNull();
      expect(screen.getByText("Conversations")).toBeInTheDocument();
    });

    it("returns null when both pairs are null and no emptyMessage", () => {
      const data: ManagedComparisonData = {
        source: "in-period-cohort",
        ads: null,
        conversations: null,
      };
      const { container } = render(<ManagedComparison data={data} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders emptyMessage when both pairs are null and emptyMessage is set", () => {
      const data: ManagedComparisonData = {
        source: "in-period-cohort",
        ads: null,
        conversations: null,
        emptyMessage: "Not enough data yet to compare.",
      };
      render(<ManagedComparison data={data} />);
      expect(screen.getByText(/Not enough data yet to compare/)).toBeInTheDocument();
    });

    it("renders 'Compared to your pre-Switchboard baseline' for that source", () => {
      const data = { ...full, source: "pre-switchboard-baseline" as const };
      render(<ManagedComparison data={data} />);
      expect(screen.getByText(/Compared to your pre-Switchboard baseline/i)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 15.2: Run, expect FAIL.**

- [ ] **Step 15.3: Implement:**

  ```tsx
  // managed-comparison.tsx
  import type {
    ManagedComparisonData,
    ManagedComparisonMetrics,
    ManagedComparisonPair,
    ManagedComparisonSource,
  } from "@switchboard/schemas";
  import styles from "../reports.module.css";
  import { fmtSGD, fmtInt, fmtPct } from "./format";

  function sourceCaption(s: ManagedComparisonSource): string {
    return s === "in-period-cohort"
      ? "Compared to similar accounts this period"
      : "Compared to your pre-Switchboard baseline";
  }

  type MetricKey = keyof ManagedComparisonMetrics;
  type Render = (v: number | undefined) => string;

  const ADS_METRICS: { key: MetricKey; label: string; render: Render }[] = [
    { key: "spend",   label: "Spend",   render: (v) => (v == null ? "—" : fmtSGD(v, { withCents: "never" })) },
    { key: "revenue", label: "Revenue", render: (v) => (v == null ? "—" : fmtSGD(v, { withCents: "never" })) },
    { key: "roas",    label: "ROAS",    render: (v) => (v == null ? "—" : `${v.toFixed(2)}×`) },
  ];

  const CONV_METRICS: { key: MetricKey; label: string; render: Render }[] = [
    { key: "replies",         label: "Replies handled",   render: (v) => (v == null ? "—" : fmtInt(v)) },
    { key: "conversionRate",  label: "Conversion rate",   render: (v) => (v == null ? "—" : fmtPct(v, 1)) },
    { key: "replyMinutesP50", label: "Median reply time", render: (v) => (v == null ? "—" : `${v} min`) },
  ];

  function MCColumn({
    title,
    metrics,
    pair,
  }: {
    title: string;
    metrics: { key: MetricKey; label: string; render: Render }[];
    pair: ManagedComparisonPair;
  }) {
    return (
      <div className={styles.mcCol}>
        <div className={styles.colEyebrow}>{title}</div>
        {metrics
          .filter((m) => pair.managed[m.key] != null || pair.unmanaged[m.key] != null)
          .map((m) => (
            <div className={styles.mcMetric} key={m.key}>
              <span className={styles.label}>{m.label}</span>
              <div className={`${styles.mcSide} ${styles.managed}`}>
                <span className={styles.who}>Managed</span>
                <span className={styles.v}>{m.render(pair.managed[m.key])}</span>
                {m.key === metrics[2]?.key && pair.delta && (
                  <span className={styles.delta}>{pair.delta.text}</span>
                )}
              </div>
              <div className={`${styles.mcSide} ${styles.unmanaged}`}>
                <span className={styles.who}>Unmanaged</span>
                <span className={styles.v}>{m.render(pair.unmanaged[m.key])}</span>
              </div>
            </div>
          ))}
      </div>
    );
  }

  export function ManagedComparison({ data }: { data: ManagedComparisonData }) {
    if (!data.ads && !data.conversations) {
      if (!data.emptyMessage) return null;
      return (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.eyebrow}>How you're doing with us vs. without</span>
            <span className={styles.right}>{sourceCaption(data.source)}</span>
          </div>
          <div className={styles.mcWrap}>
            <p className={styles.emptyMessage} style={{ fontStyle: "italic", color: "var(--ink-3)" }}>
              {data.emptyMessage}
            </p>
          </div>
        </section>
      );
    }

    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>How you're doing with us vs. without</span>
          <span className={styles.right}>{sourceCaption(data.source)}</span>
        </div>

        <div className={styles.mcWrap}>
          <div
            className={styles.mcGrid}
            style={
              data.ads && data.conversations
                ? undefined
                : { gridTemplateColumns: "1fr" }
            }
          >
            {data.ads && <MCColumn title="Ads" metrics={ADS_METRICS} pair={data.ads} />}
            {data.conversations && (
              <MCColumn title="Conversations" metrics={CONV_METRICS} pair={data.conversations} />
            )}
          </div>
        </div>
      </section>
    );
  }
  ```

- [ ] **Step 15.4: Run test, expect PASS.**

- [ ] **Step 15.5: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/managed-comparison.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/managed-comparison.test.tsx
  git commit -m "feat(reports): add ManagedComparison handling locked schema shape

  Independently nullable ads/conversations pairs; per-pair delta from
  schema (not client-computed); source-driven friendlier captions;
  hides cleanly when both pairs null + no emptyMessage."
  ```

---

## Task 16: `reports-page.tsx` rewrite — wire up new components

**Files:**
- Rewrite: `apps/dashboard/src/app/(auth)/(mercury)/reports/reports-page.tsx`

After this commit the live page renders the new design. Refresh state and no-connection banner are still stubs — they land in Tasks 17 and 18.

- [ ] **Step 16.1: Read the existing imports to know what `useReportWindow` and `useReportData` return.**

  ```bash
  cat apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/hooks/use-report-window.ts
  cat apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/hooks/use-report-data.ts
  ```

- [ ] **Step 16.2: Replace `reports-page.tsx`:**

  ```tsx
  // reports-page.tsx
  "use client";
  import { useReportWindow } from "./hooks/use-report-window";
  import { useReportData } from "./hooks/use-report-data";
  import { isMercuryToolLive } from "@/lib/route-availability";
  import { Topbar } from "./components/topbar";
  import { PageHead } from "./components/page-head";
  import { PullQuote } from "./components/pull-quote";
  import { Attribution } from "./components/attribution";
  import { Funnel } from "./components/funnel";
  import { Campaigns } from "./components/campaigns";
  import { CostVsValue } from "./components/cost-vs-value";
  import { ManagedComparison } from "./components/managed-comparison";
  import { Colophon } from "./components/colophon";
  import styles from "./reports.module.css";

  // Org and current-user wiring. For now these are static; replace with
  // session/organization context resolution in a follow-up (see spec §10.7).
  const ORG_PLACEHOLDER = "Aurora Aesthetics";
  const USER_PLACEHOLDER = { display: "Operator", initials: "OP" };

  export function ReportsPage() {
    const { window: activeWindow, setWindow } = useReportWindow();
    const { data: fx, refresh } = useReportData(activeWindow);
    const liveMode = isMercuryToolLive("reports");

    return (
      <div className={styles.reportsPage}>
        <Topbar org={ORG_PLACEHOLDER} currentUser={USER_PLACEHOLDER} liveMode={liveMode} />

        <PageHead
          dateFolio={fx?.dateFolio ?? null}
          activeWindow={activeWindow}
          onSelectWindow={setWindow}
          onRefresh={() => void refresh()}
        />

        {fx && (
          <>
            <PullQuote q={fx.pullquote} />
            <Attribution data={fx.attribution} />
            <Funnel rows={fx.funnel} narrative={fx.funnelNarrative} />
            <Campaigns campaigns={fx.campaigns} />
            <CostVsValue cost={fx.cost} narrative={fx.costNarrative} />
            {fx.managedComparison && <ManagedComparison data={fx.managedComparison} />}
            <Colophon
              period={fx.period}
              org={ORG_PLACEHOLDER}
              generatedAt={new Date()}
              liveMode={liveMode}
            />
          </>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 16.3: Typecheck + run full dashboard test suite.**

  ```bash
  pnpm typecheck
  pnpm --filter @switchboard/dashboard test
  ```

  The existing `__tests__/use-report-data.test.tsx` and `__tests__/use-report-window.test.ts` should still pass (we didn't touch the hooks). All new component tests should pass.

- [ ] **Step 16.4: Run dashboard build to catch Next-specific issues (per project memory: not in CI).**

  ```bash
  pnpm --filter @switchboard/dashboard build
  ```

- [ ] **Step 16.5: Smoke-check the dev server.**

  ```bash
  pnpm --filter @switchboard/dashboard dev
  # In another shell:
  open http://localhost:3002/reports
  ```

  Visually verify: title reads "Operator's Statement.", pull quote renders S$ amounts, attribution hero is large, funnel shows 5 bars, campaigns table renders, cost-vs-value saving is amber. Switch windows; check each fixture renders.

- [ ] **Step 16.6: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/reports-page.tsx
  git commit -m "feat(reports): wire up editorial page shell with all section components

  Refresh state machine and no-connection banner land in follow-up tasks;
  the page renders correctly for fixture mode without them."
  ```

---

## Task 17: Refresh state machine + window-switch safety

**Files:**
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/page-head.tsx` (add refresh state)
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/page-head.test.tsx` (add tests)
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/use-report-data.ts` (return `isRefetching` for UI state)

- [ ] **Step 17.1: Add failing tests for label transitions to `page-head.test.tsx`:**

  ```tsx
  // Append to describe("PageHead", () => { ... })
  import { act, waitFor } from "@testing-library/react";

  it("button label flips to 'Refreshing…' while in-flight", () => {
    render(
      <PageHead
        {...baseProps}
        refreshState="refreshing"
        cacheAge={0}
      />,
    );
    expect(screen.getByRole("button", { name: /Refreshing…/i })).toBeInTheDocument();
  });

  it("button label flips to 'Still loading…' at 3s threshold", () => {
    render(
      <PageHead
        {...baseProps}
        refreshState="still-loading"
        cacheAge={0}
      />,
    );
    expect(screen.getByRole("button", { name: /Still loading…/i })).toBeInTheDocument();
  });

  it("refresh button is disabled while refreshing", () => {
    render(
      <PageHead
        {...baseProps}
        refreshState="refreshing"
        cacheAge={0}
      />,
    );
    expect(screen.getByRole("button", { name: /Refreshing…/i })).toBeDisabled();
  });

  it("renders 'cached just now' when cacheAge is 0", () => {
    render(<PageHead {...baseProps} cacheAge={0} />);
    expect(screen.getByText(/cached just now/i)).toBeInTheDocument();
  });

  it("renders 'cached 47m ago' when cacheAge is 47", () => {
    render(<PageHead {...baseProps} cacheAge={47} />);
    expect(screen.getByText(/cached 47m ago/i)).toBeInTheDocument();
  });
  ```

- [ ] **Step 17.2: Run test, expect FAIL.**

- [ ] **Step 17.3: Update `page-head.tsx` to accept refresh state props:**

  Replace the existing `PageHead` with:

  ```tsx
  // page-head.tsx
  "use client";
  import styles from "../reports.module.css";
  import type { ReportWindow } from "@switchboard/schemas";

  export type RefreshState = "idle" | "refreshing" | "still-loading";

  export interface PageHeadProps {
    dateFolio: string | null;
    activeWindow: ReportWindow;
    onSelectWindow: (w: ReportWindow) => void;
    onRefresh: () => void;
    refreshState?: RefreshState;
    cacheAge?: number | null; // minutes since last refresh
  }

  const WINDOWS: ReportWindow[] = ["THIS WEEK", "THIS MONTH", "THIS QUARTER"];

  function refreshLabel(state: RefreshState): string {
    if (state === "refreshing") return "Refreshing…";
    if (state === "still-loading") return "Still loading…";
    return "Refresh";
  }

  function cacheAgeLabel(age: number | null | undefined): string {
    if (age == null) return "—";
    if (age === 0) return "just now";
    return `${age}m ago`;
  }

  export function PageHead({
    dateFolio,
    activeWindow,
    onSelectWindow,
    onRefresh,
    refreshState = "idle",
    cacheAge = null,
  }: PageHeadProps) {
    const inFlight = refreshState !== "idle";

    return (
      <div className={styles.pageHead}>
        <div className={styles.lead}>
          <span className={styles.eyebrow}>Statement</span>
          <h1 className={styles.pageTitle}>
            Operator's <span className={styles.accent}>Statement.</span>
          </h1>
          <p className={styles.pageSub}>
            A renewal-checkpoint reading of what your two agents earned you this period, what
            they cost, and what the equivalent in headcount would have run. Read top to
            bottom — the cost arithmetic sits near the end on purpose.
          </p>
        </div>
        <div className={styles.right}>
          <span className={styles.dateFolio} data-testid="dateFolio">
            {dateFolio ?? "—"}
          </span>
          <div className={styles.windowSeg} role="group" aria-label="Report window">
            {WINDOWS.map((w) => (
              <button
                key={w}
                className={activeWindow === w ? styles.on : ""}
                onClick={() => onSelectWindow(w)}
                disabled={inFlight}
              >
                {w}
              </button>
            ))}
          </div>
          <div className={styles.recompute}>
            <button
              className={`${styles.btn} ${inFlight ? styles.spinning : ""}`}
              onClick={onRefresh}
              disabled={inFlight}
            >
              {inFlight && <span className={styles.spinner} />}
              {refreshLabel(refreshState)}
            </button>
            <span>cached <b>{cacheAgeLabel(cacheAge)}</b></span>
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 17.4: Update `use-report-data.ts` to expose `isRefetching` (drives the 3s threshold from the page).** Open the file and confirm the React Query call already returns `isFetching` — it does. Add `isFetching` to the return type:

  ```ts
  // hooks/use-report-data.ts — UpdateReportData interface
  export interface UseReportData {
    data: ReportData | undefined;
    isLoading: boolean;
    isFetching: boolean;    // ← add
    error: Error | null;
    refresh: () => Promise<void>;
  }
  ```

  Update both `return` branches to include `isFetching`:

  - Fixture-mode branch: `isFetching: false`
  - Live-mode branch: propagate the `isFetching` from `useQuery`'s result (the existing destructure already gives `data, isLoading, error`; extend it to include `isFetching`).

- [ ] **Step 17.5: Wire the state machine in `reports-page.tsx`:**

  ```tsx
  // Replace the existing useReportData call + onRefresh in reports-page.tsx
  import { useEffect, useState } from "react";
  // …
  const { data: fx, isFetching, refresh } = useReportData(activeWindow);
  const [stillLoading, setStillLoading] = useState(false);
  const [cacheAge, setCacheAge] = useState<number | null>(null);

  useEffect(() => {
    if (!isFetching) {
      setStillLoading(false);
      // when a refetch completes, age resets to 0; bump every 60s
      setCacheAge(0);
      return;
    }
    const t = setTimeout(() => setStillLoading(true), 3000);
    return () => clearTimeout(t);
  }, [isFetching]);

  useEffect(() => {
    if (cacheAge == null) return;
    const t = setInterval(() => setCacheAge((a) => (a == null ? null : a + 1)), 60_000);
    return () => clearInterval(t);
  }, [cacheAge]);

  const refreshState: "idle" | "refreshing" | "still-loading" = isFetching
    ? stillLoading
      ? "still-loading"
      : "refreshing"
    : "idle";

  // …
  <PageHead
    dateFolio={fx?.dateFolio ?? null}
    activeWindow={activeWindow}
    onSelectWindow={setWindow}
    onRefresh={() => void refresh()}
    refreshState={refreshState}
    cacheAge={cacheAge}
  />
  ```

- [ ] **Step 17.6: Run tests, expect PASS.**

  ```bash
  pnpm --filter @switchboard/dashboard test apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/page-head.test.tsx
  pnpm --filter @switchboard/dashboard test apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/hooks/__tests__/use-report-data.test.tsx
  ```

- [ ] **Step 17.7: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/page-head.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/page-head.test.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/hooks/use-report-data.ts \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/reports-page.tsx
  git commit -m "feat(reports): refresh state machine — Refresh → Refreshing… → Still loading… at 3s

  Disables window-selector buttons during in-flight refetch so a window
  switch cannot commit stale data to a new window."
  ```

---

## Task 18: No-connection banner (with hook research)

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/no-connection-banner.tsx`
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/__tests__/no-connection-banner.test.tsx`
- Possibly create: a new hook (read-only wrapper) if no existing Meta-connection accessor exists
- Modify: `apps/dashboard/src/app/(auth)/(mercury)/reports/reports-page.tsx` to render the banner conditionally

Spec §4.3 mandates an existing-hook-first search. **Hard order:**

- [ ] **Step 18.1: Search for existing Meta-connection state accessors.**

  ```bash
  grep -rn "meta" apps/dashboard/src/hooks/ apps/dashboard/src/lib/ apps/dashboard/src/providers/ 2>/dev/null | grep -i "connect\|channel"
  grep -rn "use[A-Z].*Connection\|use[A-Z].*Channel" apps/dashboard/src/hooks/ apps/dashboard/src/lib/ 2>/dev/null
  cat apps/dashboard/src/hooks/use-managed-channels.ts | head -60
  ```

  Decide based on what you find:

  - **If `useManagedChannels()` (or a sibling hook) already returns the Meta connection's status,** use it directly — no new hook.
  - **If not**, add a thin read-only wrapper. Identify the existing API endpoint that already returns connection state (likely `/api/dashboard/connections` or a managed-channels endpoint — find it via `grep -rn "connections" apps/api/src/routes/`).
  - **If no existing endpoint exposes this**, stop and surface the gap. Adding a new endpoint is out of scope per spec §4.3.

- [ ] **Step 18.2: Failing test for `NoConnectionBanner`:**

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { NoConnectionBanner } from "../no-connection-banner";

  describe("NoConnectionBanner", () => {
    it("renders the eyebrow, message, and CTA", () => {
      render(<NoConnectionBanner />);
      expect(screen.getByText(/no meta ads connection/i)).toBeInTheDocument();
      expect(screen.getByText(/Campaigns and funnel will read zero/i)).toBeInTheDocument();
      const cta = screen.getByRole("link", { name: /Connect under Settings/i });
      expect(cta.getAttribute("href")).toBe("/settings/connections");
    });
  });
  ```

- [ ] **Step 18.3: Run, expect FAIL.**

- [ ] **Step 18.4: Implement the (presentational) banner:**

  ```tsx
  // no-connection-banner.tsx
  import styles from "../reports.module.css";

  export function NoConnectionBanner() {
    return (
      <div className={styles.bannerNoconn}>
        <span className={styles.eyebrow}>no meta ads connection</span>
        <span className={styles.msg}>
          Campaigns and funnel will read zero until a Meta Ads connection is reattached.
          Stripe and booking data continue to feed the attribution number above.
        </span>
        <a className={styles.cta} href="/settings/connections">
          Connect under Settings
        </a>
      </div>
    );
  }
  ```

- [ ] **Step 18.5: Add the connection-status hook** (only if the search in 18.1 did not find one). Skip this step if `useManagedChannels()` already discriminates Meta state.

  ```ts
  // apps/dashboard/src/app/(auth)/(mercury)/reports/hooks/use-meta-connection-status.ts
  "use client";
  import { useQuery } from "@tanstack/react-query";
  import { useScopedQueryKeys } from "@/hooks/use-query-keys";

  export interface UseMetaConnectionStatus {
    isConnected: boolean | undefined; // undefined while loading
    isLoading: boolean;
  }

  export function useMetaConnectionStatus(): UseMetaConnectionStatus {
    const keys = useScopedQueryKeys();
    const { data, isLoading } = useQuery({
      queryKey: keys?.connections.list() ?? ["__disabled_connections__"],
      queryFn: async () => {
        const res = await fetch("/api/dashboard/connections");
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        return res.json() as Promise<{ connections: Array<{ serviceId: string; status: string }> }>;
      },
      enabled: !!keys,
    });

    if (!data) return { isConnected: undefined, isLoading };
    const meta = data.connections.find((c) => c.serviceId === "meta");
    return { isConnected: !!meta && meta.status === "connected", isLoading };
  }
  ```

  **Verify the endpoint path and shape against the actual API** before committing. If `keys.connections.list()` doesn't exist on the query-keys factory, add it in `apps/dashboard/src/lib/query-keys.ts` (small, mirroring the existing patterns).

- [ ] **Step 18.6: Wire the banner into `reports-page.tsx`:**

  ```tsx
  // Inside ReportsPage, after Topbar / PageHead
  import { useMetaConnectionStatus } from "./hooks/use-meta-connection-status";
  import { NoConnectionBanner } from "./components/no-connection-banner";
  // …
  const { isConnected } = useMetaConnectionStatus();
  const showBanner = liveMode && isConnected === false;
  // …
  {showBanner && <NoConnectionBanner />}
  ```

  The banner never appears in fixture mode (`liveMode === false`) because `showBanner` short-circuits.

- [ ] **Step 18.7: Tests pass; typecheck; build.**

  ```bash
  pnpm typecheck
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard build
  ```

- [ ] **Step 18.8: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/no-connection-banner.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/__tests__/no-connection-banner.test.tsx \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/hooks/use-meta-connection-status.ts \
          apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/reports-page.tsx
  # If query-keys.ts was modified:
  git add apps/dashboard/src/lib/query-keys.ts
  git commit -m "feat(reports): no-connection banner reads connection state, not inferred from data

  Banner appears only when liveMode is true AND Meta connection status is
  explicitly false. Never appears in fixture mode."
  ```

---

## Task 19: Delete v1 components

**Files:**
- Delete: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/header.tsx`
- Delete: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/title-controls.tsx`
- Delete: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/report-footer.tsx`
- Delete: `apps/dashboard/src/app/(auth)/(mercury)/reports/components/disclosure.tsx`
- Delete: any matching `__tests__/` files (likely none — v1 didn't have component-level tests)

- [ ] **Step 19.1: Verify nothing imports the doomed files.**

  ```bash
  grep -rn "from .*reports/components/header\|from .*reports/components/title-controls\|from .*reports/components/report-footer\|from .*reports/components/disclosure" apps/ packages/ 2>/dev/null
  ```

  Expected: no matches. If anything does, fix the import (likely a stale test file) before deleting.

- [ ] **Step 19.2: Delete the files.**

  ```bash
  rm apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/header.tsx
  rm apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/title-controls.tsx
  rm apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/report-footer.tsx
  rm apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/disclosure.tsx
  ```

- [ ] **Step 19.3: Typecheck + tests + build.**

  ```bash
  pnpm typecheck
  pnpm --filter @switchboard/dashboard test
  pnpm --filter @switchboard/dashboard build
  ```

  Expected: all green.

- [ ] **Step 19.4: Commit.**

  ```bash
  git add -A apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/components/
  git commit -m "chore(reports): remove v1 header/title-controls/report-footer/disclosure components

  Their responsibilities now live in Topbar, PageHead, and Colophon."
  ```

---

## Task 20: Full-page acceptance criteria sweep

**Files:**
- Create: `apps/dashboard/src/app/(auth)/(mercury)/reports/__tests__/reports-page.test.tsx`

This single test file exercises every §12 acceptance criterion that wasn't covered by per-component tests. Use real fixtures imported from `fixtures.ts` so the assertion runs against true production data shape.

- [ ] **Step 20.1: Failing test:**

  ```tsx
  // apps/dashboard/src/app/(auth)/(mercury)/reports/__tests__/reports-page.test.tsx
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render, screen } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { ReportsPage } from "../reports-page";

  // Force fixture mode for these tests
  vi.mock("@/lib/route-availability", async (orig) => {
    const actual = await orig<typeof import("@/lib/route-availability")>();
    return { ...actual, isMercuryToolLive: () => false };
  });

  function renderWithQuery(ui: React.ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  }

  describe("ReportsPage (fixture mode, all three windows)", () => {
    it("renders without any bare $ in the DOM (THIS MONTH default)", () => {
      const { container } = renderWithQuery(<ReportsPage />);
      expect(container.textContent).not.toMatch(/(?<!S)\$/);
    });

    it("does not render 'schema · reports/v1' anywhere", () => {
      const { container } = renderWithQuery(<ReportsPage />);
      expect(container.textContent).not.toMatch(/schema\s*·\s*reports\/v1/i);
      expect(container.textContent).not.toMatch(/reports\/v1/);
    });

    it("renders the hero number 14,720 for the default goodFixture", () => {
      renderWithQuery(<ReportsPage />);
      expect(screen.getByText(/14,720/)).toBeInTheDocument();
    });

    it("renders 'Salesperson + ad agency' and not 'SDR + agency alt.'", () => {
      renderWithQuery(<ReportsPage />);
      expect(screen.getByText(/Salesperson \+ ad agency/i)).toBeInTheDocument();
      expect(screen.queryByText(/SDR \+ agency alt/i)).toBeNull();
    });

    it("renders 'Revenue we drove' and not 'Attributed pipeline'", () => {
      renderWithQuery(<ReportsPage />);
      expect(screen.getByText(/Revenue we drove/i)).toBeInTheDocument();
      expect(screen.queryByText(/Attributed pipeline/i)).toBeNull();
    });

    it("never shows the no-connection banner in fixture mode", () => {
      renderWithQuery(<ReportsPage />);
      expect(screen.queryByText(/no meta ads connection/i)).toBeNull();
    });

    it("renders sample data pip in fixture mode", () => {
      renderWithQuery(<ReportsPage />);
      expect(screen.getAllByText(/Sample data/i).length).toBeGreaterThan(0);
    });

    it("renders Refresh button (not Recompute)", () => {
      renderWithQuery(<ReportsPage />);
      expect(screen.getByRole("button", { name: /^Refresh$/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Recompute/i })).toBeNull();
    });

    it("renders the ManagedComparison section for goodFixture (has populated managedComparison)", () => {
      renderWithQuery(<ReportsPage />);
      expect(screen.getByText(/How you're doing with us vs\. without/i)).toBeInTheDocument();
      expect(screen.getByText("Ads")).toBeInTheDocument();
      expect(screen.getByText("Conversations")).toBeInTheDocument();
    });

    it("uses no red or green color words in rendered DOM", () => {
      const { container } = renderWithQuery(<ReportsPage />);
      // Class-name based green/red would show up in className attrs serialized to innerHTML
      expect(container.innerHTML).not.toMatch(/\b(red|green)\b/i);
    });
  });
  ```

- [ ] **Step 20.2: Run test, expect PASS** (the implementation already satisfies every criterion if the prior tasks landed clean):

  ```bash
  pnpm --filter @switchboard/dashboard test apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/__tests__/reports-page.test.tsx
  ```

  If any test fails, the failure traces back to a specific task's component — fix that component, re-run, then commit a fix-up under the same task's commit boundary if it lands separately.

- [ ] **Step 20.3: Full test + build sweep.**

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm --filter @switchboard/dashboard build
  ```

- [ ] **Step 20.4: Commit.**

  ```bash
  git add apps/dashboard/src/app/\(auth\)/\(mercury\)/reports/__tests__/reports-page.test.tsx
  git commit -m "test(reports): full-page acceptance sweep covering spec §12 criteria"
  ```

---

## Post-implementation checklist (one-time)

After Task 20, sweep the final state:

- [ ] All §12 DoD items in the spec are green (compare line-by-line).
- [ ] `git log --oneline origin/main..HEAD` shows ~20 focused commits, conventional-commit style, no fix-up noise.
- [ ] Dev server smoke check at `http://localhost:3002/reports` with `NEXT_PUBLIC_REPORTS_LIVE=false` (default): renders goodFixture, window switching works, refresh button label flips to "Refreshing…" briefly, no console errors.
- [ ] Open PR to `main` titled `feat(reports): editorial second-pass redesign` with the spec linked in the description.

---

## Self-review notes

This plan was self-reviewed against the spec on 2026-05-13. Findings:

- **Spec coverage:** Every §4 subsection maps to a task (4.1→Task 7, 4.2→Tasks 8+17, 4.3→Task 18, 4.4→Task 10, 4.5→Task 11, 4.6→Task 13, 4.7→Task 14, 4.8→Task 12, 4.9→Task 15, 4.10→Task 9). §6 currency reconciliation → Tasks 1+2. §5 live/fixture/error → Tasks 16+17. §8 CSS → Task 4. §10b sequencing → Option A executed.
- **Type consistency:** `RefreshState` declared in Task 17 matches the prop typing in `PageHead`. `ManagedComparisonPair.delta` (locked schema) used unmodified throughout Task 15. `CampaignRow` field names match `packages/schemas/src/reports/v1.ts:65-77`.
- **Placeholder scan:** Three `useManagedChannels()` references in Task 18.1 are deliberately exploratory — the task structure forces a search before deciding. `ORG_PLACEHOLDER` / `USER_PLACEHOLDER` constants in Task 16 are intentional; the spec §10.7 explicitly defers session/org wiring to a follow-up, and the placeholders are flagged in the commit message.
- **Known scope-creep risk:** Task 18.5 may discover that no existing endpoint exposes Meta connection status. The task says to stop and surface; do not silently invent an endpoint. If escalation happens here, file a small follow-up task for the connections API surface and ship the rest of the redesign without the banner (since fixture mode is the launch default; live mode flips later).
