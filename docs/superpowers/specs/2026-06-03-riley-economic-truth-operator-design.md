# Riley per-campaign economic truth → the operator (design)

**Date:** 2026-06-03
**Branch:** `worktree-riley-economic-truth-operator`
**Type:** advisory / display-only slice (no mutating path)
**Builds on:** #835 (per-campaign Gate-4 targets + `campaignEconomics`) and #837 (named `TargetSourceSchema`), both on `origin/main`.

## Goal

Surface Riley's per-campaign economic truth to the operator:

- **(a)** At the approval moment, the operator sees **which target judged each Riley recommendation** — the campaign's own booking-calibrated CAC (Tier-1, `targetSource="campaign"`) vs the account-level fallback (Tier-2, `targetSource="account"`) — plus the **economic tier** (`booked_cac` / `cpl` / `cpc`).
- **(b)** The operator sees **per-campaign economics** — CPL, cost-per-booked, true ROAS — with honest-null degradation (never a fabricated `$0`).

Display/read only. No new mutating path, no `PlatformIngress`, no Meta writes, zero mutating callers gained.

## What is already persisted (verified live, post-#835/#837)

- `RecommendationOutputSchema` (`packages/schemas/src/ad-optimizer.ts:191-216`) carries optional `economicTier`, `marginBasis`, `targetSource`. `applyTier` (`packages/ad-optimizer/src/analyzers/economic-target.ts:113-148`) stamps them per surviving rec; it appends a `basisNote` to `estimatedImpact` that names the **tier** but deliberately omits the **source** (and any `$`, to protect the dollars-at-risk scrape).
- `AuditReportSchema` carries optional `campaignEconomics: { rows: CampaignEconomicsRow[] }`. `CampaignEconomicsRow` (`packages/ad-optimizer/src/analyzers/source-comparator.ts:67-73`) = `{ campaignId; cpl (dollars|null); costPerBooked (dollars|null); bookedValueCents (CENTS|null); trueRoas (major|null) }`. Built by `compareCampaigns` and attached at `audit-runner.ts:583`.

## The gap (verified live this session — file:line)

1. **The operator's live approval surface drops the basis.** Riley recs reach the operator as **emitted `Recommendation` rows** on the `queue` surface: `useDecisionFeed` → `/api/dashboard/decisions` → `decisions.ts` → `recommendationStore.listBySurface({surface:"queue"})` → `adaptRecommendation` → `approval-detail-sheet.tsx`. The emitted row is built by `runRecommendationSink` / `buildPresentation` (`recommendation-sink.ts`), which carries `humanSummary/confidence/riskLevel/parameters/presentation` but **no `economicTier`/`targetSource`** and **no source basis in `dataLines`**. So the operator never learns whether a rec was judged on the campaign's own target or the account fallback.
2. **`campaignEconomics` has no live reader.** It is persisted only on the audit-report **task `output`** JSON. Its sole consumer, `useAdOptimizerAudit` (`apps/dashboard/src/hooks/use-ad-optimizer.ts`), is **dead code — zero importers** (verified by grep). No component renders `campaignEconomics` / `sourceComparison` / the audit `recommendations[]`. The `OutputFeed` referenced in a comment **does not exist**. Live Riley surfaces (Home `AgentPanel`, `/results`, `/reports`) read different endpoints (`/agents/riley/*`, `/reports` → `ReportData`) that do not carry `campaignEconomics`.

This is exactly the dead-surface contingency the task anticipated: scope #3's "mirror the existing `sourceComparison` table" is impossible — that table is never rendered.

## The enabling fact

`buildPresentation(rec)` runs on the **post-`applyTier`** rec, so `economicTier` + `targetSource` are already in hand there. `presentation.dataLines` (a `string[][]`) is threaded end-to-end and rendered **generically** in the live `approval-detail-sheet.tsx:187-198` (`dataLines.map(...)`, inner arrays joined by `·`). And in `audit-runner.ts`, `campaignEconomics` (built ~509-526) is in the **same scope** as the `recommendations` passed to `runRecommendationSink` (~541). So both the basis and the per-campaign economics can ride the existing, already-mounted `dataLines` channel with no dashboard or schema change.

## Approaches considered

**Approach 1 — Approval-moment consolidation via the sink's `dataLines` (CHOSEN).**
Thread the basis (`economicTier`+`targetSource`) and each rec's matching `campaignEconomics` row into `buildPresentation`'s `dataLines`, by passing `campaignEconomics` from `audit-runner.ts` into `runRecommendationSink`. Renders automatically in the live approval drill-in (Inbox + AgentPanel `OpenDecisions`).

- _Pros:_ Fully live (the approval moment is mounted). Surface-agnostic (Layer-2, strings only — no UI ref). No schema change, no dashboard change, no DB migration, no mutating path. Minimal (2 source files + tests). Co-locates economic truth with the decision. Honest-null is native. Exactly the task's "render on whatever Riley surface IS live" contingency.
- _Cons:_ Per-campaign economics show only for campaigns that have a recommendation (not a standalone full-coverage table). Renders in the approval drill-in sheet, not the list-glance card. Does not deliver a standalone "results surface" (explicitly deferred below).

**Approach 2 — Revive/mount the dead audit view.** Extend the dead hook's types, build a `CampaignEconomics` table + an audit view, resolve Riley's `deploymentId`, mount on a new/revived route.

- _Rejected:_ Building a from-scratch view + deploymentId resolution + a new mount is precisely the "balloon into a new view / slip into Phase-C" the task forbids. Largest diff, highest risk, revives a large dead surface.

**Approach 3 — Per-campaign economics slot on the live `AgentPanel`.** Add `useDeployments` deploymentId resolution + `useAdOptimizerAudit` + a focused table as a new Riley panel slot.

- _Rejected for this slice:_ Needs net-new deploymentId resolution + a second audit fetch + a new slot/failure-mode on a carefully-composed, polished Sheet; debatable product fit (dense table in a quick-glance panel). Still meaningfully balloons vs Approach 1. Left as the substrate-ready follow-up.

## Design (Approach 1)

All changes live in `packages/ad-optimizer` (Layer 2, surface-agnostic).

### Pure formatting helpers (`recommendation-sink.ts`, co-located, unit-tested)

- `economicBasisLine(rec): string | null`
  - Derived from `rec.targetSource` + `rec.economicTier`. Returns `null` when `targetSource` is absent (back-compat / honest-null).
  - `targetSource="campaign"` (Tier-1; always `booked_cac` per the resolver invariant) → "Target: this campaign's own {tier-phrase}."
  - `targetSource="account"` (Tier-2) → "Target: account-level fallback ({tier-phrase})."
  - tier-phrase: `booked_cac` → "booked-CAC"; `cpl` → "cost-per-lead"; `cpc` → "cost-per-click". Deliberately terse: the rec's `estimatedImpact` (dataLine[0]) already states the tier basis and discloses thin-data for cpl/cpc (via `applyTier`'s `basisNote`), so this line adds only the campaign-vs-account SOURCE and does not re-state "judged on … basis" or double-state thinness.
- `economicsCells(row: CampaignEconomicsRow | undefined): string[]`
  - Returns the per-campaign metric cells, honest-null per field; `[]` when no row or all-null.
  - `cpl` non-null → `"CPL $<n>"`; `costPerBooked` non-null → `"$<n>/booked"`; `trueRoas` non-null → `"<n>x true ROAS"`, **null → "true ROAS not yet attributed"** (canonical honest-null — never a fabricated `$0`).
  - Units: `cpl`/`costPerBooked` are dollars (format only — no re-division); `trueRoas` is already major (format only). `bookedValueCents` (CENTS) is **not** displayed directly (it is the `trueRoas` numerator).

### Presentation assembly

`buildPresentation(rec, economicsRow?)` returns `dataLines`:

```
[ [rec.estimatedImpact],
  ...(basisLine ? [[basisLine]] : []),
  ...(cells.length ? [cells] : []),            // joined by "·" in the UI
  [`Learning phase: ${rec.learningPhaseImpact}`] ]
```

`estimateRisk` scrapes only `rec.estimatedImpact` (verified) — the new `dataLines` text cannot perturb dollars-at-risk.

### Sink wiring

`RunRecommendationSinkArgs` gains an optional `campaignEconomics?: { rows: CampaignEconomicsRow[] }`. `runRecommendationSink` builds a `Map<campaignId, row>` once and passes each rec's matching row (or `undefined`) to `buildPresentation`. Absent input ⇒ no economics line (existing analysis-only callers unaffected).

### Audit-runner thread (one site)

`audit-runner.ts:541` passes the already-in-scope `campaignEconomics` into `runRecommendationSink`. No other backend change.

### Dashboard

**None.** `dataLines` already render generically in the mounted `approval-detail-sheet.tsx`. No view-model typing, no new component, no route. (The dead `useAdOptimizerAudit` view-model is intentionally left untouched — typing fields onto a dead hook would only add dead code.)

## Honest-null contract

- `trueRoas` null (no attributed booked `ConversionRecord` value, or the booked-value port is unwired) → "true ROAS not yet attributed".
- `cpl` / `costPerBooked` null (zero-denominator) → that cell omitted.
- No matching campaign row → economics line omitted entirely.
- `targetSource` absent → basis line omitted entirely.

## Testing

- `recommendation-sink.test.ts`: `economicBasisLine` (campaign/account × each tier; absent source ⇒ null); `economicsCells` (full row; null trueRoas ⇒ "not yet attributed"; null cpl/costPerBooked ⇒ omitted; no row ⇒ `[]`); `runRecommendationSink` passes the matching row by campaignId into the emitted presentation; absent `campaignEconomics` ⇒ unchanged behavior. Update existing `dataLines`-shape assertions.
- Riley eval seam (`pnpm eval:riley`) must stay green (no rec content/gating change — only presentation `dataLines`).

## Scope / non-goals (flagged deferrals)

- **No standalone results-surface rendering of `campaignEconomics`.** Its only reader is dead and no render component exists; reviving it is out-of-scope (Approach 2/3). The audit substrate is ready; a future focused PR can mount a per-campaign economics table on a live Riley surface (AgentPanel slot or a Results section) with deploymentId resolution.
- Per-campaign economics surface only for campaigns that carry a recommendation this cycle (the approval-moment placement). Acceptable: the approval moment is where economics inform a decision.
- No judged-target **dollar** in the basis line: the on-rec `effectiveTarget` is a calibrated CPL-equivalent (not the raw booked-CAC), so printing it as "booked-CAC $X" would mislead; the basis names the source + tier qualitatively instead (honest over precise-but-wrong).

## Constraints honored

ESM + `.js` relative imports; no `any`; co-located tests; conventional lowercase commit subject. Advisory-only (grep the diff: no `PlatformIngress`, no Meta write, no new mutating caller). Surface-agnostic (ad-optimizer Layer 2 imports nothing from UI). Units never re-divided in display.
