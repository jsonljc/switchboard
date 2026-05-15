# Alex Cockpit A.3 — KPI Strip + ROI Bar + Targets Persistence

**Date:** 2026-05-15
**Parent spec:** [Alex Cockpit Home — Full Phase A Target Spec](../specs/2026-05-14-alex-cockpit-home-design.md) (§Implementation slices → A.3, §KPI strip, §ROI bar, §Backend changes §1 + §4)
**Predecessor slice:** [A.2 Slice Brief](./2026-05-14-alex-cockpit-a2-slice-brief.md) — merged 2026-05-14 as #485 (`67eb0618`)
**Sibling spec:** [Riley Cockpit Home](../specs/2026-05-13-riley-cockpit-home-design.md) (target spec on branch `docs/riley-cockpit-home-spec`)

> **Slice brief is authoritative.** Where this brief and the parent spec conflict, this brief wins for A.3. Where this brief and the corresponding implementation plan conflict, this brief wins.

---

## Slice goal

Bring Alex's performance numbers onto the cockpit. The shell already reserves a `KPIStrip` slot between `<Identity>` and the approval block (A.1 insertion comment in `cockpit-page.tsx:97`); A.3 mounts the four KPI tiles (bookings · leads worked · qualified · ad spend), the ROI bar with break-even mark and per-booking comparator, and the collapsed-when-approval-open headline. The same slice wires the two backend echoes the locked-design ROI math reads — `target` (cost-per-booking target) and `avgValue` (per-booking value) — and the Meta Ads spend integration, with deterministic degraded states when either is null.

A.3 proves the metrics endpoint can carry both backend-emitted (Riley) and client-adapted (Alex) shapes without forking the route, and locks the storage convention for Alex/Riley target values.

---

## Decision lock — `AgentRoster.config` JSON keys, not columns

**`avgValueCents` and `targetCpbCents` live in `AgentRoster.config` as JSON keys.** They are read **only** through `getAgentTargets(roster)` in `packages/core/src/agent-home/targets.ts`. Direct reads of `roster.config.avgValueCents` / `roster.config.targetCpbCents` are forbidden in metrics code; a convention test enforces this.

**Why config over columns:**

- Storage symmetry with the five sibling threshold keys (`priceApprovalThreshold`, `refundEscalationFloor`, `quietHours`, `founderRateEnabled`, `calendar.providerId`, `reEngagementTemplate`) that already live in `config`.
- The values are per-roster scalars, never queried in `WHERE` clauses — DB-level typing/indexability gives no practical benefit.
- No migration blast radius. A.3 already carries KPI strip + ROI bar + legacy-shape adapter + `metrics-alex` extension + metrics-endpoint wiring; avoiding a schema migration keeps the PR focused and skips the `migrate diff` / `db:check-drift` workflow that adds review surface.
- The typed seam (`getAgentTargets`) sits at the application boundary — equivalent practical safety to a typed column for this access pattern.

**Spec correction needed (separate docs PR):** The Riley Wave A slicing spec (`docs/superpowers/specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md` on branch `origin/docs/riley-cockpit-home-spec`) §B.2 currently locks "**columns over `config` JSON** for typed access, easier check-drift, future schema discoverability" (line 131; also §B.2 acceptance line 141 and §Backend-changes-by-slice line 416). This decision is **overridden by A.3**. When that spec lands on `main`, a focused docs PR must amend it to:

> Riley/Alex target values are stored in `AgentRoster.config` as JSON keys and read only through `getAgentTargets(roster)`. No schema migration is required. The metrics endpoints tolerate missing keys and emit degraded ROI/CPL states when targets are null.

A.3 does not itself touch the unmerged Riley branch. The amendment is tracked as a post-A.3 action item.

---

## What ships

### Core (`packages/core/src/agent-home/`)

| File                                         | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targets.ts` (new)                           | `getAgentTargets(roster: { config: unknown }): { avgValueCents: number \| null; targetCpbCents: number \| null }`. Defensive JSON read (same pattern A.2's `mission.ts` established with `readNumberKey`). The _only_ canonical reader for these two keys. Exported through `packages/core/src/agent-home/index.ts`.                                                                                                                                                                                                                                                                                 |
| `__tests__/targets.test.ts`                  | Both keys present; both absent (`config: {}` and `config: null`); one present one absent; non-number values (string/boolean) coerced to null; defensive against non-object config.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `metrics-types.ts` (modified)                | Extend `MetricsSignalStore` with `getMetaSpendCents(input: { orgId: string; from: Date; to: Date }): Promise<number \| null>`. Extend `PerAgentBuilderInput` with required `targets: { avgValueCents: number \| null; targetCpbCents: number \| null }`. Extend `MetricsViewModel` with `targets: { avgValueCents: number \| null; targetCpbCents: number \| null }`, `spendCents: number \| null`, `bookedDelta: string \| null` (week-over-week sign-prefixed delta string like `"+3"`), `leadsDelta: string \| null`, `qualifiedDelta: string \| null` (pp-formatted; `null` when no comparator). |
| `metrics-alex.ts` (modified)                 | Echo `targets` from `PerAgentBuilderInput` onto the response. Call `store.getMetaSpendCents` for the current week's range. Emit `spendCents` (null when provider returns null). Emit `bookedDelta` / `leadsDelta` / `qualifiedDelta` strings using the existing `heroPrev` and a new `leadsPrev` / `qualifiedPrev` pair. The flat `Spend` cell in `stats` continues to render `unavailable: true` when `spendCents === null`; renders `display: "$NNN"` with `unavailable: false` when present.                                                                                                      |
| `__tests__/metrics-alex.test.ts` (extended)  | Targets echo from `targets` input; spend present (formatted as `display: "$214"`); spend null preserves `unavailable: true`; delta strings render with `+` / `-` / no-prefix for flat; cross-cell freshness still emits `"ad-platform-spend"` only when spendCents is null.                                                                                                                                                                                                                                                                                                                          |
| `metrics-riley.ts` (modified)                | Same shape extension — emit `targets` echo + `spendCents` + delta strings. Riley uses the explicit `tiles[]` + `roi` server-side per its own spec; A.3 only adds the **echo fields**, not Riley's `tiles`/`roi` (B.2's responsibility). Keeps the API endpoint single-shape.                                                                                                                                                                                                                                                                                                                         |
| `__tests__/metrics-riley.test.ts` (extended) | Targets echo round-trips through Riley path too (proves shared shape).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `index.ts` (modified)                        | Export `getAgentTargets`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**No schema migration.** No Prisma changes. `AgentRoster.config` already exists as `Json @default("{}")`.

### Fastify API (`apps/api/src/routes/agent-home/metrics.ts` + sibling)

| Change                                     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metrics.ts` (modified)                    | Before calling `projectMetrics`: load `AgentRoster` row for `{ organizationId: orgId, agentRole: agentId }` via `app.prisma.agentRoster.findUnique`. Compute `targets = getAgentTargets(roster ?? { config: {} })`. Build store with `getMetaSpendCents` wired to the per-org Meta Ads `Connection` lookup (returns `null` when no connection or when the provider call throws). Pass `targets` into `projectMetrics`.           |
| `lib/meta-spend-provider.ts` (new)         | `buildMetaSpendProvider(prisma, adOptimizer)` — factory returning the `getMetaSpendCents` impl. Looks up `Connection` row with `serviceId === "meta-ads"`, `status === "connected"`. When absent, returns null without calling the provider. When present, calls `metaCampaignInsightsProvider` (from `@switchboard/ad-optimizer`) for the date range, sums `spendCents` across rows, returns sum (or null if provider rejects). |
| `__tests__/meta-spend-provider.test.ts`    | No `Connection` → null; degraded `Connection` → null (treat as inactive); provider throws → null + logs warning; happy path returns sum. Mock `prisma.connection.findFirst` and `metaCampaignInsightsProvider`.                                                                                                                                                                                                                  |
| `__tests__/api-metrics.test.ts` (extended) | Targets echo when `config` has both keys; `null` when keys absent; spend null when no Connection row; spend numeric when Connection + provider mocked.                                                                                                                                                                                                                                                                           |

**Note on layer boundary:** `apps/api` (Layer 5) can import from `@switchboard/ad-optimizer`. `packages/core` (Layer 3) cannot — and doesn't, since spend comes through the store interface.

### Dashboard wire types (`apps/dashboard/src/lib/cockpit/`)

| File                     | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metrics-types.ts` (new) | Re-export / mirror the wire shape additions: `MetricsTargets`, the extended `MetricsViewModel` echo fields. Dashboard-local type mirror (same pattern as A.2's `mission-types.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `legacy-shapes.ts` (new) | Port `legacyTiles(k)` and `legacyRoi(k)` and `collapsedHeadline(k)` from the locked-design `cockpit.jsx` reference (lines 327, 335, 354) to TypeScript. Inputs typed as `LegacyKpiInput = { booked: number \| null; bookedDelta: string \| null; leads: number \| null; leadsDelta: string \| null; qualifiedPct: number \| null; qualifiedDelta: string \| null; spend: number \| null; avgValue: number \| null; target: number \| null }`. Outputs typed as `KpiTile[]` and `RoiBar` (existing in `components/cockpit/types.ts`, extended at A.3 — see below). `legacyRoi` priority (explicit, in order — first match wins): |

1. `spendCents === null` → degraded; `degradedHint: "Connect Meta Ads to see return on spend"` (regardless of `avgValueCents`).
2. `spendCents > 0 && avgValueCents === null` → degraded; `degradedHint: "Set average booking value to see return on spend"`.
3. `spendCents > 0 && avgValueCents != null && bookings <= 0` → degraded; comparator pill renders `"—"` (no hint copy — the degradation is "no math possible," not a missing setup step).
4. Live only when `spendCents > 0 && avgValueCents != null && bookings > 0`. `legacyTiles` emits `unavailable: true` + `hint: "Connect Meta Ads"` for the `ad spend` tile when `spend === null`; uses `value: "$NNN"` string for present spend (matching locked design). |
   | `__tests__/legacy-shapes.test.ts` | Steady-state full ROI (cpb on-target / off-target); fillPct cap at 6×; `legacyRoi` hint priority covered as a four-row table-driven test exercising each case in §`legacy-shapes.ts` priority order — `spend null + avgValue null` → Meta Ads hint, `spend null + avgValue set` → still Meta Ads hint (rule 1 wins over rule 2), `spend set + avgValue null` → Set-avg-value hint, `spend set + avgValue set + bookings === 0` → degraded with comparator `"—"` and **no hint copy**, `spend set + avgValue set + bookings > 0` → live; `ad spend` tile renders unavailable correctly; `collapsedHeadline` reads first non-unavailable tile when explicit `tiles[]` present and falls back to flat-shape headline (`X bookings · $Y each · +Z`) otherwise. |
   | `metrics-to-kpi-input.ts` (new) | Adapter `metricsViewModelToLegacyKpiInput(vm)` mapping the wire response to `LegacyKpiInput`. Reads: `booked = vm.hero.value`, `bookedDelta = vm.bookedDelta`, `leads = vm.stats[0].rawValue` (or new dedicated field; see Risks), `qualifiedPct = vm.stats[1].rawValue * 100`, `qualifiedDelta = vm.qualifiedDelta`, `spend = vm.spendCents ?? null` (converted to dollars: `Math.round(vm.spendCents / 100)`), `avgValue = vm.targets.avgValueCents ? Math.round(vm.targets.avgValueCents / 100) : null`, `target = vm.targets.targetCpbCents ? Math.round(vm.targets.targetCpbCents / 100) : null`. |
   | `__tests__/metrics-to-kpi-input.test.ts` | All fields round-trip; spendCents null → spend null; targets null → null in legacy shape; cents → dollars rounding. |

### Dashboard cockpit types (`apps/dashboard/src/components/cockpit/types.ts`, modified)

Add the spec §Appendix `KpiTile`, `RoiBarFull`, `RoiBarDegraded`, `RoiBar` union, and `CockpitKpiData` interfaces. Additive — no existing types changed.

### Dashboard cockpit components (`apps/dashboard/src/components/cockpit/`)

| File                           | Responsibility                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kpi-tile.tsx` (new)           | `<KpiTile>` — single tile component matching locked design `KPI` (cockpit.jsx:380). Renders `label` (eyebrow), `value` + optional `unit`, `trend` line. Unavailable branch shows `—` + dashed-underline `{hint} →` button. Pure component — no data fetching. Props: `KpiTile` type from `types.ts`.                                                                                             |
| `__tests__/kpi-tile.test.tsx`  | Renders label/value/unit/trend; unavailable branch renders dash + hint; trend `+` prefix uses green class, `-` uses red, flat uses muted; click on hint button is a no-op at A.3 (wired at A.5 via composer commands; emit `data-testid` for future tests).                                                                                                                                      |
| `kpi-strip.tsx` (new)          | `<KPIStrip kpis={kpis} collapsed={collapsed} />` — orchestrates the four tiles + ROI bar. Reads `kpis.tiles` first; if absent, calls `legacyTiles(kpis)` from `lib/cockpit/legacy-shapes`. Same for `roi` via `legacyRoi`. When `collapsed`, renders the single-line `collapsedHeadline` row (locked design cockpit.jsx:284). Eyebrow text: `kpis.range` (e.g. `"This week · May 12 – May 18"`). |
| `__tests__/kpi-strip.test.tsx` | Steady state renders four tiles + ROI bar; collapsed renders single-line headline (no tiles, no ROI); explicit `tiles[]` takes precedence over legacy adapter; `roi` absent (e.g., degraded both ways) still renders strip; eyebrow shows the range string.                                                                                                                                      |
| `roi-bar.tsx` (new)            | `<ROIBar roi={roi} />` — full or degraded variant per the locked design (cockpit.jsx:422). Reads `accent` from `ALEX_CONFIG` via `T` tokens.                                                                                                                                                                                                                                                     |
| `__tests__/roi-bar.test.tsx`   | Full variant: bar fillPct clamped 0..100; break-even tick rendered at correct percent; comparator pill green when `onTarget`; comparator pill amber otherwise. Degraded variant: dashed top border; no bar track; comparator pill rendered; degradedHint copy rendered exactly (both hint strings tested).                                                                                       |

### Dashboard hook (`apps/dashboard/src/hooks/use-agent-metrics.ts`)

`useAgentMetrics(agentKey)` already exists and reads `vm: MetricsViewModel`. A.3 extends the return type to surface the new fields (`targets`, `spendCents`, `bookedDelta`, `leadsDelta`, `qualifiedDelta`). No behavior change beyond the typed-response widening.

| Change                                            | Responsibility                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Hook return-type widening                         | TS-only; runtime unchanged. Test asserts the new fields are typed and present in the parsed response when the upstream returns them. |
| `__tests__/use-agent-metrics.test.tsx` (extended) | Parses targets + spend echo; tolerates missing fields gracefully (for older API responses during deploy skew — defaults to null).    |

### CockpitPage composition (`apps/dashboard/src/components/cockpit/cockpit-page.tsx`)

Modified to:

1. Call `useAgentMetrics("alex")` alongside existing hooks.
2. Build `kpis: CockpitKpiData` via `metricsViewModelToLegacyKpiInput(metricsQ.data.vm)` when `metricsQ.data` is present, with `range` set to the spec format. The range is computed client-side from `vm.freshness.generatedAt` (the existing endpoint exposes the week window via `folioRange`, but the locked design's eyebrow reads `"This week · May 12 – May 18"` — see Risks for the source-of-truth call).
3. Mount `<KPIStrip kpis={kpis} collapsed={approvals.length > 0} />` between `<Identity>` (and its popover sibling) and the approval block — at the A.1 insertion-point comment.
4. **Cold state preserved:** when `coldState` (mission-driven empty state), render EmptyState as A.2 already does and **do not render KPIStrip**. Activity stream is suppressed by A.2; KPIStrip joins that suppression set.

---

## What does NOT ship at A.3

- ❌ Riley's `tiles[]` / `roi` backend emission (per Riley Wave A B.2 — but with the column → config-key amendment locked above).
- ❌ KPI tile "best Mon"-style superlative trend strings — v1 ships numeric deltas only (per spec §KPI strip).
- ❌ Composer / palette / `parseCommand` (A.5).
- ❌ Activity stream changes (A.4).
- ❌ Thread previews / "Tell Alex about {firstName}" (A.4).
- ❌ Schema migration for `AgentRoster.avgValueCents` / `targetCpbCents` columns — overridden by the config-keys decision above. No `migrate diff` / `migrate deploy` / `db:check-drift` workflow is run at A.3.
- ❌ `Approval.payload.kind` / `quote` / `quoteFrom` / `body` schema additions (A.5).
- ❌ `RecommendationPresentation.acceptToast` / `declineToast` (A.5).
- ❌ Activity endpoint changes (A.4).
- ❌ Sprite avatars (out of Phase A).
- ❌ Inline "set average booking value" UX in the cockpit — the degraded comparator pill is a read-only signal at A.3. The "Set average booking value" hint copy is rendered; the click handler is a no-op (composer command lands at A.5).
- ❌ Inline "Connect Meta Ads" CTA flow — A.3 renders the unavailable tile + hint copy; the deep-link wiring to `/setup?step=meta` is via the existing setup-row routing pattern in A.2's EmptyState and is **not** re-implemented here (the steady-state KPI tile's hint button uses `data-testid` for future wiring; A.3 leaves it inert per locked design — operators see the cold state for full setup flow).
- ❌ Status pill vocabulary change — `WORKING/IDLE/WAITING/HALTED` stays. `TALKING + liveCount` requires conversation-grain signals (later phase).
- ❌ `HaltProvider` re-rooting — provider stays mounted by `EditorialAuthShell` (A.6).
- ❌ Deletion of any A.1/A.2 file. Same retirement gate (A.6) applies.

---

## Acceptance gates (slice-scoped)

From the parent spec's §Phase A acceptance criteria, the A.3 subset:

1. **KPI strip steady state (criterion 3):** `/alex` with a non-cold mission state renders four tiles: `bookings`, `leads worked`, `qualified`, `ad spend`. Numeric trend deltas render with `+`/`-` prefix or no prefix for flat. Eyebrow renders `"This week · {start} – {end}"`. ✅
2. **KPI strip cold state:** when EmptyState renders (A.2 gating), KPIStrip does **not** render. No empty placeholder. ✅
3. **KPI strip collapsed-on-approval:** when `approvals.length > 0`, KPIStrip collapses to single-line headline reading the first non-unavailable tile. Tiles and ROI bar do not render in this mode. "Open report →" link present (inert per A.3 scope). ✅
4. **ROI bar full state:** renders fillPct clamped 0..100; break-even tick at correct percent; comparator pill green when `cpb <= target`, amber otherwise. Scale labels `"$0"` and `"6× spend"` per locked design. ✅
5. **ROI bar degraded states:** dashed top border, no bar track. Hint priority is explicit (first match wins): (a) `spend === null` → `"Connect Meta Ads to see return on spend"` regardless of `avgValue`; (b) `spend > 0 && avgValue === null` → `"Set average booking value to see return on spend"`; (c) `spend > 0 && avgValue != null && bookings <= 0` → degraded with comparator `"—"` and no hint copy; (d) all three sane → live. Comparator pill renders with `"—"` cpb when undefined. ✅
6. **Targets persistence:** `AgentRoster.config.avgValueCents` and `targetCpbCents` are read **only** through `getAgentTargets`. Convention test `pnpm test:targets-convention` (or equivalent grep) passes. Direct config-key access in `packages/core/src/agent-home/metrics-*.ts` and `apps/api/src/routes/agent-home/*.ts` returns zero matches. ✅
7. **Spend integration:** when an Org has a `Connection` row with `serviceId: "meta-ads"`, `status: "connected"`, the metrics endpoint returns numeric `spendCents`. When absent or `status !== "connected"`, returns `null`. Provider errors return `null` and log a warning. ✅
8. **API response additive:** existing `vm` fields unchanged; new fields (`targets`, `spendCents`, `bookedDelta`, `leadsDelta`, `qualifiedDelta`) are additive. Old dashboard hook consumers continue to work. ✅
9. `pnpm typecheck` + `pnpm lint` + `pnpm --filter @switchboard/core test` + `pnpm --filter @switchboard/api test` + `pnpm --filter @switchboard/dashboard test` + `pnpm --filter @switchboard/dashboard build` all green locally. (`next build` is not in CI per `feedback_dashboard_build_not_in_ci`.)

**Out of A.3 acceptance:** activity richness, thread preview, composer, palette, schema migrations, Riley-side `tiles[]`/`roi` emission, command-button wiring.

---

## Risks specific to A.3

- **`MetricsViewModel` shape drift vs spec.** Spec §KPI strip says `metrics-alex` already emits `{ heroValue, stats, spark, subprose }`. **Reality:** it emits `{ hero, heroSubProseSegments, spark, stats, freshness, folioRange }`. The legacy adapter reads `hero.value` (not `heroValue`). **Mitigation:** the adapter is the seam — `metricsViewModelToLegacyKpiInput` translates real-shape to legacy-shape on the dashboard side. Backend keeps emitting the real shape plus new echo fields. Tests assert exact wire-shape names.
- **`leads worked` source.** Today's `metrics-alex` puts leads into `stats[0]` with `display: String(leads)` and `rawValue: leads`. **Mitigation:** A.3 adds a top-level `leads` echo on the response (alongside `bookedDelta`/`leadsDelta`/`qualifiedDelta`) so the legacy adapter doesn't reach into `stats[]` array slots — array-index reads are fragile. **Locked: `MetricsViewModel` gains `leads: number` + `qualifiedPct: number` echo fields too.** (Updated from the table above — final wire shape includes `bookedDelta`, `leads`, `leadsDelta`, `qualifiedPct`, `qualifiedDelta`, `spendCents`, `targets`.)
- **Range eyebrow format.** Locked design reads `"This week · May 12 – May 18"`. `metrics-alex` already emits `folioRange` (string). Inspect existing format before deciding to reuse vs reshape. **Mitigation:** if `folioRange` matches the locked-design format, reuse verbatim; otherwise extend `MetricsViewModel` with `rangeShort: { start: string; end: string }` and build the eyebrow client-side. Verify in the audit step before coding.
- **`MetricsSignalStore` extension breaks existing callers.** Today the store is implemented inline in `apps/api/src/routes/agent-home/metrics.ts:49`. Adding a required method breaks Riley's store as well as core tests. **Mitigation:** the required-method extension is the right call (avoiding optional methods that silently default to null). All callers — the API route and the three core test files (`metrics-alex.test.ts`, `metrics-riley.test.ts`, `metrics.test.ts`) — get a vi-mock of `getMetaSpendCents`. Each is a one-line addition.
- **Meta Ads `Connection` schema unknowns.** A.2's `mission.ts` reads `Connection.serviceId` and `Connection.status` — verify the canonical values during audit step. Spec uses `"meta-ads"` / `"connected"` but the actual `Connection` model may use different naming (the WhatsApp launch readiness work introduced canonical service IDs but Meta Ads specifically wasn't audited). **Mitigation:** audit step in implementation plan verifies the constant before any code lands.
- **`metrics-riley.ts` shape extension may collide with B.1.** Riley B.1 already merged. **Mitigation:** A.3 adds echo fields to Riley's response too (since they're shared shape) but **does not** emit `tiles[]` / `roi` from Riley's path — that's B.2's job. The extension is additive on Riley too.
- **`pnpm reset` may be required.** The spec doesn't change Prisma. **Mitigation:** A.3 should not need `pnpm reset`. If `pnpm typecheck` reports unknown fields on the schemas/core build chain, run `pnpm reset` per `CLAUDE.md` (stale lower-layer `dist/`).
- **Dashboard `.js` extension regression.** Per `feedback_dashboard_no_js_on_any_import` — dashboard imports never use `.js` even with `@/` alias. **Mitigation:** plan includes `pnpm --filter @switchboard/dashboard build` as an explicit verification step before claiming the dashboard work is done.
- **600-line file pressure.** `kpi-strip.tsx` + `roi-bar.tsx` + `legacy-shapes.ts` + tests should comfortably fit under the 400-line warn threshold per file. `kpi-strip.tsx` is mostly composition (tiles loop + ROI mount); `roi-bar.tsx` carries the most layout but stays focused. **Mitigation:** track per-file line counts at commit boundary; if any file approaches 400 lines, split before merging.
- **Convention enforcement.** Spec says lint convention forbids direct `roster.config.targetCpbCents` access in `metrics-*.ts`. **Mitigation:** start with a convention test (a vitest test that does `git grep` for the forbidden patterns and asserts zero matches outside `targets.ts` and tests/docs). Heavy ESLint custom rules are out of scope.

---

## Verification before merge

1. `pnpm --filter @switchboard/core test` — green; new `targets.test.ts` + extended metrics tests pass.
2. `pnpm --filter @switchboard/api test` — green; new `meta-spend-provider.test.ts` + extended `api-metrics.test.ts` pass.
3. `pnpm --filter @switchboard/dashboard test` — green; new tile / strip / bar / legacy-shapes / adapter tests pass.
4. `pnpm typecheck` workspace-wide — clean.
5. `pnpm lint` workspace-wide — clean.
6. `pnpm --filter @switchboard/dashboard build` — succeeds locally (per `feedback_dashboard_build_not_in_ci` + `feedback_dashboard_no_js_on_any_import`).
7. Convention check: `rg "config\.(avgValueCents|targetCpbCents)" packages/core/src apps/api/src apps/dashboard/src --type ts --type tsx` returns zero matches outside `targets.ts` / its tests / this slice brief.
8. Manual `pnpm dev` walkthroughs:
   - `/alex` with empty seed (no Connections, no AgentRoster.config keys) → cold state (no KPI strip).
   - `/alex` with seeded bookings/leads but no Meta Ads Connection → KPI strip shows three populated tiles + `ad spend` unavailable; ROI bar degraded with Meta Ads hint.
   - `/alex` with Connection + bookings/leads but no `avgValueCents` → KPI strip + ROI bar degraded with `"Set average booking value"` hint.
   - `/alex` with all four fields seeded → full ROI bar with break-even tick and on-target comparator (set `targetCpbCents` accordingly).
   - `/alex` with a pending approval injected → KPI strip collapses to single-line headline; tiles/ROI hidden.
   - `/riley` — KPI strip slot stays empty (B.2 will populate); metrics endpoint returns the echo fields without breaking Riley's current consumers.

---

## What comes after A.3

- **A.4 plan:** Activity richness — `ActivityRow` superset (`body` / `preview` / `who` / `replyable` / `tag`), inline `thread-preview.tsx`, reply box routing, "Tell Alex about {firstName}" affordance, activity filters.
- **A.5 plan:** Composer + command palette + `parseCommand` + `respondToApproval` wiring + `Approval.payload` schema additions + `RecommendationPresentation` toast additions.
- **A.6 plan:** Deletion sweep after the cockpit has been stable through A.5.
- **Post-A.3 docs PR:** amend `2026-05-14-riley-cockpit-wave-a-slicing-design.md` §B.2 to overturn the columns decision in favor of `config` JSON keys + `getAgentTargets`, applied when the Riley specs land on `main`.
- **Riley B.2a / B.2b sequencing (already in flight):** B.2a (PRs #494 docs + #493 impl) ships the Riley mission popover **without** depending on A.3 — no KPI strip, no ROI bar, no `/metrics` extension on Riley's path; targets surface in the Targets row of the popover via the same `getAgentTargets` helper this brief introduces. B.2b waits for A.3 to merge, then **reuses** `getAgentTargets`, the KPI/ROI shell components (`kpi-strip.tsx`, `roi-bar.tsx`), and `KpiTile`/`RoiBar` types — but **does not** port `legacy-shapes.ts` verbatim. Riley's slicing spec has `metrics-riley.ts` eventually emitting `tiles[]` / `roi` natively as the wire shape, so B.2b's adapter is thinner (a typed pass-through, not a flat-to-explicit translation). The legacy-shapes adapter is an Alex-only seam justified by the existing flat `metrics-alex` shape; Riley starts from the explicit shape and stays there.
