# 1B-1.6 sink wiring — TDD plan (ephemeral scratch, uncommitted)

Slice: wire the weekly-audit sink to PROPOSE a reallocation for `scale` recs — source current budget,
compute ×1.2, build candidate, submit (parks for mandatory approval) — behind a per-org flag, default OFF.
Mirrors the proven pause self-execution wiring. The real executor (1B-1.5b, PR #1053) consumes the parked
approval. Worktree: .claude/worktrees/spec1b-act-loop; base: FRESH origin/main AFTER #1053 merges.
Authority: act-leg auto-merge BUT this slice touches `scripts/env-allowlist.local-readiness.json` (new env
var) = a mechanical merge-stop glob → SURFACE-before-merge (human merge call), not waivable by authority.

## FRAME — the one real decision: current-budget source at sink time (LOCKED)

The sink (recommendation-sink.ts, L2) is a PURE function over the audit snapshot + injected submitters; it
has NO Meta client. The audit-runner (also ad-optimizer, but the IO owner) holds `adsClient`. DECISION:
pre-compute per-scale-campaign current daily budgets in `audit-runner.run()` via the existing
`adsClient.getCampaign()`, ONLY when the reallocate submitter is present (flag-on) AND there are scale recs
(flag-off ⇒ ZERO extra Meta calls), each read wrapped try/catch → null on failure (no fleet-halt; a failed
read just abstains that candidate), build `Map<campaignId, number|null>`, thread into runRecommendationSink.
Sink computes proposed via proposeCampaignReallocationCents and builds the candidate. Rate limiter (60s/
instance) is acceptable in a weekly background cron (latency-insensitive); executor drift-check is the
backstop if budget moves between proposal and approval.
REJECT: injecting a Meta read fn into the sink (breaches the sink-as-pure-snapshot-consumer doctrine).

## Ground-truth anchors (verified vs main 861399f5; re-confirm after #1053 merges)

- Sink: `packages/ad-optimizer/src/recommendation-sink.ts` runRecommendationSink(args: RunRecommendationSinkArgs). Pause dispatch @499-524 (gate `args.rileyPauseSubmitter && result.id` → buildRileyPauseCandidate → args.rileyPauseSubmitter(candidate) → pauseParkedIndex). Args has orgId, recommendations, emissionContext, campaignEvidenceByCampaign, rileyPauseSubmitter?, pausePrimaryIndex?. NO reallocate fields yet.
- Candidate builder: `riley-budget-dispatch.ts:48-91` buildRileyBudgetCandidate({emitted{recommendationId,actionType,campaignId,rationale,surface}, currentDailyBudgetCents:number|null, proposedDailyBudgetCents:number|null, context:HandoffCampaignContext|undefined, organizationId, deploymentId, adAccountId}) → RileyBudgetCandidate|null. ABSTAINS null when: actionType!=="scale", surface==="dropped", !context, !deploymentId, !adAccountId, current|proposed null, delta magnitude 0.
- RileyBudgetSubmitter type + buildRileyBudgetSubmitter: `apps/api/src/bootstrap/riley-budget-submitter.ts:31-89` → returns {parked:boolean}. submit closure pattern mirrors submitRileyPause.
- Propose: `budget-reallocation-plan.ts:58-67` proposeCampaignReallocationCents(currentCents, factor=REALLOCATE_SCALE_FACTOR=1.2) → number|null.
- Submit-request: `riley-budget-submit-request.ts:37` buildRileyBudgetSubmitRequest(input, deployment) → CanonicalSubmitRequest|null (input = {organizationId,recommendationId,adAccountId,campaignId,fromCents,toCents,rationale,evidence}).
- Pause flag wiring to MIRROR: bootstrap `contained-workflows.ts:576-586` submitRileyPause closure; `inngest.ts:393-396` buildRileyPauseSubmitter; `inngest.ts:472-474` flag-gate `RILEY_PAUSE_SELF_EXECUTION_ENABLED === "true"` → {rileyPauseSubmitter}; `inngest-functions.ts:268-273` thread to audit-runner gated on deployment.pauseSelfExecutionEnabled.
- audit-runner: `audit-runner.ts` AuditConfig.accountId@95; AdsClientInterface w/ getCampaign; runRecommendationSink call @655-672 (NO rileyBudgetSubmitter/adAccountId/current-budget map). AuditDependencies + private fields where rileyPauseSubmitter is stored — mirror for rileyBudgetSubmitter.
- Flag plumbing: `.env.example:374` RILEY_PAUSE_SELF_EXECUTION_ENABLED=false; `scripts/env-allowlist.local-readiness.json:111` array entry same category. Read as process.env["..."]==="true".

## Steps (each: test RED first, then impl GREEN)

- [ ] S1 SINK dispatch (L2, ad-optimizer): extend RunRecommendationSinkArgs with `rileyBudgetSubmitter?: RileyBudgetSubmitter`, `adAccountId?: string`, `currentDailyBudgetCentsByCampaign?: Map<string, number|null>`. Add a reallocate dispatch block mirroring pause: for each `scale` rec when rileyBudgetSubmitter+adAccountId present → current=map.get(campaignId)??null; proposed=proposeCampaignReallocationCents(current); candidate=buildRileyBudgetCandidate({emitted, currentDailyBudgetCents:current, proposedDailyBudgetCents:proposed, context:evidence, organizationId:orgId, deploymentId, adAccountId}); if candidate → await rileyBudgetSubmitter(candidate); track parked count. Keep recommendation-sink.ts under 400 lines (it is 533 → extract a `budget-sink-dispatch.ts` helper if needed). RED: sink test — scale rec + submitter + map(current) → submitter called with candidate carrying current/proposed/adAccountId; flag-off (no submitter) → NOT called; current=null in map → submitter NOT called (abstain); read-failure null → abstain. (`pnpm --filter @switchboard/ad-optimizer test`)
- [ ] S2 AUDIT-RUNNER current-budget pre-compute + thread (L2): in run(), when rileyBudgetSubmitter present, for each unique scale-rec campaignId do try `adsClient.getCampaign(id)` → dailyBudgetCents else null (catch→null), build Map; thread rileyBudgetSubmitter + adAccountId(=config.accountId) + the Map into runRecommendationSink. Add `rileyBudgetSubmitter?` to AuditDependencies + private field. RED: audit-runner test — flag present + scale rec → getCampaign called per scale campaign, sink receives map + adAccountId; flag absent → getCampaign NOT called for budget, sink gets no budget submitter; getCampaign throw → map has null, audit still completes.
- [ ] S3 FLAG + CLOSURE wiring (L5, apps/api): submitRileyBudget closure in contained-workflows.ts (mirror submitRileyPause); buildRileyBudgetSubmitter in inngest.ts gated `process.env["RILEY_REALLOCATE_SELF_EXECUTION_ENABLED"]==="true"`; thread rileyBudgetSubmitter through inngest-functions → audit-runner (mirror pause, gated on the per-deployment flag if one exists, else env-only). RED: a wiring/unit test if a seam is testable; else covered by typecheck + the audit-runner test via injected submitter.
- [ ] S4 ENV plumbing: `.env.example` add `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED=false` after the pause flag; `scripts/env-allowlist.local-readiness.json` add `"RILEY_REALLOCATE_SELF_EXECUTION_ENABLED"` (same array/category as pause). MUST pass `CI=1 npx tsx scripts/local-verify-fast.ts` (the only gate that catches an uncategorized env var).
- [ ] S5 VERIFY: typecheck; `--filter @switchboard/ad-optimizer test` + `--filter api test`; lint; format:check; arch:check (recommendation-sink.ts line cap — extract helper if over); `--filter api build`; `pnpm eval:riley`; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm build`. NO migration. Independent fresh-context review. Three-dot diff vs main. SURFACE-before-merge (env-allowlist stop-glob).

## Key risks to pin (for the plan-grade)

- producer-population: the sink dispatch is the producer that makes the executor reachable; ensure flag-off ⇒ truly inert (no submitter, no getCampaign reads). Test from real defaults.
- per-campaign read failure must NOT abort the audit (no D2 fleet-halt) → try/catch→null→abstain.
- deploymentId source in the sink for the candidate — confirm where pause gets it (emissionContext? args?) and reuse the SAME source.
- arch:check: recommendation-sink.ts is 533 lines; adding a dispatch block risks the 600 error / 400 warn → extract `budget-sink-dispatch.ts`.
- the per-deployment flag: pause threads on `deployment.pauseSelfExecutionEnabled` too — check if a reallocate per-deployment field exists or if env-only gating is the v1 (decide; env-only is acceptable if no field exists, flag-off default holds).
