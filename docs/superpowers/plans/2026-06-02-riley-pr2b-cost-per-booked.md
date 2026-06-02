# Riley ROI: cost per booked (PR2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Riley's operator-facing ROI surface read "cost per booked $X · target $Y" (account-level CAC) instead of "cost per lead", matching the PR2 engine that now optimizes for paying customers.

**Architecture:** The core read-model (`metrics-riley.ts`) computes the CAC from `countBookingsCreated` (mirroring `metrics-alex.ts`) and is the single source of truth. The dashboard agent-panel hero (`key-result.tsx`) renders the server-computed `roi.comparator` instead of recomputing client-side; the cockpit ROI bar already renders `roi.label`/`roi.comparator` generically. Stale `"cost per lead"` test fixtures are refreshed. Out of scope: Alex's home week-note, Mercury `/reports`, recommendation-card `economicTier`/`marginBasis` UI, and Riley's audit engine.

**Tech Stack:** TypeScript monorepo (pnpm + Turborepo), Vitest, React/Next.js (dashboard). Spec: `docs/superpowers/specs/2026-06-02-riley-pr2b-cost-per-booked-design.md`.

---

## File Structure

| File                                                                               | Responsibility                                                              | Change |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| `packages/core/src/agent-home/metrics-riley.ts`                                    | Compute CAC, relabel ROI bar, honest degraded fallbacks                     | Modify |
| `packages/core/src/agent-home/__tests__/metrics-riley.test.ts`                     | ROI assertions: label + booking-denominator + new zero-bookings/units cases | Modify |
| `apps/dashboard/src/components/agent-panel/lib/key-result-state.ts`                | Thread `roi` into proof + paused state                                      | Modify |
| `apps/dashboard/src/components/agent-panel/lib/__tests__/key-result-state.test.ts` | Assert `roi` is threaded                                                    | Modify |
| `apps/dashboard/src/components/agent-panel/key-result.tsx`                         | Render `roi.comparator`; delete `buildCplBeat`                              | Modify |
| `apps/dashboard/src/components/agent-panel/__tests__/key-result.test.tsx`          | Rewrite "Riley CPL beat" test; add blank-CAC test                           | Modify |
| `apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts`                   | Refresh stale `"cost per lead"` fixture                                     | Modify |
| `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx`                 | Refresh stale `"cost per lead"` fixtures                                    | Modify |
| `apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx`               | Refresh stale `"cost per lead"` fixtures                                    | Modify |

Baseline (already verified clean on this branch): `metrics-riley` 20 tests pass; dashboard `key-result`/`roi-bar`/`kpi-strip`/`metrics-types` 44 tests pass.

---

## Task 1: Core read-model — cost per booked in `metrics-riley.ts`

**Files:**

- Modify: `packages/core/src/agent-home/metrics-riley.ts`
- Test: `packages/core/src/agent-home/__tests__/metrics-riley.test.ts`

- [ ] **Step 1: Extend the test store mock with a bookings count.** In `metrics-riley.test.ts`, the `makeStore` factory currently stubs `countBookingsCreated: vi.fn(async () => 0)`. Add a `bookingsThisWeek?` option and make the stub return it for the hero window (mirror the `countConversionsByType` hero-window logic). Replace the `makeStore` signature + the `countBookingsCreated` stub:

```ts
function makeStore(opts: {
  leadsThisWeek?: number;
  leadsLastWeek?: number;
  leadsPerWeeklyBucket?: number[];
  leadsPerDailyBucket?: number[];
  bookingsThisWeek?: number;
}): MetricsSignalStore {
  return {
    countBookingsCreated: vi.fn(async ({ from, to }) => {
      const week = buildWeekContext(WED_NOW, TZ);
      if (from.getTime() === week.weekStart.getTime() && to.getTime() === week.weekEnd.getTime())
        return opts.bookingsThisWeek ?? 0;
      return 0;
    }),
    countConversionsByType: vi.fn(async ({ from, to }) => {
```

(Leave the rest of `countConversionsByType` and `getMetaSpendCents` unchanged.)

- [ ] **Step 2: Rewrite the 5 ROI test cases** in the `describe("buildRileyMetricsViewModel — tiles + roi (B.2b)")` block. The ROI now depends on the **booking** denominator, not leads. Replace the five `it("roi …")` cases (rules 1–4 + sub-dollar guard) with:

```ts
it("roi rule 1: spendCents === null → 'Connect Meta Ads to see cost per booked'", async () => {
  const week = buildWeekContext(WED_NOW, TZ);
  const store = makeStore({ leadsThisWeek: 27, bookingsThisWeek: 4 });
  const vm = await buildRileyMetricsViewModel({
    orgId: "org-1",
    week,
    store,
    targets: { avgValueCents: null, targetCpbCents: 500 },
  });
  expect(vm.roi).toEqual({
    degraded: true,
    degradedHint: "Connect Meta Ads to see cost per booked",
    label: "cost per booked",
    comparator: { value: "—", target: "target $5" },
  });
});

it("roi rule 2: spend present + zero bookings → 'No bookings attributed yet', comparator '—'", async () => {
  const week = buildWeekContext(WED_NOW, TZ);
  const store = makeStore({ leadsThisWeek: 27, bookingsThisWeek: 0 });
  (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(20000);
  const vm = await buildRileyMetricsViewModel({
    orgId: "org-1",
    week,
    store,
    targets: { avgValueCents: null, targetCpbCents: 4000 },
  });
  expect(vm.roi).toEqual({
    degraded: true,
    degradedHint: "No bookings attributed yet",
    label: "cost per booked",
    comparator: { value: "—", target: "target $40" },
  });
});

it("roi rule 3: spend > 0 && bookings > 0 && targetCpbCents === null → '$N per booked', target '—'", async () => {
  const week = buildWeekContext(WED_NOW, TZ);
  const store = makeStore({ leadsThisWeek: 50, bookingsThisWeek: 10 });
  (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(20000);
  const vm = await buildRileyMetricsViewModel({
    orgId: "org-1",
    week,
    store,
    targets: { avgValueCents: null, targetCpbCents: null },
  });
  expect(vm.roi).toEqual({
    degraded: true,
    degradedHint: "",
    label: "cost per booked",
    comparator: { value: "$20 per booked", target: "—" },
  });
});

it("roi sub-dollar guard: cac rounds to 0 → '<$1 per booked', not '$0 per booked'", async () => {
  const week = buildWeekContext(WED_NOW, TZ);
  const store = makeStore({ leadsThisWeek: 100, bookingsThisWeek: 100 });
  (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(99);
  const vm = await buildRileyMetricsViewModel({
    orgId: "org-1",
    week,
    store,
    targets: { avgValueCents: null, targetCpbCents: 500 },
  });
  expect(vm.roi).toEqual({
    degraded: true,
    degradedHint: "",
    label: "cost per booked",
    comparator: { value: "<$1 per booked", target: "target $5" },
  });
});

it("roi rule 4 + units: spend > 0 && bookings > 0 && targetCpbCents=1000 → '$25 per booked' / 'target $10'", async () => {
  const week = buildWeekContext(WED_NOW, TZ);
  const store = makeStore({ leadsThisWeek: 80, bookingsThisWeek: 5 });
  (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(12345);
  const vm = await buildRileyMetricsViewModel({
    orgId: "org-1",
    week,
    store,
    targets: { avgValueCents: null, targetCpbCents: 1000 },
  });
  // 1000 cents → "target $10" (NOT the audit's dollar-valued targetCostPerBooked).
  // CAC = round(12345 / 100 / 5) = round(24.69) = 25.
  expect(vm.roi).toEqual({
    degraded: true,
    degradedHint: "",
    label: "cost per booked",
    comparator: { value: "$25 per booked", target: "target $10" },
  });
});
```

Leave every other test (hero/spark/stats/tiles, `qualifiedPct === 0`, A.3 echoes, Spend mirror, voice divergence) untouched.

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `CI=true pnpm --filter @switchboard/core test metrics-riley`
Expected: FAIL — current code emits `label: "cost per lead"` / `"$N per lead"` and the rule-2 hint is `""`.

- [ ] **Step 4: Implement the read-model change** in `metrics-riley.ts`.

(a) Add a module-level constant after the `RILEY_VOICE` block (after line 17):

```ts
// Must match metrics-alex.ts EXCLUDE_STATUSES so Riley's CAC denominator stays in
// lockstep with Alex's booking hero. Alex currently excludes only "cancelled".
// If that list changes, change it in both files.
const EXCLUDE_STATUSES = ["cancelled"] as const;
```

(b) Add a bookings fetch to the parallel loads. After the `spendCentsP` line (line 26) add:

```ts
const bookingsP = store.countBookingsCreated({
  orgId,
  excludeStatuses: EXCLUDE_STATUSES,
  from: week.weekStart,
  to: week.weekEnd,
});
```

Then add `bookingsP` to the `Promise.all` and `bookings` to its destructure:

```ts
const [heroValue, heroPrev, spendCents, bookings, weeklyCounts, dailyCounts] = await Promise.all([
  heroValueP,
  heroPrevP,
  spendCentsP,
  bookingsP,
  weeklyCountsP,
  dailyCountsP,
]);
```

(c) Replace the `cpl`/`cplDisplay` block **and** the stale comment (current lines 96–109 — from `const cpl =` through the `targetLabel` line, including the multi-line "Riley v1 reinterprets `targetCpbCents`…" comment) with:

```ts
const cac = spendCents !== null && bookings > 0 ? Math.round(spendCents / 100 / bookings) : null;
let cacDisplay = "—";
if (cac !== null) cacDisplay = cac === 0 ? "<$1 per booked" : `$${cac} per booked`;
// `targetCpbCents` is the genuine target cost per BOOKING (cents), shared with Alex
// via AgentRoster config. Distinct from the audit engine's dollar-valued
// `targetCostPerBooked` (a different config surface); they are not unified here.
const targetDollars =
  targets.targetCpbCents !== null ? Math.round(targets.targetCpbCents / 100) : null;
const targetLabel = targetDollars !== null ? `target $${targetDollars}` : "—";
```

(Keep the `spendDollars` line above it — `tiles` still uses it.)

(d) Replace the `roi` IIFE (current lines 123–152) with:

```ts
const roi: RoiBar = (() => {
  if (spendCents === null) {
    return {
      degraded: true,
      degradedHint: "Connect Meta Ads to see cost per booked",
      label: "cost per booked",
      comparator: { value: "—", target: targetLabel },
    };
  }
  if (bookings <= 0) {
    return {
      degraded: true,
      degradedHint: "No bookings attributed yet",
      label: "cost per booked",
      comparator: { value: "—", target: targetLabel },
    };
  }
  return {
    degraded: true,
    degradedHint: "",
    label: "cost per booked",
    comparator: { value: cacDisplay, target: targetLabel },
  };
})();
```

Leave the returned VM (hero `ad-leads`, `spark`, `stats`, `tiles`, `qualifiedPct`, `leads`, deltas, freshness) unchanged.

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `CI=true pnpm --filter @switchboard/core test metrics-riley`
Expected: PASS (20 tests).

- [ ] **Step 6: Typecheck core.**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS. (If it reports stale exports, run `pnpm reset` first.)

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/agent-home/metrics-riley.ts \
        packages/core/src/agent-home/__tests__/metrics-riley.test.ts
git commit -m "feat(core): compute riley roi as cost per booked"
```

---

## Task 2: Dashboard — thread `roi` through `selectKeyResult`

**Files:**

- Modify: `apps/dashboard/src/components/agent-panel/lib/key-result-state.ts`
- Test: `apps/dashboard/src/components/agent-panel/lib/__tests__/key-result-state.test.ts`

- [ ] **Step 1: Add the failing test.** In `key-result-state.test.ts`, the `vm()` helper builds a VM without `roi`. Extend it and add two assertions. Replace the `vm` helper (lines 8–14) with:

```ts
const vm = (over = {}) =>
  ({
    hero: { kind: "ad-leads", value: 32, comparator: {} },
    spendCents: 142000,
    targets: { targetCpbCents: 3500, avgValueCents: 38000 },
    roi: {
      degraded: true,
      degradedHint: "",
      label: "cost per booked",
      comparator: { value: "$44 per booked", target: "target $35" },
    },
    ...over,
  }) as any;
```

Then add, inside `describe("selectKeyResult")`:

```ts
it("threads roi into proof state (lifetime)", () => {
  const r = selectKeyResult({
    agentKey: "riley",
    halted: false,
    mission: undefined,
    all: slot(vm()),
    week: slot(vm()),
  });
  expect(r.kind === "proof" && r.roi?.comparator).toEqual({
    value: "$44 per booked",
    target: "target $35",
  });
});

it("threads roi into paused state", () => {
  const r = selectKeyResult({
    agentKey: "riley",
    halted: true,
    mission: undefined,
    all: slot(vm()),
    week: slot(vm()),
  });
  expect(r.kind === "paused" && r.roi?.label).toBe("cost per booked");
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `CI=true pnpm --filter @switchboard/dashboard test -- key-result-state`
Expected: FAIL — `roi` does not exist on the proof/paused state (TS + assertion failure).

- [ ] **Step 3: Add `roi` to the state type and selector.** In `key-result-state.ts`:

Add `roi` to the `paused` and `proof` variants of `KeyResultState`:

```ts
  | {
      kind: "paused";
      hero: MetricsViewModelWire["hero"] | null;
      spendCents: number | null;
      targets: MetricsViewModelWire["targets"] | null;
      roi: MetricsViewModelWire["roi"] | null;
      scope: "lifetime" | "week" | null;
    }
```

```ts
  | {
      kind: "proof";
      scope: "lifetime" | "week";
      hero: MetricsViewModelWire["hero"];
      spendCents: number | null;
      targets: MetricsViewModelWire["targets"];
      roi: MetricsViewModelWire["roi"] | null;
    };
```

In `selectKeyResult`, populate `roi` in all three return sites that build paused/proof:

- paused: add `roi: pick?.roi ?? null,`
- lifetime proof (`all.data`): add `roi: all.data.roi ?? null,`
- week proof (`week.data`): add `roi: week.data.roi ?? null,`

- [ ] **Step 4: Run to verify it passes.**

Run: `CI=true pnpm --filter @switchboard/dashboard test -- key-result-state`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/agent-panel/lib/key-result-state.ts \
        apps/dashboard/src/components/agent-panel/lib/__tests__/key-result-state.test.ts
git commit -m "feat(dashboard): thread roi through key-result state"
```

---

## Task 3: Dashboard — render server `roi` in `key-result.tsx`, delete `buildCplBeat`

**Files:**

- Modify: `apps/dashboard/src/components/agent-panel/key-result.tsx`
- Test: `apps/dashboard/src/components/agent-panel/__tests__/key-result.test.tsx`

- [ ] **Step 1: Update the test fixtures and rewrite the Riley comparator tests.** In `key-result.test.tsx`:

(a) Extend `makeMetricsVM` to accept a `roi` override. Add `roi?: unknown;` to the overrides type and add `roi: overrides.roi,` to the returned object (after `qualifiedDelta: null,`):

```ts
function makeMetricsVM(
  overrides: {
    kind?: "tours-booked" | "ad-leads" | "creatives-shipped" | "revenue-attributed";
    value?: number;
    spendCents?: number | null;
    targetCpbCents?: number | null;
    roi?: unknown;
  } = {},
) {
```

```ts
    qualifiedDelta: null,
    roi: overrides.roi,
  };
}
```

(b) Replace test 6 ("Riley CPL beat") with a cost-per-booked test that drives off the server `roi`, and add a blank-CAC test. Replace the entire `it("6. Riley CPL beat …")` block:

```ts
  // Riley ROI proof now comes from the server-computed roi.comparator (cost per booked).
  it("6. Riley roi proof — renders 'cost per booked' comparator, neutral, no green/red classes", () => {
    allData = makeMetricsVM({
      kind: "ad-leads",
      value: 32,
      roi: {
        degraded: true,
        degradedHint: "",
        label: "cost per booked",
        comparator: { value: "$44 per booked", target: "target $35" },
      },
    });
    render(<KeyResult agentKey="riley" />);

    expect(screen.getByText("$44 per booked · target $35")).toBeInTheDocument();

    const { container } = render(<KeyResult agentKey="riley" />);
    const allElements = container.querySelectorAll("[class]");
    allElements.forEach((el) => {
      const cls = el.className;
      expect(cls).not.toMatch(/\bup\b/);
      expect(cls).not.toMatch(/\bdown\b/);
      expect(cls).not.toMatch(/\bgood\b/);
      expect(cls).not.toMatch(/\bgreen\b/);
      expect(cls).not.toMatch(/\bred\b/);
    });
  });

  it("6b. Riley roi blank CAC (value '—') → renders NO comparator line", () => {
    allData = makeMetricsVM({
      kind: "ad-leads",
      value: 32,
      roi: {
        degraded: true,
        degradedHint: "No bookings attributed yet",
        label: "cost per booked",
        comparator: { value: "—", target: "target $35" },
      },
    });
    render(<KeyResult agentKey="riley" />);
    expect(screen.queryByText(/per booked/i)).not.toBeInTheDocument();
  });
```

> Note: the original test 6 ended with a `forEach` over class names followed by closing braces. Replace from `it("6. Riley CPL beat …` through its closing `});` (the end of that `it` block). Keep test 5 unchanged — its `queryByText(/per lead/i)` still correctly asserts no comparator while paused.

- [ ] **Step 2: Run to verify it fails.**

Run: `CI=true pnpm --filter @switchboard/dashboard test -- key-result.test`
Expected: FAIL — current `buildCplBeat` renders `"$44.38 per lead …"`, not `"$44 per booked · target $35"`.

- [ ] **Step 3: Edit `key-result.tsx`.**

(a) In the proof branch, change the destructure (current line 143) to drop now-unused `spendCents`/`targets` and add `roi`:

```ts
const { hero, scope, roi } = result;
```

(b) Replace the `cplBeat` computation (current lines 147–155) with:

```ts
// Riley's ROI proof = server-computed cost-per-booked comparator (single source of
// truth; the read-model owns the CAC math). Show only when a real value AND target
// exist — never gate on roi.degraded (Riley marks all ROI degraded), and never render
// a blank "— · target" line.
const hasRoiProof =
  !!roi && "comparator" in roi && roi.comparator.value !== "—" && roi.comparator.target !== "—";
const rileyRoiLine =
  agentKey === "riley" && hero.kind === "ad-leads" && hasRoiProof
    ? `${roi.comparator.value} · ${roi.comparator.target}`
    : null;
```

(c) Replace the render line (current line 176, `{cplBeat && …}`) with:

```ts
      {/* ROI comparator — neutral ink only, never green/red */}
      {rileyRoiLine && <p className={styles.heroComp}>{rileyRoiLine}</p>}
```

(d) Delete the `buildCplBeat` function (current lines 253–271, including its JSDoc) and remove the now-unused `formatCents` import (current line 9: `import { formatCents } from "./lib/format";`).

- [ ] **Step 4: Run to verify it passes.**

Run: `CI=true pnpm --filter @switchboard/dashboard test -- key-result.test`
Expected: PASS.

- [ ] **Step 5: Typecheck the dashboard** (catches unused-var / orphaned-import errors).

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/components/agent-panel/key-result.tsx \
        apps/dashboard/src/components/agent-panel/__tests__/key-result.test.tsx
git commit -m "feat(dashboard): render riley cost-per-booked roi comparator"
```

---

## Task 4: Refresh stale cockpit/lib `"cost per lead"` fixtures

These are sample RoiBar payloads in component/type tests (not assertions against `metrics-riley`). The components render `roi.label`/`roi.comparator` generically, so refreshing the strings does not break the style/testid assertions. Refresh so they don't mislead future readers.

**Files:**

- Modify: `apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx`
- Modify: `apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx`

- [ ] **Step 1: Replace the stale strings.** In all three files, within RoiBar fixture literals, change:
  - `label: "cost per lead"` → `label: "cost per booked"`
  - `value: "$4 per lead"` → `value: "$4 per booked"`
  - `value: "$7 per lead"` → `value: "$7 per booked"`

  (Leave `value: "—"` / `target: "—"` / `target: "target $5"` literals as-is.) Occurrence sites for reference: `metrics-types.test.ts:10-11`; `roi-bar.test.tsx:93-94,115-116`; `kpi-strip.test.tsx:103-104` (plus the two `value: "—"` fixtures whose `label` also reads `"cost per lead"`). Search to be exhaustive:

```bash
grep -rn "cost per lead\|per lead" \
  apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts \
  apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx \
  apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx
```

Update every match (label and comparator value). Do **not** touch any `/reports` or Mercury file.

- [ ] **Step 2: Run the three suites to verify they pass.**

Run: `CI=true pnpm --filter @switchboard/dashboard test -- roi-bar kpi-strip metrics-types`
Expected: PASS.

- [ ] **Step 3: Confirm no stray "per lead" remains in the cockpit fixtures.**

Run: `grep -rn "per lead" apps/dashboard/src/components/cockpit apps/dashboard/src/lib/cockpit`
Expected: no output.

- [ ] **Step 4: Commit.**

```bash
git add apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts \
        apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx \
        apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx
git commit -m "test(dashboard): refresh cockpit roi fixtures to cost per booked"
```

---

## Task 5: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Core + dashboard targeted tests green.**

Run:

```bash
CI=true pnpm --filter @switchboard/core test metrics-riley
CI=true pnpm --filter @switchboard/dashboard test -- key-result roi-bar kpi-strip metrics-types
```

Expected: all PASS.

- [ ] **Step 2: Typecheck both packages.**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS.

- [ ] **Step 3: Dashboard production build** (catches missing `.js`/import gaps — historically not relied on in CI; #803 added it, still run locally).

Run: `pnpm --filter @switchboard/dashboard build`
Expected: build succeeds.

- [ ] **Step 4: Prettier check** (CI lint runs prettier; local lint does not).

Run: `pnpm format:check`
Expected: no formatting diffs. If it reports any, run `pnpm format` and re-stage.

- [ ] **Step 5: Confirm no Riley "per lead" copy remains outside Mercury/Alex surfaces.**

Run: `grep -rn "per lead" apps/dashboard/src packages/core/src`
Expected: only Mercury `/reports` (`reports/**`, `results/campaigns-section`, `use-ad-optimizer`, landing `beat-riley`) and Alex's `home/` week-note remain — no Riley ROI / cockpit / agent-panel matches.

---

## Self-Review

- **Spec coverage:** Core CAC + relabel + degraded fallbacks (Task 1); units test #4 (Task 1, rule-4 case); zero-bookings test #5 (Task 1, rule-2 case); `EXCLUDE_STATUSES = ["cancelled"]` mirror #1 (Task 1 Step 4a); agent-panel proof plumbing + `hasRoiProof` #2 (Tasks 2–3); hint-in-roi-bar-not-hero #3 (Task 1 rule 2 + Task 3 `hasRoiProof` gate); fixture refreshes (Task 4); out-of-scope surfaces never touched (verified in Task 5 Step 5). All spec sections map to a task.
- **Placeholder scan:** none — every code step shows full code; commands have expected output.
- **Type consistency:** `EXCLUDE_STATUSES`, `cac`/`cacDisplay`, `targetLabel`, `roi`, `hasRoiProof`, `rileyRoiLine`, `bookingsThisWeek`, `makeMetricsVM(roi)` used consistently across tasks. `roi` added to both `paused` and `proof` `KeyResultState` variants and read in `key-result.tsx`.
