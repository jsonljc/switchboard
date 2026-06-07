# Riley v3 Slice 4e: late-interval retroactive stability read (design)

**Date:** 2026-06-07
**Branch:** `feat/riley-4e-late-interval-stability`
**Type:** design spec (consumed by the same-PR implementation plan)
**Consumes:** the 4c plan's Decision B (the recorded 4e deferral: "post-window confirmations contribute their explicit interval declarations only, never scalar-transition inference"); the 4d spec's P4 (corroboration consumes `businessContextStable`); slices 4a (#895), 4c (#915), 4d (#939), 4f (#946) as shipped.

> Verification note. Every "already exists" claim was re-read against `origin/main` at `4de03843` (the #946 merge, this branch's base).

---

## 1. What this slice does, in one paragraph

Today `businessContextStable` derives only from confirmations the 4a window read returns: the governing row at-or-before `windowStartedAt` plus rows confirmed inside `(windowStartedAt, windowEndedAt]`. But attribution runs at least 24 hours after the window closes (`SETTLEMENT_LAG_HOURS = 24`, enforced in `findAttributableCandidates`), and an operator who confirms a promo or closure AFTER `windowEndedAt` is declaring a DATED FACT ("promo ran June 1 to 7") whose interval may overlap the already-measured window. Those late declarations are invisible today: a row can read `"stable"` or `"unknown"`, and even earn 4d's `corroborated`, while the operator's own late confirmation says the window was disrupted. This slice admits late confirmations into the stability derivation under a strict honesty asymmetry: their dated intervals (promoWindows, closures) may ADD disruption evidence, and nothing else. Late evidence can flip `unknown -> unstable` and `stable -> unstable`; it can never certify, restore, or vouch. Insert-once outcome rows are thereby judged against all operator facts that exist at attribution time, before pilot data accumulates.

## 2. The admission rules (the load-bearing part)

### Decision A: the honesty asymmetry (disruption-only, structurally)

Late evidence may only ever ADD disruption. The mechanics make the asymmetry structural rather than policed:

- Late rows are processed in their own pass that can only set the existing `disrupted` flag. They never enter the governing/in-window walk.
- Certification ("stable") reads ONLY the governing row (freshness at window entry, five-dimension completeness). A late row can never be governing: governing requires `confirmedAt <= windowStartedAt`, a late row has `confirmedAt > windowEndedAt`. Unreachable by construction, and pinned anyway: a late all-five-dimensions full-normal confirmation on an ungoverned window leaves `"unknown"`; on a stale-governed window leaves `"unknown"`; freshness vouching anchors on governing-row age at `windowStartedAt` and cannot be earned retroactively.
- The verdict is monotone in late evidence: `disrupted` is a boolean OR, so late rows can move the verdict only toward `"unstable"`, never away from it.

### Decision B: intervals only, never scalar inference (the recorded 4c rule)

A late confirmation's `promoWindows`/`closures` intervals are operator-dated facts: "the promo ran June 1 to 7" is equally true whenever it is recorded, and its overlap with the measured window is pure interval geometry. Its scalars (`operatingStatus`, `staffing`, `inventory`) describe the regime in force FROM the confirmation moment forward (the 4a derived-validity contract: `[confirmedAt_i, confirmedAt_{i+1})`), and a late row's validity has zero overlap with the window. The in-window walk's scalar rules are justified by validity overlap; that justification structurally fails for late rows, so the late pass reads scalars not at all. Inferring backward reach from an undated scalar ("staffing shortfall confirmed June 16, so maybe it began inside the June 1-15 window") is exactly the forbidden retroactive scalar-transition inference. Consequences, each pinned negative:

- A late scalar-only confirmation (shortfall, outage, even `temporarily_closed` with no dated closure interval) changes NOTHING. Only dated facts reach back.
- The declaration-change detector (the `overlappingSubsetKey` walk) does NOT run over late rows. A late declaration that differs from the governing row's is new knowledge recorded after the window, not a mid-window regime change. Late intervals contribute through geometry alone.

### Decision C: late interval geometry (same helpers, same rules)

The late pass applies the SAME interval geometry as the governing/in-window pass, factored into one shared helper so the two passes can never drift:

- A closure interval overlapping the window disrupts (the closure carve-out has no covers-exemption: a closed business transacts nothing, constancy does not rescue it).
- A promo interval overlapping but NOT covering the window disrupts (partial overlap breaks pre/post comparability). A late-declared promo COVERING the entire window does not disrupt: by the operator's own dated fact it was constant background across both sub-windows, and the differencing principle holds regardless of when the fact was recorded. (Deliberate, recorded divergence from the in-window case: an in-window declaration of a covering promo trips the declaration-change detector today and stays `"unstable"`; the same dated content arriving late is geometry-only. The in-window rule flags a mid-window change of declared regime; no such change happened inside the window when the declaration is late.)
- An interval with unparseable bounds disrupts (fail-safe toward `"unstable"`, mirroring the shipped in-window rule; store-validated rows always parse, this guards direct callers of the pure unit).
- Late-declared intervals are a UNION across late rows: a subsequent late re-confirm with `[]` does not retract a previously late-declared overlapping interval. Disruption evidence, once declared, stands (a hygiene-clearing re-confirm after a promo ends must not erase the dated fact that it ran). This needs no code: each late row is checked independently and disruption is monotone.

### Decision D: the late horizon (unbounded to the attribution moment, recorded)

Admissible late evidence = every confirmation existing at attribution time with `confirmedAt > windowEndedAt`. No recency bound, for four reasons: (1) a dated fact does not expire; the vouch window governs attestation of normalcy, and 4c's own principle is that disruption evidence is exempt from vouching. (2) The natural bound is the attribution moment itself: rows are insert-once and never re-derive, so only confirmations existing when the cron fires can ever matter. (3) Volume is operator-paced (the 4b editor; weekly-ish re-confirms), so the widened read stays small. (4) Any time cutoff would silently drop admissible operator facts for catch-up candidates (flag enabled after a backlog accumulated), which is exactly the fabrication-by-omission this slice exists to close.

Residual gap, recorded not papered over: a late confirmation arriving AFTER the row was attributed is permanently invisible for that row. That is the insert-once ledger property, recorded since 4c; 4e narrows the gap from "all post-window confirmations" to "post-attribution confirmations".

### Decision E: read shape (widen the call, not the contract)

Three candidate shapes were weighed:

1. **Widen `getConfirmationsOverlappingWindow`'s semantics** (return late rows from the same method under the same args): rejected. The 4a contract is "rows whose DERIVED VALIDITY overlaps the window"; late rows' validity does not overlap, so the method name becomes a lie, the db WHERE-shape pins (CI mocks Prisma; the WHERE is the pin) all change, and the shipped 4a store tests churn for zero behavioral need.
2. **A new store method + new `OperationalStateReader` interface method + a second orchestrator read**: rejected. More surface (db method, interface change, threading, mocks), two extra queries per candidate, and the derivation would take two input arrays describing one timeline, inviting caller mistakes about which row goes in which slot.
3. **Widen the CALL: pass a later end to the existing span-parametric method** (chosen). `getConfirmationsOverlappingWindow(orgId, preStart, X)` answers validity-overlap for the span `[preStart, X]` as a pure function of its arguments. The orchestrator passes `X = now` (clamped: `now > postEnd ? now : postEnd`, so the read can never be narrower than the shipped 4c read even for a hypothetical direct caller violating the settlement-lag invariant). The span `(preStart, now]` is exactly "all operator facts existing at attribution time that could govern or reach into the window". Zero db diff, zero interface diff, the db WHERE pins untouched; one call-site change plus the derivation extension.

The derivation already partitions rows internally by `confirmedAt` against the window bounds (governing `<= windowStart`, in-window `(windowStart, windowEnd]`); rows after `windowEndedAt` are silently DROPPED today. The slice adds the third bucket (late: `confirmedAt > windowEndedAt`) and its geometry-only pass. One input array, internal bucketing: the derivation is the single owner of window-relative semantics, and callers cannot misroute rows.

### Decision F: boundary doctrine (no gap, no double-count)

- The window stays half-open `[windowStartedAt, windowEndedAt)`; interval geometry is byte-unchanged: a late interval starting exactly at `windowEndedAt` does NOT overlap (that instant is never measured); one ending exactly at `windowEndedAt` covers every measured instant; one ending exactly at `windowStartedAt` does not overlap.
- A confirmation with `confirmedAt` exactly at `windowEndedAt` is an IN-WINDOW row today (store `lte`, derivation `t <= weMs`, shipped 4c bucketing) and stays one: 4e does not relitigate shipped in-window semantics. The late bucket is strictly `confirmedAt > windowEndedAt`. The buckets partition `(windowStartedAt, now]` exactly: no gap, no double-count, pinned on both edges (scalar flip declared exactly AT `windowEndedAt` disrupts via in-window semantics; the same flip 1ms later is a late row and changes nothing).

## 3. Ordering and threading (the consumer sweep)

Stability derives BEFORE corroboration and trustDelta inside `attributeOneRecommendation` (shipped 4d ordering, unchanged), so the late-aware verdict flows everywhere automatically. Every `businessContextStable` consumer, verified at `4de03843`:

| Consumer                                              | Reads                                                         | Verdict                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deriveBusinessContextStability`                      | the change itself                                             | gains the late bucket                                                                                                                            |
| corroboration P4 (`outcome-corroboration.ts`)         | `businessContextStable !== "unstable"`                        | receives the post-late-read value; a late-disrupted window now correctly blocks `corroborated` (pinned e2e)                                      |
| trustDelta demotion (`outcome-attribution.ts:166`)    | `=== "unstable"` ternary                                      | demotes on late-caused unstable automatically (pinned e2e)                                                                                       |
| row write (`PrismaRecommendationOutcomeStore.insert`) | typed passthrough                                             | value set unchanged (3 values; the enum gains NO new value)                                                                                      |
| read model `narrowEnum`                               | narrows `stable/unstable/unknown`                             | unchanged                                                                                                                                        |
| activity-feed translator (`outcome-activity-row.ts`)  | trustDelta/copyTemplate only, never stability (grep-verified) | renders a late-disrupted row as any other unstable row                                                                                           |
| run summary                                           | no stability counter exists                                   | unchanged (deliberate: 4c shipped the bare enum; a stability-reason/counter surface is a separate observability decision, recorded not smuggled) |
| audit freshness path (`getLatest`, ad-optimizer)      | different method, different question                          | byte-untouched                                                                                                                                   |

The "fixed in N, missed in N+1" hunt: `grep -rn businessContextStable` across packages and apps returns only the files above plus tests; no binary ternary other than the two verified sites exists.

## 4. Do-no-harm byte-identity

With zero late confirmations, every row is byte-identical to 4d/4f output, by construction at both layers: the widened read returns exactly the shipped row set when `(windowEndedAt, now]` holds no confirmations, and the derivation's late pass over an empty bucket is a no-op. The entire shipped test matrix (operational-stability, outcome-attribution, corroboration, linkage) passes untouched except ONE pin: the orchestrator test asserting the reader's call args (`outcome-attribution.test.ts:562`) updates from `postEnd` to `now` (that pin IS the slice's wire-level change, restated honestly). An explicit deep-equality test additionally pins that benign late rows (non-overlapping intervals, scalars only) leave the full row object identical field-for-field.

## 5. Architecture (a core-only diff)

- **packages/core** (the entire code diff): `operational-stability.ts` gains the late bucket, a shared `declaredIntervalsDisrupt` helper (factored from the existing rules 1-2 so the in-window and late passes share one geometry), and the late pass; `outcome-attribution.ts` widens the reader call with the clamped horizon and updates the input doc contract. No type changes, no new exports beyond the helper staying module-internal.
- **packages/db**: ZERO diff. The store is span-parametric already; its WHERE pins stay untouched. Zero migrations (`db:check-drift` clean).
- **apps/api**: ZERO diff. The reader flows through `bindRileyOutcomeOrchestrator` unchanged; the worker has no step boundaries around the read (no Inngest JSON-memoization exposure); error-propagation asymmetry preserved (the widened read adds no error path; reader failures still PROPAGATE because rows are insert-once, while the audit-side `getLatest` path keeps degrading, untouched).
- **packages/ad-optimizer, schemas, dashboard, chat**: ZERO diff. No new env vars or flags (rides `RILEY_OUTCOME_ATTRIBUTION_ENABLED`, untouched); no new mutating surface (read-side derivation only; `check-routes` baseline clean).

## 6. Test doctrine

New co-located files (the shipped attribution test file is at the eslint max-lines ceiling; the 4d/4f sessions both split):

- `__tests__/operational-stability-late-interval.test.ts` (pure derivation): asymmetry pins both directions (stable->unstable and unknown->unstable via late closure/partial-promo; late full-normal certifies nothing on ungoverned/stale-governed windows); intervals-only negatives (late scalar-only shortfall/outage/temporarily_closed change nothing; late scalar flip vs governing is not a transition); the geometry matrix on both windowEnd edges (start-at-we no overlap; end-at-we covers; end-at-ws no overlap; covering late promo stays stable, the recorded divergence vs the in-window declaration-change case); the confirmedAt boundary pair (at-we = in-window semantics, we+1ms = late semantics); union/no-retraction; unparseable late bounds fail toward unstable; benign-late-rows inertness across all three base verdicts; order independence with late rows shuffled in.
- `__tests__/outcome-attribution-late-interval.test.ts` (orchestrator + row level): the widened-call pin (reader receives `(orgId, preStart, now)`); the clamp pin (a hypothetical `now < postEnd` never narrows the read); e2e late closure flips the row to `unstable` + `trustDelta "none"`; e2e P4 block (late-disrupted window with otherwise-passing corroboration inputs emits `directional`, never `corroborated`); e2e late scalar-only leaves `stable` + corroboration earnable; row-level byte-identity with benign late rows.
- Eval gates: `pnpm eval:riley` (12+10+6) and `pnpm eval:governance` (26) byte-identical (baselines captured at the branch's clean state; the outcome path has no import contact with `evals/`, proven by 4c/4d).

## 7. Scope fence

ONE PR. In: the core derivation extension + widened reader call, the two new test files, the one updated call-args pin, this spec + the implementation plan. Out: any db/store/interface change, any migration, any new env var or flag, any UI, any summary counter or stability reason-code surface, scalar retroactive inference of any kind, re-derivation/backfill of existing rows (insert-once stands), the audit-side freshness path, pause-execution flags and evals (all byte-untouched).
