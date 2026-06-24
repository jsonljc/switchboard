# ai-infra-uplift S7 (shadow-mode Riley money-path) loop — scratch, uncommitted

Durable record: ai-infra-uplift-backlog.md S7 + research f8 + project_riley_capability_audit_2026_06_10.

## >>> RESUME POINT <<<

ORIENT done (feasibility YES). Design LOCKED below. Worktree `.claude/worktrees/ai-shadow-riley` branch `feat/ai-shadow-riley`.
Disposition: SURFACE (money/Riley path). Mark [S].

Goal: a predicted-vs-actual shadow harness for Riley's flag-dark reallocation executor with an (injectable) LLM-judge diff, runnable before the real-money flip. Build the BOUNDED, TESTABLE CORE: a pure `buildShadowReallocationReport` composing the existing planner + blast-radius + an injectable judge (deterministic without a key). NO money move, does NOT touch the live execute/audit path. Operational runner (audit shadow-logging / CLI) + the concrete live LLM judge = documented follow-up (the judge needs the 401-blocked key to run live).
Task-size: standard (one bounded PR; one new ad-optimizer module + tests).

## Ground truth (ORIENT, file:line)

- Planner (pure, predict): `packages/ad-optimizer/src/budget-reallocation-plan.ts:58 proposeCampaignReallocationCents(currentCents, factor=1.2)`; `packages/ad-optimizer/src/riley-budget-dispatch.ts:48 buildRileyBudgetCandidate(args) -> RileyBudgetCandidate | null` (abstains on non-scale/dropped/missing/zero-move). READ exact signatures + RileyBudgetCandidate shape before composing.
- Blast radius: `packages/ad-optimizer/src/blast-radius-contract.ts` DEFAULT_BLAST_RADIUS_CONTRACT + `assertWithinBlastRadius` (maxDeltaCents, maxAccountSpendShare). READ exact signature/return.
- Executor (DO NOT call): submit `budget-sink-dispatch.ts:22 dispatchRileyBudgetReallocation` -> PlatformIngress; money write `riley-budget-execution-workflow.ts:344 -> MetaAdsClient.updateCampaignBudget` (meta-ads-client.ts:516).
- Flag-dark confirmed: `apps/api/src/bootstrap/inngest.ts:569-574` submitter wired only when `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED==="true"` (absent=dark). Before the flip.
- LLM-judge pattern to mirror (mockable): `evals/alex-conversation/judge.ts` injects `AnthropicClientLike` (`messages.create -> {content}`); needs key live, stub in tests. For the harness, take an INJECTED judge fn (don't import evals).
- No existing reallocation shadow/dry-run; `shadow_action` router concept (`core/recommendations/router.ts:29`) is UI-level, not this.
- Layer: new module in ad-optimizer (Layer 2) imports planner + blast-radius (both ad-optimizer) + schemas only. Judge is injected (no cross-layer import). OK.

## DESIGN (LOCKED) — packages/ad-optimizer/src/shadow-reallocation.ts (+ .test.ts)

Types:

- `ShadowReallocationInput`: the per-campaign args `buildRileyBudgetCandidate` needs (emitted recommendation + currentDailyBudgetCents + context). Mirror its arg type exactly (read it).
- `ShadowJudgeVerdict`: { sound: boolean; rationale: string; ... } (minimal; injectable judge returns it).
- `ShadowJudge = (args:{ candidate: RileyBudgetCandidate; input: ShadowReallocationInput }) => Promise<ShadowJudgeVerdict>` (optional dep).
- `ShadowReallocationEntry`: { input ref/campaignId; predicted: RileyBudgetCandidate | null; abstained: boolean; blastRadius: { withinRadius: boolean; reason?: string } | null; judge: ShadowJudgeVerdict | null }.
- `ShadowReallocationReport`: { entries: ShadowReallocationEntry[]; summary: { total; predicted; abstained; blastRadiusRejected } }.
  Function: `async buildShadowReallocationReport(inputs: ShadowReallocationInput[], deps?: { judge?: ShadowJudge; blastRadiusContract?: ... }): Promise<ShadowReallocationReport>`
  - per input: candidate = buildRileyBudgetCandidate(...); if null -> abstained entry (no money, no judge). Else: blastRadius = assertWithinBlastRadius(candidate vs contract) -> within/reason; judge = deps.judge ? await deps.judge({candidate,input}) : null. Build entry. Tally summary.
  - PURE except the injected judge; NEVER calls the submitter/executor/MetaAdsClient.

## TDD plan (RED first)

- S7.1 predicts a scale candidate for a scale recommendation (deterministic, no judge) -> entry.predicted set, abstained false, blastRadius.withinRadius true.
- S7.2 abstains on a non-scale/zero-move input -> predicted null, abstained true, judge not called.
- S7.3 blast-radius rejects an oversized delta -> blastRadius.withinRadius false + reason; (still no money).
- S7.4 injected judge verdict is attached per predicted candidate; judge NOT called for abstained entries; a throwing/absent judge degrades gracefully (no judge -> judge null).
- S7.5 summary tallies (total/predicted/abstained/blastRadiusRejected).
- Confirm: the harness never imports/calls dispatchRileyBudgetReallocation / MetaAdsClient (grep in test or assert by construction).

## VERIFY gates (delegate)

typecheck; `--filter @switchboard/ad-optimizer test` (+ core if touched); lint; format:check; arch:check; verify-fast; build. NO db/schema. NO eval (deterministic; judge mocked). Independent fresh-context opus review (diff + criteria + lessons: feedback_system_auto_approved_bypasses_spend_gates, feedback_meta_ads_client_rate_limiter_fresh_instance, feedback_nan_blind_comparison_gates [budget math], feedback_safety_gate_needs_producer_population). Non-self-gradable. KEY review focus: the harness provably CANNOT move money (no executor/submitter/MetaAdsClient path).

## CONVERGE

SURFACE (money/Riley). PR notes: delivered = reusable shadow-harness CORE (predict + blast-radius + injectable judge, deterministic, no money move); follow-up = operational runner (audit shadow-logging or CLI) + concrete live LLM judge (needs the 401-blocked key). Mark backlog S7 [S]. Proceed to S8.

## Log

- 2026-06-20: ORIENT (Explore) done, feasibility YES, design locked. Next: EXECUTE in fresh worktree (read exact buildRileyBudgetCandidate + assertWithinBlastRadius signatures first).
