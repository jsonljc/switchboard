# Riley v3 Safe Revenue Control Plane: sequenced roadmap

> **For agentic workers:** This is a multi-slice *roadmap*, not a single bite-sized plan. It consumes the spec at `docs/superpowers/specs/2026-06-03-riley-v3-control-plane.md`. Each slice below is an independent future session that, at execution time, produces its own detailed `docs/superpowers/plans/` plan via `superpowers:writing-plans` and is built with `superpowers:subagent-driven-development` / `executing-plans`. Slice 1 is the recommended next session and is specified most concretely; later slices are scoped enough to plan but deliberately not pre-written to file:line (those references drift as `main` moves). Re-verify every file:line against live `origin/main` before implementing.

**Goal:** Land Riley's v3 "control plane" reframe as focused, independently-shippable slices over the existing `packages/ad-optimizer` and `packages/core` machinery (consolidation, not a rewrite), keeping Riley advisory-only until the explicit Phase-C seam (slice 5).

**Architecture:** Give typed boundaries to machinery that already exists (RevenueState, RevenueOpportunity, ActionContract, ExecutionPermit, OutcomeLedger), add the one genuinely-missing deterministic OpportunityArbitrator, and design the Phase-C execution seam without wiring it. Decisions stay model-free; the per-campaign decision layer is pinned by the `evals/riley-recommendation/` CI gate, and the cross-campaign arbitrator brings its own new fixture.

**Tech Stack:** TypeScript ESM monorepo (pnpm plus Turborepo); `packages/ad-optimizer` (Layer 2, surface-agnostic) and `packages/core` (Layer 3, governance); Vitest plus the `pnpm eval:riley` golden harness; Inngest crons.

---

## Global invariants (every slice)

- [ ] **Advisory-only.** No new `PlatformIngress` caller in `packages/ad-optimizer`; no Meta write; no new mutating caller. Slice 2 leaves emission and handoff gating unchanged. Grep the diff before every PR.
- [ ] **Eval honestly anchored.** `pnpm eval:riley` (CI-blocking, `.github/workflows/ci.yml`) passes. Slice 1 must not change it. Slice 2 *adds* a new multi-candidate fixture for the arbitrator (the existing per-campaign harness cannot see it). Slice 3 is downstream of decisions and must not perturb it.
- [ ] **Surface-agnostic backend.** New backend objects live in `packages/ad-optimizer` or `packages/core`; zero UI imports. The only operator-surface touches are the explicit, scoped ones in slices 3 (trustDelta on the existing cockpit outcome feed) and 4b (business-context editor); these are not the deferred standalone results dashboard.
- [ ] **Conventions.** ESM plus `.js` relative imports; no `any`; co-located `*.test.ts`; conventional lowercase commit subject; no em-dashes; files under the 600-line arch-check ceiling (`pnpm arch:check`).
- [ ] **Pre-flight per session.** `git fetch origin main`; re-derive the file:line anchors below (audited at `63abdcb`); run `pnpm reset` if `@switchboard/*` exports look stale before trusting any "main is broken" signal.

---

## Slice 1: RevenueState consolidation (RECOMMENDED FIRST SESSION)

**Why first:** every later slice reads RevenueState. It is a behavior-preserving refactor pinned by the existing eval, so it is the lowest-risk, highest-leverage starting point.

**Goal:** Introduce one typed `RevenueState` object, assembled *progressively in producer order* from the six existing producers, and pass it into the decision layer in place of the six positional variables, with *zero behavior change* (eval stays green) and *no provider called past an early abort*.

**Files:**
- Create: `packages/ad-optimizer/src/revenue-state.ts`, the `RevenueState` type (late fields optional, populated in producer order) plus a pure `assembleRevenueState(...)` builder. No new computation.
- Create: `packages/ad-optimizer/src/revenue-state.test.ts`, co-located unit tests.
- Modify: `packages/ad-optimizer/src/audit-runner.ts`, build `RevenueState` incrementally from values already in scope (denominator step-change ~`:408`, economic target ~`:417`, marginBasis ~`:425`, coverage Gate-0 ~`:300-321`, signal health ~`:336`, spend-attribution coverage ~`:536`) and thread it into the decision calls. *Keep the two early-returns (coverage abstention ~`:305`, signal-health-red ~`:345`) as standalone guards; do not hoist late producers above them.*
- Modify: `packages/ad-optimizer/src/campaign-decision.ts`, `CampaignDecisionInput` reads from `RevenueState` instead of the loose `measurementTrusted` / `economicTier` / `effectiveTarget` / `marginBasis` fields. Keep the gate logic byte-identical.
- Modify: `packages/ad-optimizer/src/analyzers/source-reallocation.ts`, `SourceReallocationInput` reads the relevant slice of `RevenueState` (`measurementTrusted`, `spendAttributionCoverageBySource`).
- Modify: `packages/ad-optimizer/src/index.ts`, export the `RevenueState` type only if a consumer outside the package needs it (likely not; keep internal if possible).

**Sequenced steps (TDD; each is a commit boundary):**
- [ ] Write `revenue-state.test.ts`: `assembleRevenueState` maps each producer output onto the right typed field (including `marginBasis: "unavailable"` passthrough and a `businessContextFreshness: "unknown"` default reserved for slice 4), and a *partial* assembly (only the pre-abort fields present) is well-typed. Run; verify fail.
- [ ] Implement `revenue-state.ts` (type plus pure builder) minimally to pass. Run; verify pass.
- [ ] **Abort-guard test (asymmetric):** add an `audit-runner` test asserting that a coverage-Gate-0 abstention returns with *zero* provider calls (no Meta fetch, no `resolveEconomicTarget`, no spend attribution, no booked-value), while a signal-health-red short-circuit returns *after* the Meta insight fetches (`getCampaignInsights` x2 + `getAccountSummary`, which feed its critical report) but with no `resolveEconomicTarget`, CRM funnel, spend-attribution, booked-value, or per-campaign decision calls (spy/mock asserts). Run; verify fail (it fails if the refactor hoists late producers above an abort).
- [ ] Refactor `audit-runner.ts` to build `RevenueState` incrementally, *preserving* the early-return short-circuits. Run audit-runner integration tests plus the abort-guard test plus `pnpm eval:riley`; verify green.
- [ ] Refactor `campaign-decision.ts` and `source-reallocation.ts` to read from `RevenueState`. Run their unit tests plus `pnpm eval:riley`; verify green.
- [ ] `pnpm test --filter @switchboard/ad-optimizer`, `pnpm typecheck`, `pnpm arch:check`, `pnpm format:check`. Commit.

**Acceptance gate:** `pnpm eval:riley` unchanged and green; all ad-optimizer unit tests green; the abort-guard test proves no provider runs past an abort; no diff in emitted recommendations for the eval fixtures; `RevenueState` is the single object the decision layer reads.

**Risk (spec section 7.3):** the bug is hoisting producers to "complete the object up front." The abort-guard test is the defense; "assemble once" is explicitly forbidden.

---

## Slice 2: OpportunityArbitrator (and the ActionContract consolidation it first consumes)

**Goal:** Pick one primary mutating `RevenueOpportunity` per account per cycle (plus optionally one non-mutating measurement fix), via a deterministic score, as *additive ranking metadata* that does not change emission or handoff gating. Bring a new pin (the existing per-campaign eval cannot see a cross-campaign selection).

**Files:**
- Create: `packages/ad-optimizer/src/action-contract.ts`, consolidating `ACTION_RISK_CONTRACT` + `ACTION_RESETS_LEARNING` + `EVIDENCE_FLOORS` into one keyed record plus an `isMutating(action)` helper that bakes in the sink's `resetsLearning==="yes"` externalEffect elevation (`recommendation-sink.ts:453`). Have the sink derive its elevation from this shared contract (or assert `rec.resetsLearning === resetsLearningFor(rec.action)`) so the two cannot drift, with no behavior change to the sink's emitted booleans.
- Create: `packages/ad-optimizer/src/action-contract.test.ts`, including a test that `isMutating` agrees with the sink's elevated `externalEffect` for all 14 actions: pins `pause` as mutating and *both* static-false-but-elevated cases, `refresh_creative` **and** `add_creative` (do not test only one).
- Create: `packages/ad-optimizer/src/analyzers/opportunity-arbitrator.ts`, pure `arbitrate(candidates, revenueState, actionContracts) -> { primary, secondary[], measurementFix? }`.
- Create: `packages/ad-optimizer/src/analyzers/opportunity-arbitrator.test.ts`.
- Modify: `packages/ad-optimizer/src/audit-runner.ts`, call the arbitrator after candidates are assembled; annotate primary/secondary rank on the outputs. Do not drop candidates; do not change handoff gating.
- Modify: `evals/riley-recommendation/run-eval.ts` plus a new multi-campaign fixture, add an `expectedPrimary` assertion over an account with several candidates (extends the existing account-level source-reallocation sub-eval capability). Keep existing per-campaign `expectedActions` set-membership unchanged.

**Score (spec section 3):** `materiality × revenueProximity × truthConfidence − learningResetPenalty − attributionConflictPenalty`. `materiality` from a *structured* magnitude (campaign spend, breach severity), not the `estimateRisk` prose dollar-scrape. `revenueProximity` from `economicTier`. `truthConfidence` from the RevenueState composite. `learningResetPenalty` from `ACTION_RESETS_LEARNING`. `attributionConflictPenalty` from the `same_campaign_overlap`/`same_kind_retry` conflict condition. "Mutating" = `ActionContract.isMutating`. Measurement fixes (`fix_signal_health`, `harden_capi_attribution`) bypass the cap.

**Sequenced steps:**
- [ ] Write `action-contract.test.ts` incl. the `isMutating`-vs-sink agreement test. Run; verify fail.
- [ ] Implement `action-contract.ts` (consolidated record plus `isMutating`); re-point the sink at it without changing emitted booleans. Run sink tests plus `pnpm eval:riley`; verify green.
- [ ] Write arbitrator unit tests: ties broken deterministically; a second mutating action on an already-edited campaign loses; a measurement fix is never starved by the mutating cap; highest `materiality×proximity×confidence` wins; materiality uses the structured magnitude. Run; verify fail.
- [ ] Implement `opportunity-arbitrator.ts`. Run; verify pass.
- [ ] Wire into `audit-runner.ts` as additive ranking (no emission/handoff change). Run audit-runner tests; assert emission and handoff candidate sets are byte-identical to pre-arbitrator.
- [ ] Add the multi-campaign `expectedPrimary` fixture to `run-eval.ts`. Run `pnpm eval:riley`; verify existing assertions unchanged and the new primary assertion passes.
- [ ] Full ad-optimizer test plus typecheck plus arch:check plus format:check. Commit.

**Acceptance gate:** for a multi-candidate account, exactly one primary mutating opportunity is selected deterministically; non-mutating measurement fixes survive; emission and handoff gating are provably unchanged; existing eval assertions unchanged; the new `expectedPrimary` assertion green.

**Depends on:** Slice 1 (reads `RevenueState`). This slice owns the ActionContract consolidation because it is the first consumer of `isMutating`.

---

## Slice 3: OutcomeLedger enrichment

**Goal:** Add `causalStrength`, `businessContextStable`, and `trustDelta` to the existing outcome path, scoped to `V1_ATTRIBUTABLE_KINDS` (`pause`, `refresh_creative`), rendered on the existing cockpit outcome feed, none auto-applied.

**Files:**
- Modify: `packages/core/src/recommendations/outcome-attribution-types.ts` (`RileyOutcomeRow` gains the three fields), `outcome-attribution.ts` (derive them), `outcome-attribution-config.ts` if a per-kind config is needed.
- Modify: `packages/db/prisma/schema.prisma` plus a migration in the same commit (the three fields persist on `RecommendationOutcome`). Run `pnpm db:check-drift`.
- Modify: the existing cockpit outcome read path (`/api/riley/outcomes` and its renderer) so `trustDelta` is *displayed* on the surface that already renders `RileyOutcomeRow` (spec section 7.2; an existing surface, not a new dashboard).
- Tests: co-located in `packages/core/src/recommendations/__tests__/`.

**Derivation (spec sections 2.5, 7.4, 7.5):** `causalStrength` emits only `directional | inconclusive` in this slice (derivable from `visibilityFlags`, `dailyRowCount`, overlap/retry; `inconclusive` when flagged/sparse/zero-baseline, `directional` for a clean single delta). The `corroborated` value is reserved and emitted only once slice 4 wires the CRM/booking-agreement signal; never fabricated here. `businessContextStable` records `unknown` until slice 4 (never a fabricated `true`). `trustDelta` (`up|none|down`) is derived from outcome direction and `causalStrength`; recorded and displayed, *not* auto-applied into scoring (Riley executes nothing).

**Sequenced steps:**
- [ ] Write tests: `causalStrength` is `inconclusive` under a visibility flag / low `dailyRowCount`, `directional` for a clean delta, and *never* `corroborated` in this slice; `businessContextStable` is `unknown`; `trustDelta` from direction times `causalStrength`. Run; verify fail.
- [ ] Hand-write the Prisma migration (`migrate diff --script` then `migrate deploy`; index names <= 63 chars) plus schema fields. Run `pnpm db:check-drift`.
- [ ] Implement derivation in `outcome-attribution.ts`. Run core tests.
- [ ] Display `trustDelta` on the existing `/api/riley/outcomes` cockpit feed. Run.
- [ ] `pnpm test --filter @switchboard/core`, typecheck, arch:check, format:check. Commit.

**Acceptance gate:** enriched outcome rows for `pause`/`refresh_creative`; `trustDelta` visible on the existing cockpit feed (not a dead field); `causalStrength` never `corroborated` yet; honest-null/`unknown` defaults; no auto-application; eval seam unaffected.

**Depends on:** Slice 1 (conceptually); independent enough to run parallel to Slice 2. If `trustDelta` cannot be surfaced on an existing surface, defer it to Phase-C rather than storing an unread field.

---

## Slice 4: businessContextFreshness (a sub-project, not a peer slice)

**Goal:** Add operator-editable operational-state plus freshness on top of the existing `PlaybookBusinessFacts` substrate, wire it into the audit/outcome path, flip RevenueState's deferred dimension plus OutcomeLedger's `businessContextStable` from `unknown` to real, and enable the `corroborated` arm of `causalStrength`. This is four packages plus an operator surface; plan it as three sub-PRs.

**Slice 4a (schema + store + migration):**
- Modify: `packages/schemas/src/marketplace.ts`, extend the *active* `BusinessFactsSchema` (`:274`, the one the live store persists and Alex reads), or add a sibling operational-state schema, with operational-state fields (open/closed, promo window, staffing, inventory) *and a freshness/last-confirmed timestamp* encoding staleness of the input itself (spec section 7.4). Note: `PlaybookBusinessFactsSchema` in `playbook.ts` is a *separate* schema and is NOT the store substrate; do not extend it by mistake.
- Modify: `packages/db/src/stores/prisma-business-facts-store.ts` (imports `BusinessFactsSchema`) plus a migration (same commit); `pnpm db:check-drift`.
- Tests: schema shape incl. freshness timestamp; store round-trip.

**Slice 4b (operator editor):**
- Add or extend the operator business-facts editing surface so the operator can confirm/update operational state (and so a confirmation carries a validity interval).
- Tests: editor save path; confirmation timestamp persisted.

**Slice 4c (consumption):**
- Modify: `packages/ad-optimizer/src/revenue-state.ts`, consume freshness into `businessContextFreshness`.
- Modify: the slice-3 outcome derivation: `businessContextStable` becomes real, requiring the operator confirmation's validity interval to *overlap the full attribution window* (`windowStartedAt`..`windowEndedAt`), not merely a recent edit (spec section 7.4). Wire the CRM/booking-agreement signal so `causalStrength` can emit `corroborated` honestly.
- Run ad-optimizer plus core tests plus `pnpm eval:riley`.

**Acceptance gate:** RevenueState carries a real `businessContextFreshness`; `businessContextStable` reflects window-overlapping operator confirmation; `causalStrength` can now emit `corroborated` only when the CRM/booking signal independently agrees; no fabricated stability or corroboration.

**Depends on:** Slices 1 and 3 (it flips their `unknown` defaults and enables the reserved `corroborated` value).

---

## Slice 5: Phase-C seam (designed-but-unwired)

**Goal:** Design (not wire) the `ActionContract` reversibility/rollback/guardrail fields and the `RevenueOpportunity` plus `ActionContract` to `CanonicalSubmitRequest` adapter for a self-executed reversible class, so a future Phase-C session can switch it on through the already-built `PlatformIngress` to `GovernanceGate` permit. *No execution path is enabled.*

**Files (design plus unwired shapes only):**
- Modify: `packages/ad-optimizer/src/action-contract.ts` (from slice 2), add `reversibility` plus optional `rollbackPlan` / `successMetric` / `guardrailMetrics` *types*, defaulted/empty, consumed by nothing yet.
- Create: `packages/ad-optimizer/src/phase-c/opportunity-to-submit-request.ts`, a pure mapper `RevenueOpportunity + ActionContract -> CanonicalSubmitRequest` for `pause`. It defines a *new* ad-mutation intent and resolves *Riley's own* deployment (NOT the Mira creative-handoff intent `adoptimizer.recommendation.handoff`), reusing only the path's conventions (seeded `{id:"system",type:"system"}` actor, idempotency-key shape, the `approvalRequired` branch). Not called from any live path.
- Tests: assert the mapped `CanonicalSubmitRequest` shape for a `pause`, *and* assert convention-parity (actor, idempotency-key shape, expiry/approval fields) against the live `recommendation-handoff-request.ts` builder so that drift in the real builder breaks this test.

**Sequenced steps:**
- [ ] Write the mapper test (shape for `pause` plus convention-parity vs the live builder). Run; verify fail.
- [ ] Implement the pure mapper plus the unwired contract fields, with an explicit `// PHASE-C: intent + Riley deployment resolution unresolved` note. Run; verify pass.
- [ ] Grep-prove no live caller: the mapper is referenced only by its test; no `PlatformIngress` import added to `packages/ad-optimizer`. Run full ad-optimizer test plus typecheck plus arch:check. Commit.

**Acceptance gate:** the mapper plus extended contract compile and are unit-tested; the convention-parity test ties the unwired mapper to the live builder so it cannot rot silently; *zero* new mutating callers; advisory-only invariant holds (grep the diff). The new mutate intent and Riley-self deployment resolution are flagged as open Phase-C questions, to be resolved by the wiring session.

**Depends on:** Slices 1 through 3 (RevenueState, RevenueOpportunity, the consolidated ActionContract). Consider folding slice 5 into the Phase-C wiring session rather than landing standalone, to avoid long-lived unwired code.

---

## Self-review (spec coverage)

- Spec section 2.1 RevenueState maps to Slice 1 (progressive assembly + abort-guard test).
- Spec section 2.2 RevenueOpportunity (ownership derivation + single-most-material) maps to Slice 2 (arbitrator selects the primary; `deriveOwnership` placement decision flagged).
- Spec section 2.3 ActionContract consolidation + `isMutating` maps to Slice 2 (its first consumer); Phase-C fields map to Slice 5.
- Spec section 2.4 ExecutionPermit (already built) requires no build; mapping designed in Slice 5 with a new intent, not the creative handoff.
- Spec section 2.5 OutcomeLedger enrichment maps to Slice 3 (`corroborated` reserved to Slice 4c).
- Spec section 3 OpportunityArbitrator maps to Slice 2 (additive metadata, new multi-candidate eval fixture, structured materiality).
- Spec section 4 defer list honored: no bandit, no conformal infra, no rollback execution, `causalStrength` stays a 3-value enum (third value gated, not fabricated), no standalone results dashboard, businessContextFreshness gated to Slice 4.
- Spec section 7 risks each map to an acceptance gate / explicit step (arbitrator-vs-eval and materiality in Slice 2; trustDelta-on-existing-feed in Slice 3; assembly ordering in Slice 1; window-alignment + corroborated in Slice 4c; ownership placement in Slice 2; slice-5 intent/deployment + convention-parity in Slice 5).

## Execution handoff

This roadmap is *spec-only*; no slice is implemented here. The recommended next session is **Slice 1 (RevenueState consolidation)**: a fresh worktree off `origin/main` that consumes the spec, runs `superpowers:writing-plans` to expand Slice 1 into a bite-sized TDD plan, and builds it with `superpowers:subagent-driven-development`.
