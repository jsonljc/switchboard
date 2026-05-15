# Riley Cockpit B.2b — KPI Strip + ROI Bar on `/riley` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Alex A.3's `<KPIStrip>` (`<KpiTile>` grid + `<ROIBar>`) on `/riley`, populated by `metrics-riley.ts` emitting `tiles[]` and `roi` natively (typed pass-through, not flat-to-explicit translation). Reuse `getAgentTargets` for `avgValueCents` / `targetCpbCents`. Parameterize `<KPIStrip>` / `<ROIBar>` with optional `accent?` defaults so Alex render is unchanged and Riley's mount applies clay tokens. Riley's ROI bar is always degraded (`RoiBarDegraded` shape) in v1 with a cost-per-lead comparator; no fill bar. Collapse to single-line headline when `approvals.length > 0` (same mount pattern A.3 used on `/alex`).

**Architecture:** Two layers move in lockstep. (1) **Core** extends `MetricsViewModel` with optional `tiles?: readonly KpiTile[]` and `roi?: RoiBar` and `metrics-riley.ts` populates them; Alex is untouched. (2) **Dashboard** mirrors the optional fields onto `MetricsViewModelWire`, adds a typed-pass-through adapter `metrics-to-kpi-data.ts` under `lib/cockpit/riley/**`, parameterizes accent on `<KPIStrip>` / `<ROIBar>`, and mounts `<KPIStrip>` between `<Identity>` and the approvals stack in `RileyCockpitPage`. No new Prisma columns. No new wire endpoints. No Alex render diff. No `legacyTiles` / `legacyRoi` import inside the Riley adapter.

**Tech Stack:** Vitest (all layers), TypeScript (ESM, `.js` extensions in relative imports per `CLAUDE.md`; dashboard imports omit `.js` per `feedback_dashboard_no_js_on_any_import`), Next.js 14 App Router + React 18 + `@tanstack/react-query` (dashboard), Riley clay accent (`RILEY_ACCENT` exported from `apps/dashboard/src/lib/cockpit/riley/riley-config.ts`).

**Parent docs:**
- [`docs/superpowers/plans/2026-05-15-riley-cockpit-b2b-slice-brief.md`](./2026-05-15-riley-cockpit-b2b-slice-brief.md) — scope, what-ships-vs-defers, decision lock, risks.
- [`docs/superpowers/plans/2026-05-14-alex-cockpit-a3-implementation.md`](./2026-05-14-alex-cockpit-a3-implementation.md) — precedent for shipped shell components, the `getAgentTargets` helper, and the dashboard adapter pattern.
- [`docs/superpowers/specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md`](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) — §Slice B.2 (authoritative contract; §B.2 "columns over config JSON" is overridden by A.3's decision lock — see slice brief §"Decision lock").
- [`docs/superpowers/specs/2026-05-13-riley-cockpit-home-design.md`](../specs/2026-05-13-riley-cockpit-home-design.md) — Riley target spec (KPI / ROI visual language).
- [`docs/superpowers/plans/2026-05-15-riley-cockpit-b3-implementation.md`](./2026-05-15-riley-cockpit-b3-implementation.md) — pattern source for `?: defaults` accent parameterization and the page-level test harness.

> **The slicing spec is authoritative**, except for §B.2's "columns over config JSON" sentence, which is overridden by Alex A.3's targets-in-config decision lock. If anything else in this plan expands B.2b's scope beyond the slice brief — Prisma migration, onboarding form, CTR live data, `RoiBarFull` shape on Riley, Alex render diff, new mutation paths — the spec/slice brief win and the conflicting text in this plan is wrong. Resolve in favor of the slice brief and flag the discrepancy.

---

## Precondition checks

Run before Task 1.

- [ ] **Step 0a: Confirm worktree, branch, and base.**

```bash
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
```

Expected: branch `feat/riley-cockpit-b2b` (created from `origin/main`, separate from the `docs/riley-cockpit-b2b-plan` branch this docs PR landed on). Status clean. The log shows zero commits (fresh branch).

- [ ] **Step 0b: Verify A.3 artifacts exist on `main`.**

```bash
ls apps/dashboard/src/components/cockpit/kpi-strip.tsx \
   apps/dashboard/src/components/cockpit/kpi-tile.tsx \
   apps/dashboard/src/components/cockpit/roi-bar.tsx \
   apps/dashboard/src/lib/cockpit/metrics-types.ts \
   apps/dashboard/src/lib/cockpit/metrics-to-kpi-input.ts \
   apps/dashboard/src/lib/cockpit/legacy-shapes.ts \
   apps/dashboard/src/hooks/use-agent-metrics.ts \
   packages/core/src/agent-home/targets.ts \
   packages/core/src/agent-home/metrics-types.ts \
   packages/core/src/agent-home/metrics-riley.ts
```

Expected: all 10 files exist. If any is missing, A.3 baseline has shifted — stop and investigate.

- [ ] **Step 0c: Verify the `MetricsViewModel` echo fields exist.**

```bash
grep -n "spendCents\|leads\|qualifiedPct\|bookedDelta\|leadsDelta\|qualifiedDelta\|targets" \
  packages/core/src/agent-home/metrics-types.ts
```

Expected: 7+ matches across the `MetricsViewModel` interface. These are the A.3 additions; B.2b builds on top of them.

- [ ] **Step 0d: Verify Riley's metrics view model emits the A.3 echo fields.**

```bash
grep -n "targets\|spendCents\|leads:\|qualifiedPct\|bookedDelta\|leadsDelta\|qualifiedDelta" \
  packages/core/src/agent-home/metrics-riley.ts
```

Expected: 7+ matches. Riley is already echoing the A.3 shape; B.2b adds `tiles` + `roi`.

- [ ] **Step 0e: Verify no KPIStrip mount exists on `/riley` yet.**

```bash
grep -n "KPIStrip\|kpi-strip\|useAgentMetrics" \
  apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx
```

Expected: zero matches. If matches appear, another PR has already started B.2b — stop and reconcile.

- [ ] **Step 0f: Verify baseline tests pass.**

```bash
pnpm --filter @switchboard/core test -- --run agent-home && \
  pnpm --filter @switchboard/dashboard test -- --run cockpit
```

Expected: green. The `prisma-work-trace-store-integrity` / `prisma-greeting-signal-store` flakes ([[feedback_db_integrity_tests_pg_advisory_lock]]) may be ignored if reproduced on the baseline branch.

---

## File Structure

### Files created

| Path | Responsibility |
|---|---|
| `apps/dashboard/src/lib/cockpit/riley/metrics-to-kpi-data.ts` | Pure `metricsViewModelToRileyKpiData(vm)` → `CockpitKpiData`. Typed pass-through: reads `vm.tiles` and `vm.roi` directly; constructs `range`. Does **not** invoke `legacyTiles` / `legacyRoi`. |
| `apps/dashboard/src/lib/cockpit/riley/__tests__/metrics-to-kpi-data.test.ts` | Unit tests. Three cases: pass-through tiles + roi; range format; absence of legacy-derivation fallback. |

### Files modified

| Path | Change | Why touched |
|---|---|---|
| `packages/core/src/agent-home/metrics-types.ts` | Add server-side `KpiTile` and `RoiBar` interfaces (structurally mirroring `apps/dashboard/src/components/cockpit/types.ts:115-143`). Add **optional** `tiles?: readonly KpiTile[]` and `roi?: RoiBar` to `MetricsViewModel`. | Wire shape for B.2b. |
| `packages/core/src/agent-home/metrics-riley.ts` | Populate `tiles` (3 entries: Leads / CTR unavailable / Ad spend) and `roi` (degraded shape with cost-per-lead comparator) in the returned VM. | Riley emission. |
| `packages/core/src/agent-home/__tests__/metrics-riley.test.ts` | Add `describe("tiles + roi (B.2b)", …)` block with 5 cases pinning the locked Riley tile and ROI shape across the four hint-priority rules. | Coverage. |
| `apps/dashboard/src/lib/cockpit/metrics-types.ts` | Mirror the optional `tiles?` + `roi?` fields onto `MetricsViewModelWire`. Add structural `KpiTileWire` + `RoiBarWire` types. | Keep dashboard mirror in sync. |
| `apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts` (if exists) or new `metrics-types.test.ts` | Add 1 case asserting `MetricsViewModelWire` admits optional `tiles` + `roi`. | Type-only coverage. |
| `apps/dashboard/src/components/cockpit/roi-bar.tsx` | Add optional `accent?: { base: string; deep: string; soft: string; paper: string }` prop. Default → Alex amber tokens. When provided: degraded chip border = `accent.soft`, degraded chip background = `accent.paper`, live "off-target" comparator color = `accent.deep`, live fill gradient = `${accent.soft} → ${accent.base}`. | Riley clay accent. |
| `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx` | Add 2 cases: default accent renders Alex amber tokens at the three sites (no current-render diff); Riley accent overrides all three sites. | Coverage. |
| `apps/dashboard/src/components/cockpit/kpi-strip.tsx` | Add optional `accent?: AccentTokens` prop. Forward to `<ROIBar>` only (KpiTile colors are token-driven via `T.ink*` and stay Alex-default — Riley tile colors match Alex grayscale; the accent affects only ROI comparator). | Accent plumbing. |
| `apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx` | Add 1 case asserting `accent` prop reaches `<ROIBar>` (use the ROI comparator data-attribute color assertion from `roi-bar.test.tsx` Riley case). | Coverage. |
| `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx` | Add `useAgentMetrics("riley")` call. Construct `kpis` shape from the adapter when data is present. Mount `<KPIStrip kpis={kpis} collapsed={approvals.length > 0} accent={RILEY_ACCENT} />` between the `<Identity>` element and the approvals stack, gated on `kpis != null`. | The visible mount. |
| `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` | Add `describe("RileyCockpitPage — B.2b KPI strip", …)` block with 3 cases (rendered when data present; collapsed when approvals.length > 0; not rendered when loading/error). | Page-level integration. |

### Files explicitly NOT modified

- `packages/core/src/agent-home/metrics-alex.ts` — Alex continues to emit flat fields only; `tiles` and `roi` are absent on Alex's VM. Alex dashboard path (`metricsViewModelToLegacyKpiInput` + `legacyTiles` / `legacyRoi`) is unchanged.
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` (Alex page) — no prop changes; defaults preserve current Alex render byte-for-byte.
- `apps/dashboard/src/lib/cockpit/legacy-shapes.ts` — Alex's flat-to-explicit derivation unchanged.
- `apps/dashboard/src/lib/cockpit/metrics-to-kpi-input.ts` — Alex's flat-shape adapter unchanged.
- `apps/dashboard/src/components/cockpit/kpi-tile.tsx` — tile rendering is token-driven via `T.ink*`; no accent change needed for the tile values themselves (Riley reuses Alex grayscale tile colors).
- `apps/dashboard/src/hooks/use-agent-metrics.ts` — already accepts `AgentKey = "alex" | "riley"`; no signature change.
- `apps/api/src/routes/agent-home/metrics.ts` — already loads roster, calls `getAgentTargets`, wires Meta spend provider; no code change. The `agentId === "riley"` branch already dispatches to `buildRileyMetricsViewModel` via `projectMetrics`.
- `apps/api/src/lib/meta-spend-provider.ts` — already wired structurally; reuses the `Connection` check. Riley spend flows the same path as Alex.
- `apps/dashboard/src/lib/cockpit/riley/recommendation-to-approval-view.ts` — B.1 adapter, irrelevant to KPI/ROI.
- `apps/dashboard/src/lib/cockpit/riley/riley-config.ts` — `RILEY_ACCENT` already exported (B.3); consumed as-is.
- `packages/db/prisma/schema.prisma` — targets live in `AgentRoster.config` JSON; no migration. No `db:check-drift` concern.

---

## Adapter boundary (unchanged from B.1)

B.2b adds **zero** new imports of `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit}` under `apps/dashboard/src/components/cockpit/**` or `apps/dashboard/src/hooks/**`. The new `metrics-to-kpi-data.ts` lives in `apps/dashboard/src/lib/cockpit/riley/**` and imports only `MetricsViewModelWire` from `@/lib/cockpit/metrics-types` and `CockpitKpiData` from `@/components/cockpit/types`. `useAgentMetrics` already consumes the wire `/api/dashboard/agents/[id]/metrics` route, not Prisma — exempt.

Pre-merge grep gate (Task 8):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: same set of matches as `main` before B.2b — no new matches outside `lib/cockpit/riley/**`.

---

## Riley tile + ROI tables (locked)

These tables are the canonical authorship reference. Task 2 (engine emission) and Task 7 (page mount + test fixtures) both refer back to them. **All copy descriptions observed deltas; never causal "Riley improved X" claims** (honest-impact-language guardrail).

### Riley tiles (always 3 tiles, in order)

| Index | Tile | Source |
|---|---|---|
| 0 | `{ label: "leads", value: heroValue, trend: bookedDelta ?? undefined }` | `heroValue = countConversionsByType("lead", weekStart, weekEnd)` (already computed); `bookedDelta = formatNumericDelta(heroValue, heroPrev)` (already computed). |
| 1 | `{ label: "ctr", value: "—", unavailable: true }` | Static. No `hint` — CTR needs `ad-platform-ctr` source, not Meta connection. |
| 2 | `spendCents === null ? { label: "ad spend", value: "—", unavailable: true, hint: "Connect Meta Ads" } : { label: "ad spend", value: \`$${Math.round(spendCents / 100)}\` }` | Match A.3 quirk: no `toLocaleString` on `legacyTiles[3]`. |

**Three tiles, not four.** No "qualified" tile (Riley does not qualify leads). The `qualifiedPct: 0` flat field is emitted unchanged for backward-compat with `MetricsViewModel`'s flat shape; it is not surfaced via `tiles[]`.

### Riley ROI bar (always degraded shape in v1)

Hint priority (first match wins; mirrors A.3 priority pattern):

| Rule | Condition | Returned `RoiBarDegraded` |
|---|---|---|
| 1 | `spendCents === null` | `{ degraded: true, degradedHint: "Connect Meta Ads to see cost per lead", label: "cost per lead", comparator: { value: "—", target: targetLabel } }` |
| 2 | `spendCents !== null && leads <= 0` | `{ degraded: true, degradedHint: "", label: "cost per lead", comparator: { value: "—", target: targetLabel } }` |
| 3 | `spendCents !== null && leads > 0 && targetCpbCents === null` | `{ degraded: true, degradedHint: "", label: "cost per lead", comparator: { value: \`$${cpl} per lead\`, target: "—" } }` |
| 4 | `spendCents !== null && leads > 0 && targetCpbCents !== null` | `{ degraded: true, degradedHint: "", label: "cost per lead", comparator: { value: \`$${cpl} per lead\`, target: \`target $${targetDollars}\` } }` |

Where:
- `cpl = Math.round(spendCents / 100 / leads)` — integer division.
- **`cplDisplay = cpl === 0 ? "<$1 per lead" : \`$${cpl} per lead\`"`** — avoids the misleading `$0 per lead` chip when very low spend × high leads round to zero. The threshold is sub-dollar; cpl ≥ 1 reads `$N per lead` normally.
- `targetDollars = Math.round(targetCpbCents / 100)`.
- `targetLabel` (rules 1 + 2) = `targetCpbCents !== null ? \`target $${targetDollars}\` : "—"` — the target chip echoes when known even in degraded modes.

The `onTarget` flag is omitted on `RoiBarDegraded` (the type permits `onTarget?: false` only; defaults are fine — the rendered chip has no on-target styling in degraded branches).

**Why always degraded.** v1 has no honest "return on ad spend" math for Riley — leads × `avgValueCents` would imply causal attribution that conflicts with the B.2 honest-impact-language guardrail. Riley grows `RoiBarFull` shape in a future slice when qualified-lead-rate × avg booking attribution can ship.

---

## Tasks

### Task 1: Extend `MetricsViewModel` with optional `tiles?` + `roi?` fields

**Files:**
- Modify: `packages/core/src/agent-home/metrics-types.ts`

- [ ] **Step 1: Write the failing test.**

Create `packages/core/src/agent-home/__tests__/metrics-types.test.ts` (or extend the existing one if present):

```ts
import { describe, expect, it } from "vitest";
import type { MetricsViewModel, KpiTile, RoiBar } from "../metrics-types.js";

describe("MetricsViewModel B.2b tiles + roi optional shape", () => {
  it("admits a KpiTile array under optional tiles", () => {
    const tile: KpiTile = { label: "leads", value: 27, trend: "+5" };
    const tiles: readonly KpiTile[] = [tile];
    // Type-only assertion — if the field is missing, this won't compile.
    const partial: Partial<MetricsViewModel> = { tiles };
    expect(partial.tiles).toEqual(tiles);
  });

  it("admits a RoiBar (degraded) under optional roi", () => {
    const roi: RoiBar = {
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: { value: "$4 per lead", target: "target $5" },
    };
    const partial: Partial<MetricsViewModel> = { roi };
    expect(partial.roi).toEqual(roi);
  });

  it("admits a RoiBar (full) under optional roi", () => {
    const roi: RoiBar = {
      label: "return on spend",
      leftMeta: "$200 spent",
      rightMeta: { value: "$1,000", suffix: " in tour value" },
      fillPct: 50,
      breakEvenPct: 16,
      breakEvenLabel: "break-even",
      scaleLeft: "$0",
      scaleRight: "6× spend",
      comparator: { value: "$7 per booking", target: "target $10", onTarget: true },
    };
    const partial: Partial<MetricsViewModel> = { roi };
    expect(partial.roi).toEqual(roi);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails.**

```bash
pnpm --filter @switchboard/core test -- --run metrics-types
```

Expected: TypeScript compilation error — `tiles` and `roi` are not in `MetricsViewModel`, and `KpiTile` / `RoiBar` are not exported.

- [ ] **Step 3: Add the types and the optional fields.**

Edit `packages/core/src/agent-home/metrics-types.ts`. Append before `export interface PerAgentBuilderInput`:

```ts
export interface KpiTile {
  label: string;
  value: number | string;
  unit?: string;
  trend?: string;
  unavailable?: boolean;
  hint?: string;
}

export interface RoiBarFull {
  label: string;
  leftMeta: string;
  rightMeta: { value: string; suffix: string };
  fillPct: number;
  breakEvenPct: number;
  breakEvenLabel: string;
  scaleLeft: string;
  scaleRight: string;
  comparator: { value: string; target: string; onTarget: boolean };
}

export interface RoiBarDegraded {
  degraded: true;
  degradedHint: string;
  label?: string;
  comparator: { value: string; target: string; onTarget?: false };
}

export type RoiBar = RoiBarFull | RoiBarDegraded;
```

In the existing `MetricsViewModel` interface, after `qualifiedDelta`, add:

```ts
  tiles?: readonly KpiTile[];
  roi?: RoiBar;
```

Verify the `metrics.ts` barrel re-exports the new types. Edit `packages/core/src/agent-home/metrics.ts` to extend the re-export list:

```ts
export type {
  ProseSegment,
  MetricComparator,
  HeroMetric,
  SparkPoint,
  StatCell,
  DataFreshness,
  MetricsViewModel,
  MetricsSignalStore,
  PerAgentBuilderInput,
  KpiTile,
  RoiBar,
  RoiBarFull,
  RoiBarDegraded,
} from "./metrics-types.js";
```

- [ ] **Step 4: Run the test and verify it passes.**

```bash
pnpm --filter @switchboard/core test -- --run metrics-types
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/agent-home/metrics-types.ts \
        packages/core/src/agent-home/metrics.ts \
        packages/core/src/agent-home/__tests__/metrics-types.test.ts
git commit -m "feat(core): MetricsViewModel.tiles + .roi optional fields (B.2b)"
```

---

### Task 2: Emit `tiles` + `roi` in `metrics-riley.ts`

**Files:**
- Modify: `packages/core/src/agent-home/metrics-riley.ts`
- Test: `packages/core/src/agent-home/__tests__/metrics-riley.test.ts`

- [ ] **Step 1: Write the failing tests.**

Append a new `describe` block to `packages/core/src/agent-home/__tests__/metrics-riley.test.ts`:

```ts
describe("buildRileyMetricsViewModel — tiles + roi (B.2b)", () => {
  const baseTargets = { avgValueCents: null, targetCpbCents: null };

  function tilesOf(vm: { tiles?: readonly { label: string; value: number | string; unavailable?: boolean; trend?: string; hint?: string }[] }) {
    return vm.tiles ?? [];
  }

  it("emits exactly 3 tiles: leads / ctr / ad spend", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 27, leadsLastWeek: 22 });
    (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(20000);
    const vm = await buildRileyMetricsViewModel({ orgId: "org-1", week, store, targets: baseTargets });
    const tiles = tilesOf(vm);
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toEqual({ label: "leads", value: 27, trend: "+5" });
    expect(tiles[1]).toEqual({ label: "ctr", value: "—", unavailable: true });
    expect(tiles[2]).toEqual({ label: "ad spend", value: "$200" });
  });

  it("tile[2] degrades to unavailable + 'Connect Meta Ads' hint when spendCents is null", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 27, leadsLastWeek: 22 });
    // store already returns null for spend by default
    const vm = await buildRileyMetricsViewModel({ orgId: "org-1", week, store, targets: baseTargets });
    expect(tilesOf(vm)[2]).toEqual({
      label: "ad spend",
      value: "—",
      unavailable: true,
      hint: "Connect Meta Ads",
    });
  });

  it("roi rule 1: spendCents === null → 'Connect Meta Ads to see cost per lead'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 27, leadsLastWeek: 22 });
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: { avgValueCents: null, targetCpbCents: 500 },
    });
    expect(vm.roi).toEqual({
      degraded: true,
      degradedHint: "Connect Meta Ads to see cost per lead",
      label: "cost per lead",
      comparator: { value: "—", target: "target $5" },
    });
  });

  it("roi rule 2: spendCents > 0 && leads === 0 → empty hint, comparator '—'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 0, leadsLastWeek: 0 });
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
      label: "cost per lead",
      comparator: { value: "—", target: "—" },
    });
  });

  it("roi rule 3: spendCents > 0 && leads > 0 && targetCpbCents === null → comparator '$N per lead', target '—'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 10, leadsLastWeek: 0 });
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
      label: "cost per lead",
      comparator: { value: "$20 per lead", target: "—" },
    });
  });

  it("roi sub-dollar guard: cpl rounds to 0 → '<$1 per lead', not '$0 per lead'", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 100, leadsLastWeek: 0 });
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
      label: "cost per lead",
      comparator: { value: "<$1 per lead", target: "target $5" },
    });
  });

  it("roi rule 4: spendCents > 0 && leads > 0 && targetCpbCents > 0 → live comparator + target", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const store = makeStore({ leadsThisWeek: 5, leadsLastWeek: 0 });
    (store.getMetaSpendCents as ReturnType<typeof vi.fn>).mockResolvedValue(12345);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store,
      targets: { avgValueCents: null, targetCpbCents: 1000 },
    });
    expect(vm.roi).toEqual({
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: { value: "$25 per lead", target: "target $10" },
    });
  });

  it("preserves the flat-shape qualifiedPct=0 placeholder for backward compat", async () => {
    const week = buildWeekContext(WED_NOW, TZ);
    const vm = await buildRileyMetricsViewModel({
      orgId: "org-1",
      week,
      store: makeStore({ leadsThisWeek: 27, leadsLastWeek: 22 }),
      targets: baseTargets,
    });
    expect(vm.qualifiedPct).toBe(0);
    // tiles must not surface qualified
    expect(tilesOf(vm).map((t) => t.label)).not.toContain("qualified");
  });
});
```

Notes for the test author: `makeStore` and `buildWeekContext` and `WED_NOW` are already imported at the top of `metrics-riley.test.ts`. The default-target value of `{ targetCpbCents: 500 }` in the rule-1 test produces `target $5` (`Math.round(500/100) = 5`).

- [ ] **Step 2: Run the tests and verify they fail.**

```bash
pnpm --filter @switchboard/core test -- --run metrics-riley
```

Expected: 7 new failures — `vm.tiles` and `vm.roi` are undefined.

- [ ] **Step 3: Implement.**

Edit `packages/core/src/agent-home/metrics-riley.ts`. Inside `buildRileyMetricsViewModel`, after the `stats` block and before the `return` statement, compute `tiles` and `roi`:

```ts
  const spendDollars = spendCents !== null ? Math.round(spendCents / 100) : null;
  const cpl =
    spendCents !== null && heroValue > 0 ? Math.round(spendCents / 100 / heroValue) : null;
  const cplDisplay = cpl === 0 ? "<$1 per lead" : cpl !== null ? `$${cpl} per lead` : "—";
  // Riley v1 reinterprets `targetCpbCents` as **target cost per lead** for the
  // ROI comparator. The config key is shared with Alex (target cost per
  // booking) for storage symmetry — `AgentRoster.config.targetCpbCents` is a
  // single value; the meaning is agent-side. Do not treat Riley's target as
  // booking economics until Riley has booking attribution (future slice).
  const targetDollars =
    targets.targetCpbCents !== null ? Math.round(targets.targetCpbCents / 100) : null;
  const targetLabel = targetDollars !== null ? `target $${targetDollars}` : "—";

  const tiles: readonly KpiTile[] = [
    {
      label: "leads",
      value: heroValue,
      ...(bookedDeltaStr ? { trend: bookedDeltaStr } : {}),
    },
    { label: "ctr", value: "—", unavailable: true },
    spendDollars !== null
      ? { label: "ad spend", value: `$${spendDollars}` }
      : { label: "ad spend", value: "—", unavailable: true, hint: "Connect Meta Ads" },
  ];

  const roi: RoiBar = (() => {
    // Rule 1: spendCents === null
    if (spendCents === null) {
      return {
        degraded: true,
        degradedHint: "Connect Meta Ads to see cost per lead",
        label: "cost per lead",
        comparator: { value: "—", target: targetLabel },
      };
    }
    // Rule 2: spendCents !== null && leads <= 0
    if (heroValue <= 0) {
      return {
        degraded: true,
        degradedHint: "",
        label: "cost per lead",
        comparator: { value: "—", target: targetLabel },
      };
    }
    // Rules 3 + 4: spendCents !== null && leads > 0
    return {
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: {
        value: cplDisplay,
        target: targetLabel,
      },
    };
  })();
```

The `bookedDeltaStr` referenced above must capture the existing `formatNumericDelta(heroValue, heroPrev)` result; today `metrics-riley.ts` inlines that call inside the `return`. Hoist it into a local variable:

```ts
  const bookedDeltaStr = formatNumericDelta(heroValue, heroPrev);
```

(Place it alongside the existing `leads` / `qualifiedPct` constants near line 53.)

Then update the existing `return` block:

```ts
  return {
    hero: { kind: "ad-leads", value: heroValue, comparator: { window: "week", value: heroPrev } },
    heroSubProseSegments: subprose,
    spark,
    stats,
    freshness: {
      generatedAt: week.now.toISOString(),
      window: "week",
      dataSource: "live",
      unavailableSources,
    },
    folioRange: week.folioRange,
    targets,
    spendCents,
    leads,
    qualifiedPct,
    bookedDelta: bookedDeltaStr,
    leadsDelta: bookedDeltaStr,
    qualifiedDelta: formatPercentPointsDelta(qualifiedPct, qualifiedPrev),
    tiles,
    roi,
  };
```

Add the imports at the top:

```ts
import type {
  MetricsSignalStore,
  MetricsViewModel,
  PerAgentBuilderInput,
  ProseSegment,
  SparkPoint,
  StatCell,
  KpiTile,
  RoiBar,
} from "./metrics-types.js";
```

- [ ] **Step 4: Run the tests and verify they pass.**

```bash
pnpm --filter @switchboard/core test -- --run metrics-riley
```

Expected: all green (including the existing B.1 / A.3 cases).

- [ ] **Step 5: Run the broader core test suite to catch regressions.**

```bash
pnpm --filter @switchboard/core test
```

Expected: green. The A.3 producer-side invariant test on `metrics-alex` continues to pass (Alex still has `tiles === undefined` / `roi === undefined`).

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/agent-home/metrics-riley.ts \
        packages/core/src/agent-home/__tests__/metrics-riley.test.ts
git commit -m "feat(core): metrics-riley emits tiles + degraded cost-per-lead roi (B.2b)"
```

---

### Task 3: Mirror `tiles?` + `roi?` onto `MetricsViewModelWire`

**Files:**
- Modify: `apps/dashboard/src/lib/cockpit/metrics-types.ts`
- Test: `apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test.**

Create or extend `apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  MetricsViewModelWire,
  KpiTileWire,
  RoiBarWire,
} from "../metrics-types";

describe("MetricsViewModelWire B.2b shape", () => {
  it("admits tiles + roi as optional fields", () => {
    const tile: KpiTileWire = { label: "leads", value: 27, trend: "+5" };
    const roi: RoiBarWire = {
      degraded: true,
      degradedHint: "",
      label: "cost per lead",
      comparator: { value: "$4 per lead", target: "target $5" },
    };
    const wire: Partial<MetricsViewModelWire> = {
      tiles: [tile],
      roi,
    };
    expect(wire.tiles).toHaveLength(1);
    expect(wire.roi).toEqual(roi);
  });
});
```

- [ ] **Step 2: Run the test.**

```bash
pnpm --filter @switchboard/dashboard test -- --run metrics-types
```

Expected: TS compilation failure — types don't exist.

- [ ] **Step 3: Mirror onto the wire shape.**

Edit `apps/dashboard/src/lib/cockpit/metrics-types.ts`:

```ts
export interface KpiTileWire {
  label: string;
  value: number | string;
  unit?: string;
  trend?: string;
  unavailable?: boolean;
  hint?: string;
}

export interface RoiBarFullWire {
  label: string;
  leftMeta: string;
  rightMeta: { value: string; suffix: string };
  fillPct: number;
  breakEvenPct: number;
  breakEvenLabel: string;
  scaleLeft: string;
  scaleRight: string;
  comparator: { value: string; target: string; onTarget: boolean };
}

export interface RoiBarDegradedWire {
  degraded: true;
  degradedHint: string;
  label?: string;
  comparator: { value: string; target: string; onTarget?: false };
}

export type RoiBarWire = RoiBarFullWire | RoiBarDegradedWire;

export interface MetricsViewModelWire {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
  folioRange: string;
  targets: MetricsTargets;
  spendCents: number | null;
  leads: number;
  qualifiedPct: number;
  bookedDelta: string | null;
  leadsDelta: string | null;
  qualifiedDelta: string | null;
  tiles?: readonly KpiTileWire[];
  roi?: RoiBarWire;
}
```

- [ ] **Step 4: Run the test and verify it passes.**

```bash
pnpm --filter @switchboard/dashboard test -- --run metrics-types
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/lib/cockpit/metrics-types.ts \
        apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts
git commit -m "feat(dashboard): mirror tiles + roi onto MetricsViewModelWire (B.2b)"
```

---

### Task 4: Add `accent?` prop to `<ROIBar>`

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/roi-bar.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx`

- [ ] **Step 1: Write the failing tests.**

Append to the existing `describe("<ROIBar>", …)` block:

```ts
  it("default accent renders Alex amber on degraded chip", () => {
    render(
      <ROIBar
        roi={{
          degraded: true,
          degradedHint: "",
          label: "cost per lead",
          comparator: { value: "$4 per lead", target: "target $5" },
        }}
      />,
    );
    const pill = screen.getByTestId("roi-comparator");
    // Default border/background come from T.hair / T.paper — no accent override.
    expect(pill).toHaveAttribute("data-on-target", "false");
  });

  it("Riley accent applies clay tokens to degraded chip border + background", () => {
    const RILEY_ACCENT = {
      base: "#B86C50",
      deep: "#7E4533",
      soft: "#ECD4C8",
      paper: "#F6E7DE",
    };
    render(
      <ROIBar
        roi={{
          degraded: true,
          degradedHint: "",
          label: "cost per lead",
          comparator: { value: "$4 per lead", target: "target $5" },
        }}
        accent={RILEY_ACCENT}
      />,
    );
    const pill = screen.getByTestId("roi-comparator");
    expect(pill).toHaveStyle({
      background: RILEY_ACCENT.paper,
      borderColor: RILEY_ACCENT.soft,
    });
  });

  it("Riley accent applies clay deep to live 'off-target' comparator color", () => {
    const RILEY_ACCENT = {
      base: "#B86C50",
      deep: "#7E4533",
      soft: "#ECD4C8",
      paper: "#F6E7DE",
    };
    render(
      <ROIBar
        roi={{
          ...fullRoi,
          comparator: { ...fullRoi.comparator, onTarget: false },
        }}
        accent={RILEY_ACCENT}
      />,
    );
    const pill = screen.getByTestId("roi-comparator");
    expect(pill).toHaveStyle({ color: RILEY_ACCENT.deep });
  });
```

- [ ] **Step 2: Run and verify they fail.**

```bash
pnpm --filter @switchboard/dashboard test -- --run roi-bar
```

Expected: 3 new failures — the `accent` prop is not yet recognized.

- [ ] **Step 3: Add the prop and apply at three sites.**

Edit `apps/dashboard/src/components/cockpit/roi-bar.tsx`:

```tsx
export interface AccentTokens {
  base: string;
  deep: string;
  soft: string;
  paper: string;
}

interface ROIBarProps {
  roi: RoiBar;
  accent?: AccentTokens;
}

export function ROIBar({ roi, accent }: ROIBarProps) {
  // Degraded branch: replace `T.paper` background + `T.hair` border with
  // accent tokens when provided.
  // Live branch: replace `T.amberDeep` off-target color + `${T.amberSoft} → ${T.amber}` gradient.
  // ...
}
```

Wire the three sites:

1. Degraded chip background + border:

```tsx
background: accent ? accent.paper : T.paper,
border: `1px solid ${accent ? accent.soft : T.hair}`,
```

2. Live "off-target" comparator color:

```tsx
color: onTarget ? T.green : accent ? accent.deep : T.amberDeep,
```

3. Live fill-bar gradient:

```tsx
background: `linear-gradient(90deg, ${accent ? accent.soft : T.amberSoft} 0%, ${accent ? accent.base : T.amber} 100%)`,
```

- [ ] **Step 4: Run and verify they pass.**

```bash
pnpm --filter @switchboard/dashboard test -- --run roi-bar
```

Expected: all green (including the pre-existing 7 cases).

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/roi-bar.tsx \
        apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx
git commit -m "feat(cockpit): optional accent prop on <ROIBar> for Riley clay tokens (B.2b)"
```

---

### Task 5: Plumb `accent?` through `<KPIStrip>`

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/kpi-strip.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx`

- [ ] **Step 1: Write the failing tests.**

Append to the existing `describe("<KPIStrip>", …)`:

```ts
  it("forwards accent prop through to <ROIBar>", () => {
    const RILEY_ACCENT = {
      base: "#B86C50",
      deep: "#7E4533",
      soft: "#ECD4C8",
      paper: "#F6E7DE",
    };
    render(
      <KPIStrip
        kpis={{
          range: "This week · Mon — Wed",
          tiles: [
            { label: "leads", value: 27, trend: "+5" },
            { label: "ctr", value: "—", unavailable: true },
            { label: "ad spend", value: "$200" },
          ],
          roi: {
            degraded: true,
            degradedHint: "",
            label: "cost per lead",
            comparator: { value: "$7 per lead", target: "target $5" },
          },
        }}
        accent={RILEY_ACCENT}
      />,
    );
    const pill = screen.getByTestId("roi-comparator");
    expect(pill).toHaveStyle({
      background: RILEY_ACCENT.paper,
      borderColor: RILEY_ACCENT.soft,
    });
  });

  it("exposes data-testid='kpi-strip' on the root container (expanded mode)", () => {
    render(
      <KPIStrip
        kpis={{
          range: "This week · Mon — Wed",
          tiles: [{ label: "leads", value: 27 }],
          roi: { degraded: true, degradedHint: "", label: "cost per lead", comparator: { value: "—", target: "—" } },
        }}
      />,
    );
    expect(screen.getByTestId("kpi-strip")).toBeInTheDocument();
  });

  it("exposes data-testid='kpi-strip' on the root container (collapsed mode)", () => {
    render(
      <KPIStrip
        collapsed
        kpis={{
          range: "This week · Mon — Wed",
          tiles: [{ label: "leads", value: 27 }],
          roi: { degraded: true, degradedHint: "", label: "cost per lead", comparator: { value: "—", target: "—" } },
        }}
      />,
    );
    expect(screen.getByTestId("kpi-strip")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run and verify it fails.**

```bash
pnpm --filter @switchboard/dashboard test -- --run kpi-strip
```

Expected: 1 new failure — `accent` not a recognized prop.

- [ ] **Step 3: Add the prop and forward.**

Edit `apps/dashboard/src/components/cockpit/kpi-strip.tsx`:

```tsx
import type { AccentTokens } from "./roi-bar";

interface KPIStripProps {
  kpis: CockpitKpiData;
  collapsed?: boolean;
  accent?: AccentTokens;
}

export function KPIStrip({ kpis, collapsed = false, accent }: KPIStripProps) {
  // ... (existing logic unchanged) ...
  {roi ? <ROIBar roi={roi} accent={accent} /> : null}
```

`AccentTokens` is exported from `roi-bar.tsx` in Task 4.

**Additionally, add `data-testid="kpi-strip"` to the root `<div>` of both render branches** (collapsed and expanded) inside `KPIStrip`. This enables scoped DOM assertions in Task 7's "no `qualified` leak" regression — without scoping, the assertion would false-pass against the activity stream's `QUALIFIED` activity-kind label (`kind-meta.ts:18`). Both branches share the same testid; the collapsed assertion in Task 7 reads "expanded or collapsed strip mounted; no `qualified` label inside it."

```tsx
// Collapsed branch
<div data-testid="kpi-strip" style={{ /* existing collapsed styles */ }}>
  {/* ... */}
</div>

// Expanded branch
<div data-testid="kpi-strip" style={{ /* existing expanded styles */ }}>
  {/* ... */}
</div>
```

- [ ] **Step 4: Run and verify it passes.**

```bash
pnpm --filter @switchboard/dashboard test -- --run kpi-strip
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/kpi-strip.tsx \
        apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx
git commit -m "feat(cockpit): forward accent prop from <KPIStrip> to <ROIBar> (B.2b)"
```

---

### Task 6: Add `metrics-to-kpi-data.ts` adapter

**Files:**
- Create: `apps/dashboard/src/lib/cockpit/riley/metrics-to-kpi-data.ts`
- Test: `apps/dashboard/src/lib/cockpit/riley/__tests__/metrics-to-kpi-data.test.ts`

- [ ] **Step 1: Write the failing tests.**

Create `apps/dashboard/src/lib/cockpit/riley/__tests__/metrics-to-kpi-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { metricsViewModelToRileyKpiData } from "../metrics-to-kpi-data";
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";

// Riley adapter is strict — no legacy-shape fallback. If tiles or roi are
// missing on the wire, the adapter returns null and the page renders no KPI
// strip. This guards against Alex's `qualified` tile leaking into /riley via
// `legacyTiles()` derivation.

const baseWire: MetricsViewModelWire = {
  hero: { kind: "ad-leads", value: 27, comparator: { window: "week", value: 22 } },
  heroSubProseSegments: [{ kind: "text", text: "+5 from last week." }],
  spark: [],
  stats: [
    { label: "Leads", display: "27", rawValue: 27, unit: "count" },
    { label: "CTR", display: "—", rawValue: null, unit: "percent", unavailable: true },
    { label: "Spend", display: "$200", rawValue: 20000, unit: "currency", unavailable: false },
  ],
  freshness: {
    generatedAt: "2026-05-06T07:30:00.000Z",
    window: "week",
    dataSource: "live",
  },
  folioRange: "Mon — Wed",
  targets: { avgValueCents: null, targetCpbCents: 500 },
  spendCents: 20000,
  leads: 27,
  qualifiedPct: 0,
  bookedDelta: "+5",
  leadsDelta: "+5",
  qualifiedDelta: null,
  tiles: [
    { label: "leads", value: 27, trend: "+5" },
    { label: "ctr", value: "—", unavailable: true },
    { label: "ad spend", value: "$200" },
  ],
  roi: {
    degraded: true,
    degradedHint: "",
    label: "cost per lead",
    comparator: { value: "$7 per lead", target: "target $5" },
  },
};

describe("metricsViewModelToRileyKpiData", () => {
  it("passes tiles through unchanged (typed pass-through)", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect(out).not.toBeNull();
    expect(out!.tiles).toEqual(baseWire.tiles);
  });

  it("passes roi through unchanged", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect(out).not.toBeNull();
    expect(out!.roi).toEqual(baseWire.roi);
  });

  it("formats range as 'This week · {folioRange}'", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect(out!.range).toBe("This week · Mon — Wed");
  });

  it("does not surface qualifiedPct as a tile (Riley has no qualified concept)", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect((out!.tiles ?? []).map((t) => t.label)).not.toContain("qualified");
  });

  it("does not populate the Alex-flat fields (booked/leads/avgValue/target)", () => {
    const out = metricsViewModelToRileyKpiData(baseWire);
    expect(out!.booked).toBeUndefined();
    expect(out!.avgValue).toBeUndefined();
    expect(out!.target).toBeUndefined();
  });

  it("returns null when vm.tiles is missing (no legacy-shape fallback)", () => {
    const { tiles: _omit, ...wireWithoutTiles } = baseWire;
    const out = metricsViewModelToRileyKpiData(wireWithoutTiles as MetricsViewModelWire);
    expect(out).toBeNull();
  });

  it("returns null when vm.roi is missing (no legacy-shape fallback)", () => {
    const { roi: _omit, ...wireWithoutRoi } = baseWire;
    const out = metricsViewModelToRileyKpiData(wireWithoutRoi as MetricsViewModelWire);
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails.**

```bash
pnpm --filter @switchboard/dashboard test -- --run metrics-to-kpi-data
```

Expected: module not found.

- [ ] **Step 3: Create the adapter.**

Create `apps/dashboard/src/lib/cockpit/riley/metrics-to-kpi-data.ts`:

```ts
import type { MetricsViewModelWire } from "@/lib/cockpit/metrics-types";
import type { CockpitKpiData } from "@/components/cockpit/types";

/**
 * Strict, typed pass-through. Returns null when the wire VM lacks `tiles` or
 * `roi` — the cockpit page renders no KPI strip in that case rather than
 * falling back to Alex's `legacyTiles()` derivation (which would leak a
 * `qualified` tile onto /riley).
 */
export function metricsViewModelToRileyKpiData(
  vm: MetricsViewModelWire,
): CockpitKpiData | null {
  if (!vm.tiles || !vm.roi) return null;
  return {
    range: `This week · ${vm.folioRange}`,
    tiles: [...vm.tiles],
    roi: vm.roi,
  };
}
```

Note: `[...vm.tiles]` materializes the readonly wire array into a mutable `KpiTile[]` to match the `CockpitKpiData.tiles?: KpiTile[]` declared (non-readonly) type at `apps/dashboard/src/components/cockpit/types.ts:147`.

- [ ] **Step 4: Run and verify it passes.**

```bash
pnpm --filter @switchboard/dashboard test -- --run metrics-to-kpi-data
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/lib/cockpit/riley/metrics-to-kpi-data.ts \
        apps/dashboard/src/lib/cockpit/riley/__tests__/metrics-to-kpi-data.test.ts
git commit -m "feat(dashboard): Riley metrics→kpi-data typed pass-through adapter (B.2b)"
```

---

### Task 7: Mount `<KPIStrip>` on `<RileyCockpitPage>`

**Files:**
- Modify: `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`
- Test: `apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx`

- [ ] **Step 1: Write the failing tests.**

Append a new `describe` block in `riley-cockpit-page.test.tsx`. The existing module-level mocks for `useHalt` / `useRileyApprovals` / `useRileyStatus` / `useRileyActivity` are reused. Add a new mock for `useAgentMetrics` at the top of the file (before any test):

```ts
import { within } from "@testing-library/react";

const metricsState: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = {
  data: null,
  isLoading: false,
  isError: false,
  error: null,
};
vi.mock("@/hooks/use-agent-metrics", () => ({
  useAgentMetrics: () => metricsState,
}));
```

The mock mirrors the four fields the real hook returns (`apps/dashboard/src/hooks/use-agent-metrics.ts:34-39`): `data`, `isLoading`, `isError`, `error`. A future refactor that reads `metricsQ.error` will see a fresh `null` rather than `undefined`.

Then the new block:

```ts
describe("RileyCockpitPage — B.2b KPI strip", () => {
  // Local fixture builder — reused across cases. The wire shape mirrors
  // MetricsViewModelWire; minimal fields populated to satisfy the page render.
  function buildMetricsFixture(overrides: Partial<{ tiles: unknown; roi: unknown }> = {}) {
    const base = {
      hero: { kind: "ad-leads" as const, value: 27, comparator: { window: "week" as const, value: 22 } },
      heroSubProseSegments: [],
      spark: [],
      stats: [],
      freshness: { generatedAt: "x", window: "week" as const, dataSource: "live" as const },
      folioRange: "Mon — Wed",
      targets: { avgValueCents: null, targetCpbCents: null },
      spendCents: 20000,
      leads: 27,
      qualifiedPct: 0,
      bookedDelta: "+5",
      leadsDelta: "+5",
      qualifiedDelta: null,
      tiles: [
        { label: "leads", value: 27, trend: "+5" },
        { label: "ctr", value: "—", unavailable: true },
        { label: "ad spend", value: "$200" },
      ],
      roi: {
        degraded: true as const,
        degradedHint: "",
        label: "cost per lead",
        comparator: { value: "$7 per lead", target: "—" },
      },
    };
    return { ...base, ...overrides };
  }

  beforeEach(() => {
    rileyApprovalsState.approvals = [];
    rileyActivityState.rows = []; // prevent activity-kind="qualified" rows from polluting the no-qualified assertion
    metricsState.data = null;
    metricsState.isLoading = false;
    metricsState.isError = false;
    metricsState.error = null;
  });

  it("renders <KPIStrip> in expanded mode when metrics data exists and no approvals", () => {
    metricsState.data = buildMetricsFixture();
    wrap(<RileyCockpitPage />);
    const strip = screen.getByTestId("kpi-strip");
    expect(within(strip).getByText("$200")).toBeInTheDocument();
    expect(within(strip).getByText(/cost per lead/i)).toBeInTheDocument();
    expect(within(strip).getByText("$7 per lead")).toBeInTheDocument();
  });

  it("collapses to single-line headline when approvals.length > 0", () => {
    rileyApprovalsState.approvals = mapRecommendationsToApprovalViews(pauseFixture);
    metricsState.data = buildMetricsFixture();
    wrap(<RileyCockpitPage />);
    const strip = screen.getByTestId("kpi-strip");
    // Collapsed headline is "27 leads · +5 from last week" (driven by collapsedHeadline()).
    expect(within(strip).getByText(/27/)).toBeInTheDocument();
    expect(within(strip).getByText(/leads/i)).toBeInTheDocument();
  });

  it("renders nothing for KPI strip when metrics is loading or errored", () => {
    metricsState.isLoading = true;
    wrap(<RileyCockpitPage />);
    expect(screen.queryByTestId("kpi-strip")).not.toBeInTheDocument();
  });

  it("renders nothing for KPI strip when wire VM is missing tiles (no Alex fallback)", () => {
    // Adapter returns null when tiles is missing; page renders no strip.
    const { tiles: _omit, ...withoutTiles } = buildMetricsFixture();
    metricsState.data = withoutTiles;
    wrap(<RileyCockpitPage />);
    expect(screen.queryByTestId("kpi-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("roi-comparator")).not.toBeInTheDocument();
  });

  it("hard regression: KPI strip never renders a 'qualified' label (no legacy leak)", () => {
    // Even with full live data, no qualified tile should appear inside the
    // strip — Riley is not qualifying leads. The assertion is scoped to the
    // strip subtree via data-testid so it cannot false-pass on (a) the
    // ActivityStream's `QUALIFIED` activity-kind label (kind-meta.ts:18), nor
    // (b) an empty render where the strip never mounted.
    metricsState.data = buildMetricsFixture();
    wrap(<RileyCockpitPage />);
    const strip = screen.getByTestId("kpi-strip"); // positive presence — fails fast if missing
    expect(within(strip).queryByText(/qualified/i)).not.toBeInTheDocument();
  });

  it("applies RILEY_ACCENT to the ROI comparator chip", () => {
    metricsState.data = buildMetricsFixture();
    wrap(<RileyCockpitPage />);
    const pill = screen.getByTestId("roi-comparator");
    expect(pill).toHaveStyle({ background: "#F6E7DE" }); // RILEY_ACCENT.paper
  });
});
```

The collapsed-mode test uses `mapRecommendationsToApprovalViews(pauseFixture)` directly — both `pauseFixture` and `mapRecommendationsToApprovalViews` are already imported at the top of the test file (B.1 fixtures, kept across B.3). The `within()` helper from `@testing-library/react` is imported alongside the existing `render` / `screen` / `fireEvent`.

- [ ] **Step 2: Run and verify they fail.**

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-cockpit-page
```

Expected: 4 new failures.

- [ ] **Step 3: Wire the page.**

Edit `apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx`. Imports:

```tsx
import { KPIStrip } from "./kpi-strip";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { metricsViewModelToRileyKpiData } from "@/lib/cockpit/riley/metrics-to-kpi-data";
import type { CockpitKpiData } from "./types";
```

Inside `RileyCockpitPage`:

```tsx
const metricsQ = useAgentMetrics("riley");

// Adapter returns null when the wire VM is missing tiles or roi —
// the page mount gates on this and renders no KPI strip rather than
// falling back to Alex's `legacyTiles()` derivation. See
// metrics-to-kpi-data.ts for the strict no-fallback rationale.
const kpis: CockpitKpiData | null = metricsQ.data
  ? metricsViewModelToRileyKpiData(metricsQ.data)
  : null;
```

Mount between `<Identity>` (close tag) and the existing `approvals.length > 0` block:

```tsx
{kpis ? <KPIStrip kpis={kpis} collapsed={approvals.length > 0} accent={RILEY_ACCENT} /> : null}
{approvals.length > 0 && (
  <div ...>
    {/* … existing RileyApprovalRow mapping … */}
  </div>
)}
```

`RILEY_ACCENT` is already imported from `@/lib/cockpit/riley/riley-config` (used by `RILEY_APPROVAL_ACCENT` at line 29).

- [ ] **Step 4: Run and verify they pass.**

```bash
pnpm --filter @switchboard/dashboard test -- --run riley-cockpit-page
```

Expected: all green (including B.1 / B.3 cases).

- [ ] **Step 5: Run the broader dashboard cockpit suite.**

```bash
pnpm --filter @switchboard/dashboard test -- --run cockpit
```

Expected: green (including kpi-strip, kpi-tile, roi-bar, identity, status-pill, composer-placeholder, approval-card, riley-cockpit-page).

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/components/cockpit/riley-cockpit-page.tsx \
        apps/dashboard/src/components/cockpit/__tests__/riley-cockpit-page.test.tsx
git commit -m "feat(riley-cockpit): mount KPI strip + ROI bar on /riley with clay accent (B.2b)"
```

---

### Task 8: Adapter-boundary grep gate

**Files:** none modified — verification only.

- [ ] **Step 1: Run the grep.**

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks > /tmp/b2b-after.txt

git stash  # if needed to compare against main; or just compare against origin/main
git checkout origin/main -- apps/dashboard/src/components/cockpit apps/dashboard/src/hooks
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks > /tmp/b2b-baseline.txt
git checkout HEAD -- apps/dashboard/src/components/cockpit apps/dashboard/src/hooks
git stash pop  # if applicable

diff /tmp/b2b-baseline.txt /tmp/b2b-after.txt
```

Expected: no diff. If new matches appear under `components/cockpit/**` or `hooks/**`, an import slipped past the boundary — move it under `lib/cockpit/riley/**` or rework to consume only view-model types.

- [ ] **Step 2: Document the gate result.**

Note in the eventual PR body: "Adapter-boundary grep — no new matches vs `main` baseline."

---

### Task 9: Full verification gate

**Files:** none modified — verification only.

- [ ] **Step 1: Typecheck the whole repo.**

```bash
pnpm typecheck
```

Expected: green. If errors mention `tiles` / `roi` / `KpiTile` exports, run `pnpm reset` first (per `CLAUDE.md` build-cache instructions) and re-run.

- [ ] **Step 2: Lint.**

```bash
pnpm lint
```

Expected: green.

- [ ] **Step 3: Test the touched packages.**

```bash
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/dashboard test
```

Expected: green (ignoring the pre-existing `prisma-work-trace-store-integrity` / `prisma-greeting-signal-store` flakes if reproduced on baseline).

- [ ] **Step 4: Build the dashboard.** *(Required — CI doesn't run `next build`; this catches `.js`-extension regressions and other build-time issues per [[feedback_dashboard_build_not_in_ci]] / [[feedback_dashboard_no_js_on_any_import]].)*

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: green.

- [ ] **Step 5: Smoke-check the route locally.**

```bash
pnpm dev
# Wait for api on :3000 and dashboard on :3002 to come up; open http://localhost:3002/riley.
```

Verify in the browser:
- KPI strip renders between the mission line and the activity stream when no approvals are pending.
- The three tiles read "leads", "ctr —", "ad spend — / $N".
- The ROI bar reads "cost per lead" with a comparator chip ("$N per lead · target $M" or "—").
- The chip uses Riley clay (warm-brown background `#F6E7DE`) not Alex amber.
- When pending Riley approvals exist, the strip collapses to a single-line headline above the approval cards.
- The `Connect Meta Ads →` hint button is visually present when spendCents is null; click-inert (A.5 dep).

If Postgres is not running locally and the API can't serve metrics, the dashboard renders without the strip — that is the loading/error state covered by the page test. To exercise the strip locally, seed the database with at least one Riley conversion-row for the current week and a `Connection { status: "connected" }` for Meta Ads (or stub the route response in `apps/api`).

---

## Pre-merge checklist

- [ ] Slice brief on `main` (this docs PR merged first via the umbrella docs PR pattern, or alongside as B.3 did).
- [ ] All 9 tasks complete; all checkbox steps marked.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm --filter @switchboard/core test` clean.
- [ ] `pnpm --filter @switchboard/dashboard test` clean.
- [ ] `pnpm --filter @switchboard/dashboard build` clean.
- [ ] Adapter-boundary grep matches baseline.
- [ ] Local browser smoke at `/riley`: KPI strip mounts, Riley clay accent, collapsed-with-approvals behavior verified.
- [ ] No Alex render diff: open `/alex` and verify the KPI strip + ROI bar render identically to the A.3 baseline.
- [ ] PR description names the honest-impact-language guardrail and confirms no causal-impact copy.
- [ ] PR body cross-links A.3 (#500), B.3 (#499/#507), and the slice brief.

---

## Commit message recap (for the eventual feature PR)

Tasks 1–7 each produce one commit. **Tasks 8 (adapter-boundary grep) and 9 (full verification gate) produce no commits** — they are pre-merge verification gates only.

The 7 commits in order:

1. `feat(core): MetricsViewModel.tiles + .roi optional fields (B.2b)`
2. `feat(core): metrics-riley emits tiles + degraded cost-per-lead roi (B.2b)`
3. `feat(dashboard): mirror tiles + roi onto MetricsViewModelWire (B.2b)`
4. `feat(cockpit): optional accent prop on <ROIBar> for Riley clay tokens (B.2b)`
5. `feat(cockpit): forward accent prop from <KPIStrip> to <ROIBar> (B.2b)`
6. `feat(dashboard): Riley metrics→kpi-data typed pass-through adapter (B.2b)`
7. `feat(riley-cockpit): mount KPI strip + ROI bar on /riley with clay accent (B.2b)`

Squash-merge title: `feat(riley-cockpit): B.2b — KPI strip + ROI bar on /riley`.

---

## What comes after B.2b

- **B.2-spec amendment** (post-PR-#497-merge) — small docs PR amending Riley slicing §B.2 / §B.2 acceptance / §Backend-changes-by-slice to read "targets via config JSON keys, reuse `getAgentTargets`."
- **Riley qualified-lead-rate attribution** (future) — move Riley ROI from `RoiBarDegraded` to `RoiBarFull` once honest tour-value attribution math ships.
- **CTR signal source** — when `ad-platform-ctr` ships, tile[1] becomes live.
- **B.3-followup** (post-Alex-A.5) — wire `RILEY_COMMANDS` into the shared `<CommandPalette>`; independent of B.2b.
