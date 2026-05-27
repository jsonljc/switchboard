# Alex Cockpit A.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Slice brief is authoritative.** See [`2026-05-15-alex-cockpit-a3-slice-brief.md`](./2026-05-15-alex-cockpit-a3-slice-brief.md). Where this plan conflicts with the brief, the brief wins.

**Goal:** Ship Alex's KPI strip + ROI bar at `/alex`, wire `AgentRoster.config`-based target persistence via the canonical `getAgentTargets` helper, and surface Meta Ads spend through the metrics endpoint without leaking ad-optimizer dependencies into `packages/core`.

**Architecture:** Three-layer cut. (1) `packages/core/src/agent-home/` gains `targets.ts` + an extended `MetricsSignalStore` interface + echo fields on `MetricsViewModel`; `metrics-alex.ts` and `metrics-riley.ts` emit those echoes from the resolved targets and an injected `getMetaSpendCents` store method. (2) `apps/api/src/routes/agent-home/metrics.ts` loads `AgentRoster`, calls `getAgentTargets(roster)`, and builds a `getMetaSpendCents` impl backed by `meta-campaign-insights-provider` from `@switchboard/ad-optimizer`. (3) `apps/dashboard` ports `legacyTiles`/`legacyRoi`/`collapsedHeadline` from the locked-design reference into a `legacy-shapes.ts` adapter, adds `<KpiTile>` / `<KPIStrip>` / `<ROIBar>` components, and mounts the strip at the A.1-marked insertion point in `cockpit-page.tsx`.

**Tech Stack:** TypeScript ESM, Fastify, Prisma, Next.js 14 App Router, React Query, Vitest. Dashboard imports omit `.js` extensions (per `feedback_dashboard_no_js_on_any_import`); all other packages use `.js` extensions in relative imports.

---

## Pre-flight verification (do these before Task 1)

Run from the worktree root after `pnpm worktree:init`:

```bash
git fetch origin main && git log -1 origin/main --oneline
# Expect: latest A.2-era commit; A.3 base.
git branch --show-current
# Expect: feat/alex-cockpit-a3
pnpm install
pnpm build
pnpm typecheck
# Expect: green. If "missing exports from @switchboard/schemas/db/core" → pnpm reset.
```

Verify spec assumptions:

```bash
# Confirm Connection.serviceId convention for Meta Ads is "meta-ads"
rg 'serviceId.*"meta-ads"' apps/api/src --type ts | head -5
# Expect: multiple matches in api-connections.test.ts — canonical value.

# Confirm metrics-alex shape matches plan expectations
sed -n '60,90p' packages/core/src/agent-home/metrics-alex.ts
# Expect: returns { hero, heroSubProseSegments, spark, stats, freshness, folioRange }.

# Verify folioRange format for the eyebrow decision
rg 'folioRange|formatTimeFolio' packages/core/src/agent-home --type ts -l
sed -n '1,40p' packages/core/src/agent-home/time-folio.ts
# If folioRange already produces "May 12 – May 18" style, prefix client-side with "This week · ".
# If not, plan task 9 below adds rangeShort to MetricsViewModel.

# Verify CampaignInsight.spend numeric unit (dollars vs cents)
rg 'spend.*number|sum.*spend|i\.spend' packages/ad-optimizer/src --type ts | head -10
# Meta Marketing API returns spend as decimal dollars. Conversion to cents is on the apps/api side.
```

If any of the above diverges from the plan's assumption, stop and update the plan before coding.

---

## File Structure

### Created files

- `packages/core/src/agent-home/targets.ts` — `getAgentTargets(roster)`.
- `packages/core/src/agent-home/__tests__/targets.test.ts`
- `packages/core/src/agent-home/__tests__/targets-convention.test.ts` — grep-based convention check.
- `apps/api/src/lib/meta-spend-provider.ts` — `buildMetaSpendProvider(prisma, adsClientFactory)`.
- `apps/api/src/__tests__/meta-spend-provider.test.ts`
- `apps/dashboard/src/lib/cockpit/legacy-shapes.ts` — port of `legacyTiles` / `legacyRoi` / `collapsedHeadline`.
- `apps/dashboard/src/lib/cockpit/__tests__/legacy-shapes.test.ts`
- `apps/dashboard/src/lib/cockpit/metrics-to-kpi-input.ts` — adapter from wire `MetricsViewModel` to `LegacyKpiInput`.
- `apps/dashboard/src/lib/cockpit/__tests__/metrics-to-kpi-input.test.ts`
- `apps/dashboard/src/lib/cockpit/metrics-types.ts` — dashboard-local mirror of extended wire shape.
- `apps/dashboard/src/components/cockpit/kpi-tile.tsx`
- `apps/dashboard/src/components/cockpit/__tests__/kpi-tile.test.tsx`
- `apps/dashboard/src/components/cockpit/kpi-strip.tsx`
- `apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx`
- `apps/dashboard/src/components/cockpit/roi-bar.tsx`
- `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx`

### Modified files

- `packages/core/src/agent-home/metrics-types.ts` — extend `MetricsSignalStore`, `PerAgentBuilderInput`, `MetricsViewModel`.
- `packages/core/src/agent-home/metrics-alex.ts` — emit `targets`, `spendCents`, `bookedDelta`, `leadsDelta`, `qualifiedDelta`, `leads`, `qualifiedPct` echoes.
- `packages/core/src/agent-home/metrics-riley.ts` — same echo extension (additive only).
- `packages/core/src/agent-home/index.ts` — export `getAgentTargets` and new types.
- `packages/core/src/agent-home/__tests__/metrics-alex.test.ts` — cover new emissions + `getMetaSpendCents` store calls.
- `packages/core/src/agent-home/__tests__/metrics-riley.test.ts` — same.
- `packages/core/src/agent-home/__tests__/metrics.test.ts` — store mock gains `getMetaSpendCents`.
- `apps/api/src/routes/agent-home/metrics.ts` — load `AgentRoster`, compute `targets`, wire `getMetaSpendCents`.
- `apps/api/src/__tests__/api-metrics.test.ts` — new test cases for targets + spend.
- `apps/dashboard/src/components/cockpit/types.ts` — add `KpiTile`, `RoiBarFull`, `RoiBarDegraded`, `RoiBar`, `CockpitKpiData`.
- `apps/dashboard/src/components/cockpit/cockpit-page.tsx` — call `useAgentMetrics("alex")`, mount `<KPIStrip>` at the A.1 insertion comment.
- `apps/dashboard/src/hooks/use-agent-metrics.ts` — widened return type via the new wire shape (TS-only).
- `apps/dashboard/src/hooks/__tests__/use-agent-metrics.test.tsx` — assert new fields surface; legacy responses default to null.

---

## Commit strategy

Five logical commits at task boundaries (Task 4, 7, 10, 13, 15). Commits are conventional (`feat`/`feat(cockpit)`/`feat(api)` etc., per commitlint).

1. **Commit 1** (after Task 4): `feat(cockpit): A.3 targets helper + MetricsSignalStore extension`
2. **Commit 2** (after Task 7): `feat(cockpit): A.3 metrics-alex + metrics-riley emit targets/spend/delta echoes`
3. **Commit 3** (after Task 10): `feat(api): A.3 meta-spend-provider + metrics route wiring`
4. **Commit 4** (after Task 13): `feat(dashboard): A.3 legacy-shapes + KPI types + metrics adapter`
5. **Commit 5** (after Task 15): `feat(cockpit): A.3 KPI strip + ROI bar mounted on /alex`

---

## Tasks

### Task 1: Convention test for forbidden direct `config` reads

**Files:**

- Create: `packages/core/src/agent-home/__tests__/targets-convention.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/agent-home/__tests__/targets-convention.test.ts
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const FORBIDDEN = ["config.avgValueCents", "config.targetCpbCents"];

function rg(pattern: string, scope: string[]): string[] {
  try {
    const out = execSync(
      `git grep -nE ${JSON.stringify(pattern)} -- ${scope.map((s) => `'${s}'`).join(" ")}`,
      { encoding: "utf8", cwd: process.cwd() },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("targets convention — only getAgentTargets reads config keys", () => {
  for (const pattern of FORBIDDEN) {
    it(`forbids direct ${pattern} access outside targets.ts`, () => {
      const matches = rg(pattern.replace(".", "\\."), [
        "packages/core/src/agent-home/metrics-*.ts",
        "apps/api/src/routes/**/*.ts",
        "apps/dashboard/src/lib/cockpit/*.ts",
        "apps/dashboard/src/components/cockpit/*.tsx",
      ]);
      // targets.ts itself and tests / docs are excluded by the scope above.
      expect(matches, matches.join("\n")).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run, expect PASS (nothing reads these keys yet)**

```bash
pnpm --filter @switchboard/core test -- targets-convention
```

Expected: PASS — guards future regressions.

- [ ] **Step 3: Stage (commit deferred to Task 4)**

```bash
git add packages/core/src/agent-home/__tests__/targets-convention.test.ts
```

---

### Task 2: `getAgentTargets` helper + tests

**Files:**

- Create: `packages/core/src/agent-home/targets.ts`
- Create: `packages/core/src/agent-home/__tests__/targets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/agent-home/__tests__/targets.test.ts
import { describe, expect, it } from "vitest";
import { getAgentTargets } from "../targets.js";

describe("getAgentTargets", () => {
  it("reads both keys when present", () => {
    expect(getAgentTargets({ config: { avgValueCents: 17900, targetCpbCents: 3000 } })).toEqual({
      avgValueCents: 17900,
      targetCpbCents: 3000,
    });
  });

  it("returns null for missing keys", () => {
    expect(getAgentTargets({ config: {} })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
  });

  it("returns null when one key absent", () => {
    expect(getAgentTargets({ config: { avgValueCents: 17900 } })).toEqual({
      avgValueCents: 17900,
      targetCpbCents: null,
    });
  });

  it("returns null for non-number values", () => {
    expect(getAgentTargets({ config: { avgValueCents: "17900", targetCpbCents: true } })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
  });

  it("defensive against non-object config", () => {
    expect(getAgentTargets({ config: null })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
    expect(getAgentTargets({ config: "not-an-object" })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
    expect(getAgentTargets({ config: 42 })).toEqual({
      avgValueCents: null,
      targetCpbCents: null,
    });
  });

  it("rejects negative or non-finite numbers", () => {
    expect(getAgentTargets({ config: { avgValueCents: -10, targetCpbCents: Number.NaN } })).toEqual(
      { avgValueCents: null, targetCpbCents: null },
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL ("Cannot find module '../targets.js'")**

```bash
pnpm --filter @switchboard/core test -- targets.test
```

- [ ] **Step 3: Implement**

```ts
// packages/core/src/agent-home/targets.ts
export interface AgentTargets {
  avgValueCents: number | null;
  targetCpbCents: number | null;
}

export function getAgentTargets(roster: { config: unknown }): AgentTargets {
  return {
    avgValueCents: readNonNegativeIntKey(roster.config, "avgValueCents"),
    targetCpbCents: readNonNegativeIntKey(roster.config, "targetCpbCents"),
  };
}

function readNonNegativeIntKey(config: unknown, key: string): number | null {
  if (config === null || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[key];
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  return value;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @switchboard/core test -- targets.test
```

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/agent-home/targets.ts \
        packages/core/src/agent-home/__tests__/targets.test.ts
```

---

### Task 3: Extend `MetricsSignalStore`, `PerAgentBuilderInput`, `MetricsViewModel`

**Files:**

- Modify: `packages/core/src/agent-home/metrics-types.ts`

- [ ] **Step 1: Edit `metrics-types.ts` — extend the three interfaces additively**

Append/insert (preserving all existing fields):

```ts
// MetricsSignalStore — add getMetaSpendCents
export interface MetricsSignalStore {
  countBookingsCreated(input: {
    orgId: string;
    excludeStatuses: readonly string[];
    from: Date;
    to: Date;
  }): Promise<number>;

  countConversionsByType(input: {
    orgId: string;
    type: string;
    from: Date;
    to: Date;
  }): Promise<number>;

  getMetaSpendCents(input: { orgId: string; from: Date; to: Date }): Promise<number | null>;
}

// PerAgentBuilderInput — add targets
export interface PerAgentBuilderInput {
  orgId: string;
  week: WeekContext;
  store: MetricsSignalStore;
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
}

// MetricsViewModel — additive fields
export interface MetricsViewModel {
  hero: HeroMetric;
  heroSubProseSegments: readonly ProseSegment[];
  spark: readonly SparkPoint[];
  stats: readonly [StatCell, StatCell, StatCell];
  freshness: DataFreshness;
  folioRange: string;
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
  spendCents: number | null;
  leads: number;
  qualifiedPct: number;
  bookedDelta: string | null;
  leadsDelta: string | null;
  qualifiedDelta: string | null;
}
```

- [ ] **Step 2: Run typecheck — expect failures in metrics-alex, metrics-riley, route, tests**

```bash
pnpm --filter @switchboard/core typecheck
```

Expected: errors flagging unsatisfied new fields (`targets`, `spendCents`, etc.) and missing store method. Tasks 4–7 fix these.

- [ ] **Step 3: Stage**

```bash
git add packages/core/src/agent-home/metrics-types.ts
```

---

### Task 4: Update barrel + Commit boundary (Commit 1)

**Files:**

- Modify: `packages/core/src/agent-home/index.ts`

- [ ] **Step 1: Export new symbols**

In `index.ts`, after the existing `metrics-types.ts` re-export block, add:

```ts
export { getAgentTargets, type AgentTargets } from "./targets.js";
```

- [ ] **Step 2: Run targets test + convention test from worktree root**

```bash
pnpm --filter @switchboard/core test -- targets
```

Expected: targets.test + targets-convention.test both PASS.

- [ ] **Step 3: Stage and commit**

```bash
git add packages/core/src/agent-home/index.ts
git commit -m "feat(cockpit): A.3 targets helper + MetricsSignalStore extension

- getAgentTargets(roster) reads AgentRoster.config.{avgValueCents,targetCpbCents}
  defensively; the only canonical reader for these two keys.
- Convention test guards against direct config-key access in metrics/route code.
- Additive shape extension on MetricsSignalStore (getMetaSpendCents),
  PerAgentBuilderInput (targets), and MetricsViewModel (echo fields).
  Implementers updated in subsequent commits.

Per A.3 slice brief: targets live in AgentRoster.config JSON keys,
not as columns. No schema migration. Riley slicing spec needs amendment
in its own docs PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Typecheck across the workspace will still red — that's expected; the next two tasks fix `metrics-alex` + `metrics-riley`.)

---

### Task 5: `metrics-alex.ts` emits targets + spend + deltas + leads + qualifiedPct

**Files:**

- Modify: `packages/core/src/agent-home/metrics-alex.ts`
- Modify: `packages/core/src/agent-home/__tests__/metrics-alex.test.ts`

- [ ] **Step 1: Extend the test file (write the failures first)**

Open `packages/core/src/agent-home/__tests__/metrics-alex.test.ts`. The existing `makeStore` helper at the top needs `getMetaSpendCents`. Update the helper and add new test blocks. The exact existing helper signature is at the top of the file — make `getMetaSpendCents` a `vi.fn` returning the default (null). Add an `overrides.spendCents?: number | null` param so individual tests can override.

```ts
function makeStore(overrides?: {
  bookingsByRange?: (from: Date, to: Date) => number;
  leadsByRange?: (from: Date, to: Date) => number;
  spendCents?: number | null;
}): MetricsSignalStore {
  return {
    countBookingsCreated: vi.fn(
      async ({ from, to }) => overrides?.bookingsByRange?.(from, to) ?? 0,
    ),
    countConversionsByType: vi.fn(async ({ from, to }) => overrides?.leadsByRange?.(from, to) ?? 0),
    getMetaSpendCents: vi.fn(async () => overrides?.spendCents ?? null),
  };
}

function makeInput(
  store: MetricsSignalStore,
  targets: { avgValueCents: number | null; targetCpbCents: number | null } = {
    avgValueCents: null,
    targetCpbCents: null,
  },
) {
  const now = new Date("2026-05-15T12:00:00Z");
  const week = buildWeekContext(now, "America/Los_Angeles");
  return { orgId: "org_1", week, store, targets };
}
```

Add fresh test cases at the bottom of the existing `describe` (preserving existing tests):

```ts
describe("A.3 echoes", () => {
  it("echoes targets verbatim onto the view-model", async () => {
    const store = makeStore();
    const vm = await buildAlexMetricsViewModel(
      makeInput(store, { avgValueCents: 17900, targetCpbCents: 3000 }),
    );
    expect(vm.targets).toEqual({ avgValueCents: 17900, targetCpbCents: 3000 });
  });

  it("emits spendCents from the store when present, null when absent", async () => {
    const present = await buildAlexMetricsViewModel(makeInput(makeStore({ spendCents: 21400 })));
    expect(present.spendCents).toBe(21400);

    const absent = await buildAlexMetricsViewModel(makeInput(makeStore()));
    expect(absent.spendCents).toBeNull();
  });

  it("Spend stat-cell unavailable mirrors spendCents nullity", async () => {
    const present = await buildAlexMetricsViewModel(makeInput(makeStore({ spendCents: 21400 })));
    const spend = present.stats[2];
    expect(spend.unavailable).toBe(false);
    expect(spend.display).toBe("$214");
    expect(spend.rawValue).toBe(21400);

    const absent = await buildAlexMetricsViewModel(makeInput(makeStore()));
    expect(absent.stats[2].unavailable).toBe(true);
    expect(absent.stats[2].display).toBe("—");
  });

  it("computes deltas with sign prefix", async () => {
    // up
    const up = await buildAlexMetricsViewModel(
      makeInput(
        makeStore({
          bookingsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 9 : 6),
          leadsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 47 : 35),
        }),
      ),
    );
    expect(up.bookedDelta).toBe("+3");
    expect(up.leadsDelta).toBe("+12");
    expect(up.qualifiedDelta).not.toBeNull();

    // flat
    const flat = await buildAlexMetricsViewModel(
      makeInput(makeStore({ bookingsByRange: () => 5, leadsByRange: () => 10 })),
    );
    expect(flat.bookedDelta).toBe("0");
    expect(flat.leadsDelta).toBe("0");

    // down
    const down = await buildAlexMetricsViewModel(
      makeInput(
        makeStore({
          bookingsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 4 : 10),
          leadsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 30 : 50),
        }),
      ),
    );
    expect(down.bookedDelta).toBe("-6");
    expect(down.leadsDelta).toBe("-20");
  });

  it("echoes leads and qualifiedPct as top-level fields", async () => {
    const vm = await buildAlexMetricsViewModel(
      makeInput(makeStore({ bookingsByRange: () => 9, leadsByRange: () => 47 })),
    );
    expect(vm.leads).toBe(47);
    expect(vm.qualifiedPct).toBe(Math.round((9 / 47) * 100));
  });

  it("qualifiedDelta returns null when prior leads = 0 (no comparator)", async () => {
    const vm = await buildAlexMetricsViewModel(
      makeInput(
        makeStore({
          bookingsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 9 : 0),
          leadsByRange: (from) => (from.getTime() === up_currentWeekStart() ? 47 : 0),
        }),
      ),
    );
    expect(vm.qualifiedDelta).toBeNull();
  });
});

function up_currentWeekStart(): number {
  const now = new Date("2026-05-15T12:00:00Z");
  return buildWeekContext(now, "America/Los_Angeles").weekStart.getTime();
}
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @switchboard/core test -- metrics-alex
```

- [ ] **Step 3: Implement — extend `buildAlexMetricsViewModel`**

Edit `packages/core/src/agent-home/metrics-alex.ts`. The current function signature is `buildAlexMetricsViewModel(input: PerAgentBuilderInput)`. Changes:

a. Destructure `targets` from the input.
b. Add new promises: `leadsPrev` (previous-week leads — symmetric with `heroPrev`), `spendCents` (call `store.getMetaSpendCents({ orgId, from: week.weekStart, to: week.weekEnd })`).
c. Compute `qualifiedPct = leads > 0 ? Math.round((heroValue / leads) * 100) : 0`.
d. Compute `qualifiedPrev = leadsPrev > 0 ? Math.round((heroPrev / leadsPrev) * 100) : null` (when `leadsPrev === 0`, qualifiedDelta must surface as `null`).
e. Compute deltas:

```ts
function formatNumericDelta(current: number, prev: number): string {
  const diff = current - prev;
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `${diff}`;
  return "0";
}

function formatPercentPointsDelta(current: number, prev: number | null): string | null {
  if (prev === null) return null;
  const diff = current - prev;
  if (diff > 0) return `+${diff} pts`;
  if (diff < 0) return `${diff} pts`;
  return "0 pts";
}
```

f. Update `stats[2]` (Spend cell) — when `spendCents !== null`, set:

```ts
{
  label: "Spend",
  display: `$${Math.round(spendCents / 100)}`,
  rawValue: spendCents,
  unit: "currency",
  unavailable: false,
}
```

g. Update `freshness.unavailableSources` — only include `"ad-platform-spend"` when `spendCents === null`.

h. Return the extended object:

```ts
return {
  hero: { kind: "tours-booked", value: heroValue, comparator: { window: "week", value: heroPrev } },
  heroSubProseSegments: subprose,
  spark,
  stats,
  freshness: {
    generatedAt: week.now.toISOString(),
    window: "week",
    dataSource: "live",
    ...(spendCents === null ? { unavailableSources: ["ad-platform-spend"] } : {}),
  },
  folioRange: week.folioRange,
  targets,
  spendCents,
  leads,
  qualifiedPct,
  bookedDelta: formatNumericDelta(heroValue, heroPrev),
  leadsDelta: formatNumericDelta(leads, leadsPrev),
  qualifiedDelta: formatPercentPointsDelta(qualifiedPct, qualifiedPrev),
};
```

i. Add the `countLeads` helper (mirror of `countBookings`) using `store.countConversionsByType` with `type: "lead"`.

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @switchboard/core test -- metrics-alex
```

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/agent-home/metrics-alex.ts \
        packages/core/src/agent-home/__tests__/metrics-alex.test.ts
```

---

### Task 6: `metrics-riley.ts` echoes (additive only — no `tiles[]`/`roi`)

**Files:**

- Modify: `packages/core/src/agent-home/metrics-riley.ts`
- Modify: `packages/core/src/agent-home/__tests__/metrics-riley.test.ts`

- [ ] **Step 1: Extend the test file**

In `metrics-riley.test.ts`, update the local `makeStore` helper to include `getMetaSpendCents: vi.fn(async () => null)`. Update test-input construction to pass `targets: { avgValueCents: null, targetCpbCents: null }`. Add a single block:

```ts
describe("A.3 echoes (Riley shares the shape)", () => {
  it("echoes targets and spendCents on Riley path", async () => {
    const store = makeStore();
    const vm = await buildRileyMetricsViewModel({
      orgId: "org_1",
      week: buildWeekContext(new Date("2026-05-15T12:00:00Z"), "America/Los_Angeles"),
      store,
      targets: { avgValueCents: 12000, targetCpbCents: 4000 },
    });
    expect(vm.targets).toEqual({ avgValueCents: 12000, targetCpbCents: 4000 });
    expect(vm.spendCents).toBeNull();
    expect(vm.leads).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @switchboard/core test -- metrics-riley
```

- [ ] **Step 3: Implement minimal echo wiring in `metrics-riley.ts`**

Mirror the four fields onto Riley's return:

- `targets` from `input.targets`
- `spendCents` from `store.getMetaSpendCents({ orgId, from: week.weekStart, to: week.weekEnd })`
- `leads` from `countConversionsByType(type: "lead", ...)` for current week
- `qualifiedPct` from leads/heroValue (mirror Alex's computation)
- `bookedDelta` / `leadsDelta` / `qualifiedDelta` via the same helpers (extract them to `packages/core/src/agent-home/metrics-deltas.ts` for DRY — see Step 3a).

- [ ] **Step 3a: Extract `formatNumericDelta` + `formatPercentPointsDelta` to a shared helper**

Create `packages/core/src/agent-home/metrics-deltas.ts`:

```ts
export function formatNumericDelta(current: number, prev: number): string {
  const diff = current - prev;
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `${diff}`;
  return "0";
}

export function formatPercentPointsDelta(current: number, prev: number | null): string | null {
  if (prev === null) return null;
  const diff = current - prev;
  if (diff > 0) return `+${diff} pts`;
  if (diff < 0) return `${diff} pts`;
  return "0 pts";
}
```

Update `metrics-alex.ts` to import from `./metrics-deltas.js`. Remove the locally-defined copies.

- [ ] **Step 4: Run all core metrics tests, expect PASS**

```bash
pnpm --filter @switchboard/core test -- metrics
```

- [ ] **Step 5: Stage**

```bash
git add packages/core/src/agent-home/metrics-alex.ts \
        packages/core/src/agent-home/metrics-riley.ts \
        packages/core/src/agent-home/metrics-deltas.ts \
        packages/core/src/agent-home/__tests__/metrics-alex.test.ts \
        packages/core/src/agent-home/__tests__/metrics-riley.test.ts
```

---

### Task 7: Fix remaining core test store mocks + Commit boundary (Commit 2)

**Files:**

- Modify: `packages/core/src/agent-home/__tests__/metrics.test.ts`

- [ ] **Step 1: Update the orchestrator test's `makeStore`**

Add `getMetaSpendCents: vi.fn(async () => null)` to the inline store. Add the `targets` input to any `projectMetrics` call sites in the test file: `targets: { avgValueCents: null, targetCpbCents: null }`. The test in `metrics.ts` orchestrator may need its input type updated to accept the new field — verify `ProjectMetricsInput` in `metrics.ts` carries `targets`:

In `packages/core/src/agent-home/metrics.ts`, extend `ProjectMetricsInput`:

```ts
export interface ProjectMetricsInput {
  orgId: string;
  agentKey: AgentHomeKey;
  now: Date;
  timezone: string;
  store: MetricsSignalStore;
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
}
```

And forward `targets` to both `buildAlexMetricsViewModel` and `buildRileyMetricsViewModel`.

- [ ] **Step 2: Run full core test suite + typecheck**

```bash
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/core typecheck
```

Expected: both green.

- [ ] **Step 3: Stage and commit**

```bash
git add packages/core/src/agent-home/metrics.ts \
        packages/core/src/agent-home/__tests__/metrics.test.ts
git commit -m "feat(cockpit): A.3 metrics-alex + metrics-riley emit targets/spend/delta echoes

- MetricsSignalStore gains getMetaSpendCents; PerAgentBuilderInput gains
  targets; MetricsViewModel gains targets/spendCents/leads/qualifiedPct/
  bookedDelta/leadsDelta/qualifiedDelta echoes (additive — no breaking change).
- Shared metrics-deltas helper centralizes formatNumericDelta and
  formatPercentPointsDelta for Alex and Riley.
- Spend stat-cell flips unavailable based on spendCents nullity;
  freshness.unavailableSources retains ad-platform-spend tag when null.
- Riley path emits the same echo fields but does not yet emit tiles[]/roi —
  that lands in Riley B.2 once its slicing spec is amended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `meta-spend-provider.ts` factory + tests

**Files:**

- Create: `apps/api/src/lib/meta-spend-provider.ts`
- Create: `apps/api/src/__tests__/meta-spend-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/__tests__/meta-spend-provider.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildMetaSpendProvider } from "../lib/meta-spend-provider.js";

type PrismaStub = {
  connection: { findFirst: ReturnType<typeof vi.fn> };
};

function stubPrisma(connection: unknown): PrismaStub {
  return { connection: { findFirst: vi.fn(async () => connection) } };
}

const ANY_RANGE = { orgId: "org_1", from: new Date("2026-05-12"), to: new Date("2026-05-18") };

describe("buildMetaSpendProvider", () => {
  it("returns null when no Meta Ads Connection exists", async () => {
    const prisma = stubPrisma(null);
    const adsClientFactory = vi.fn();
    const getMetaSpendCents = buildMetaSpendProvider(prisma as never, adsClientFactory);
    expect(await getMetaSpendCents(ANY_RANGE)).toBeNull();
    expect(adsClientFactory).not.toHaveBeenCalled();
  });

  it("returns null when Connection is not connected", async () => {
    const prisma = stubPrisma({ id: "c1", status: "degraded", serviceId: "meta-ads" });
    const adsClientFactory = vi.fn();
    const getMetaSpendCents = buildMetaSpendProvider(prisma as never, adsClientFactory);
    expect(await getMetaSpendCents(ANY_RANGE)).toBeNull();
  });

  it("sums spend across campaign rows and converts dollars to cents", async () => {
    const prisma = stubPrisma({ id: "c1", status: "connected", serviceId: "meta-ads" });
    const adsClient = {
      getCampaignInsights: vi.fn(async () => [{ spend: 120.5 }, { spend: 93.49 }, { spend: 0 }]),
    };
    const adsClientFactory = vi.fn(async () => adsClient);
    const getMetaSpendCents = buildMetaSpendProvider(prisma as never, adsClientFactory as never);
    // 120.50 + 93.49 + 0 = 213.99 → 21399 cents
    expect(await getMetaSpendCents(ANY_RANGE)).toBe(21399);
    expect(adsClient.getCampaignInsights).toHaveBeenCalledWith({
      dateRange: { since: "2026-05-12", until: "2026-05-18" },
      fields: ["spend"],
    });
  });

  it("returns null and logs when provider throws", async () => {
    const prisma = stubPrisma({ id: "c1", status: "connected", serviceId: "meta-ads" });
    const adsClient = {
      getCampaignInsights: vi.fn(async () => {
        throw new Error("rate limited");
      }),
    };
    const warn = vi.fn();
    const adsClientFactory = vi.fn(async () => adsClient);
    const getMetaSpendCents = buildMetaSpendProvider(prisma as never, adsClientFactory as never, {
      log: { warn },
    });
    expect(await getMetaSpendCents(ANY_RANGE)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @switchboard/api test -- meta-spend-provider
```

- [ ] **Step 3: Implement**

```ts
// apps/api/src/lib/meta-spend-provider.ts
import type { PrismaClient } from "@prisma/client";

export interface AdsClientLike {
  getCampaignInsights(params: {
    dateRange: { since: string; until: string };
    fields: string[];
  }): Promise<Array<{ spend: number }>>;
}

export type AdsClientFactory = (connection: {
  id: string;
  organizationId: string | null;
}) => Promise<AdsClientLike>;

export interface MetaSpendProviderDeps {
  log?: { warn: (...args: unknown[]) => void };
}

export interface MetaSpendRange {
  orgId: string;
  from: Date;
  to: Date;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildMetaSpendProvider(
  prisma: PrismaClient,
  adsClientFactory: AdsClientFactory,
  deps: MetaSpendProviderDeps = {},
): (range: MetaSpendRange) => Promise<number | null> {
  return async ({ orgId, from, to }) => {
    const connection = await prisma.connection.findFirst({
      where: { organizationId: orgId, serviceId: "meta-ads", status: "connected" },
      select: { id: true, organizationId: true },
    });
    if (!connection) return null;

    try {
      const client = await adsClientFactory(connection);
      const rows = await client.getCampaignInsights({
        dateRange: { since: fmt(from), until: fmt(to) },
        fields: ["spend"],
      });
      const dollars = rows.reduce((sum, r) => sum + (Number.isFinite(r.spend) ? r.spend : 0), 0);
      return Math.round(dollars * 100);
    } catch (err) {
      deps.log?.warn({ err }, "meta-spend-provider: insights call failed");
      return null;
    }
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @switchboard/api test -- meta-spend-provider
```

- [ ] **Step 5: Stage**

```bash
git add apps/api/src/lib/meta-spend-provider.ts \
        apps/api/src/__tests__/meta-spend-provider.test.ts
```

---

### Task 9: Wire targets + spend into `metrics.ts` route

**Files:**

- Modify: `apps/api/src/routes/agent-home/metrics.ts`
- Modify: `apps/api/src/__tests__/api-metrics.test.ts`

- [ ] **Step 1: Extend the existing api-metrics test**

Inspect `apps/api/src/__tests__/api-metrics.test.ts` (it follows the `buildTestServer` pattern per `feedback_api_test_mocked_prisma`). Add the following cases at the bottom of the existing describe block:

```ts
describe("A.3 metrics route — targets + spend", () => {
  it("echoes targets from AgentRoster.config", async () => {
    // Seed AgentRoster with both keys in config, expect vm.targets to match.
    // Use the existing test-server pattern; mock prisma.agentRoster.findUnique
    // to return { config: { avgValueCents: 17900, targetCpbCents: 3000 } }.
    // Mock buildMetaSpendProvider's wired output via app.adsClientFactory or
    // by stubbing prisma.connection.findFirst -> null (spendCents null is fine here).
    // Assert response.vm.targets === { avgValueCents: 17900, targetCpbCents: 3000 }.
  });

  it("returns null targets when AgentRoster has no config keys", async () => {
    // prisma.agentRoster.findUnique → { config: {} }
    // Assert response.vm.targets === { avgValueCents: null, targetCpbCents: null }.
  });

  it("returns null spendCents when no Meta Ads Connection exists", async () => {
    // prisma.connection.findFirst → null
    // Assert response.vm.spendCents === null.
  });

  it("returns numeric spendCents when Connection exists and adsClient succeeds", async () => {
    // prisma.connection.findFirst → connected meta-ads row
    // Mock adsClientFactory to return a client whose getCampaignInsights returns
    // [{ spend: 120 }, { spend: 94 }] → 21400.
    // Assert response.vm.spendCents === 21400.
  });

  it("handles missing AgentRoster row defensively (zero-config tenant)", async () => {
    // prisma.agentRoster.findUnique → null
    // Assert: targets are null; route still 200 (does not 500).
  });
});
```

Implementer fills in the test bodies using the existing `buildTestServer` + mock-prisma pattern in the file.

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @switchboard/api test -- api-metrics
```

- [ ] **Step 3: Implement the route changes in `metrics.ts`**

Edit `apps/api/src/routes/agent-home/metrics.ts`. After computing `orgId` and before constructing `store`:

```ts
const agentRoleForRoster = agentId; // "alex" | "riley"
const roster = await app.prisma.agentRoster.findUnique({
  where: { organizationId_agentRole: { organizationId: orgId, agentRole: agentRoleForRoster } },
  select: { config: true },
});
const targets = getAgentTargets(roster ?? { config: {} });
```

Replace the existing inline `store` literal to add `getMetaSpendCents`:

```ts
const getMetaSpendCents = app.metaSpendProvider ?? (async () => null);

const store: MetricsSignalStore = {
  countBookingsCreated: ({ orgId: o, excludeStatuses, from, to }) =>
    reportStores.bookings.countExcludingStatuses({ orgId: o, excludeStatuses, from, to }),
  countConversionsByType: ({ orgId: o, type, from, to }) =>
    reportStores.conversions.countByType(o, type, from, to),
  getMetaSpendCents: ({ orgId: o, from, to }) => getMetaSpendCents({ orgId: o, from, to }),
};
```

Pass `targets` to `projectMetrics`:

```ts
const vm = await projectMetrics({
  orgId,
  agentKey: agentId as "alex" | "riley",
  now: new Date(),
  timezone,
  store,
  targets,
});
```

Add import: `import { getAgentTargets } from "@switchboard/core";` at the top.

- [ ] **Step 3a: Register `metaSpendProvider` on the Fastify app instance**

If `app.metaSpendProvider` doesn't exist as a typed property, add it to `apps/api/src/types/fastify.d.ts` (or the equivalent app-decoration file used by `reportStores`):

```ts
declare module "fastify" {
  interface FastifyInstance {
    metaSpendProvider?: (range: { orgId: string; from: Date; to: Date }) => Promise<number | null>;
  }
}
```

Then wire `app.decorate("metaSpendProvider", ...)` in the same bootstrap location that calls `decorate("reportStores", ...)` — inspect `apps/api/src/bootstrap/` and the test-server builder to mirror the wiring. The decorator builds the provider from `buildMetaSpendProvider(app.prisma, adsClientFactory)` where `adsClientFactory` is the existing module that constructs Meta clients for an `organizationId` (search `rg "MetaCampaignInsightsProvider\\|new MetaAdsClient" apps/api packages -l` to locate the canonical factory; if none exists, the implementer creates one as a tiny wrapper around `MetaAdsClient` per existing usage in the codebase).

For tests, allow `buildTestServer` to inject a mock `metaSpendProvider`. Default to `null` (i.e., no provider — spendCents always null).

- [ ] **Step 4: Run all api tests, expect PASS**

```bash
pnpm --filter @switchboard/api test
```

- [ ] **Step 5: Stage**

```bash
git add apps/api/src/routes/agent-home/metrics.ts \
        apps/api/src/__tests__/api-metrics.test.ts \
        apps/api/src/types/fastify.d.ts \
        apps/api/src/bootstrap/
```

(Exact bootstrap paths confirmed during implementation.)

---

### Task 10: Commit boundary (Commit 3) + verify cross-package typecheck

**Files:** (none new)

- [ ] **Step 1: Workspace-wide typecheck**

```bash
pnpm typecheck
```

Expected: green across schemas/sdk/core/db/ad-optimizer/api. If errors mention stale Prisma types, run `pnpm reset` then re-run typecheck.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(api): A.3 meta-spend-provider + metrics route wiring

- buildMetaSpendProvider(prisma, adsClientFactory) reads the org's
  meta-ads Connection, calls getCampaignInsights({ fields: ['spend'] }),
  sums dollars across rows, converts to cents. Returns null on no connection,
  non-connected connection, or provider error.
- /agents/:agentId/metrics now loads AgentRoster, computes targets via
  getAgentTargets, and passes the resolved targets + a getMetaSpendCents
  store method to projectMetrics. The response shape is the additive
  echo locked in core.

Per A.3 slice brief: ad-optimizer integration lives in apps/api boundary;
core stays free of ad-optimizer imports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Dashboard types — `KpiTile` / `RoiBar` union / `CockpitKpiData`

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/types.ts`

- [ ] **Step 1: Append to types.ts** (additive; preserve existing exports)

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

export interface CockpitKpiData {
  range: string;
  tiles?: KpiTile[];
  roi?: RoiBar;
  // legacy flat shape (Alex-side adapter)
  booked?: number | null;
  bookedDelta?: string | null;
  leads?: number | null;
  leadsDelta?: string | null;
  qualifiedPct?: number | null;
  qualifiedDelta?: string | null;
  spend?: number | null;
  avgValue?: number | null;
  target?: number | null;
}
```

- [ ] **Step 2: Verify nothing breaks**

```bash
pnpm --filter @switchboard/dashboard typecheck
```

Expected: green (additive only).

- [ ] **Step 3: Stage**

```bash
git add apps/dashboard/src/components/cockpit/types.ts
```

---

### Task 12: `legacy-shapes.ts` port + tests

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/legacy-shapes.ts`
- Create: `apps/dashboard/src/lib/cockpit/__tests__/legacy-shapes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/src/lib/cockpit/__tests__/legacy-shapes.test.ts
import { describe, expect, it } from "vitest";
import { legacyTiles, legacyRoi, collapsedHeadline, type LegacyKpiInput } from "../legacy-shapes";

const base: LegacyKpiInput = {
  booked: 9,
  bookedDelta: "+3",
  leads: 47,
  leadsDelta: "+12",
  qualifiedPct: 28,
  qualifiedDelta: "+4 pts",
  spend: 214,
  avgValue: 179,
  target: 30,
};

describe("legacyTiles", () => {
  it("emits four tiles in the locked-design order", () => {
    const tiles = legacyTiles(base);
    expect(tiles.map((t) => t.label)).toEqual([
      "bookings",
      "leads worked",
      "qualified",
      "ad spend",
    ]);
    expect(tiles[0]).toMatchObject({ value: 9, trend: "+3" });
    expect(tiles[1]).toMatchObject({ value: 47, trend: "+12" });
    expect(tiles[2]).toMatchObject({ value: 28, unit: "%", trend: "+4 pts" });
    expect(tiles[3]).toMatchObject({ value: "$214" });
  });

  it("ad spend tile renders unavailable + Meta Ads hint when spend is null", () => {
    const tiles = legacyTiles({ ...base, spend: null });
    expect(tiles[3]).toMatchObject({
      label: "ad spend",
      unavailable: true,
      hint: "Connect Meta Ads",
    });
  });
});

describe("legacyRoi", () => {
  it("steady-state on-target", () => {
    const roi = legacyRoi({ ...base, spend: 270, target: 30, booked: 9, avgValue: 179 });
    // cpb = 270/9 = 30 → onTarget
    if ("degraded" in roi!) throw new Error("expected full ROI");
    expect(roi.comparator.onTarget).toBe(true);
    expect(roi.comparator.value).toBe("$30 per booking");
    expect(roi.comparator.target).toBe("target $30");
  });

  it("fillPct caps at 100 when ratio > 6", () => {
    const roi = legacyRoi({ ...base, spend: 100, avgValue: 1000, booked: 9, target: 30 });
    if ("degraded" in roi!) throw new Error("expected full ROI");
    expect(roi.fillPct).toBe(100);
  });

  it("cpb null when booked === 0", () => {
    const roi = legacyRoi({ ...base, booked: 0, spend: 100, avgValue: 179, target: 30 });
    if ("degraded" in roi!) throw new Error("expected full ROI");
    expect(roi.comparator.value).toBe("—");
  });

  it("degraded when avgValue is null — 'Set average booking value' hint", () => {
    const roi = legacyRoi({ ...base, avgValue: null });
    expect(roi).toMatchObject({
      degraded: true,
      degradedHint: "Set average booking value to see return on spend",
    });
  });

  it("degraded when spend is null — 'Connect Meta Ads' hint", () => {
    const roi = legacyRoi({ ...base, spend: null });
    expect(roi).toMatchObject({
      degraded: true,
      degradedHint: "Connect Meta Ads to see return on spend",
    });
  });

  it("degraded when both null — prefers Meta Ads hint", () => {
    const roi = legacyRoi({ ...base, spend: null, avgValue: null });
    expect(roi).toMatchObject({
      degraded: true,
      degradedHint: "Connect Meta Ads to see return on spend",
    });
  });
});

describe("collapsedHeadline", () => {
  it("flat-shape headline uses bookings + cpb + bookedDelta", () => {
    const headline = collapsedHeadline(base);
    expect(headline.bookedValue).toBe(9);
    expect(headline.cpb).toBe(Math.round(214 / 9));
    expect(headline.delta).toBe("+3");
  });

  it("explicit tiles[] headline uses first non-unavailable tile", () => {
    const headline = collapsedHeadline({
      ...base,
      tiles: [
        { label: "ad spend", value: "—", unavailable: true },
        { label: "bookings", value: 12, trend: "+5" },
      ],
    });
    expect(headline.label).toBe("bookings");
    expect(headline.value).toBe(12);
    expect(headline.trend).toBe("+5");
  });
});
```

- [ ] **Step 2: Run, expect FAIL ("Cannot find module")**

```bash
pnpm --filter @switchboard/dashboard test -- legacy-shapes
```

- [ ] **Step 3: Implement** (no `.js` extensions on imports — Next.js compile target)

```ts
// apps/dashboard/src/lib/cockpit/legacy-shapes.ts
import type { KpiTile, RoiBar, CockpitKpiData } from "@/components/cockpit/types";

export interface LegacyKpiInput {
  booked: number | null;
  bookedDelta: string | null;
  leads: number | null;
  leadsDelta: string | null;
  qualifiedPct: number | null;
  qualifiedDelta: string | null;
  spend: number | null;
  avgValue: number | null;
  target: number | null;
}

export type CollapsedHeadline =
  | {
      mode: "explicit";
      label: string;
      value: number | string;
      unit?: string;
      trend?: string;
    }
  | {
      mode: "flat";
      bookedValue: number;
      cpb: number | null;
      delta: string | null;
      label: string;
    };

export function legacyTiles(k: LegacyKpiInput): KpiTile[] {
  return [
    { label: "bookings", value: k.booked ?? 0, trend: k.bookedDelta ?? undefined },
    { label: "leads worked", value: k.leads ?? 0, trend: k.leadsDelta ?? undefined },
    {
      label: "qualified",
      value: k.qualifiedPct ?? 0,
      unit: "%",
      trend: k.qualifiedDelta ?? undefined,
    },
    k.spend === null
      ? { label: "ad spend", value: "—", unavailable: true, hint: "Connect Meta Ads" }
      : { label: "ad spend", value: `$${k.spend}` },
  ];
}

export function legacyRoi(k: LegacyKpiInput): RoiBar {
  // Degraded paths — Meta Ads hint preferred when both null
  if (k.spend === null) {
    const cpb =
      k.booked && k.booked > 0 && k.spend !== null ? Math.round(k.spend / k.booked) : null;
    return {
      degraded: true,
      degradedHint: "Connect Meta Ads to see return on spend",
      label: "return on spend",
      comparator: {
        value: cpb !== null ? `$${cpb} per booking` : "—",
        target: k.target !== null ? `target $${k.target}` : "—",
      },
    };
  }
  if (k.avgValue === null) {
    const cpb =
      k.booked && k.booked > 0 && k.spend !== null ? Math.round(k.spend / k.booked) : null;
    return {
      degraded: true,
      degradedHint: "Set average booking value to see return on spend",
      label: "return on spend",
      comparator: {
        value: cpb !== null ? `$${cpb} per booking` : "—",
        target: k.target !== null ? `target $${k.target}` : "—",
      },
    };
  }

  const booked = k.booked ?? 0;
  const spend = k.spend;
  const avgValue = k.avgValue;
  const target = k.target ?? 0;
  const earned = booked * avgValue;
  const ratio = spend > 0 ? earned / spend : 0;
  const ratioCap = Math.min(ratio, 6);
  const cpb = booked > 0 ? Math.round(spend / booked) : null;
  const onTarget = cpb !== null && target > 0 && cpb <= target;

  return {
    label: "return on spend",
    leftMeta: `$${spend} spent`,
    rightMeta: { value: `$${earned.toLocaleString()}`, suffix: " in tour value" },
    fillPct: (ratioCap / 6) * 100,
    breakEvenPct: (1 / 6) * 100,
    breakEvenLabel: "break-even",
    scaleLeft: "$0",
    scaleRight: "6× spend",
    comparator: {
      value: cpb !== null ? `$${cpb} per booking` : "—",
      target: target > 0 ? `target $${target}` : "—",
      onTarget,
    },
  };
}

export function collapsedHeadline(k: CockpitKpiData & LegacyKpiInput): CollapsedHeadline {
  if (k.tiles && k.tiles.length > 0) {
    const lead = k.tiles.find((t) => !t.unavailable) ?? k.tiles[0]!;
    return {
      mode: "explicit",
      label: lead.label,
      value: lead.value,
      ...(lead.unit ? { unit: lead.unit } : {}),
      ...(lead.trend ? { trend: lead.trend } : {}),
    };
  }
  const booked = k.booked ?? 0;
  const cpb =
    booked > 0 && k.spend !== null && k.spend !== undefined ? Math.round(k.spend / booked) : null;
  return {
    mode: "flat",
    bookedValue: booked,
    cpb,
    delta: k.bookedDelta ?? null,
    label: "bookings",
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- legacy-shapes
```

- [ ] **Step 5: Stage**

```bash
git add apps/dashboard/src/lib/cockpit/legacy-shapes.ts \
        apps/dashboard/src/lib/cockpit/__tests__/legacy-shapes.test.ts
```

---

### Task 13: `metrics-to-kpi-input.ts` adapter + use-agent-metrics widening + Commit 4

**Files:**

- Create: `apps/dashboard/src/lib/cockpit/metrics-to-kpi-input.ts`
- Create: `apps/dashboard/src/lib/cockpit/__tests__/metrics-to-kpi-input.test.ts`
- Modify: `apps/dashboard/src/hooks/use-agent-metrics.ts`
- Modify: `apps/dashboard/src/hooks/__tests__/use-agent-metrics.test.tsx`

- [ ] **Step 1: Write the failing adapter test**

```ts
// apps/dashboard/src/lib/cockpit/__tests__/metrics-to-kpi-input.test.ts
import { describe, expect, it } from "vitest";
import { metricsViewModelToLegacyKpiInput } from "../metrics-to-kpi-input";

const fullVm = {
  hero: { kind: "tours-booked", value: 9, comparator: { window: "week", value: 6 } },
  heroSubProseSegments: [],
  spark: [],
  stats: [
    { label: "Leads", display: "47", rawValue: 47, unit: "count" },
    { label: "Conversion", display: "19%", rawValue: 0.19, unit: "percent" },
    { label: "Spend", display: "$214", rawValue: 21400, unit: "currency", unavailable: false },
  ],
  freshness: { generatedAt: "2026-05-15T12:00:00Z", window: "week", dataSource: "live" },
  folioRange: "May 12 – May 18",
  targets: { avgValueCents: 17900, targetCpbCents: 3000 },
  spendCents: 21400,
  leads: 47,
  qualifiedPct: 19,
  bookedDelta: "+3",
  leadsDelta: "+12",
  qualifiedDelta: "+4 pts",
};

describe("metricsViewModelToLegacyKpiInput", () => {
  it("converts cents to dollars and propagates echoes", () => {
    const input = metricsViewModelToLegacyKpiInput(fullVm);
    expect(input.booked).toBe(9);
    expect(input.bookedDelta).toBe("+3");
    expect(input.leads).toBe(47);
    expect(input.leadsDelta).toBe("+12");
    expect(input.qualifiedPct).toBe(19);
    expect(input.qualifiedDelta).toBe("+4 pts");
    expect(input.spend).toBe(214);
    expect(input.avgValue).toBe(179);
    expect(input.target).toBe(30);
  });

  it("null spendCents → null spend", () => {
    const input = metricsViewModelToLegacyKpiInput({ ...fullVm, spendCents: null });
    expect(input.spend).toBeNull();
  });

  it("null targets → null avgValue and target", () => {
    const input = metricsViewModelToLegacyKpiInput({
      ...fullVm,
      targets: { avgValueCents: null, targetCpbCents: null },
    });
    expect(input.avgValue).toBeNull();
    expect(input.target).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- metrics-to-kpi-input
```

- [ ] **Step 3: Implement**

```ts
// apps/dashboard/src/lib/cockpit/metrics-to-kpi-input.ts
import type { LegacyKpiInput } from "./legacy-shapes";

interface MetricsViewModelLike {
  hero: { value: number };
  targets: { avgValueCents: number | null; targetCpbCents: number | null };
  spendCents: number | null;
  leads: number;
  qualifiedPct: number;
  bookedDelta: string | null;
  leadsDelta: string | null;
  qualifiedDelta: string | null;
}

function centsToDollars(cents: number | null): number | null {
  return cents === null ? null : Math.round(cents / 100);
}

export function metricsViewModelToLegacyKpiInput(vm: MetricsViewModelLike): LegacyKpiInput {
  return {
    booked: vm.hero.value,
    bookedDelta: vm.bookedDelta,
    leads: vm.leads,
    leadsDelta: vm.leadsDelta,
    qualifiedPct: vm.qualifiedPct,
    qualifiedDelta: vm.qualifiedDelta,
    spend: centsToDollars(vm.spendCents),
    avgValue: centsToDollars(vm.targets.avgValueCents),
    target: centsToDollars(vm.targets.targetCpbCents),
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- metrics-to-kpi-input
```

- [ ] **Step 5: Widen the `use-agent-metrics` hook return type**

Open `apps/dashboard/src/hooks/use-agent-metrics.ts`. The hook fetches the metrics endpoint and returns `{ data: { vm: MetricsViewModel } | null, ... }`. Update the local `MetricsViewModel` type (or import an explicit type that mirrors the new wire shape — recommend creating a dashboard-local mirror at `apps/dashboard/src/lib/cockpit/metrics-types.ts` so the hook + adapter both reference one shape).

Create `apps/dashboard/src/lib/cockpit/metrics-types.ts` mirroring the extended wire shape (no `.js` extension):

```ts
export interface MetricsTargets {
  avgValueCents: number | null;
  targetCpbCents: number | null;
}

export interface MetricsViewModelWire {
  hero: { kind: string; value: number; comparator: { window: "week"; value: number } };
  heroSubProseSegments: Array<{ kind: "text" | "accent"; text: string }>;
  spark: unknown[];
  stats: ReadonlyArray<{
    label: string;
    display: string;
    rawValue: number | null;
    unit: "count" | "percent" | "currency";
    unavailable?: boolean;
  }>;
  freshness: {
    generatedAt: string;
    window: "week";
    dataSource: "live" | "fixture";
    unavailableSources?: readonly string[];
  };
  folioRange: string;
  targets: MetricsTargets;
  spendCents: number | null;
  leads: number;
  qualifiedPct: number;
  bookedDelta: string | null;
  leadsDelta: string | null;
  qualifiedDelta: string | null;
}
```

Update `use-agent-metrics.ts` to type the response payload as `{ vm: MetricsViewModelWire }`.

- [ ] **Step 6: Extend the hook test**

Add a test asserting `vm.targets`, `vm.spendCents`, and the delta fields surface in the parsed response (mock fetch to return the extended payload). Also assert legacy responses (without the new fields) don't crash the hook — TS treats them as `undefined` and consumers should null-coalesce.

- [ ] **Step 7: Run all dashboard tests + typecheck**

```bash
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard typecheck
```

Expected: green.

- [ ] **Step 8: Stage and commit (Commit 4)**

```bash
git add apps/dashboard/src/components/cockpit/types.ts \
        apps/dashboard/src/lib/cockpit/legacy-shapes.ts \
        apps/dashboard/src/lib/cockpit/metrics-to-kpi-input.ts \
        apps/dashboard/src/lib/cockpit/metrics-types.ts \
        apps/dashboard/src/lib/cockpit/__tests__/legacy-shapes.test.ts \
        apps/dashboard/src/lib/cockpit/__tests__/metrics-to-kpi-input.test.ts \
        apps/dashboard/src/hooks/use-agent-metrics.ts \
        apps/dashboard/src/hooks/__tests__/use-agent-metrics.test.tsx
git commit -m "feat(dashboard): A.3 legacy-shapes + KPI types + metrics adapter

- types.ts gains KpiTile, RoiBarFull, RoiBarDegraded, RoiBar union, and
  CockpitKpiData (additive — A.1/A.2 consumers untouched).
- legacy-shapes.ts ports legacyTiles / legacyRoi / collapsedHeadline from
  the locked-design reference. Two degraded ROI states with distinct hints;
  Meta Ads hint preferred when both spend and avgValue are null.
- metrics-to-kpi-input.ts adapts the wire MetricsViewModel to LegacyKpiInput,
  converting cents to dollars at the seam.
- use-agent-metrics widened to the new wire shape via dashboard-local
  MetricsViewModelWire mirror; legacy responses safely null-coalesce.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `KpiTile` + `KPIStrip` + `ROIBar` components + tests

**Files:**

- Create: `apps/dashboard/src/components/cockpit/kpi-tile.tsx`
- Create: `apps/dashboard/src/components/cockpit/__tests__/kpi-tile.test.tsx`
- Create: `apps/dashboard/src/components/cockpit/roi-bar.tsx`
- Create: `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx`
- Create: `apps/dashboard/src/components/cockpit/kpi-strip.tsx`
- Create: `apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx`

- [ ] **Step 1: Write failing tests for `<KpiTile>`**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/kpi-tile.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiTile } from "../kpi-tile";

describe("<KpiTile>", () => {
  it("renders label, value, unit, and trend", () => {
    render(<KpiTile label="qualified" value={28} unit="%" trend="+4 pts" />);
    expect(screen.getByText(/qualified/i)).toBeInTheDocument();
    expect(screen.getByText("28")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
    expect(screen.getByText("+4 pts")).toBeInTheDocument();
  });

  it("renders unavailable state with dash and hint", () => {
    render(<KpiTile label="ad spend" value="—" unavailable hint="Connect Meta Ads" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect Meta Ads/i })).toBeInTheDocument();
  });

  it("renders + prefix trend in green and - in red via inline color", () => {
    const { rerender } = render(<KpiTile label="x" value={1} trend="+3" />);
    expect(screen.getByText("+3")).toHaveAttribute("data-trend-sign", "up");
    rerender(<KpiTile label="x" value={1} trend="-3" />);
    expect(screen.getByText("-3")).toHaveAttribute("data-trend-sign", "down");
    rerender(<KpiTile label="x" value={1} trend="0" />);
    expect(screen.getByText("0")).toHaveAttribute("data-trend-sign", "flat");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- kpi-tile
```

- [ ] **Step 3: Implement `<KpiTile>`**

Port `KPI` from the locked-design `cockpit.jsx:380` to TypeScript with strict types. Use the `T` token import from `./tokens`. Add `data-trend-sign` attribute on the trend `<div>` so tests can assert sign branching without re-implementing color logic. Component is purely presentational (no hooks).

- [ ] **Step 4: Write failing tests for `<ROIBar>`**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ROIBar } from "../roi-bar";
import type { RoiBar } from "../types";

const fullRoi: RoiBar = {
  label: "return on spend",
  leftMeta: "$214 spent",
  rightMeta: { value: "$1,611", suffix: " in tour value" },
  fillPct: 75,
  breakEvenPct: 16.67,
  breakEvenLabel: "break-even",
  scaleLeft: "$0",
  scaleRight: "6× spend",
  comparator: { value: "$24 per booking", target: "target $30", onTarget: true },
};

describe("<ROIBar>", () => {
  it("renders full variant — label, scales, comparator, fill bar", () => {
    render(<ROIBar roi={fullRoi} />);
    expect(screen.getByText(/return on spend/i)).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText("6× spend")).toBeInTheDocument();
    expect(screen.getByText(/\$24 per booking/)).toBeInTheDocument();
    expect(screen.getByText(/target \$30/)).toBeInTheDocument();
    expect(screen.getByTestId("roi-bar-fill")).toHaveStyle({ width: "75%" });
  });

  it("clamps fillPct under 0 and over 100", () => {
    const { rerender } = render(<ROIBar roi={{ ...fullRoi, fillPct: -10 }} />);
    expect(screen.getByTestId("roi-bar-fill")).toHaveStyle({ width: "0%" });
    rerender(<ROIBar roi={{ ...fullRoi, fillPct: 150 }} />);
    expect(screen.getByTestId("roi-bar-fill")).toHaveStyle({ width: "100%" });
  });

  it("renders degraded variant with Meta Ads hint", () => {
    render(
      <ROIBar
        roi={{
          degraded: true,
          degradedHint: "Connect Meta Ads to see return on spend",
          label: "return on spend",
          comparator: { value: "—", target: "target $30" },
        }}
      />,
    );
    expect(screen.getByText(/Connect Meta Ads to see return on spend/i)).toBeInTheDocument();
    expect(screen.queryByTestId("roi-bar-fill")).not.toBeInTheDocument();
  });

  it("comparator pill onTarget=true renders green via data attribute", () => {
    render(<ROIBar roi={fullRoi} />);
    expect(screen.getByTestId("roi-comparator")).toHaveAttribute("data-on-target", "true");
  });
});
```

- [ ] **Step 5: Run, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- roi-bar
```

- [ ] **Step 6: Implement `<ROIBar>`**

Port the `ROIBar` function from `cockpit.jsx:422` to TypeScript. Branch on `"degraded" in roi`. Use `T` tokens for color; add `data-testid="roi-bar-fill"` on the fill `<div>` and `data-testid="roi-comparator"` + `data-on-target={String(comparator.onTarget ?? false)}` on the comparator pill so tests don't depend on color values.

- [ ] **Step 7: Write failing tests for `<KPIStrip>`**

```tsx
// apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { KPIStrip } from "../kpi-strip";
import type { CockpitKpiData } from "../types";

const flatKpis: CockpitKpiData = {
  range: "This week · May 12 – May 18",
  booked: 9,
  bookedDelta: "+3",
  leads: 47,
  leadsDelta: "+12",
  qualifiedPct: 28,
  qualifiedDelta: "+4 pts",
  spend: 214,
  avgValue: 179,
  target: 30,
};

describe("<KPIStrip>", () => {
  it("renders four tiles + ROI bar in steady state", () => {
    render(<KPIStrip kpis={flatKpis} />);
    expect(screen.getByText(/bookings/i)).toBeInTheDocument();
    expect(screen.getByText(/leads worked/i)).toBeInTheDocument();
    expect(screen.getByText(/qualified/i)).toBeInTheDocument();
    expect(screen.getByText(/ad spend/i)).toBeInTheDocument();
    expect(screen.getByText(/return on spend/i)).toBeInTheDocument();
    expect(screen.getByText(/This week/i)).toBeInTheDocument();
  });

  it("renders collapsed single-line headline when collapsed=true", () => {
    render(<KPIStrip kpis={flatKpis} collapsed />);
    expect(screen.queryByText(/return on spend/i)).not.toBeInTheDocument();
    // collapsed headline reads "9 bookings · $24 each · +3"
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open report/i })).toBeInTheDocument();
  });

  it("prefers explicit tiles[] over legacy adapter", () => {
    render(
      <KPIStrip
        kpis={{
          range: "This week",
          tiles: [{ label: "ROAS", value: "3.2×", trend: "+0.4×" }],
        }}
      />,
    );
    expect(screen.getByText(/ROAS/i)).toBeInTheDocument();
    expect(screen.queryByText(/leads worked/i)).not.toBeInTheDocument();
  });

  it("handles degraded ROI gracefully (no fill bar)", () => {
    render(<KPIStrip kpis={{ ...flatKpis, spend: null }} />);
    expect(screen.queryByTestId("roi-bar-fill")).not.toBeInTheDocument();
    expect(screen.getByText(/Connect Meta Ads to see return on spend/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run, expect FAIL**

```bash
pnpm --filter @switchboard/dashboard test -- kpi-strip
```

- [ ] **Step 9: Implement `<KPIStrip>`**

```tsx
// apps/dashboard/src/components/cockpit/kpi-strip.tsx
"use client";

import { T } from "./tokens";
import { KpiTile } from "./kpi-tile";
import { ROIBar } from "./roi-bar";
import { legacyTiles, legacyRoi, collapsedHeadline } from "@/lib/cockpit/legacy-shapes";
import type { CockpitKpiData } from "./types";

interface KPIStripProps {
  kpis: CockpitKpiData;
  collapsed?: boolean;
}

export function KPIStrip({ kpis, collapsed = false }: KPIStripProps) {
  const tiles = kpis.tiles ?? legacyTiles(kpis as never);
  const roi = kpis.roi ?? legacyRoi(kpis as never);

  if (collapsed) {
    const head = collapsedHeadline(kpis as never);
    return (
      <div
        style={{
          padding: "10px 28px",
          borderTop: `1px solid ${T.hair}`,
          borderBottom: `1px solid ${T.hair}`,
          background: T.bg,
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: T.ink4,
            textTransform: "uppercase",
          }}
        >
          {kpis.range}
        </span>
        {head.mode === "explicit" ? (
          <span style={{ fontSize: 13, color: T.ink }}>
            <strong style={{ color: T.ink, fontWeight: 600 }}>{head.value}</strong>
            {head.unit ? <span>{head.unit}</span> : null}
            <span style={{ color: T.ink4 }}> {head.label}</span>
            {head.trend ? (
              <>
                <span style={{ color: T.ink4 }}> · </span>
                <span style={{ color: T.green, fontWeight: 500 }}>{head.trend}</span>
              </>
            ) : null}
          </span>
        ) : (
          <span style={{ fontSize: 13, color: T.ink }}>
            <strong style={{ color: T.ink, fontWeight: 600 }}>{head.bookedValue}</strong> bookings
            <span style={{ color: T.ink4 }}> · </span>
            {head.cpb !== null ? (
              <>
                <strong style={{ color: T.ink, fontWeight: 600 }}>${head.cpb}</strong> each
              </>
            ) : (
              <span>— each</span>
            )}
            {head.delta ? (
              <>
                <span style={{ color: T.ink4 }}> · </span>
                <span style={{ color: T.green, fontWeight: 500 }}>{head.delta}</span>
              </>
            ) : null}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={{ all: "unset", cursor: "pointer", color: T.ink2 }}
          aria-label="Open report"
        >
          Open report →
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "16px 28px 20px",
        borderTop: `1px solid ${T.hair}`,
        borderBottom: `1px solid ${T.hair}`,
        background: T.bg,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: T.ink3,
            textTransform: "uppercase",
          }}
        >
          {kpis.range}
        </span>
        <button
          type="button"
          style={{ all: "unset", cursor: "pointer", color: T.ink2 }}
          aria-label="Open report"
        >
          Open report →
        </button>
      </div>
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
          rowGap: 0,
          columnGap: 18,
        }}
      >
        {tiles.map((tile, i) => (
          <KpiTile key={`${tile.label}-${i}`} {...tile} />
        ))}
      </div>
      {roi ? <ROIBar roi={roi} /> : null}
    </div>
  );
}
```

(The `as never` casts on `legacyTiles(kpis)` / `legacyRoi(kpis)` / `collapsedHeadline(kpis)` are acceptable here because `CockpitKpiData` and `LegacyKpiInput` share the same structural fields — the cast is a one-line concession to avoid a duplicate adapter type. If linting flags `any`/`never`, refactor `legacyTiles`/`legacyRoi`/`collapsedHeadline` to accept `CockpitKpiData` directly.)

- [ ] **Step 10: Run, expect PASS**

```bash
pnpm --filter @switchboard/dashboard test -- kpi-tile kpi-strip roi-bar
```

- [ ] **Step 11: Stage**

```bash
git add apps/dashboard/src/components/cockpit/kpi-tile.tsx \
        apps/dashboard/src/components/cockpit/kpi-strip.tsx \
        apps/dashboard/src/components/cockpit/roi-bar.tsx \
        apps/dashboard/src/components/cockpit/__tests__/kpi-tile.test.tsx \
        apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx \
        apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx
```

---

### Task 15: Mount `<KPIStrip>` in `cockpit-page.tsx` + final verification + Commit 5

**Files:**

- Modify: `apps/dashboard/src/components/cockpit/cockpit-page.tsx`
- Modify: (optionally) extend existing `__tests__/cockpit-page.test.tsx` if it exists; otherwise the component tests above cover the contract.

- [ ] **Step 1: Edit `cockpit-page.tsx`**

a. Add imports:

```tsx
import { KPIStrip } from "./kpi-strip";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { metricsViewModelToLegacyKpiInput } from "@/lib/cockpit/metrics-to-kpi-input";
import type { CockpitKpiData } from "./types";
```

b. Inside `CockpitPage()`, after the existing `useAgentMission` call, add:

```tsx
const metricsQ = useAgentMetrics("alex");
```

c. Compute the KPI view-model:

```tsx
const kpis: CockpitKpiData | null = metricsQ.data?.vm
  ? {
      range: `This week · ${metricsQ.data.vm.folioRange}`,
      ...metricsViewModelToLegacyKpiInput(metricsQ.data.vm),
    }
  : null;
```

(If pre-flight verification finds `folioRange` already includes the `"This week · "` prefix, drop the template wrapper and use `range: metricsQ.data.vm.folioRange` directly.)

d. Replace the A.1 comment block in the return JSX with the mount, gated on `!coldState && kpis`:

```tsx
{
  !coldState && kpis ? <KPIStrip kpis={kpis} collapsed={approvals.length > 0} /> : null;
}
```

The placement is between the popover-bearing identity block and `<ApprovalBlock>` — exactly where the A.1 comment marked.

- [ ] **Step 2: Run dashboard tests**

```bash
pnpm --filter @switchboard/dashboard test
```

Expected: green.

- [ ] **Step 3: Workspace-wide verification (the verification gates)**

```bash
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/dashboard test
pnpm typecheck
pnpm lint
pnpm --filter @switchboard/dashboard build
```

All six must be green. If `pnpm typecheck` reports stale Prisma types: `pnpm reset` then rerun.

- [ ] **Step 4: Convention check**

```bash
rg "config\.(avgValueCents|targetCpbCents)" packages/core/src apps/api/src apps/dashboard/src --type ts --type tsx
```

Expected: matches only inside `packages/core/src/agent-home/targets.ts` and the convention test (which references the strings literally as test data).

- [ ] **Step 5: Stage and commit (Commit 5)**

```bash
git add apps/dashboard/src/components/cockpit/cockpit-page.tsx
git commit -m "feat(cockpit): A.3 KPI strip + ROI bar mounted on /alex

- CockpitPage calls useAgentMetrics(\"alex\"); adapts the wire response to
  the legacy CockpitKpiData shape via metricsViewModelToLegacyKpiInput.
- <KPIStrip> renders at the A.1 insertion point between Identity and
  ApprovalBlock when steady-state (cold state still suppresses both
  KPI strip and activity stream — narrator is the entire body).
- collapsed={approvals.length > 0} flips the strip to the single-line
  headline per locked design.

Verifications: pnpm test/typecheck/lint workspace-wide + dashboard build
locally green; convention grep zero matches outside targets.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual smoke**

`pnpm dev` then walk through the §Verification scenarios in the slice brief (cold state; partial setup; full data; pending approval collapses strip; Riley page unaffected). Capture any deviations as blockers, not follow-ups (per `feedback_ship_clean_not_followup`).

---

## Self-review checklist (run after writing this plan)

- [x] Every spec §A.3 requirement maps to a task: targets persistence (Tasks 1–4), spend integration (Tasks 5, 8–10), KPI strip steady/collapsed/cold (Tasks 11, 14, 15), ROI bar full/degraded (Tasks 12, 14), eyebrow range (Task 15).
- [x] No `TBD` / `TODO` / `implement later`. Each step shows the code or the exact command.
- [x] Type names consistent across tasks: `AgentTargets`, `MetricsSignalStore`, `MetricsViewModel`, `MetricsViewModelWire`, `LegacyKpiInput`, `CockpitKpiData`, `KpiTile`, `RoiBar`, `CollapsedHeadline`.
- [x] Dashboard imports use `@/` alias without `.js` extensions (per memory `feedback_dashboard_no_js_on_any_import`).
- [x] Core / API imports retain `.js` extensions in relative imports.
- [x] No schema migration is run at A.3 (config-keys decision).
- [x] No new ad-optimizer imports inside `packages/core`.
- [x] Conventional commit messages with `Co-Authored-By` trailer.
- [x] Five commit boundaries explicitly marked.
- [x] Pre-flight verification step exists and gates downstream tasks against drift from spec assumptions.
