# Operator evidence-first review-item anatomy (design)

Date: 2026-06-21
Status: active
Workstream: aesthetic-rehaul (Pass-2 thread 2)
Scope: `apps/dashboard` operator inbox approval sheet + the Decision read-model that feeds it. Authed app only.

## North star

Thesis line 49 (`docs/superpowers/specs/2026-06-19-aesthetic-rehaul-thesis.md`):

> Operator: canonical evidence-first review-item anatomy (proposed action + evidence-above-recommendation + dollar-at-stake + signal chips + reason-on-override).

The operator inbox is where a revenue/governance pilot is actually earned: a human decides whether an agent's proposed action runs. Today that decision is made against a thin card and a detail sheet whose central "What this changes" panel is a hardcoded placeholder ("preview not yet wired", four `—` cells). The operator is asked to approve without seeing the stakes or the reasoning. This slice turns the review item into an evidence-first instrument: the operator reads **why**, sees **what's at stake**, scans the **signals**, and only then approves or overrides (recording a reason when they do).

This is a presentation + small data-threading change. It does not change governance, trust, approval lifecycle, or mutation semantics.

## Ground truth (verified 2026-06-21)

The shared detail sheet `apps/dashboard/src/components/inbox/approval-detail-sheet.tsx` serves two decision kinds (`inbox-screen.tsx:322-330`):

- `kind="approval"` (recommendation rows) — the hero case.
- `kind="workflow_approval"` (parked governance approvals).
- `kind="handoff"` uses a **separate** `HandoffDetailSheet` → **out of scope** here.

Per-ingredient data inventory (the make-or-break: do not ship a hollow shell):

| Ingredient | Status today | Source of truth |
|---|---|---|
| Proposed action | REAL on the wire | `decision.humanSummary` + `presentation.primaryLabel` |
| Evidence (the "why") | REAL on the wire **for ad-optimizer recommendations**; rendered as a flat bullet list today | `parameters.__recommendation.presentation.dataLines` (`string[][]`), built by `recommendation-sink.ts buildPresentation`, persisted `emit.ts:78-104` → `recommendation-store.ts:131`, read by `extractPresentation` (`recommendation-adapter.ts:43-47`). Parked approvals carry their own `dataLines` from `summarizeParkedIntent`. Recommendations from producers that do not nest a presentation → `FALLBACK` empty → no evidence (degrade). |
| Dollar-at-stake | On the **row**, **dropped by the adapter** (NOT on the wire) | `Recommendation.dollarsAtRisk` (`recommendations/types.ts`), set `recommendation-sink.ts:448` via `estimateRisk` regex of `estimatedImpact`. Whole dollars, always `>= 0`, `0` when no `$` found. It is an estimated **impact**, explicitly not a spend/budget threshold. |
| Confidence | On the **row**, **dropped by the adapter** (NOT on the wire) | `Recommendation.confidence` (`0..1`), set `recommendation-sink.ts:447`. |
| Signal chips | REAL on the wire | `meta.riskContract` (`riskLevel, externalEffect, financialEffect, clientFacing, requiresConfirmation`); rendered today by `riskChips()` in `lib/decisions/risk-chips.ts`. |
| Reason-on-override | Plumbing COMPLETE end-to-end | The recommendation `/act` and approval `/respond` mutations already accept + persist an optional `note`, threaded UI → core (handlers, client `actOnRecommendation`/`respondToApproval`, both dashboard proxy routes, both api routes). |

The dead stub: `approval-detail-sheet.tsx:210-241` renders the `ds-pending` section — eyebrow "What this changes" + "preview not yet wired" tag + a Before/After/Confidence/Money grid hardcoded to `—` + a "wiring it up next week" caption. This is the residual customer-facing-placeholder item noted in `project_aesthetic_rehaul`; this slice removes it.

The backend `Decision` type (`packages/core/src/decisions/types.ts:25-63`) and the dashboard mirror (`apps/dashboard/src/lib/decisions/types.ts`) are **hand-mirrored** (no shared zod schema) → the producer→consumer seam must be pinned with a shape test.

## Scope

In:
- Thread `dollarsAtRisk` + `confidence` from the recommendation row onto `Decision.meta` (the only genuinely-missing wire fields).
- Redesign the shared `ApprovalDetailSheet` into the evidence-first anatomy below; delete the dead `ds-pending` stub.
- Add reason-on-override: an optional inline reason note on the **dismiss/decline** path, persisted via the existing `note` param (no new plumbing, no semantics change).
- A quiet dollar-at-stake hint on the inbox card doorway (`inbox-decision-card.tsx`) when present.

Out:
- Handoff sheet (separate component).
- New evidence producers for non-ad-optimizer recommendations (their sinks don't nest a presentation).
- Parked-approval budget dollar extraction (budget params exist but summarizers don't surface them).
- Any before/after delta visualization (the deleted stub's original ambition) — do NOT re-stub; revive only when a real before/after producer exists.
- Mutation behavior: the override note stays **optional** (forcing a reason would be a product-behavior change).

## The anatomy

Order follows the thesis literally: proposal → evidence → dollar-at-stake → signals → controls. Each data-driven section renders only when its data is present, so a sparse decision collapses to header + proposal + controls. Evidence sits above the decision controls so the operator reasons from evidence to verdict rather than rubber-stamping.

```
┌──────────────────────────────────────────────────┐
│ ●  Riley  needs your okay              [med risk]  │  header: agent + risk pill (kept)
│    proposed 12m ago · undoable for 2h              │
├──────────────────────────────────────────────────┤
│ THE PROPOSAL                                       │  mono eyebrow
│ Raise the Lunchtime Promo daily budget             │  humanSummary (serif)
│ from S$40 to S$60.                                 │
│ For ▸ Lunchtime Promo                              │  target/contact strip (kept)
├──────────────────────────────────────────────────┤
│ WHY RILEY'S RECOMMENDING THIS                      │  mono eyebrow — EVIDENCE block
│   Impact      +18 bookings/wk at current CPA       │  dataLines[0]
│   Basis       CTR 3.1%, 7-day conversions up 22%   │  dataLines[1]
│   Economics   S$3.40 cost per booked appointment   │  dataLines[2]
│   Learning    budget-capped 4 of the last 5 days   │  dataLines[3]
├──────────────────────────────────────────────────┤
│ ESTIMATED IMPACT                                   │  mono eyebrow — AT-STAKE
│ S$450 / mo                                         │  dollarsAtRisk, serif hero, S$
│ Riley's estimate from recent performance.          │  honest caption
├──────────────────────────────────────────────────┤
│ SIGNALS                                            │  mono eyebrow — chips
│ [ Spends money ]  [ Changes live ads ]             │  riskChips(contract)
│ [ High confidence ]                                │  confidence band chip
├──────────────────────────────────────────────────┤
│ View conversation →                                │  thread link (kept)
└──────────────────────────────────────────────────┘
  footer:  [ Decline ]      [ Snooze ]      [ Approve ]   ← Approve is the only amber CTA
  on Decline → reveal optional reason note → confirm Decline   (reason-on-override)
```

When evidence dataLines are empty (non-ad-optimizer recommendation) the WHY block is omitted. When `dollarsAtRisk` is `0`/absent/non-finite the AT-STAKE block is omitted (never `S$0`, never `—`). When `confidence` is absent the confidence chip is omitted.

## Data contract changes

Add two optional scalars to `Decision.meta` (core type + dashboard mirror):

```ts
meta: {
  // ...existing...
  /** Estimated whole-dollar impact (>= 0) from the recommendation row; omit-render when not > 0. SGD. */
  dollarsAtRisk?: number;
  /** Recommendation confidence 0..1; rendered as a qualitative band. */
  confidence?: number;
}
```

Population:
- `recommendation-adapter.ts` → `dollarsAtRisk: row.dollarsAtRisk`, `confidence: row.confidence`.
- `handoff-adapter.ts`, `parked-approval-adapter.ts` → leave both `undefined`.
- Confirm the apps/api decisions serializer forwards `meta` wholesale (it already serializes `createdAt` Date→ISO); if it maps field-by-field, add the two there.

Seam test (cross-slice-seam lesson): assert the recommendation adapter output carries the two fields from the row, and pin the wire shape the dashboard consumes (a shape/`safeParse`-style assertion over the adapter output, since the types are hand-mirrored).

## Decisions (locked)

1. Target the shared `ApprovalDetailSheet` (approval + workflow_approval). Handoffs out.
2. Evidence = the existing `dataLines`, elevated into a dedicated "Why" block, gated on presence. No new evidence threading.
3. Thread `dollarsAtRisk` + `confidence` — the only missing wire fields.
4. AT-STAKE renders `dollarsAtRisk` via the canonical `formatMoney`/`<Money>` (`lib/money.tsx`, S$), only when `Number.isFinite(v) && v > 0`. Eyebrow "Estimated impact" + caption naming it an estimate. Never `S$0`, never `—`.
5. Confidence as a qualitative band chip: low `<0.5`, medium `0.5–<0.8`, high `>=0.8`. Only when `Number.isFinite`. No fake-precise percentage.
6. SIGNALS row = `riskChips(contract)` + the confidence chip; cap ~4 chips. Risk **level** stays in the header pill (no duplicate). AA-safe pairing only (solid `bg-{x} text-{x}-foreground` or neutral ink on tint — never mid-tone text on a subtle tint).
7. reason-on-override = optional inline note on the dismiss/decline path → `onDismiss(note)`; persisted via the existing `note` param. Approve keeps its existing high-risk `ConfirmInline` note. Note stays optional (no semantics change).
8. Delete the dead `ds-pending` "What this changes" stub (`approval-detail-sheet.tsx:210-241`) and its now-orphaned CSS.
9. Card doorway: a quiet dollar figure (mono, not a loud chip) when `dollarsAtRisk > 0`; preserve card density (audit M4 prizes the inbox rhythm).
10. Vertical order: proposal → evidence → dollar-at-stake → signals → controls.

## Graceful degradation

| kind / source | evidence | dollar-at-stake | confidence | reason-on-override |
|---|---|---|---|---|
| approval — ad-optimizer rec | rich dataLines | shown if `>0` | band | yes |
| approval — other rec | empty → block omitted | omitted if `0` | band if present | yes |
| workflow_approval — parked | summarizer dataLines | omitted | omitted | yes |

## Voice & tokens (editorial register)

- Mono eyebrows (JetBrains, loaded weights 400/500/600 only), Source Serif (`--serif`) for the proposal line + the at-stake hero numeral, Geist body.
- Amber (`--action`) only on Approve. Agent hue for identity only.
- All chips/text meet WCAG AA on the cream + grain ground — compute contrast for every new tint+text pairing; prefer the solid `-foreground` pairing.
- Ink tokens `--ink/--ink-2/--ink-3` are pre-`hsl()`-wrapped (`var(--ink-3)`, not `hsl(var(--ink-3))`); raw triplets still need `hsl(var(--x))`.
- No em-dashes. The `—` no-value glyph is being removed with the stub; the new blocks omit rather than show a placeholder.
- Reuse `formatMoney`/`<Money>`, `Badge`, `Button` (`action`), and the existing `ds-*` sheet CSS conventions.

## Test plan (TDD, RED first)

- core `recommendation-adapter.test`: `dollarsAtRisk` + `confidence` threaded from the row; handoff/parked adapters leave both undefined.
- core seam test: wire `Decision.meta` shape includes the new optional fields (pin the hand-mirrored seam).
- dashboard `approval-detail-sheet.test`: evidence block renders dataLines when present and is absent when empty; at-stake renders `S$` when `>0`, absent when `0`/undefined/`NaN`; confidence chip bands correctly and is absent when undefined; reason-on-override reveals the note on decline and forwards it; the `ds-pending` stub is gone (assert "preview not yet wired" no longer in the DOM).
- dashboard `inbox-decision-card.test`: dollar hint renders when present, absent otherwise.
- Regression: existing `inbox-screen.test.tsx` + sheet tests stay green (e.g. the `getByRole("heading")` assertion).

## Risks

- **Money display** (flagged): `dollarsAtRisk` is an estimate scraped from agent-authored copy, rendered as S$ via the canonical formatter — a display of an existing field, not a currency guess or a money behavior change (consistent with the locked app-wide #6b USD→S$ decision). Guarded against `0`/`NaN`. Called out in the PR for human visibility.
- **Source-dependent evidence**: only ad-optimizer recommendations carry rich dataLines; others collapse the WHY block. Honest, intended; before/after screenshots should show both a rich case and a sparse case.
- **Hand-mirrored wire types** → seam test mandatory.
- **New `.module.css`/CSS while `next dev` runs** throws a stale-HMR false alarm → restart dev; `next build` + vitest resolve fine.

## Out of scope / follow-ups

- Handoff sheet evidence (conversationSummary / leadScore / sentiment exist on the row, separate sheet).
- Parked-approval budget dollar surfacing.
- Per-source evidence enrichment so non-ad-optimizer recommendations nest a presentation (producer slice).
- A genuine before/after delta panel — only with a real producer; do not re-stub.
