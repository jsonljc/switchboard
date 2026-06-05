# Riley ROI: cost per booked (PR2b — operator-facing tail of PR2 "Target")

**Date:** 2026-06-02
**Status:** Approved (brainstorming complete; ready for plan)
**Branch:** `feat/riley-roi-cost-per-booked` (off `origin/main` @ `d4f9ff0b`)

## Context

PR2 "Target" (#798, merged to `main`) made Riley's ad-optimizer **audit engine** judge
campaigns on cost-per-booked behind a 3-tier economic ladder (account-level calibration).
The engine now optimizes for paying customers — but the **operator-facing ROI surface**
still says "cost per lead". That is a live cross-surface mismatch: the dashboard tells the
operator Riley chases cheap leads while the engine chases booked customers.

PR2b is the deliberately-split operator-facing tail (Task 6 of the PR2 plan,
`docs/superpowers/plans/2026-06-02-riley-pr2-target-plan.md`). It is **operator-facing
only**: it does not touch Riley's audit engine, recommendations, thresholds, or any
mutating path. It is code-independent of #798 (metrics-riley / dashboard do not import the
new schema fields), so it branches off `main` whether or not #798 has landed (it has).

**Goal:** the operator's Riley ROI reads "cost per booked $X · target $Y", matching the
engine that now optimizes for paying customers.

## Scope

### In scope

1. **Core read-model** — `packages/core/src/agent-home/metrics-riley.ts`: compute a real
   cost-per-booked (CAC) from `countBookingsCreated`, relabel the ROI bar, use
   `targetCpbCents` as the booking target it genuinely is, honest degraded fallbacks.
2. **Core tests** — `metrics-riley.test.ts`: update the ROI assertions; add the
   units test and the zero-bookings-with-spend test.
3. **Dashboard proof/paused plumbing** — `key-result.tsx` + `key-result-state.ts`: render
   the server-computed `roi.comparator` for Riley's agent-panel hero; delete the
   client-side CPL recompute.
4. **Fixture refreshes** — three cockpit/lib test fixtures that hardcode the stale
   `"cost per lead"` sample payload.

### Out of scope (verified against live code — do **not** touch in this PR)

- **`this-week.tsx` / `home-page.tsx` / `home/types.ts` `costPerLead`** — this is **Alex's**
  Home week-note (`home-page.tsx:170`, fed by `alexMetrics`;
  `costPerLead = centsPerLeadToDisplay(m.spendCents, m.leads)`). It is a genuinely-labeled
  cost-per-lead for Alex's funnel (Alex's hero is already `bookedConsults`). It is not a
  Riley ROI surface and relabeling it would mislabel Alex's real metric.
- **Mercury `/reports` CPL columns** — separate surface.
- **Recommendation cards / `economicTier` / `marginBasis` UI** — `use-ad-optimizer.ts` has
  zero dashboard consumers and the typed fields are referenced nowhere in the UI. There is
  no live surface that parses the rationale string. **Deferred** (no surface to fix).
- **Riley's audit engine** (`packages/ad-optimizer`) — unchanged.

## Design

### 1. Core read-model — `metrics-riley.ts`

Riley's hero stays **ad-leads** (the headline number is leads generated). Only the `roi`
object changes: Riley's _economic efficiency_ is judged on **bookings**, not leads —
mirroring the engine's account-level booked-CAC.

**Bookings fetch.** Add one store call alongside the existing `Promise.all`, mirroring
`metrics-alex.ts`'s `countBookings` helper:

```ts
// Must match metrics-alex.ts EXCLUDE_STATUSES so Riley's CAC denominator stays in
// lockstep with Alex's booking hero. Alex currently excludes only "cancelled"
// (verified metrics-alex.ts). If that list changes, change it in both files.
const EXCLUDE_STATUSES = ["cancelled"] as const;

const bookings = await store.countBookingsCreated({
  orgId,
  excludeStatuses: EXCLUDE_STATUSES,
  from: week.weekStart,
  to: week.weekEnd,
});
```

> **Decision (tightening edit #1):** `metrics-alex.ts:17` excludes **only `["cancelled"]`**,
> not `no_show`. The PR2b directive's `["cancelled","no_show"]` was the recommended-_if_-
> Alex-does-too. Adding `no_show` would make Riley's CAC denominator diverge from Alex's
> booking hero (Alex counts no-shows as booked) — a _new_ cross-surface inconsistency. So
> we mirror Alex exactly with `["cancelled"]`. Changing the list is out of this PR's scope.

`bookings` is **org-level** (same call Alex uses) → Riley's "cost per booked" = Riley's ad
spend ÷ org bookings in the window = account-level CAC, consistent with PR2's account-level
calibration philosophy.

**CAC computation + relabel.** Replace the `cpl` block:

```ts
const cac = spendCents !== null && bookings > 0 ? Math.round(spendCents / 100 / bookings) : null;
let cacDisplay = "—";
if (cac !== null) cacDisplay = cac === 0 ? "<$1 per booked" : `$${cac} per booked`;
```

`targetCpbCents` is now used as the **booking** target it genuinely is. Delete the stale
"Riley v1 reinterprets `targetCpbCents` as target cost per lead" comment block.

> **Units (tightening edit #4):** `targetCpbCents` is **cents** — `1000 → "target $10"`
> (`Math.round(targetCpbCents / 100)`). This is a **different config surface** from the
> audit's `targetCostPerBooked`, which is **dollars** sourced from `AgentRoster.config` via
> the engine's `inputConfig`. PR2b does **not** unify them. A test asserts `1000 → $10`.

**ROI rules** (the `roi` IIFE). Riley keeps `degraded: true` in all branches (existing
behavior; full RoiBar with fill/break-even is not in PR2b scope — polish, not
over-engineering). Only `label`, `comparator`, and `degradedHint` change:

| Rule | Condition                              | `label`           | `degradedHint`                            | `comparator.value` | `comparator.target` |
| ---- | -------------------------------------- | ----------------- | ----------------------------------------- | ------------------ | ------------------- |
| 1    | `spendCents === null`                  | `cost per booked` | `Connect Meta Ads to see cost per booked` | `—`                | `targetLabel`       |
| 2    | `spendCents !== null && bookings <= 0` | `cost per booked` | `No bookings attributed yet`              | `—`                | `targetLabel`       |
| 3+4  | `spendCents !== null && bookings > 0`  | `cost per booked` | `""`                                      | `cacDisplay`       | `targetLabel`       |

where `targetLabel = targetCpbCents !== null ? ` + `` `target $${round(targetCpbCents/100)}` `` + ` : "—"`.

> **Rule 2 (tightening edit #5):** spend present but zero bookings is _common_ for Riley —
> it feeds leads; bookings lag (and arrive via Alex). Without an explanation the operator
> sees spend + a hero full of leads but a blank ROI. The `No bookings attributed yet` hint
> explains the blank. Never divide by zero, never emit a fake CAC, never `$Infinity`/`$0`.

Untouched in this file: hero (`ad-leads`), `spark`, `stats` (Leads/CTR/Spend), `tiles`
(leads/ctr/ad spend), `qualifiedPct = 0`, `leads`, freshness, deltas.

### 2. Dashboard — agent-panel proof/paused plumbing

The Riley agent-panel hero comparator (`key-result.tsx`) today recomputes CPL client-side
via `buildCplBeat(spendCents, hero.value /* =leads */, targetCpbCents)`. It has no bookings
count, and `selectKeyResult` threads only `hero`/`spendCents`/`targets` into proof state.

**Approach (chosen): consume the server-computed `roi` (single source of truth).** The
read-model already computes the CAC; the dashboard should render it, not re-derive it.
`MetricsViewModelWire.roi?: RoiBarWire` already exists on the wire
(`lib/cockpit/metrics-types.ts:63`) — **no wire-schema change needed.**

- **`key-result-state.ts`** — add `roi: MetricsViewModelWire["roi"] | null` to the `proof`
  state (and `paused`, for shape parity), sourced from `all.data?.roi ?? week.data?.roi`
  the same way `hero`/`spendCents`/`targets` are picked.
- **`key-result.tsx`** — in the proof branch, replace the `cplBeat` logic. Render the
  comparator only when Riley + ad-leads hero + a usable ROI proof exists:

  ```ts
  const roi = result.roi;
  const hasRoiProof =
    !!roi && "comparator" in roi && roi.comparator.value !== "—" && roi.comparator.target !== "—";

  const rileyRoiLine =
    agentKey === "riley" && hero.kind === "ad-leads" && hasRoiProof
      ? `${roi.comparator.value} · ${roi.comparator.target}`
      : null;
  ```

  Render `{rileyRoiLine && <p className={styles.heroComp}>{rileyRoiLine}</p>}`. **Delete
  `buildCplBeat`** and the now-unused `formatCents` import if it becomes orphaned.

> **`hasRoiProof` (tightening edit #2):** gate on the comparator being non-blank, **not** on
> `roi.degraded`. The read-model marks Riley's ROI `degraded: true` even when there is a
> useful comparator, so gating on `degraded` would wrongly hide a real CAC. Requiring both
> `value` and `target` to be present matches today's behavior (`buildCplBeat` only rendered
> when `targetCpbCents != null`).

> **Hint placement (tightening edit #3):** `"No bookings attributed yet"` lives in
> `roi.degradedHint` and is rendered by the cockpit ROI bar — **never** in the agent-panel
> hero. The agent-panel hero renders the comparator only when `hasRoiProof`; when CAC is
> blank it shows nothing (no `"— · target $Y"`).

The cockpit `roi-bar.tsx` already renders `roi.label` and `roi.comparator` generically
(`roi-bar.tsx:51,66`), so it auto-reflects the new label/value with **no component change**.

### 3. Fixture refreshes

Three test files hardcode `"cost per lead"` / `"$N per lead"` as _sample_ RoiBar payloads
(not assertions against `metrics-riley` output). Refresh to `"cost per booked"` /
`"$N per booked"` so they don't mislead future readers:

- `apps/dashboard/src/lib/cockpit/__tests__/metrics-types.test.ts`
- `apps/dashboard/src/components/cockpit/__tests__/roi-bar.test.tsx`
- `apps/dashboard/src/components/cockpit/__tests__/kpi-strip.test.tsx`

## Tests

### Core — `metrics-riley.test.ts`

Update the existing ROI `.toEqual` assertions (label → `"cost per booked"`; comparator
driven by the **booking** denominator, not leads). The store mock already stubs
`countBookingsCreated`; extend `makeStore` with a `bookingsThisWeek?` option so ROI tests
set the booking count. Leave hero/spark/stats/tiles/`qualifiedPct === 0` assertions
untouched.

Concrete cases (re-mapped from the current 5 ROI tests + 2 new):

- **Rule 1** — `spendCents === null` → `label: "cost per booked"`,
  `degradedHint: "Connect Meta Ads to see cost per booked"`, `comparator: { value: "—", target }`.
- **Rule 2 (NEW, edit #5)** — spend present, `bookings = 0`, `targetCpbCents = 4000` →
  `label: "cost per booked"`, `degradedHint: "No bookings attributed yet"`,
  `comparator: { value: "—", target: "target $40" }`.
- **Rule 3** — spend present, `bookings > 0`, `targetCpbCents = null` →
  `comparator: { value: "$N per booked", target: "—" }`, `degradedHint: ""`.
- **Sub-dollar guard** — small spend, high bookings → `value: "<$1 per booked"`.
- **Rule 4 + units (edit #4)** — spend present, `bookings > 0`, `targetCpbCents = 1000` →
  `comparator: { value: "$X per booked", target: "target $10" }` (asserts 1000 cents → $10).

### Dashboard

- **`key-result-state.test.ts`** — assert `roi` is threaded into proof/paused state.
- **`key-result.test.tsx`** — rewrite the existing "Riley CPL beat" test (test 6): supply a
  VM whose `roi.comparator` is `{ value: "$44 per booked", target: "target $35" }` and
  assert the rendered line is `"$44 per booked · target $35"` (neutral ink, no green/red
  classes). Add a test that a blank-CAC `roi` (`value: "—"`) renders **no** comparator line.
  Keep test 5 (halted → no comparator).
- **Cockpit fixtures** — updated payloads still parse/render (assertions follow the new
  strings).

## Constraints / gotchas

- `core` is Layer 3 (imports schemas/cartridge-sdk/sdk; **not** db/ad-optimizer).
  `metrics-riley` stays in core; bookings come from the injected `MetricsSignalStore`.
- Units: this surface is **cents** end-to-end (`targetCpbCents`, `spendCents`). Do not
  confuse with the engine's dollar `targetCostPerBooked`.
- Dashboard: relative imports omit `.js`; coverage gate is 40/35/40/40. `next build` and the
  dashboard vitest suite are now in CI (#803), but still run
  `pnpm --filter @switchboard/dashboard build` locally — only the build catches a missing
  `.js`/import.
- Commitlint lowercase subjects; Prettier (double quotes, semi, 2-space, trailing commas,
  100w); `pnpm format:check` before push (CI lint runs prettier; local lint does not).

## Verification

```bash
CI=true pnpm --filter @switchboard/core test metrics-riley
CI=true pnpm --filter @switchboard/dashboard test -- key-result roi-bar kpi-strip metrics-types
pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard build      # not relied on in CI historically; catches .js/import gaps
pnpm format:check
```

## PR shape

- **Title:** `feat(core): show Riley ROI as cost per booked`
- **Body must state:** "This is operator-facing only. It does not change Riley's audit
  engine, recommendations, thresholds, or mutating paths." Plus the in/out-of-scope list.
- One focused PR to `main`, separate from the PR2 engine work.
