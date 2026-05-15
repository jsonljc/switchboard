# Riley Cockpit B.2b — KPI Strip + ROI Bar on `/riley`

**Date:** 2026-05-15
**Parent spec:** [Riley Cockpit — Wave A Slicing Design](../specs/2026-05-14-riley-cockpit-wave-a-slicing-design.md) (§Slice B.2)
**Target spec:** [Riley Cockpit Home — Design Spec](../specs/2026-05-13-riley-cockpit-home-design.md) (§KPI strip, §ROI bar)
**Predecessor slices:**
- Alex A.3 — `feat(cockpit): A.3 — KPI strip + ROI bar on /alex` (#500, squash `ed54c4a8`) — ships the shell components, `getAgentTargets` helper, Meta spend provider, and the targets-in-config decision lock.
- Riley B.1 — `feat(riley-cockpit): B.1 — core operator loop at /riley` (#488, squash `5ef3910a`) — `RileyCockpitPage` shell, view-model adapters, signal-health grouper.
- Riley B.3 — `feat(riley-cockpit): B.3 — voice + accent + acceptToast/declineToast schema` (#507, squash `3b59e4cc`) — accent parameterization, toast schema, per-row `<RileyApprovalRow>` resolution wiring.

---

## Why B.2b is a focused slice

The Wave A slicing spec scoped B.2 as a single bundle (popover wiring + KPI strip + ROI bar + targets persistence). B.2 has since been split:

- **B.2a (in review, 3-PR chain #497/#494/#493)** — mission popover wiring on `/riley` reusing the Alex A.2 popover shell. Not a blocker for B.2b.
- **B.2b (this slice)** — KPI strip + ROI bar on `/riley`. Now unblocked by Alex A.3's `<KpiTile>` / `<ROIBar>` / `<KPIStrip>` components and the `getAgentTargets` helper on `main`.

B.2b is the *visible-economics* slice for Riley: the operator who today sees Riley's status pill, mission line, approvals, and activity stream — but no numbers — gets the same week-bucketed KPI grid and ROI comparator that Alex got at A.3, tuned to Riley's lead-economics shape.

---

## Decision lock from Alex A.3 (overrides Riley spec §B.2)

The Riley Wave A slicing spec's §B.2 says: *"`avgValueCents` and `targetCpbCents` land as nullable Prisma columns on `AgentRoster`; migration in the same PR."* **Alex A.3 ratified the opposite decision** — these values live as JSON keys inside the existing `AgentRoster.config` column, with one canonical reader:

```ts
// packages/core/src/agent-home/targets.ts
export function getAgentTargets(roster: { config: unknown }): AgentTargets {
  return {
    avgValueCents: readNonNegativeIntKey(roster.config, "avgValueCents"),
    targetCpbCents: readNonNegativeIntKey(roster.config, "targetCpbCents"),
  };
}
```

A convention test (`packages/core/src/agent-home/__tests__/targets-convention.test.ts`) greps real source to enforce zero direct `config.avgValueCents` / `config.targetCpbCents` reads outside the helper. The five sibling threshold keys (`priceApprovalThreshold` / `refundEscalationFloor` / `quietHours` / etc.) already live in `config`; A.3 chose symmetry.

**B.2b reuses the helper. No migration. No Prisma column.**

The Riley slicing spec §B.2 still reads "columns over config JSON" because it pre-dates A.3. That divergence is acknowledged here and deferred — **not amended in this PR**:

- The Riley slicing spec lives on `docs/riley-cockpit-home-spec` (PR #497, OPEN). It has not landed on `main` yet.
- B.3's slice brief and Wave A slicing share the same blocker; B.3 shipped against the open spec PR by reference, not by amendment.
- Amending §B.2 in this docs PR would require the spec to land on `main` first, then a second commit on top — two-step coupling that adds no value over a single follow-up amendment after #497 merges.

**Action:** when PR #497 (Riley specs) lands on `main`, open a small follow-up docs PR that amends §B.2 / §B.2 acceptance / §Backend-changes-by-slice to read "targets via `AgentRoster.config` JSON keys, no migration; reuse `getAgentTargets`." The follow-up is tracked alongside the existing Riley-side amendments noted in [[project_alex_cockpit_a3_shipped]].

---

## Slice goal

Render Alex A.3's `<KPIStrip>` (KPI tile grid + ROI bar) on `/riley`, populated with Riley's lead-economics shape, between `<Identity>` and the approval rows — the same mount point Alex uses. Collapse to a single-line headline when `approvals.length > 0`, the same pattern shipped at A.3. Use Riley clay accent (`RILEY_ACCENT`) for the comparator chip; never Alex amber. Add no new Prisma columns; reuse `getAgentTargets`. Honor the honest-impact-language guardrail from B.2 — KPI/ROI copy describes observed deltas, never causal "Riley improved X" claims.

---

## What ships

### Core (`packages/core/src/agent-home/`)

| Change | Responsibility |
|---|---|
| `metrics-types.ts` — define server-side `KpiTile` and `RoiBar` interfaces; add **optional** `tiles?: readonly KpiTile[]` + `roi?: RoiBar` fields to `MetricsViewModel`. | Surface-agnostic wire shape. The shapes mirror the dashboard's `KpiTile` / `RoiBar` (`apps/dashboard/src/components/cockpit/types.ts:115-143`) at a structural level. Core remains UI-free. |
| `metrics-riley.ts` — emit `tiles` (3 tiles: Leads, CTR (—), Ad spend) and `roi` (always degraded shape: cost-per-lead comparator + Riley-voice hint) natively, alongside the existing flat-shape fields A.3 added. | Riley's adapter becomes a thin pass-through — no flat-to-explicit translation needed. |
| `metrics-alex.ts` — **unchanged**. Alex continues to emit flat fields only; the dashboard's `metricsViewModelToLegacyKpiInput` + `legacyTiles` / `legacyRoi` derivation path stays the source of Alex tiles. | Alex render is unchanged byte-for-byte. |
| `__tests__/metrics-riley.test.ts` — five new cases pinning the Riley `tiles` and `roi` shape: (a) live ROI degraded with cost-per-lead when spend > 0 + leads > 0; (b) degraded "Connect Meta Ads" hint when spendCents === null; (c) degraded empty-hint when spend > 0 + leads === 0; (d) tiles[0]=Leads + tiles[1]=CTR-unavailable + tiles[2]=Ad-Spend; (e) `qualifiedPct` stays in the flat shape as `0` (backward-compat); not surfaced via tiles. | Pin the Riley wire shape. |

### API (`apps/api/src/routes/agent-home/metrics.ts`)

**No code change.** The route already loads `AgentRoster.config` and calls `getAgentTargets` (A.3). The Meta spend provider is already wired structurally; B.2b enables it for Riley by virtue of `metrics-riley.ts` consuming `store.getMetaSpendCents` (added in A.3 — the method exists; the provider currently returns null when no `Connection` row). Once a tenant connects Meta Ads, Riley's spend flows through. The bootstrap-side `app.metaSpendProvider` was already wired in A.3 and is not Riley-specific.

### Dashboard (`apps/dashboard/`)

| Path | Change | Why |
|---|---|---|
| `src/lib/cockpit/metrics-types.ts` | Mirror the core-side optional `tiles?` / `roi?` fields onto `MetricsViewModelWire`. | Keep dashboard mirror in sync with the API contract. Pattern matches `mission-types.ts` (A.2). |
| `src/lib/cockpit/riley/metrics-to-kpi-data.ts` **(new file)** | Pure `metricsViewModelToRileyKpiData(vm)` → `CockpitKpiData`. Reads `vm.tiles` and `vm.roi` directly (typed pass-through). Constructs `range` as `"This week · ${vm.folioRange}"`. **Does not** invoke `legacyTiles` / `legacyRoi`. | Riley's adapter is structurally different from Alex's — typed pass-through, not flat-to-explicit translation. |
| `src/lib/cockpit/riley/__tests__/metrics-to-kpi-data.test.ts` **(new file)** | Three cases: (a) tiles + roi pass through unchanged; (b) range string format; (c) the qualifiedPct flat field is ignored (no 4th tile snuck in from legacy shape). | Pin the adapter shape. |
| `src/components/cockpit/riley-cockpit-page.tsx` | Add `useAgentMetrics("riley")` hook call. Mount `<KPIStrip kpis={kpis} collapsed={approvals.length > 0} />` between `<Identity>` and the approval rows, gated on `kpis != null`. Pass `accent={RILEY_ACCENT}` to `<KPIStrip>` (see next row). | The visible mount. |
| `src/components/cockpit/kpi-strip.tsx` | Add **optional** `accent?: { base: string; deep: string; soft: string; paper: string }` prop. Default → Alex amber tokens (current behavior, no Alex render change). When provided, the ROI degraded comparator chip uses `accent.paper` background + `accent.soft` border; the live-mode `T.amberDeep` "off-target" comparator color becomes `accent.deep`; the live-mode fill-bar gradient `${T.amberSoft} → ${T.amber}` becomes `${accent.soft} → ${accent.base}`. | Riley clay accent on the ROI comparator and bar. Three sites total — all in `<KPIStrip>` + `<ROIBar>`. |
| `src/components/cockpit/roi-bar.tsx` | Accept `accent?: AccentTokens` and apply it at the three sites above. Default behavior unchanged. | Accent plumbing. |
| `src/components/cockpit/__tests__/roi-bar.test.tsx` | Two new cases: default-accent renders Alex amber; Riley-accent renders Riley clay (assert `data-on-target="false"` chip border color and the live-mode fill gradient stops). | Coverage. |
| `src/components/cockpit/__tests__/riley-cockpit-page.test.tsx` | Three new cases: KPI strip renders between Identity and approvals when `useAgentMetrics` returns data; collapses (single-line headline) when approvals.length > 0; not rendered when `useAgentMetrics` is loading or errors. | Page-level integration. |

### Riley tile shape (locked)

| Index | Tile | Source | Notes |
|---|---|---|---|
| 0 | `{ label: "leads", value: heroValue, trend: bookedDelta }` | `heroValue` (= week leads count); `bookedDelta` already emitted by metrics-riley.ts | Riley's "leads" is the hero value (`hero.kind === "ad-leads"`). |
| 1 | `{ label: "ctr", value: "—", unavailable: true }` | n/a | CTR is not in v1's signal store. No `hint` — connecting Meta Ads brings spend, not CTR. CTR comes when an `ad-platform-ctr` source ships. |
| 2 | `spendCents === null ? { label: "ad spend", value: "—", unavailable: true, hint: "Connect Meta Ads" } : { label: "ad spend", value: \`$${spend}\` }` | `spendCents` already echoed by metrics-riley.ts | Match A.3's `$${spend}` quirk (no `toLocaleString`). |

**Three tiles, not four.** Riley has no "qualified" tile — qualification is downstream of Riley (Alex's pipeline). The `qualifiedPct: 0` placeholder in the flat shape stays for backward-compat with the Alex adapter's `CockpitKpiData` shape, but Riley's adapter does not surface it. Documented v1 quirk; no UI surface.

### Riley ROI shape (locked, always degraded in v1)

The full `RoiBarFull` shape (fill bar + earned-value math) is Alex's tour-value calculation: `earned = booked × avgValue`. Riley's signal is leads, not bookings — and leads × avgValue would be a misleading projection that conflicts with B.2's **honest-impact-language guardrail**. v1 Riley therefore always emits `RoiBarDegraded` shape with the cost-per-lead comparator. The fill bar and break-even tick do not render. This is a deliberate v1 simplification — when Riley grows an honest "return on ad spend" math (e.g., qualified-lead-rate × avg booking value), it will move to the full shape in a future slice.

ROI hint priority (first match wins; mirrors A.3's table-driven test pattern):

| Rule | Condition | `degradedHint` | `comparator.value` | `comparator.target` |
|---|---|---|---|---|
| 1 | `spendCents === null` | `"Connect Meta Ads to see cost per lead"` | `"—"` | `target` echo or `"—"` |
| 2 | `spendCents > 0 && leads <= 0` | `""` (waiting for leads — no setup step) | `"—"` | `target` echo or `"—"` |
| 3 | `spendCents > 0 && leads > 0 && targetCpbCents === null` | `""` (target not configured — no nag in v1) | `"$N per lead"` | `"—"` |
| 4 | `spendCents > 0 && leads > 0 && targetCpbCents !== null` | `""` | `"$N per lead"` | `"target $M"` |

Where `$N per lead = round(spendCents / 100 / leads)`, `$M = round(targetCpbCents / 100)`. The `label` is `"cost per lead"`. The comparator chip's on-target affordance is **off** in degraded mode (per the existing `<ROIBar>` degraded branch — the chip is a neutral pill).

**Rule 2 vs Rule 3 nuance.** A.3 had three degraded rules (`spend===null` / `avgValue===null` / `bookings===0`). Riley reuses rules 1, 2, 3 in spirit but drops the `avgValue===null` gate — Riley's cost-per-lead math doesn't need `avgValueCents`. `avgValueCents` is irrelevant to Riley v1 economics; it stays a `getAgentTargets` echo but is not consumed in the Riley ROI computation. The dashboard does not surface a "set average booking value" hint on `/riley`.

**Target name reuse.** Riley reuses the `targetCpbCents` config key as "target cost per lead." Semantically different from Alex's "target cost per booking," but storage-symmetric and avoids a new config key for v1. When Riley's economics expand (booking-value attribution), a follow-up slice may introduce `targetCplCents` if naming disambiguation matters. v1 ships with one key, two interpretations.

### Riley voice on the collapsed headline

The shipped `collapsedHeadline()` function in `legacy-shapes.ts` has two modes (`"explicit"` when `tiles[]` exist, `"flat"` otherwise). For Riley:

- `tiles` are emitted by `metrics-riley.ts`, so the explicit branch runs.
- The lead tile (`tiles[0] = { label: "leads", value: N, trend: "+5" }`) becomes the headline: `"N leads · +5 from last week"` (when trend exists).
- This is the same voice phrasing Riley's hero subprose already uses (`metrics-riley.ts:11-15`: `+N from last week.`). The collapsed-headline composer's trend slot accepts the trend verbatim — no additional Riley-voice translation needed.

No copy change in `collapsedHeadline()`. No Riley-specific override required.

### What does NOT ship at B.2b

- ❌ **Prisma migration** for `avgValueCents` / `targetCpbCents`. A.3 settled this — config JSON keys, no columns.
- ❌ **Onboarding form** for setting `avgValueCents` / `targetCpbCents`. Operators write via direct `AgentRoster.config` edit until Alex A.5's command palette ships `Set average booking value to $N` / `Set target CPL to $N`. Same v1 quirk A.3 accepted.
- ❌ **CTR live data.** The CTR tile is `unavailable` with no hint. Surfacing CTR needs an `ad-platform-ctr` signal source — out of scope for B.2b.
- ❌ **Full ROI bar with fill + break-even** on `/riley`. v1 always emits the degraded comparator-only shape. The full shape lives in a later slice when Riley has honest "return on ad spend" math.
- ❌ **A new `targetCplCents` config key.** v1 reuses `targetCpbCents` with a Riley-side interpretation.
- ❌ **Alex render diff.** Alex continues to use `metricsViewModelToLegacyKpiInput` + `legacyTiles` / `legacyRoi`. No byte change to Alex's KPI strip or ROI bar.
- ❌ **Tile-hint click-routing on `/riley`.** A.3 left the `Connect Meta Ads →` button inert pending A.5's deep-link command vocabulary. B.2b inherits the same v1 quirk — Riley's `Connect Meta Ads` hint is visually present, click-inert.
- ❌ **Spec amendment to Riley slicing §B.2.** Deferred until #497 merges to `main`.
- ❌ **`useAgentMetrics("riley")` migration to per-agent hook.** A.3 introduced `useAgentMetrics(agentKey)` already supporting both agents. The hook accepts `"riley"` today — no hook change required, only a new call site on `/riley`.

---

## Adapter-boundary invariant

The B.1 load-bearing rule continues to hold:

> Only files under `apps/dashboard/src/lib/cockpit/riley/**` may import `Recommendation` / `AuditEntry` / `@switchboard/db` / `@prisma` / `@switchboard/schemas/{recommendations,audit}`.

B.2b adds **zero** new imports of those types to `components/cockpit/**` or `hooks/`. The new `metrics-to-kpi-data.ts` lives in `lib/cockpit/riley/**` and consumes only `MetricsViewModelWire` from `@/lib/cockpit/metrics-types` and `CockpitKpiData` from `@/components/cockpit/types`. `useAgentMetrics` already consumes the wire `/api/dashboard/agents/[id]/metrics` route; no Prisma import is added.

Pre-merge grep gate (same as B.1 / B.2a / B.3):

```bash
rg "Recommendation|AuditEntry|@switchboard/db|@prisma" \
   apps/dashboard/src/components/cockpit \
   apps/dashboard/src/hooks
```

Expected: no new matches vs `main` baseline.

---

## Dependencies

- ✅ Alex A.3 merged (#500, `ed54c4a8`) — `<KpiTile>` / `<ROIBar>` / `<KPIStrip>` components, `getAgentTargets`, Meta spend provider, dashboard adapters, types in place. **The shipped shell is the load-bearing dependency.**
- ✅ Riley B.1 merged (#488, `5ef3910a`) — `RileyCockpitPage` shell, page test harness, riley-config exports.
- ✅ Riley B.3 merged (#507, `3b59e4cc`) — Riley accent tokens (`RILEY_ACCENT`) live and exported from `riley-config.ts`; per-row resolution wiring; toast helper.
- ⚠ Riley B.2a (#497/#494/#493) **does not block B.2b.** B.2a touches `<Identity>` wrap to mount `<MissionPopover>`; B.2b touches the JSX between `<Identity>` and approvals to mount `<KPIStrip>`. Adjacent regions of the same file but non-overlapping; either order resolves trivially.
- ⚠ Riley specs (`2026-05-13-riley-cockpit-home-design.md`, `2026-05-14-riley-cockpit-wave-a-slicing-design.md`) still not on `main` — they live on `docs/riley-cockpit-home-spec` (#497, OPEN). B.2b's spec links assume #497 merges before or alongside this docs PR. Same precedent as B.1, B.2a, B.3.
- ❌ Alex A.5 — **not a dependency.** B.2b's KPI strip / ROI bar are rendered, not interactive. The `Connect Meta Ads →` hint button stays inert (A.5 dependency, same as Alex).

---

## Schema-side decisions ratified by this slice

1. **`MetricsViewModel.tiles` and `.roi` are optional.** Alex continues to emit them as `undefined`; the dashboard adapter for Alex (`metricsViewModelToLegacyKpiInput` + `legacyTiles` / `legacyRoi`) is unchanged. Riley emits them populated. Adding optional fields to the wire shape is backwards-compatible.
2. **`KpiTile` / `RoiBar` server-side shapes mirror the dashboard interfaces structurally.** The interfaces are duplicated across the layer boundary (not imported across); dashboard cannot import `@switchboard/core` types because of bundle/edge-runtime concerns (see `metrics-types.ts:1-3` comment shipped by A.2). The mirror pattern is established.
3. **Riley emits `RoiBarDegraded` only.** v1 has no honest "return on ad spend" math for Riley; the `RoiBarFull` shape is Alex-only until a follow-up adds Riley booking-attribution.
4. **`qualifiedPct: 0` flat-field stays as a v1 quirk.** Riley emits `0` to satisfy the flat shape; the Riley adapter does not surface it. The convention test from A.3 (`stats[2].unavailable === (spendCents === null)`) continues to hold (Riley emits Spend as `stats[2]`).

---

## Risks specific to B.2b

1. **Riley render must not show "qualified 0%" tile.** The dashboard's `<KPIStrip>` falls back to `legacyTiles(legacy)` when `kpis.tiles` is missing — and `legacyTiles` emits a qualified tile. If Riley's adapter accidentally omits `tiles`, the page would show a misleading 0% qualified tile. **Mitigation:** the adapter test asserts `kpis.tiles` is always populated (never undefined); the page test asserts the rendered tile set has exactly 3 tiles, none labeled "qualified."

2. **ROI accent drift.** `<ROIBar>` and `<KPIStrip>` today hardcode Alex amber tokens at three sites (degraded chip border/background, live-mode `data-on-target="false"` color, live-mode fill gradient). B.2b parameterizes them with optional `accent?` defaults — same `?: defaults` pattern B.3 used for accent on `<ApprovalCard>` / `<ComposerPlaceholder>` / `<StatusPill>`. **Mitigation:** component tests assert *both* the default-render path (Alex amber, no Alex render change) and the explicit-override path (Riley clay).

3. **`useAgentMetrics("riley")` calls the existing route.** A.3 wired the route to dispatch by `agentId`; no API change is needed. But B.2b is the first dashboard consumer of `/agents/riley/metrics`. **Mitigation:** the page test mounts `RileyCockpitPage` with a fixture metrics response (TanStack Query handler) and asserts the rendered tile set matches the fixture. No integration test against the real API in this slice (covered by metrics-riley unit tests + the route's own fastify tests).

4. **Cost-per-lead calculation rounding.** `Math.round(spendCents / 100 / leads)` can produce 0 for small spend/large lead counts. **Mitigation:** the test fixture pins three cost-per-lead computations (e.g., spend=2000c, leads=10 → $2; spend=12345c, leads=3 → $41; spend=99c, leads=10 → $0). The locked-design quirk: `$0 per lead` is acceptable display when math rounds to 0; do not branch to `"<$1"`.

5. **`spendCents > 0` ambiguity.** A.3's hint priority rule 1 uses `spendCents === null`. B.2b mirrors that — `spendCents === 0` (real "zero spent this week") is treated as live, not unavailable. The cost-per-lead comparator displays `$0 per lead` (when leads > 0) or `—` (when leads === 0). **Mitigation:** table-driven test pins each (spendCents, leads) combination.

6. **B.2a rebase conflict.** If B.2a lands first, `RileyCockpitPage` will already have `useAgentMission` + `<MissionPopover>` wrapping `<Identity>`. The B.2b mount-point comes after that wrapper — adjacent but non-overlapping. **Mitigation:** the implementation plan locks the exact insertion point ("after the Identity element / mission-popover wrapper closes, before the approvals stack JSX"). Rebase is trivial.

7. **Honest-impact-language audit.** The KPI strip + ROI bar must describe observed deltas, never causal "Riley improved X" claims. The only copy this slice authors is the Riley-side degraded hints (rule 1: "Connect Meta Ads to see cost per lead"). All other strings come from existing locked vocabulary (tile labels, comparator chip values are computed). **Mitigation:** the slice brief locks the hint string verbatim. The PR template carries the honest-impact reviewer checkbox.

---

## Test contract

- Core tests (Vitest, `packages/core`): `metrics-riley` emits the locked tile shape (3 tiles) and the locked ROI degraded shape (4 hint rules); the Alex path is untouched (regression check on `metrics-alex` continues to pass).
- Dashboard adapter test (Vitest, `apps/dashboard`): `metricsViewModelToRileyKpiData` is a typed pass-through (no `legacyTiles` invocation).
- Dashboard component tests (Vitest + Testing Library, `apps/dashboard`): default-vs-override accent paths for `<KPIStrip>` and `<ROIBar>` (Alex render unchanged; Riley accent applied).
- Page-level integration (`riley-cockpit-page.test.tsx`): KPI strip mounted in the correct slot; collapse rule when approvals.length > 0; loading/error states do not render the strip.
- Adapter-boundary grep (gate): no new `Recommendation|AuditEntry|@switchboard/db|@prisma` imports under `components/cockpit/**` or `hooks/`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test --filter @switchboard/core --filter @switchboard/dashboard`, `pnpm --filter @switchboard/dashboard build` all clean.

`pnpm --filter @switchboard/dashboard build` is explicitly required because CI runs `lint` + `typecheck` but not `next build`, and `.js`-extension regressions or other Next-build-only failures slip past CI ([[feedback_dashboard_no_js_on_any_import]], [[feedback_dashboard_build_not_in_ci]]).

---

## What comes after B.2b

- **B.2-spec amendment** (post-PR-#497-merge) — small docs PR amending Riley slicing §B.2 / §B.2 acceptance / §Backend-changes-by-slice to read "targets via config JSON keys, reuse `getAgentTargets`."
- **B.3-followup** (post-Alex-A.5) — wire `RILEY_COMMANDS` into the shared `<CommandPalette>`; flip `Topbar.paletteEnabled = true` on `/riley`; hook the composer NL parser. Independent of B.2b.
- **Riley qualified-lead-rate attribution** (later) — when Riley's economics can honestly model "tour value per ad dollar," the ROI bar moves from `RoiBarDegraded` to `RoiBarFull` with fill bar and break-even. This also re-evaluates the `qualifiedPct: 0` placeholder.
- **CTR signal source** — when `ad-platform-ctr` ships, tile[1] becomes live. Hint becomes inert (no setup step required beyond Meta connection).
- **Wave B parity** lives in `2026-05-14-riley-agent-infra-parity-design.md`. KPI/ROI fields travel with the wire view-model regardless of which substrate (WorkTrace mirror) the cockpit reads from.
