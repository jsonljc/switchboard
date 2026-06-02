# D5 — Execution Readiness, Autonomy & Governance (Phase 2 + the leash)

> Raw domain audit. Verified against `origin/main` (incl. #788). Synthesis: [`../FINDINGS.md`](../FINDINGS.md).

## 1. CURRENT STATE (verified)

**(a) Riley writes NOTHING to ad accounts — confirmed end-to-end.**
- `MetaAdsClient` mutating methods are **truly caller-less**: the only non-test references to `updateCampaignStatus`/`createDraftCampaign`/`createDraftAdSet`/`uploadCreativeAsset` are their own definitions (`meta-ads-client.ts:129,147,160,174`) + the test file.
- All 5 `MetaAdsClient` instantiations call read-only methods.
- **Guards:** `updateCampaignStatus` throws on `status==="ACTIVE"` (`:175-179`, "SAFETY: Agent cannot activate campaigns"); `createDraft*` hardcode `status:"PAUSED"` (`:133,153`). There is **no named `neverAutoActivate` flag** — it's these literal guards.
- **No `updateCampaignBudget` exists** (Phase 2 unstarted).
- **The execution leg does not exist:** grep for any recommendation→mutating-method call returns empty. `actOnRecommendation` (`act.ts:48`) on approval only flips the recommendation **status**. **The approval queue is a leash with no hand — even a human "approve" executes nothing on Meta.**

**(b) `candidateAction` is SPEC-ONLY — not implemented.** Zero source hits across `main`, `feat/riley-phase1-eyes`, this worktree. `RecommendationOutputSchema` (`schemas/ad-optimizer.ts:168-181`) has no such field; its param carrier is `params: z.record(z.string(), z.string())` (`:179`) — **string→string only**, structurally **cannot** carry a numeric `reversibleChange:{dailyBudget:{from,to}}`. Adding it is a real schema change.

**(c) `spendApprovalThreshold` (#788) is REAL, opt-in, deny-respecting — fully wired.** Pure post-processor `applySpendApprovalThreshold` (`spend-approval-threshold.ts`) called at `governance-gate.ts:178-185`. A `deny` is a fixed point; engages only when `trustLevelOverride==="autonomous"` AND `spendAutonomyEnabled===true`; relaxes only a **reversible routine standard** `require_approval` at/under threshold → `execute`; escalates over-threshold `execute` → `require_approval`; dormant ⇒ byte-identical. Spend read via canonical `extractSpendAmount` (`spend-limits.ts`, same extractor as the deny-floor). **But #788 has no producer for Riley** — documented in `recommendation-sink.ts`: a correct producer needs a structured budget-delta field (absent) AND a PlatformIngress path (absent). #788 is a correctly-built, tested, **currently-inert** lever awaiting Phase 2.

**(d) The Phase-2 execution seam already exists and is well-trodden.** `OperatorMutationMode` (`operator-mutation-mode.ts:51`, `ExecutionModeName "operator_mutation"`) reachable only through `PlatformIngress.submit()`; `operator.act_on_recommendation` already rides it. **Idempotency is free via PlatformIngress** claim-first replay guard (D1 #780): `WorkTraceStore.claim()` atomically inserts a `running` trace keyed by `(org, idempotencyKey)`; concurrent claim conflicts and fails closed (`platform-ingress.ts:323-351`). Hard spend caps already enforced at the deny floor (`checkSpendLimits`, per-action/daily/weekly/monthly).

**(e) The trust-economics ramp is DEAD for runtime admission.** `GovernanceGate.evaluate` sets constraints from `trustLevelOverride` (manual) else hardcoded `DEFAULT_CARTRIDGE_CONSTRAINTS` (`governance-gate.ts:91-93`, comment: "without consulting the score-based ramp"). `TrustScoreEngine.scoreToAutonomyLevel` is consumed only inside the engine + the marketplace API — **the gate never calls it.** Score computed → discarded for governance.

## 2. GAPS / WEAKNESSES (by safety-adjusted severity)
1. **[CRITICAL FOOTGUN] The copy-paste Phase-2 path silently defeats #788.** Operator intents register via `registerOperatorIntent` (`operator-intents.ts:99-117`) with `approvalMode:"system_auto_approved"`. The gate **short-circuits `system_auto_approved` to `execute` at `governance-gate.ts:98-106` — BEFORE the spend post-processor at `:178`.** If Phase 2's `operator.apply_ad_action` reuses that helper (the obvious path), #788 + risk scoring + `checkSpendLimits` are **all bypassed** — an unbounded auto-execute of a budget mutation. The single most dangerous Phase-2 mistake, and it looks like a one-line reuse.
2. **#788 lever is inert for Riley** — no structured budget-delta producer; schema can't carry a numeric one.
3. **`candidateAction` doesn't exist** — Phase 1's "designed-now seam" was never built. Phase 2 must first add descriptor + schema + producer.
4. **Reversibility brake reduces to `mutationClass!=="destructive"` in prod** (no cartridge populates `reversibility`). A budget *increase* tagged `"write"` is auto-eligible under threshold.
5. **No "approve actually executes" leg.** Phase 2 must build the executor turning an approved decision into a governed `updateCampaignBudget` call — 100% greenfield.
6. **No audit assertion that Phase 1 dispatches nothing** (PR4's no-ghost-execution test not implemented). "Dispatches nothing" is caller-absence, not a guarded invariant.
7. **`updateCampaignStatus` guards only `ACTIVE`** (PAUSED/DELETED/ARCHIVED ungated) — safety lives in caller-absence.

## 3. RANKED RECOMMENDATIONS
**R1 — Forbid `system_auto_approved` for financial/external intents; force `apply_ad_action` through `approvalMode:"policy"`.** Add a registration guard; optionally assert in `GovernanceGate` that a financial mutation never reaches the short-circuit. `operator-intents.ts:99-117`; `governance-gate.ts:98-106`. Effort S, risk low. **Do BEFORE any Phase-2 handler.** *TAG: Phase-2 prerequisite / safety.*

**R2 — Implement `candidateAction` on the schema + sink.** Add optional `candidateAction` (spec §6 shape, numeric `{dailyBudget:{from,to}}`, `to ≤ 1.20×from`, `requiresHumanApproval:true`); producer populates it; emit under `spendAmount` so `extractSpendAmount` reads it. `params: Record<string,string>` must change. `schemas/ad-optimizer.ts:168-181`; `recommendation-sink.ts:303-341`. Effort M, risk low (additive, inert). *TAG: Phase-1 §6 finish → Phase-2 enabler.*

**R3 — Add the PR4 no-ghost-execution invariant test now.** Assert a full Phase-1 audit creates no `apply_ad_action`, no ad-action WorkTrace, no `MetaAdsClient` mutating call; + no path reads `candidateAction` to dispatch. Effort S. Deps R2 (for the candidateAction half). *TAG: Phase-1 acceptance.*

**R4 — MINIMAL SAFE FIRST AUTO-ACTION: a ≤20% reversible daily-budget nudge via `operator.apply_ad_action`.** New pieces: `updateCampaignBudget` (with a 1.20× clamp); `operator.apply_ad_action` intent via `policy` (per R1); an `OperatorMutationHandler` that re-reads current budget, recomputes the delta server-side, submits via PlatformIngress with stable idempotencyKey, then calls the client; surface delta under `parameters.spendAmount`. Reused: `OperatorMutationMode`, PlatformIngress claim-first idempotency, `checkSpendLimits`, #788, WorkTrace audit, the ACTIVE-guard pattern. **Reversible + bounded + idempotent + human-approval default.** Effort M-L, risk med (flag + explicit `spendAutonomy` opt-in). Deps R1, R2, R3. *TAG: Phase-2 MVP.*

**R5 — Do NOT wire the trust-economics ramp into the gate pre-launch.** Keep autonomy gated by explicit `trustLevelOverride:"autonomous"` + `spendAutonomy`. The ramp auto-escalates `≥55 → autonomous` off approval counts — wiring it means rubber-stamped *advisory* approvals silently graduate Riley to budget-mutating autonomy. Effort none (decision). *TAG: strategic / defer.*

**R6 — Enforce the reversibility-tagging contract for financial actions.** Registry-level check that irreversible financial intents register `mutationClass:"destructive"`; budget *increases* tagged so they can't auto-execute as a bare reversible "write". Effort S. Deps R1. *TAG: Phase-2 safety.*

## 4. VERIFICATION LOG
Branch reality: local HEAD was behind `origin/main`; #788 (`42b99b74`) IS on origin/main; governance files read via `git show origin/main`. `candidateAction`/`apply_ad_action`/`updateCampaignBudget` — 0 hits across all refs. Mutating callers — only definitions + test; recommendation→mutating-call grep empty. #788 traced end-to-end (`spend-approval-threshold.ts` ← `governance-gate.ts:178-185` ← `extractSpendAmount` ← resolver chain). Trust ramp deadness (`scoreToAutonomyLevel` consumers = engine + marketplace only; `governance-gate.ts:91-93` comment). Phase-2 seam (`operator-mutation-mode.ts`, `operator-intents/recommendation.ts`, registrar at `operator-intents.ts:99-117`; `system_auto_approved` short-circuit at `governance-gate.ts:98-106` precedes spend post-processor at `:178`). Idempotency (`platform-ingress.ts:323-351`). `actOnRecommendation` flips status only.
