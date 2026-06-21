# Reports + Results consolidation (design + decomposition)

Date: 2026-06-21
Status: active
Workstream: aesthetic-rehaul (Pass-2 thread 3)
Scope: `apps/dashboard` `/reports` (mercury register) + `/results` (standard editorial). Multi-slice.

## North star

Thesis line 50 (`docs/superpowers/specs/2026-06-19-aesthetic-rehaul-thesis.md`):

> Resolve reports vs results into one canonical statement + an at-a-glance KPI twin in the same voice.

Today `/reports` and `/results` read the **same** `ReportDataV1` (via `useReportData`) but render it in **two registers** with **duplicated widgets** (funnel, campaigns, colophon, managed-comparison). `/reports` is the mercury "operator statement" (the thesis style reference, Source Serif + warm paper); `/results` is the larger operational surface (3.3x more component code: hero KPIs, agent roster, 5 detail tiles, paid-visits, reconciliation, agent panel) in the standard editorial register.

**User-chosen direction (a): unify voice + dedup, keep both routes.** Bring `/results` into the mercury "operator statement" voice, extract the genuinely-duplicated widgets into shared components, and keep both routes (the nav already roles them: `/results` primary, `/reports` the conditional "advanced operator surface"). No route deprecation.

## Ground truth (verified 2026-06-21)

- Both consume `ReportDataV1`; `/results` also has `buildResultsModel` + `usePaidVisits`. Both already reuse `reports/components/format.ts` (`fmtSGD`/`fmtInt`/`fmtPct`).
- Mercury register (`reports.module.css`) is largely self-contained: `.reportsPage` defines `:root`-scoped `--serif` (Source Serif mercury), `--mono`, `--paper*` (warm cream), `--accent*`, spacing rhythm (`--page-x`, generous gaps), `.eyebrow`/`.section`/`.sectionHead` scale. Editorial (`results.module.css`) has NO `:root` block (shares globals), tighter rem-based rhythm, no warm paper.
- `reports/__tests__/css-class-integrity.test.ts` pins a hardcoded `REQUIRED_CLASSES` allowlist against `reports.module.css`.
- Dual widgets (in both surfaces): Funnel, Campaigns, Colophon, ManagedComparison. Semantically-distinct pairs (NOT duplicates): PullQuote (reports) vs VerdictLine (results); Attribution (reports comparison: Riley vs Alex, share bars) vs AgentContribution (results roster: Riley/Alex/Mira, tappable). `/results`-unique: HeroOutcomes, DetailsDisclosure, 5 detail tiles, PaidVisitsSection, ReconcileRowAction.

## Design decisions (locked)

1. **Shared home = `apps/dashboard/src/components/reports-shared/`** (new). Both `/reports` (`app/(auth)/(mercury)/reports/components/`) and `/results` (`components/results/`) import from it. It imports only `@switchboard/schemas` + local utils; never imports back from either surface (no cycles). `/results` already cross-imports `reports/components/format.ts`, so the pattern exists; `reports-shared/` makes it clean + non-route-scoped.
2. **Mercury is the canonical voice.** Extract the mercury register tokens (`--serif`, `--mono`, `--paper*`, `--accent*`, spacing rhythm, `.eyebrow`/`.section`/`.sectionHead` scale) from `reports.module.css` into `reports-shared/mercury-voice.module.css`, imported by both. `/results` adopts it.
3. **Deduped shared widgets** (ONE component each, in the mercury voice, keeping `/results`' semantic/a11y wins where better): **Funnel** (semantic `<ol><li>` + `DeltaBadge`), **ManagedComparison** (one class namespace, `fmtRatio`), **Colophon** (reconciled caveat copy). Plus **`format.ts`** promoted to `reports-shared/`. Each extraction renders in the unified mercury voice, so dedup + voice happen together (no double-touch).
4. **NOT deduped** (semantically distinct; re-voiced via CSS only, stay separate components): **PullQuote vs VerdictLine** (verdict-line adds a "Riley" byline; pull-quote animates), **Attribution vs AgentContribution** (comparison widget vs interactive 3-agent roster).
5. **Campaigns: do NOT force-merge** (the riskiest — `/results` has genuine `layout: mobile|desktop` branching + `RoasBar` + empty states that `/reports` lacks). Extract the shared **sort logic** (`sortCampaigns`, keys, direction toggle) to `reports-shared/`; keep each surface's markup; re-voice `/results`' campaigns CSS to mercury in the voice slice.
6. **`/results`-unique surfaces** (HeroOutcomes, DetailsDisclosure, the 5 detail tiles, PaidVisitsSection, ReconcileRowAction) → mercury voice via CSS only (no dedup).
7. **Both routes kept; nav unchanged.**

## Shared-component architecture

```
apps/dashboard/src/components/reports-shared/
  format.ts                 # moved from reports/components/format.ts (fmtSGD/fmtInt/fmtPct + fmtRatio)
  mercury-voice.module.css  # extracted mercury register tokens + .eyebrow/.section/.sectionHead scale
  funnel.tsx                # shared (mercury voice, semantic ol/li + DeltaBadge)
  managed-comparison.tsx    # shared (mercury voice, one class namespace)
  colophon.tsx              # shared (mercury voice, reconciled caveat)
  campaigns-sort.ts         # shared sort logic (markup stays per-surface)
  __tests__/                # co-located shared-component tests
```

`/reports` + `/results` each re-point their funnel/managed-comparison/colophon to the shared components (thin or removed wrappers) and import `mercury-voice.module.css`.

## Decomposition (PR-sized slices, low-risk-first)

Each slice is its own focused PR: TDD (RED proof), full VERIFY, independent review, then merge. Behavior-preserving refactors (T3.1-T3.5) are autonomous-friendly (structure verifiable by tests). The voice-unification slices (T3.6-T3.7) are visual re-skins of `/results` and REQUIRE before/after screenshot QA + human visual review (unit tests assert structure, not aesthetics) -> SURFACE-before-merge for those.

- **T3.1 (infra, LOW):** create `reports-shared/`; move `format.ts` there + repoint both surfaces' imports; extract mercury tokens to `reports-shared/mercury-voice.module.css` and have `/reports` import it (no visual change -- same tokens, new home). Behavior-preserving. Pin: imports resolve, `/reports` renders byte-identically.
- **T3.2 (Funnel, LOW):** `reports-shared/funnel.tsx` (mercury voice + semantic `<ol><li>` + `DeltaBadge`); both surfaces consume it; `/results` funnel adopts mercury voice. RED-proven render tests for both registers' usage.
- **T3.3 (ManagedComparison, MED):** shared component (mercury voice, one class namespace, `fmtRatio`); both consume. (95% identical today.)
- **T3.4 (Colophon, LOW-MED):** shared component (mercury voice; reconcile the two caveat texts into one honest version covering attribution-window + booking-not-collected). Both consume.
- **T3.5 (Campaigns sort + re-voice, MED):** extract `campaigns-sort.ts` to shared; keep each surface's markup; re-voice `/results` campaigns CSS toward mercury. (Markup stays divergent by design.)
- **T3.6 (VOICE: /results shell + narrative, MED, VISUAL -> SURFACE):** `/results` page root adopts `mercury-voice.module.css` (warm paper, serif, spacing rhythm); re-voice VerdictLine, WhatsWorking, WorthIt, AgentContribution, HeroOutcomes. The largest visual change. Before/after screenshots mandatory; human visual review before merge.
- **T3.7 (VOICE: /results detail surfaces, LOW-MED, VISUAL -> SURFACE):** the 5 detail tiles, DetailsDisclosure, PaidVisitsSection, ReconcileRowAction adopt mercury voice (CSS only). Screenshots + visual review.

## Test churn + css-class-integrity

- `css-class-integrity.test.ts` checks `reports.module.css` against a hardcoded allowlist. When classes move to shared CSS or `/results` adopts mercury classes, update the allowlist and/or extend the test to cover `reports-shared/mercury-voice.module.css` + (optionally) a parallel `results.module.css` check.
- Estimated ~8-12 test files need import-path/assertion updates across `reports/__tests__` + `results/` co-located tests as widgets move to `reports-shared/`. Each slice updates only the tests it touches.

## Risks

- **Campaigns merge (mitigated):** not forced -- only sort logic shared; markup stays per-surface.
- **Voice unification is visual (T3.6/T3.7):** unit tests can't certify aesthetics. These slices SURFACE-before-merge with before/after screenshots for human review. The mercury register's tighter-vs-looser spacing rhythm change to `/results` is the main visual risk.
- **Mercury register sharing:** confirm the extracted `mercury-voice.module.css` tokens don't collide with globals when imported into `/results` (the `--serif`/`--mono`/`--paper*` are mercury-scoped; verify no double-wrap / no global clobber across worktrees -- `results.module.css` deliberately has no `:root` to avoid cross-worktree clobber, so scope the shared tokens to a class, e.g. `.mercuryVoice`, not `:root`).
- **css-class-integrity drift:** update the allowlist in the same slice that moves classes.
- **Concurrent sessions:** the status-palette/amber-sweep + ai-e4c sessions touch other areas; re-check overlap before each slice.

## Out of scope

- Route deprecation / nav changes (direction (a) keeps both routes).
- Deduping the semantically-distinct pairs (PullQuote/VerdictLine, Attribution/AgentContribution) -- re-voiced only.
- The `/results` reconciliation UX + agent panel behavior (re-voiced, not restructured).
- Any `ReportDataV1` / backend change (pure presentation + dedup).
