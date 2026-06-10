# D5: Lifecycle and Async Substrate

Domain auditor d5, Mira capability audit, 2026-06-10. Branch docs/mira-capability-audit, worktree baseline origin/main at 84083f0c.

## Scope and method

This domain covers the CreativeJob dual lifecycle (polished `currentStage` vs ugc `ugcPhase`), every reader of those lifecycle columns across the repo, the Mira creative read model build and its Prisma reader, every creative-path Inngest function (mode dispatcher, polished runner, ugc runner, creative-publish, attribution dispatch and worker, taste sweep, self-brief dispatch and worker), retries and onFailure conformance to the Inngest failure contract (docs/superpowers/specs/archive/2026-05-25-inngest-failure-contract-design.md, operationalized in docs/DOCTRINE.md line 88), JSON-only step-state hazards, waitForEvent matching, queued and parked outcome handling, and crash, replay, and stuck-job recovery. Method: every claim below was read from live source in this worktree; greps were run for every lifecycle-column consumer; prior-session hypotheses were re-verified against current code, and several are explicitly refuted below.

## Lifecycle model: states and terminals

CreativeJob (packages/db/prisma/schema.prisma:1366-1440) carries both regimes on one row: `currentStage` (default "trends", line 1383) plus `stageOutputs` for polished, and nullable `ugcPhase`, `ugcPhaseOutputs`, `ugcFailure` for ugc (lines 1402-1406), discriminated by `mode` (line 1399, default "polished"). `stoppedAt` (line 1385) is shared by both modes. Stage orders: polished `STAGE_ORDER = ["trends","hooks","scripts","storyboard","production"]` then "complete" (packages/creative-pipeline/src/stages/run-stage.ts:52); ugc `UGC_PHASE_ORDER = ["planning","scripting","production","delivery"]` then "complete" (packages/creative-pipeline/src/ugc/approval-config.ts:3).

Terminal states as actually representable:

| Mode     | Success terminal              | Stopped terminal                                                                           | Failed terminal                                                                                                    | Crash terminal                                                                                             |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| polished | `currentStage === "complete"` | `stoppedAt != null` (timeout or explicit stop)                                             | derived only: `stageOutputs.production.errors` non-empty with no `assembledVideos` (status-mapper.ts:19-26, 52)    | none representable (D5-F1)                                                                                 |
| ugc      | `ugcPhase === "complete"`     | `stoppedAt != null` (stopUgc also writes `ugcPhase`, prisma-creative-job-store.ts:376-385) | persisted `ugcFailure != null` (failUgc, store 357-374), plus derived all-assets-rejected (status-mapper.ts:41-44) | only phase-execution errors persist; step failures outside the phase try/catch are unrepresentable (D5-F4) |

The store enforces the mode invariant at the write layer: `updateStage` asserts polished, `updateUgcPhase`/`failUgc`/`stopUgc` assert ugc (packages/db/src/stores/prisma-creative-job-store.ts:60-69, "Cannot update UGC phase on a polished-mode job"). The decision workflow branches the stop by mode for the same reason (creative-job-decision-workflow.ts:55-65).

## Reader enumeration (the dual-lifecycle exhaustive sweep)

Every non-test reader of `currentStage`, `ugcPhase`, `ugcFailure`, `stoppedAt`, or status-deriving JSON on CreativeJob and the read model, with a mode-awareness verdict:

| Reader                         | File                                                                                  | Mode-aware?                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status mapper                  | packages/core/src/creative-read-model/status-mapper.ts:46-67                          | yes, explicit branch ("UGC lifecycle keys off ugcPhase ... currentStage stays at 'trends' default")                                                          |
| Read-model build               | packages/core/src/creative-read-model/build-read-model.ts:29-51                       | yes; `stage: job.currentStage` carries the polished default for ugc rows by design, with `ugcPhase` added to the summary (line 47-49) for mode-honest labels |
| Desk model                     | packages/core/src/creative-read-model/desk-model.ts:58-87                             | yes, consumes seam status + ugcPhase passthrough                                                                                                             |
| Prisma reader                  | packages/db/src/stores/prisma-mira-creative-read-model-reader.ts:27-39                | passes whole rows to the mapper; mode handled downstream                                                                                                     |
| Greeting signals               | packages/db/src/stores/prisma-greeting-signal-store.ts:91-121, 168-183                | yes, via seam + deriveDeskItemState                                                                                                                          |
| Agent-home metrics             | packages/core/src/agent-home/metrics-mira.ts                                          | yes, via counts                                                                                                                                              |
| Mira builder (chat brain)      | packages/core/src/skill-runtime/builders/mira.ts:124-168                              | yes, via seam summaries (`j.source.mode`)                                                                                                                    |
| Publish preconditions          | apps/api/src/services/creative-publish-preconditions.ts:61-64                         | yes ("Mode-aware completeness (slice-3 spec 3.3f)")                                                                                                          |
| Decision workflow              | apps/api/src/services/workflows/creative-job-decision-workflow.ts:34-45, 55-77        | yes ("Mode-aware not-awaiting guard (slice-3 spec 3.3c)")                                                                                                    |
| Render spend gate              | apps/api/src/services/creative-render-spend.ts:28-56, 79-97                           | yes (ugc spend attaches at `ugcPhase === "production"`, excludes failed/stopped)                                                                             |
| Performance history            | apps/api/src/services/workflows/creative-performance-history.ts:40-42                 | yes                                                                                                                                                          |
| Taste sweep                    | apps/api/src/services/cron/creative-taste-sweep.ts:221-227                            | yes ("ugc content lives in ugcPhaseOutputs")                                                                                                                 |
| Creative descriptor            | packages/creative-pipeline/src/creative-descriptor.ts:51                              | yes, mode parameter                                                                                                                                          |
| Estimate route                 | apps/api/src/routes/creative-pipeline.ts (estimate handler)                           | yes, branches reason copy and tier suppression on mode                                                                                                       |
| Feed/desk routes               | apps/api/src/routes/agent-home/creatives.ts:24-35                                     | mode-agnostic via seam (correct)                                                                                                                             |
| Dashboard tray + detail + copy | mira-in-production-tray.tsx:20-21, creative-detail-page.tsx:88-90, desk-copy.ts:14-15 | yes, ugcPhase-first labels                                                                                                                                   |
| Dashboard polling hooks        | apps/dashboard/src/hooks/use-creative-pipeline.ts:23, 44                              | NO: `currentStage !== "complete" && !stoppedAt`. Currently dead code, see D5-F9                                                                              |
| Seed                           | packages/db/src/seed/seed-mira-demo-creatives.ts:33-69                                | yes, coherent per mode                                                                                                                                       |
| marketplace-types.ts           | apps/dashboard/src/lib/api-client/marketplace-types.ts:63                             | type declaration only                                                                                                                                        |

Note: `currentStage` hits in packages/core/src/model-router.ts, skill-executor.ts, and skill-tier-context-builder.ts are the conversation `DialogueStage`, a name collision with no relation to CreativeJob.

Verdict on the historic "fixed in N consumers, missed in N+1" hypothesis: the live consumer set is now uniformly mode-aware. The only remaining non-mode-aware reader is the pair of dead dashboard hooks (D5-F9).

## Async surface: functions, retries, failure contract

Registered creative-path functions (apps/api/src/bootstrap/inngest.ts:1074-1198), all conforming to the retries>1 needs onFailure rule:

| Function                             | retries | onFailure class as wired                                                    | Spec class                                                           |
| ------------------------------------ | ------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| creative-mode-dispatcher             | 3       | eventDomain creative.dispatch, high risk, alert:true (inngest.ts:1077-1087) | A (matches)                                                          |
| creative-job-runner                  | 3       | creative.polished, medium, alert:false (1093-1101)                          | B (matches)                                                          |
| ugc-job-runner                       | 3       | no eventDomain, emitEvent:false (1128-1136)                                 | B; relies on in-band ugc.failed, see D5-F4                           |
| creative-publish                     | 3       | creative.publish, medium, alert:false (creative-publish-function.ts:56-61)  | B (matches), NonRetriableError fail-fast for preconditions (line 77) |
| creative-attribution dispatch/worker | 2       | Class E, emitEvent:false (creative-attribution.ts:329-335)                  | E (deliberate, documented)                                           |
| creative-taste-sweep                 | 2       | Class E (creative-taste-sweep.ts:266-272)                                   | E                                                                    |
| mira-self-brief dispatch/worker      | 2       | Class E (mira-self-brief.ts:283-289)                                        | E                                                                    |

No creative function declares an Inngest `concurrency` or `idempotency` config (grep confirms; the only idempotency config in the file is pattern-decay, inngest.ts:532). No registered function triggers on `creative.polished.failed`, `creative.publish.failed`, `creative.dispatch.failed`, `creative-pipeline/ugc.failed`, `ugc-phase.completed`, `ugc.completed`, or `ugc.stopped`: every one of those events is producer-only today.

Queued/parked outcomes: the #860 fix is live. platform-lifecycle.ts:401-413 treats `queued` as success ("A 'queued' outcome means the handler successfully handed the action off to async execution"), maps envelope status to "queued" and ledger event to `action.queued` (447-453). The submit, decision, and publish workflows all return `outcome: "queued"` after dispatching events (creative-job-submit-workflow.ts:104, creative-job-decision-workflow.ts:83, creative-publish-workflow.ts:59), and the self-brief classifier accepts queued defensively (mira-self-brief.ts:260). Hypothesis confirmed fixed.

JSON-only step state: the ugc runner documents and mostly honors the rule ("Live client objects ride DEPS ... a class instance through step.run would lose its methods on an Inngest replay", ugc-job-runner.ts:73-75, 193-205), and the polished runner normalizes a step's `[]` return because "undefined does not round-trip" (creative-job-runner.ts:87-98). One residue: the Anthropic key is memoized into step state (D5-F5). waitForEvent matching: both runners match on `data.jobId` only, with the prior phase-if-filter bug fixed and documented ("a phase `if` filter could never match a governed approve", ugc-job-runner.ts:339-345). Hypotheses refuted as live defects.

SQL take-before-filter starvation: refuted in this domain. `listTasteCandidates` is the two-leg fix in person ("an oldest-first cap over ALL decided rows ... would silently starve new gestures forever", prisma-creative-job-store.ts:252-307); the PCD backfill and lead-retry queries bound pending rows in SQL.

## Findings

### D5-F1 (P1, verified): a polished pipeline that exhausts retries leaves no failure state; the job reads as live forever and offers a Continue that no run consumes

Claim: when creative-job-runner dies mid-stage (LLM or provider error through retries 3), nothing writes a terminal marker to the CreativeJob row, so the read model reports the job in_progress or awaiting_review indefinitely, and the decision workflow accepts a Continue for it, returning queued success for an event no waitForEvent will ever receive.

Evidence: executeCreativePipeline has no try/catch around stages (packages/creative-pipeline/src/creative-job-runner.ts:54-165), unlike the ugc runner. The onFailure handler writes only an audit entry and an event (packages/core/src/observability/async-failure-handler.ts:100-130); it never touches the job store, and `creative.polished.failed` has zero consumers (grep: producers only). The status mapper can mark a polished job failed only via production-stage error data (`productionErrorsWithoutVideo`, status-mapper.ts:19-26, 52); pre-production stages (trends, hooks, scripts, storyboard) throw rather than accumulate errors, so a dead run leaves `stoppedAt` null and status falls through to awaiting_review when any stage output exists (status-mapper.ts:64-66). awaiting_review derives `canContinue: true` (status-mapper.ts:71-72) and the desk shows the awaitingGo gate (desk-model.ts:67-68, 85). The decision workflow's not-awaiting guard checks only terminal states (creative-job-decision-workflow.ts:34-45), then sends `creative-pipeline/stage.approved` and returns `outcome: "queued"` (lines 67-85). No sweep exists: lifecycle-stalled-sweep is conversation-only (`conversationLifecycleSnapshot.findMany`, apps/api/src/services/cron/lifecycle-stalled-sweep.ts:63).

Impact on north star: dead drafts accumulate as phantom in-flight work on the desk, the operator's approve gesture silently no-ops, and counts.inFlight inflation can trip the self-brief backlog cap (SELF_BRIEF_BACKLOG_CAP = 5, mira-self-brief.ts:22, 153), muting Mira's self-initiated briefs. The review loop, the core trust surface, degrades invisibly. The failure-contract spec itself names "abandoned paid creative jobs (creative-job-runner / ugc-job-runner)" as the concrete impact (archive/2026-05-25-inngest-failure-contract-design.md section 0).

Recommendation: extend the polished runner's onFailure (the original trigger event carries jobId and organizationId at arg.event.data.event.data) to persist a terminal failure marker on the row (a `stageFailure` JSON column mirroring `ugcFailure`, or stoppedAt with a failure sentinel), map it in the status mapper, and make the decision workflow reject jobs carrying it. Alternatively a creative stalled-sweep cron mirroring lifecycle-stalled-sweep. Tag: extends (failure contract section 0 names the gap; the row-marker leg was never built). Effort: M.

### D5-F2 (P1, corrected during verification): no duplicate-delivery or replay guard on the job runners; a re-delivered event corrupts terminal state immediately and puts paid re-runs one spurious gate away

Claim: neither runner declares Inngest idempotency or a per-job concurrency key; a redundant event on a complete ugc job unconditionally overwrites the terminal state (complete becomes planning, breaking publishability), and the paid phase re-run then follows from one natural operator gesture, while a timeout strands the job as a non-publishable awaiting_review zombie. A duplicate polished event re-runs the trends stage immediately and overwrites currentStage "complete" with "hooks".

Evidence: ugc-job-runner.ts:263-264 `const startPhase = (job.ugcPhase as UgcPhase) ?? "planning"; const startIdx = UGC_PHASE_ORDER.indexOf(startPhase)`. For ugcPhase "complete", indexOf returns -1, so the loop runs i=-1 with phase undefined, executePhase falls to the no-op default (lines 209-212), getNextPhase(undefined) returns "planning" (lines 215-219), and `save-undefined` persists `ugcPhase: "planning"` over "complete" (lines 301-303; updateUgcPhase has no transition guard, prisma-creative-job-store.ts:338-355). That overwrite is immediate and unconditional, and assertPublishable then fails (`ugcPhase === "complete"` required, creative-publish-preconditions.ts:61-64). Correction from verification: the re-run of paid phases is not unconditional. At i=-1 the approval gate fires because `autoApproveThresholds[undefined]` is undefined, which makes shouldRequireApproval return true (approval-config.ts:30-33), so the run parks at `wait-approval-undefined`. The regressed job reads awaiting_review with canContinue (status-mapper.ts:59, 72), so the operator's natural Continue drives the real planning/scripting/production re-run (LLM and video spend; at trustScore >= 55 the planning/scripting gates self-skip, at >= 80 production/delivery too). On a 24h timeout the stop leg passes the runtime value `undefined` as the phase (`phase as string` at ugc-job-runner.ts:352-361 is a compile-time cast, not a conversion), and stopUgc writes `{ stoppedAt: phase, ugcPhase: phase }` (prisma-creative-job-store.ts:376-385) where Prisma skips undefined data fields, so the job is never actually stopped: it stays at the overwritten ugcPhase "planning", reads awaiting_review with no run listening (a later Continue is exactly the D5-F3 black hole; only an explicit Stop clears it), and `ugc.stopped` is emitted with stoppedAtPhase undefined. Both arms destroy the terminal state. The polished runner has no resume at all: it loops STAGE_ORDER from index 0 on every fresh run (creative-job-runner.ts:103), so a duplicate event re-executes trends immediately (LLM spend) and `save-trends` persists the next stage, overwriting currentStage "complete" with "hooks" (lines 128-134); it then parks at the trends gate, and a second concurrent run shares the same jobId-matched approval events (line 154). Neither createFunction config has `idempotency` or `concurrency` (creative-job-runner.ts:179-186, ugc-job-runner.ts:389-396); the only idempotency config in the bootstrap is pattern-decay (inngest.ts:532). Failure-contract section 5.3 requires idempotency for Class B ("required, handler must be safe to re-run"). Triggers exist in practice: Inngest at-least-once event delivery, send retries from the workflow, and operator-driven run replay in the Inngest console (the natural recovery action after an outage).

Impact on north star: the lifecycle row that gates publish (assertPublishable requires `ugcPhase === "complete"`) flips back to non-publishable, a delivered creative reverts to in-production on the desk, and the org pays for renders it already had.

Recommendation: clamp the resume (`if (startIdx < 0) return` for terminal/unknown phases, plus an entry guard returning early when the loaded job is terminal in either mode), and add `concurrency: { key: "event.data.jobId", limit: 1 }` to both runners. Tag: extends (spec 5.3 idempotency requirement). Effort: S.

### D5-F3 (P2, verified): an approval event sent while no wait is registered is silently dropped, and the 24h timeout then stops a job the operator already approved

Claim: the decision workflow reports queued success the moment it sends stage.approved or ugc-phase.approved, but the runners only hear events that arrive while a waitForEvent step is active, so an event landing in the gap is consumed by nothing and the pending gate later times out into stopUgc/stop.

Evidence: the runner persists the next stage and then waits (creative-job-runner.ts:132-163; ugc-job-runner.ts:301-361), so the read model shows awaiting_review (status-mapper.ts:59, 65) before the wait registers on the next invocation; the decision workflow guard checks only persisted terminal state, then sends and returns queued (creative-job-decision-workflow.ts:34-85). Timeout handling converts a missed approve into a stop: "Timeout or explicit stop -> halt pipeline" (creative-job-runner.ts:157-163), `if (!approval || approval.data.action === "stop")` (ugc-job-runner.ts:352-361). A second widening case: ugc gates above the trust thresholds (autoApproveThresholds 55/55/80/80, approval-config.ts:12-19) skip the wait entirely while status still reads awaiting_review during the next phase, so an operator approve fires into no wait. No reconciliation compares recorded decisions (WorkTrace) with the pipeline's stop-by-timeout.

Impact: an approved render dies a day later with WorkTrace asserting the approve succeeded; rare at pilot scale (trust 0 means every gate parks and the gap is seconds wide) but it breaks the approve-must-end-in-dispatch-or-recovery expectation.

Recommendation: persist the decision on the row (e.g. `lastDecisionAt`/`lastDecisionAction`) in the decision workflow, and have the timeout leg re-check it before stopping (treat a recorded continue newer than the wait start as approval). Tag: new. Effort: M.

### D5-F4 (P2, verified): the ugc failure catch covers only phase execution; step failures elsewhere die invisibly, and the wired onFailure suppresses the Class-B dead-letter event

Claim: failUgc fires only when the `phase-${phase}` step throws; failures of load-job, preload-context, save-, durable-asset, or sendEvent steps ride the generic onFailure, which is wired emitEvent:false, leaving those deaths with neither a row marker nor a domain event.

Evidence: the try/catch wraps only the phase step (ugc-job-runner.ts:272-292); the registration passes `{ functionId: "ugc-job-runner", riskCategory: "medium", alert: false, emitEvent: false }` (inngest.ts:1128-1136). The failure contract requires the `.failed` event for classes A-D (spec section 2b) and grandfathers ugc-job-runner only on the strength of its in-band `creative-pipeline/ugc.failed` emission (spec section 0 and 107), which the uncovered paths never reach. Result shape matches D5-F1: job stuck at last persisted phase, status in_progress/awaiting_review forever.

Recommendation: set eventDomain "creative.ugc" with emitEvent true on the registration, and fold the row-marker fix from D5-F1 into the same onFailure helper for both runners. Tag: extends. Effort: S.

### D5-F5 (P2, verified): the Anthropic API key is serialized into Inngest step state by the ugc preload-context step

Claim: preloadContext returns `apiKey: deps.llmConfig?.apiKey ?? ""` inside the step-memoized context, so the secret persists in Inngest run state, violating the codebase's own convention.

Evidence: ugc-job-runner.ts:239 (apiKey in the return of preloadContext), memoized at line 255 `await step.run("preload-context", () => preloadContext(job, deps))`, then threaded to LLM calls via `ctx.context.apiKey` (lines 170, 203). The convention is stated twice elsewhere: "the decrypted access token is never serialized into Inngest step state" (creative-publish-function.ts:104-106) and "Re-resolved fresh per invocation ... the decrypted token never enters Inngest step state" (creative-attribution.ts:236-238). The polished runner correctly reads the key from closure deps (creative-job-runner.ts:119).

Impact: key-at-rest in a third-party system's run history; rotation does not purge old runs.

Recommendation: drop apiKey from UgcPipelineContext and read it from deps at executePhase call sites (it already receives deps). Tag: new. Effort: S.

### D5-F6 (P2, verified): updatedAt is the completion-time proxy for weekly shipped counts, and the daily attribution sweep bumps updatedAt on every published job, permanently inflating shippedThisWeek once the flag flips on

Claim: build-read-model counts draft_ready jobs whose updatedAt falls in the week as shipped; setPastPerformance (daily, every published job) and the taste/decision writes all touch the row, so a published creative re-enters shippedThisWeek every week forever once CREATIVE_ATTRIBUTION_ENABLED=true.

Evidence: "updatedAt timestamp in ms (used as the best available proxy ... not a true completion time)" and the week filters (build-read-model.ts:53-69); the attribution worker writes a row per published job per run (creative-attribution.ts:283-309) via `setPastPerformance` updateMany (prisma-creative-job-store.ts:210-220), and `updatedAt DateTime @updatedAt` (schema.prisma:1428) bumps on any update. Consumers of the inflated count: the cockpit KPI (metrics-mira.ts:12-45, "drafts completed") and Mira's own compose prompt ("Shipped this week: ${counts.shippedThisWeek}", builders/mira.ts:127). Latent today because the kill switch defaults off (inngest.ts:964-966).

Impact: the operator KPI and the agent's self-assessment both misreport throughput exactly when the learning loop turns on, which is the moment the pilot starts judging Mira's output.

Recommendation: persist a `completedAt` on the terminal stage/phase save (or derive shipped from the save-production step's write time) and count weeks off that. Tag: new. Effort: S.

### D5-F7 (P2, verified): concept drafts are lifecycle dead-ends; no transition exists from a self-brief or handoff draft into a governed render

Claim: buildCreativeConceptDraftWorkflow creates a CreativeJob with no pipeline dispatch by design, the read model classifies it in_progress with canContinue false, and no route or workflow can promote it; an accepted concept must be re-keyed as a fresh brief.

Evidence: "NO inngestClient.send, draft-only, no spend" (creative-concept-draft-workflow.ts:140); status falls to in_progress (status-mapper.ts:66, empty stageOutputs), reviewAction for in_progress is `canContinue: false, canStop: true` (status-mapper.ts:73-74); a forced continue through the API would pass the decision-workflow guard, emit stage.approved, and be consumed by nothing (no run was ever started for the job). Grep finds no promote/render-this-draft intent.

Impact on north star: the slice-4 brain (self-brief cron, Riley handoff enrichment) terminates in artifacts the operator can admire but not act on, breaking the Riley-to-Mira-to-published-creative synergy leg. Memory and roadmap both record live-render acceptance as pending work.

Recommendation: a governed `creative.draft.render` intent (spend-gated like creative.job.continue) that dispatches the existing job through the mode dispatcher. Tag: planned (roadmap slice 4 and M1 pending list name acceptance; the transition is the missing producer). Effort: M.

### D5-F8 (P2, corrected during verification): every creative AgentTask stays status "pending" forever

Claim: the submit and concept-draft workflows create an AgentTask parent per CreativeJob and nothing on the creative path ever calls submitOutput or updateStatus, so the task ledger that marketplace surfaces read reports all creative work as perpetually pending.

Evidence: task creation at creative-job-submit-workflow.ts:29-35 and creative-concept-draft-workflow.ts:118-124; status comment "pending, running, completed..." (schema.prisma:1207); grep across apps/api and creative-pipeline finds zero updateStatus/submitOutput calls on the creative path. Correction from verification: the only automatic callers are the Riley audit and signal-health savers (inngest.ts:415-427, 451-467); generic manual task routes do exist (marketplace.ts:458 submit-output, owner-tasks.ts:30 status update), but no creative workflow, runner, or publish path ever drives them, so creative tasks still terminate only by hand. Marketplace routes list and review tasks (apps/api/src/routes/marketplace.ts:175-177, 483-494).

Impact: a second, stale lifecycle representation of the same work; harmless to /mira (which reads CreativeJob), misleading to anything reading tasks.

Recommendation: either stamp the task terminal in the same writes that terminal the job (stop/fail/complete), or stop creating AgentTask parents for creative jobs and drop the column dependency. Tag: new. Effort: S.

### D5-F9 (P2, verified): the dead dashboard hooks carry the last non-mode-aware lifecycle predicate

Claim: useCreativeJobs/useCreativeJob poll on `currentStage !== "complete" && !stoppedAt`, which for a ugc job is true forever (currentStage never leaves "trends"), so any revival of these hooks reintroduces infinite 30s polling and a wrong active-state signal; today they are exported but unimported.

Evidence: apps/dashboard/src/hooks/use-creative-pipeline.ts:23 and 44; grep shows no importer of either hook (only useApproveStage/useCostEstimate from the same module are consumed, by creative-detail-page.tsx:5 and mira-clip-actions.tsx:5).

Recommendation: delete the two dead hooks, or rewrite the predicate over the seam status if they are kept. Tag: new. Effort: S.

### D5-F10 (OPP, verified): async failure signals have no operator surface

Claim: the dead-letter chain ends in the audit ledger; no dashboard or inbox surface reads `infrastructure.job.retry_exhausted`, the creative `*.failed` events have zero consumers, and creative runners are alert:false, so the only operator-visible symptom of substrate failure is the stale desk that D5-F1 produces.

Evidence: makeOnFailureHandler records the audit entry and optionally emits (async-failure-handler.ts:100-147); grep for retry_exhausted consumers finds only schema/alerter definitions; no function triggers on any `*.failed` event (triggers enumeration). This is contract-conformant (the spec lets the event be the destination and Class B not alert) but a capability gap for a pilot where someone must notice a dead pipeline within hours, not at the next desk visit.

Recommendation: a small inbox card or daily digest over retry_exhausted audit rows scoped to creative functionIds, or register a consumer for creative.polished.failed/creative.publish.failed that posts to the existing escalation surface. Tag: new. Effort: M.

## What is sound

- The dual-lifecycle consumer sweep is clean at every live read site, each one carrying its slice-3 spec citation (status-mapper.ts:56-66, creative-publish-preconditions.ts:58-64, creative-job-decision-workflow.ts:28-45, creative-render-spend.ts:18-35, creative-taste-sweep.ts:221-227, performance-history.ts:40-42), and the store rejects cross-mode writes outright (prisma-creative-job-store.ts:60-69).
- The failure contract is wired on all nine creative-path functions with class-correct parameters, and creative-publish is the model citizen: per-object step checkpoints re-read from the row ("Each step reuses a metaId already persisted on the job", creative-publish-function.ts:83-96), NonRetriableError for state-based preconditions (line 77), credentials resolved outside step state (104-106), and a paused-only blast radius.
- Queued is a first-class success outcome end to end (platform-lifecycle.ts:401-453), and the self-brief loop is the strongest async citizen in the domain: ISO-week idempotency keys on both submits, every exit a named outcome, parked compose can never phantom-draft (mira-self-brief.ts:127-237).
- The taste sweep solved both historic hazards in one file: the two-leg candidate query that bounds pending work rather than history (prisma-creative-job-store.ts:252-307) and the deterministic bucket content with P2002 race recovery (creative-taste-sweep.ts:160-189), with an observed-timestamp watermark that survives crashes at-least-once.
- waitForEvent matching is id-based in both runners with the dead phase-if-filter explicitly documented as unmatchable (ugc-job-runner.ts:339-345), and live clients ride deps while step outputs stay JSON (ugc-job-runner.ts:73-75, 193-205).

## Open questions

1. mira-decision writes reviewDecision via direct Prisma update (apps/api/src/routes/agent-home/mira-decision.ts:61) rather than ingress; it is documented as the deliberate firewalled Keep/Pass exception, but whether the route-allowlist and governance doctrine record this exception belongs to the governance domain auditor.
2. ugc approval gates auto-skip at listing trustScore >= 55 (planning/scripting) and >= 80 (production/delivery) (approval-config.ts:12-19) with trust read from `deployment.listing.trustScore` (inngest.ts:1108-1117). Whether trust can drift above those thresholds during the pilot, silently removing human gates on spend phases, is a governance-domain question (cross-checks the claim-safety invariant in the roadmap section 4.4).
3. What are the deployed Inngest environment's duplicate-delivery characteristics (Inngest Cloud vs self-hosted dev server)? D5-F2's likelihood depends on it; its replay-tooling trigger does not.
4. `dispatchedAt: new Date()` rides event payloads typed as Date (inngest-client.ts:42, 59; mode-dispatcher.ts:29, 38) but serializes to a string; no consumer reads it today, but the type lies to the first one that will.

## Refuted during verification

None. Two adversarial passes (2026-06-10) re-opened every cited file and re-ran the consumer greps; all ten findings held against live code at 84083f0c. Three in-place corrections without severity change: D5-F2 first pass (the paid ugc re-run is mediated by a spurious undefined-phase approval gate rather than running unconditionally; the terminal-state overwrite itself is immediate), D5-F2 second pass (the timeout leg never stops the job: `phase as string` passes runtime undefined, and Prisma skips undefined data fields in stopUgc's `{ stoppedAt: phase, ugcPhase: phase }` write, so the regressed job strands as an awaiting_review zombie at ugcPhase "planning" rather than flipping to stopped), and D5-F8 (manual task routes exist at marketplace.ts:458 and owner-tasks.ts:30, but no automatic creative-path caller). Spot-verified supporting claims: onFailure handler writes the audit row and optional `.failed` event but never touches the job store (async-failure-handler.ts:84-148), the only creative-pipeline triggers are job.submitted/polished.submitted/ugc.submitted so every `*.failed`/`*.completed`/`*.stopped` event is producer-only, lifecycle-stalled-sweep reads conversationLifecycleSnapshot only and no creative stalled sweep exists in the cron directory, the only Inngest idempotency config is pattern-decay (inngest.ts:532) with zero concurrency configs anywhere on the creative path, assertPublishable requires `ugcPhase === "complete"` (creative-publish-preconditions.ts:61-64), and the failure-contract spec names the abandoned-creative-jobs impact (spec line 18) and grandfathers ugc-job-runner's in-band event (spec lines 107, 153).
