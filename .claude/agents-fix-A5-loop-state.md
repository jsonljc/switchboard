# A5 Robin send hardening loop — externalized state (orchestration scratch, not committed)

Durable record: memory [[project_all_agents_improvement_audit]]; plan slice A5 in
docs/superpowers/plans/2026-06-20-all-agents-fix-plan.md (D4 LOCKED). A4 MERGED (bdb2c2117) this session.

Goal (A5 full): Robin recovery-send hardening (4 ranks). Authority: SURFACE-before-merge (human merge call; proven A4).
Base: origin/main @ bdb2c2117 (re-fetched 2026-06-21; includes A4) Worktree: .claude/worktrees/agents-fix-a5-robin
branch fix/robin-send-hardening (built, exit 0). PG up (localhost:5432).

## DECOMPOSITION (A5 is a 4-rank bundle -> too large for one PR; split per build-loop TASK-SIZE)

- **A5a (THIS slice): executor guardrails — rank 7 (template hoist) + rank 14 (self-rebook re-check). NO migration.**
- A5b (NEXT slice): bounded-retry machinery — rank 16 (transient retry) + rank 27 (dead-letter + failure metric + alert).
  Needs migration (attemptCount/nextRetryAt + dedup epoch) + a retry cron. Mirror ScheduledFollowUp prior art
  (prisma-scheduled-follow-up-store.ts: attempts/nextRetryAt/MAX_SEND_ATTEMPTS=3/findDue). A5b rebases on A5a (same file).

## ORIENT ground truth (verified 2026-06-21 @ bdb2c2117; 2 Explore maps + read the executor)

- Executor: apps/api/src/bootstrap/robin-recovery-executor.ts (277 lines). buildRobinRecoverySendExecutor(deps):117.
  Creds resolved ONCE pre-loop (149-172) -> org-wide skip if missing (THE pattern to mirror). Per-recipient loop
  (178-267): CLAIM-FIRST store.create({dedupeKey}) P2002->skip (189-206); then getSendContext (216); eligibility
  (218-235, template-approval via ctx.approvalOverlay); markSkipped/markSent/markFailed.
- ALREADY consumes A1 per-org resolver (resolveOrgSendCreds, wired contained-workflows.ts:418). No global-env rework.
- Eligibility reasons (proactive-eligibility.ts): template_not_approved(109), no_template(91,99) = ORG-CONFIG;
  consent_pending/consent_revoked(76), no_optin(86), marketing_blocked(112) = per-recipient. Executor sets
  allowMarketingTemplate:true (marketing_blocked won't occur).
- approvalOverlay = parseTemplateApprovalOverlay(org.runtimeConfig.whatsappTemplateApprovals), ORG-level but fetched
  per-contact inside getSendContext (contained-workflows.ts:329-330,405). Candidate carries NO jurisdiction (per-contact).
- findFutureBookingContactIds(org, contactIds[], now)->Set (prisma-booking-store.ts; used by dispatch :93-100 ONCE at
  dispatch -> FROZEN; the rank-14 gap is dispatch->send). Self-rebook re-check belongs in the EXECUTOR (post-approval send).
- Dedup key (schemas/robin-recovery-send.ts:13-19): recovery:kind:org:bookingId, NO attempt axis (A5b concern).
- Tests: executor apps/api/src/bootstrap/**tests**/robin-recovery-executor.test.ts (mocked store/getSendContext/sendTemplate);
  dispatch apps/api/src/services/cron/**tests**/robin-recovery-dispatch.test.ts.

## A5a FRAME (LOCKED 2026-06-21)

rank 7 (template hoist): REORDER — resolve ctx + eligibility BEFORE the claim. If !eligible AND reason is org-config
(template_not_approved | no_template) -> skip WITHOUT claiming (re-engageable once approved; matches "draft -> zero
claims"). Else claim, then per-recipient terminal skips (consent/window via markSkipped(reason), no-phone) preserved
(audit rows kept). Eligible -> claim + send. Pre-claim getSendContext throw -> failed++ no row (safer than stranding;
re-evaluated next run). Jurisdiction-correct (per-recipient), no new org-level dep, no migration.
rank 14 (self-rebook re-check): batch-resolve findFutureBookingContactIds(org, candidates.map(contactId), now()) ONCE
before the loop; in loop (post-claim) rebookedSet.has(contactId) -> markSkipped(rowId,"already_rebooked"); skipped++.
Inject findFutureBookingContactIds + now:()=>Date (default ()=>new Date()) into executor deps; wire in contained-workflows.ts.
Helper: isOrgConfigSkip(reason) = template_not_approved | no_template.
TEST IMPACT: reorder changes call order -> UPDATE existing executor tests (P2002-skip now calls getSendContext first;
transient getSendContext throw now = no row + failed). New tests: draft-template->zero claims; rebooked->already_rebooked skip;
approved->send. Acceptance "approve->dispatch loop test asserts the send ran".

## A5b — PLAN COMPLETE (2026-06-21). Executable TDD plan: .claude/agents-fix-A5b-plan.md (11 tasks T1-T11 + VERIFY).

baseline_sha: 2dac4ef82 (branch fix/robin-recovery-retry, clean). Tasks mirrored to TaskList #1-#12. FAN-OUT GRADE running (workflow wf_58728ed7-b66, 3 opus lenses).
Pre-grade self-verified (de-risked the top CODE-GROUNDED assumptions):

- evaluateProactiveSendEligibility returns a clean discriminated union `ProactiveSendEligibility = {eligible:true;template} | {eligible:false;reason}`
  (packages/core/src/notifications/proactive-eligibility.ts:12-14, exported via notifications/index + core barrel) -> dispatchRecoveryRow's
  `eligibility.template.metaTemplateName` narrows after `if(!eligible)`, isOrgConfigSkip reads `.reason` on the false branch. USE the
  `ProactiveSendEligibility` type (import from @switchboard/core), NOT ReturnType<typeof>.
- core barrel: `export *` from telemetry (metrics), observability (safeAlert/makeOnFailureHandler/AsyncFailureContext), recovery (store iface
  - my new constants/DueRobinRecoverySend once added). All cron/core imports resolve.
- Real-gate test EXISTS: apps/api/src/**tests**/robin-recovery-gate.test.ts — drives robin.recovery_campaign.send through the REAL GovernanceGate
  with buildRobinRecovery{Allow,Approval}PolicyInput; already proves "allow ALONE -> executes" vs "allow+approval -> parks". Task 10 step 3
  extends it: retry intent + retry allow-only policy -> EXECUTES (mirrors the existing allow-alone case). Harness: systemSpec()+allowPolicy()+evaluate().
- WorkflowHandler return `{outcome:"completed", summary, outputs:{...}}` matches the cohort executor's existing return (executor.ts:319-323). ✓

| step                            | done-condition (test/cmd)     | RED proof                                             | status | evidence                                                                                                                                       |
| ------------------------------- | ----------------------------- | ----------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 schemas+core iface+consts    | schema parse + core tsc       | schema undefined (TypeError safeParse)                | DONE   | 59712adde; schemas 12 tests, core tsc clean; barrels export\* (verified symbols reachable after rebuild)                                       |
| T2 migration                    | db:check-drift green          | n/a (schema)                                          | DONE   | 59712adde; 20260621200000_robin_recovery_send_retry; ADD attempts+nextRetryAt + idx(status,nextRetryAt); db:check-drift NO drift (re-verified) |
| T3 db store findDue+markFailed3 | --filter db test              | findMany not called / update missing fields           | DONE   | 59712adde; 8 db tests green; findDue(nextRetryAt lte + attempts<MAX + createdAt floor) + markFailed retry/terminal                             |
| T4 metric x3 factories          | core test + tsc core/api/chat | counter undefined (.inc on undefined)                 | DONE   | 6e80ade4e; core 79 tests; api+chat metrics.ts tsc clean (3 factories)                                                                          |
| T5 -core compute+dispatch       | --filter api test             | jitter expected-null / dead-letter calls[0] undefined | DONE   | c9b03a6207; 13/13 tests; -core tsc clean; types copied (executor copies removed in T6)                                                         |

EXECUTE PROCESS NOTE (stale-dist gotcha, biting this session): after EACH lower-layer task, REBUILD that pkg's dist so api/chat tsc see current types — else false "missing member" alarms (contained-workflows.ts:410 'findDue missing' was just stale db dist; cleared by `pnpm --filter @switchboard/db build`). Current dist baseline rebuilt: schemas+core+db. After T4 (core metrics interface) -> rebuild core. After T6/T7 (api) no rebuild needed for api itself. Remaining REAL api breaks after T5 = ONLY robin-recovery-executor.ts (2) + robin-recovery-approval-loop.test.ts (1), both T6 targets. NOTE: plan/ledger live in MAIN repo .claude/ (not the worktree's) — subagents read via absolute /Users/jasonli/switchboard/.claude/ path.
| T6 cohort refactor | --filter api executor test | :245/:291 2-arg + new pending-retry undefined | DONE | 9ef9776e7; 21 exec+3 approval-loop; cohort routes dispatchRecoveryRow(attempts:0); in-mem mock markFailed3+findDue; 389 lines |
| T7 retry executor | --filter api test | builder not a function | DONE | 1cd3c4736; 33 exec tests (full matrix incl terminal-at-cap+metric, consent/template/rebooked re-validate, single-row no-create); isOrgConfigSkip made type-predicate; FULL api tsc=0 |
| T8 request+resolver | builder+seam+resolver test | intent undefined | DONE | ac3066277; builder(seeded system+idemKey)+seam(schema.safeParse)+resolver platform-direct; resolver drift-guard 6->7 intents updated |
| T9 retry cron | --filter api cron test | module not found (file absent) | DONE | cdeed60ad; 11 tests (per-row submit, tally, HIGH-ratio alert fires/LOW no-alert, idempotency_in_flight, defensive approvalRequired=skip-not-sent); api tsc=0 |
| T10 retry governance+real-gate | --filter db + api gate test | builder not a function (db+gate+livepath) | DONE | 3697ab9d0; db 4 tests (allow-only, 3 upserts); gate returns outcome:"execute" (NOT park) for retry; e2e live-path res.ok&&!approvalRequired through REAL ingress; db+api tsc=0 |
| T11 wiring live cron | --filter api + tsc + build | n/a (wiring) | DONE | a15f018aa; handler@contained-workflows:511, intent@681, submit closure@818->app.ts:878/1201->inngest retry deps; cron@inngest:1492; findDueRetries->store.findDue@1042; api tsc=0, 2374 tests pass, build clean. PRODUCER-POPULATION confirmed (cron live, not inert) |

EXECUTE COMPLETE: all 11 tasks DONE. 9 commits, 30 files +1987/-170. -> VERIFY (delegated gate-run + independent fresh-context review).

## A5b — VERIFY + SURFACED (2026-06-22). PR #1238 (https://github.com/jsonljc/switchboard/pull/1238), branch fix/robin-recovery-retry.

gate_results: typecheck=pass test=pass(api 2374/db 1177; chat-attribution flake passed on rerun) lint=pass format=pass arch=pass(new files <600)
verify-fast=pass(cron needs no route-allowlist) build=pass db-drift=pass(no drift) security=pass(only pre-existing ignored GHSAs) eval=n/a review=SHIP(0>=warn, 2 nits)
Independent fresh-context adversarial review (opus): SHIP, ZERO severity>=warn. Walked attempts math (no off-by-one); confirmed producer-population (all 3 legs: handler map@contained-workflows:511 + seeded allow policy + PLATFORM_DIRECT@resolver:53 + cron@inngest:1492), consent re-validation on every retry, idempotency via per-attempt ingress key (mutate:robin:org:retry:rowId:attempts), terminal-vs-transient, NaN-safe ratio, ingress branch order, single-row updates, metric completeness, cohort behavior-change safe. 2 nits (RETRY_BATCH_LIMIT co-location; metric-floor-vs-alert-burst) — both confirmed correct/fine-as-is, NO code change.
PRE-MERGE DIVERGENCE: origin/main advanced 2dac4ef82->a4b7eff26 (E4c OTel work-unit-span hook, +50 files incl platform-ingress.ts +35 [ADDITIVE optional hook, submit() signature unchanged] + app.ts OTel block). Overlap = app.ts only (auto-merged: main@773-804 OTel vs mine@817+ submitRecoveryRetry, 13-line gap > 3-line context). REBASED clean (9 commits onto a4b7eff26); `pnpm install` picked up @opentelemetry/api main added; integrated typecheck 22/22 + A5b suites (82 api+12 db) + drift re-verified GREEN. Branch pushed.
AUTHORITY=SURFACE-before-merge + merge-stop globs touched (prisma+external-send+governance) -> HUMAN MERGE CALL.

USER-REQUESTED REVIEW (/requesting-code-review, "align w/ codebase+architecture + works as intended"): fresh-context opus senior reviewer -> **Ready to merge: YES**. Traced the FULL chain end-to-end (cohort-fail->markFailed->findDue->submit->resolver->gate->executor->outputs->cron-tally->alert), confirmed every link connects (field names exact, all 3 producer-population legs in PROD wiring), architecture-alignment YES (PlatformIngress-only mutation, WorkTrace canonical, layers respected no cycle, pattern fidelity to follow-up/recovery siblings, single-row update never updateMany), works-as-intended YES (no broken link, no off-by-one, no double-send, no fail-open). Ran api(2383)+db(1177) tests green. 0 Critical/0 Important; 1 non-blocking note (cohort onDeadLetter:undefined latent-coupling only reachable if MAX lowered to 1 — fine as-is at MAX=3).

CI CAUGHT a real red I had to fix (verified actual conclusions, did NOT trust gh-watch exit 0): the `architecture` CI job runs `.agent/tools/check-routes.ts --mode=error` (NOT the local raw-line `arch:check`, NOT covered by local-verify-fast in error mode) -> store-mutation org-scoping check flagged prisma-robin-recovery-send-store.ts:82 markFailed update: the `// route-governance: store-mutation-deferred` annotation must be WITHIN 4 LINES above the .update() call (store-mutation-check.ts:124 `callLine-4`); my T3 inserted 2 explanatory comment lines BETWEEN the annotation and the update -> displaced it out of the window. FIX (commit bb98ae88f): reorder so the route-governance annotation is immediately adjacent (matching markSent/markSkipped). Re-verified `check-routes --mode=error` exit 0 + store test 8/8. GOTCHA: pre-push run `pnpm exec tsx .agent/tools/check-routes.ts --mode=error` to match the CI architecture job (local-verify-fast runs it warn-only, misses it; captured in [[feedback_new_mutating_route_needs_route_allowlist]]).
CI ALL GREEN on bb98ae88f (architecture/test/typecheck/lint/security/secrets/docker/CodeQL/analyze + 5 evals all pass). PR #1238: mergeable=MERGEABLE, mergeStateStatus=CLEAN, 10 commits, all required checks pass. VERIFY COMPLETE.

SECOND /requesting-code-review (user re-invoked; reviewed the FINAL HEAD bb98ae88f incl the route-gov fix, which the 1st arch-review at 9ee4bda79 predated): fresh-context opus, re-derived independently -> **Ready to merge: YES**. Scrutinized bb98ae88f (comment-only, behavior-identical, annotation now adjacent to all 3 updates; create correctly un-annotated since create not in MUTATION_METHODS; check-routes --mode=error exit 0). Traced full chain, confirmed producer-population (3 legs), consent re-validation at the WIRING level (getRecoverySendContext re-reads DB per call), output-key seam exact, no double-send (per-attempt idemKey + idempotent replay), backward-compat migration. Ran api(2383)+db(1177) green. 0 Critical/0 Important; 2 minor (onDeadLetter:undefined latent-coupling at MAX=1 + const co-location) both fine-as-is.
3 INDEPENDENT REVIEWS NOW AGREE (VERIFY adversarial=SHIP; arch-review #1=YES; arch-review #2=YES), all 0>=warn. main advanced a4b7eff26->7b593bdf mid-review (NO overlap with my files -> PR stayed CLEAN).

## A5b — MERGED + SESSION CLOSED (2026-06-22). Human gave merge authority.

Pre-merge re-check: main advanced a4b7eff26->7b593bdf (only isolated telemetry work-unit-span-export + a revenue-proof test #1239/#1240 — NOT in my dep surface; no overlap; PR stayed MERGEABLE/CLEAN; existing verification holds -> no rebase needed). SQUASH-MERGED (#1238 -> squash 794250372 on origin/main; repo auto-deleted the remote head). Local: ff'd main to 794250372, removed worktree .claude/worktrees/agents-fix-a5b-retry, deleted branch fix/robin-recovery-retry (was bb98ae88f), pruned. Verified: my worktree/branch gone, main tracked-clean, no stray robin branch. MEMORY.md RESUME updated (A5b MERGED, A5 complete). **A5 (A5a+A5b) = Robin send hardening COMPLETE.** NEXT (FRESH session, new worktree off main) = A6 Riley(D3)+A12 / A7 proof-chain(watch #782) / A8 Alex-booking. Other concurrent worktrees (ai-obs-throwpath, alex-north-star-spec, audit-dashboard-aesthetics, readme-revision, rehaul-home-bento, rehaul-type-collapse, work-trace-bypass-guard) UNTOUCHED.
carry_forward: A5b SURFACED (PR #1238, awaiting human merge + CI). NEXT (human picks) = A6 Riley(D3)+A12 / A7 proof-chain(watch #782) / A8 Alex-booking / A9-A14. A5 (A5a+A5b) = Robin send hardening COMPLETE once #1238 merges. Worktree .claude/worktrees/agents-fix-a5b-retry to tear down after merge.

## A5a — COMPLETE through SURFACE. PR #1231 (https://github.com/jsonljc/switchboard/pull/1231),

branch fix/robin-send-hardening, commit f522f1a41 (1 commit: executor reorder + wiring + tests).
Fan-out grade: 2/2 REVISE -> applied R1 (PrismaBookingStore wiring not thread-from-dispatch; 2 breaking-test
flips :210/:262; optional-dep empty-set guard; console.warn). EXECUTE: 20/20 executor tests + 42 robin-recovery
tests GREEN, api tsc clean. VERIFY: gate-runner GREEN (build/typecheck/test+--filter api 2332pass/lint/format/arch/
verify-fast/audit; chat-attribution flake confirmed); independent review SHIP (0 >=warn; applied nit#1 comment fix).
Pre-merge divergence: origin/main bdb2c2117->135613b5b, NO overlap on my 3 files -> clean merge. SURFACE-before-merge
(external-send merge-stop) -> HUMAN MERGE CALL.

gate_results: typecheck=pass test=pass(+api 2332) lint=pass format=pass arch=pass verify-fast=pass security=pass
build=pass eval=n/a review=SHIP(0>=warn)
carry_forward: A5a SURFACED (PR #1231, awaiting human merge). NEXT = **A5b** (bounded-retry machinery: rank 16 +
rank 27). A5b REBASES ON A5a (both edit robin-recovery-executor.ts markFailed path) -> start A5b AFTER #1231 merges.
A5b scope (PRE-READ the prior art prisma-scheduled-follow-up-store.ts + current prisma-robin-recovery-send-store.ts):

- SIMPLIFICATION vs plan: NO dedup-key epoch axis needed. ScheduledFollowUp proves single-row reclaim works —
  retry re-sends the SAME row by id (findDue), bypassing the claim entirely; the unique dedupeKey is untouched.
  Migration = just 2 cols on RobinRecoverySend: `attempts Int @default(0)` + `nextRetryAt DateTime?` (mirror
  ScheduledFollowUp). (Re-verify at A5b FRAME but this is the proven pattern.)
- Pattern to mirror: findDue(now,limit) = status pending + nextRetryAt(null||<=now) + attempts<MAX_SEND_ATTEMPTS=3,
  orderBy, take. markFailed(id,error,nextRetryAt:Date|null) = nextRetryAt ? {status:pending, attempts:{increment:1},
  nextRetryAt, lastError} : {status:failed, attempts:{increment:1}, lastError} (terminal = dead-letter).
- NEW pieces: store markFailed signature gains nextRetryAt + a findDue; the executor's markFailed call computes
  backoff+jitter+max-age + N-bound -> retry-or-terminal; a RETRY CRON (findDue -> re-send each due row by id, a
  SEPARATE entry from the campaign-cohort flow) OR a leg in the dispatch cron; rank 27 = per-recipient failure
  metric (getMetrics, a new ...Failed counter, mirror whatsappProactiveSendSkipped) + high-failure-ratio alert on
  the dead-letter transition. The retry RE-SEND path reuses the send+consent+template gates (re-validate at retry).
- Merge-stop: external send + prisma. RobinRecoverySend model schema.prisma:2317-2334. Then A6/A7/A8...

## A5b — ORIENT COMPLETE (2026-06-21, post A5a-merge). Worktree .claude/worktrees/agents-fix-a5b-retry

@ 8bbe997bf (incl A5a), built exit 0. branch fix/robin-recovery-retry.
GROUND TRUTH (verified):

- Core iface RobinRecoverySendStore: packages/core/src/recovery/robin-recovery-send-store.ts:16-21 (create/markSent/
  markSkipped/markFailed). Barrel core/src/recovery/index.ts:2. CreateRobinRecoverySendInput :1-8. Impl
  packages/db/src/stores/prisma-robin-recovery-send-store.ts:4-51. Model schema.prisma:2317-2334 (dedupeKey @unique,
  @@index([org,bookingId])). Store tests packages/db/src/stores/**tests**/prisma-robin-recovery-send-store.test.ts (mocked prisma).
- RETRY-CRON PRIOR ART = apps/api/src/services/cron/scheduled-follow-up-dispatch.ts:52-154 (Inngest id
  "scheduled-follow-up-dispatch", cron \*/15, MAX_SEND_ATTEMPTS=3): findDue -> submitFollowUpSend (PlatformIngress) ->
  ok+sent->markSent / ok+!sent activation->markDeferred(nextRetry) / ok+!sent other->markSkipped / !ok->computeNextRetry
  ->markFailed(id,error,nextRetryAt). Core iface scheduled-follow-up-store.ts:47-59. Tests
  apps/api/src/services/cron/**tests**/scheduled-follow-up-dispatch.test.ts:107-132 (retry-below-cap + terminal-at-cap).
- Robin dispatch cron robin-recovery-dispatch.ts:142-164 (cron 0 8 \* \* \*); submitRecoveryCampaign =
  contained-workflows.ts:695-701 -> buildRecoveryCampaignSubmitRequest (robin-recovery-request.ts:68 seeded system principal)
  -> PlatformIngress.submit; ingress reg inngest.ts:1013-1017.
- Metrics metrics.ts: SwitchboardMetrics, Counter.inc(labels,value), getMetrics/setMetrics/createInMemoryMetrics;
  whatsappProactiveSendSkipped exists, NO ...Failed. ALERT precedent = async-failure-handler.ts:84-110 makeOnFailureHandler
  ({functionId,eventDomain,riskCategory,alert:boolean}) -> OperatorAlerter.alert(). Add robinRecoverySendFailed counter.
- D4 dichotomy: markFailed cases (Graph not-ok + thrown/network) = TRANSIENT -> bounded retry; markSkipped (consent/phone/
  rebooked/template) = TERMINAL (unchanged). D4 lumps "Graph not-ok" as transient -> EVERY markFailed retryable (no 4xx
  classification needed). SIMPLIFICATION confirmed: single-row reclaim, NO dedup-key epoch (ScheduledFollowUp proves it).

DECOMPOSITION DECISION: A5b = ONE cohesive PR (NOT the Explore agent's 2-PR split — splitting leaves rows pending+nextRetryAt
with no consumer = inert half-state, worse than today's terminal failed). Bounded-retry + reclaim-cron + metric are one mechanism.

A5b FRAME-READY open design points (resolve at FRAME):

1. Backoff: mirror computeNextRetry (capped exponential + full jitter + short max-age); pick base (e.g. 15m) + N (2-3) + cap.
2. Retry entry: a NEW Inngest cron (more frequent than daily, ~\*/15 like follow-up) that findDue -> re-sends each due ROW
   (single-recipient), reusing an EXTRACTED sendOneRecoveryRecipient(). Submit via PlatformIngress seeded-system OR a direct
   governed path (decide; follow-up uses a submit closure). New intent "robin.recovery_send.retry" OR reuse intent + retry flag.
3. Dead-letter: status="failed" after N (markFailed nextRetryAt=null) IS the terminal/dead-letter; emit robinRecoverySendFailed
   metric on that transition + a high-failure-ratio alert (OperatorAlerter via the cron onFailure or an explicit threshold check).
4. Extract sendOneRecoveryRecipient(ctx) from the cohort loop (behavior-preserving) so the cohort executor AND the retry cron
   share one send+consent+template+state path. Re-validate consent/template/rebooked at RETRY time (re-resolve ctx).
5. Migration: add attempts Int @default(0) + nextRetryAt DateTime? to RobinRecoverySend + @@index([status, nextRetryAt]) for findDue.
   Generate via the shadow-DB migrate-diff recipe (see A4 ledger). db:check-drift mandatory (PG up).
   Merge-stop: external send + prisma + governance (the retry submit path). Big slice (~500-600 lines: migration + store + core types +
   executor refactor + new retry cron + metric/alert + tests).

## A5b — ORIENT RE-VERIFIED + DEEPENED (2026-06-21 @ 2dac4ef82, worktree reset to fresh origin/main)

main advanced 8bbe997bf->2dac4ef82 = ONE dashboard-only commit (#1232), NO overlap with api/core/db. No A5b PR/concurrent session.
All A5b cites re-verified by reading the actual files + 2 Explore maps. NEW load-bearing findings beyond the ORIENT-COMPLETE section:

- **GOVERNANCE (reshapes the design):** the cohort intent `robin.recovery_campaign.send` is gated by a seeded
  allow + **require_approval(mandatory)** pair (robin-recovery-governance.ts) -> EVERY cohort submit PARKS for human
  approval (robin-recovery-dispatch.ts:119 treats `approvalRequired` as the intended outcome). If the retry reused that
  intent it would PARK every retry for a human -> defeats automatic retry. => RETRY NEEDS A NEW AUTO-EXECUTE INTENT.
- The auto-execute model is `proactive-intake-governance.ts` (PROACTIVE_INTAKE_POLICY_RULE): **ALLOW-ONLY** (no
  require_approval) for `conversation.reminder.send|followup.send|...` because "each send is a single transactional 1:1
  message already gated downstream by consent + 24h window + template." The Robin retry IS exactly that (a 1:1 re-send
  of an already-approved campaign send, re-validated downstream). => retry gov = ALLOW-ONLY anchored to the retry intent.
- Resolver: `PLATFORM_DIRECT_WORKFLOW_INTENTS` (platform-deployment-resolver.ts:41-48) lists the cohort intent + the
  proactive sends; add the retry intent here so it resolves platform-direct (no deployment_not_found). Test at :168 pins it.
- Prior-art store markFailed: `nextRetryAt ? {pending,attempts++,nextRetryAt,lastError} : {failed,attempts++,lastError}`
  (single-row `update`, NOT updateMany). findDue: `{status:pending, dueAt<=now, OR[nextRetryAt null|<=now], attempts<3}
orderBy take`. **Robin lacks `dueAt`** (has createdAt) -> Robin findDue drops the dueAt leg + filters `nextRetryAt != null`
  (the cohort cron owns fresh rows; the retry cron owns ONLY rescheduled rows -> avoids a double-send race).
- computeNextRetry prior art = capped exponential `min(BASE*2^attempts, CAP)`, terminal at `attempts+1>=MAX`, **NO jitter**.
  D4 wants FULL JITTER -> add an injectable `random:()=>number` (default Math.random) so tests stay deterministic.
- Cohort executor markFailed is called at 2 sites (executor.ts:307 send-!ok, :314 thrown) = the TRANSIENT failures.
  With MAX=3, computeNextRetry(0) ALWAYS returns a retry -> the cohort NEVER dead-letters at attempt 0; DEAD-LETTERS
  ONLY in the retry executor (attempts->MAX) -> the failure metric+alert live on the retry path only.
- Metric: add `robinRecoverySendFailed: Counter` ({intent,reason}) to THREE typed SwitchboardMetrics factories
  (core metrics.ts interface+createInMemoryMetrics:160; apps/api/src/metrics.ts createPromMetrics:227; apps/chat/src/
  bootstrap/metrics.ts createPromMetrics) — cross-pkg typecheck enforces all three.
- Alert: OperatorAlerter.alert(InfrastructureFailureAlert) via deps.failure.operatorAlerter; reuse errorType
  `async_job_retry_exhausted` (no new enum), severity "warning", high-dead-letter-ratio check at end of retry cron.
- Submit builder robin-recovery-request.ts:46-75 (seeded `{id:"system",type:"system"}`:68); extend with
  ROBIN_RECOVERY_RETRY_INTENT + buildRecoveryRetrySubmitRequest (per-row idemKey `mutate:robin:${org}:retry:${rowId}:${attempts}`).
- STORE MOCKS that break on markFailed 3-arg + new findDue (grep-confirmed): executor.test.ts makeStore():36-43;
  robin-recovery-approval-loop.test.ts inMemoryRecoverySendStore():91-124; prisma store test :73-76 markFailed assertion.

## A5b — FRAME (LOCKED 2026-06-21; FOCUSED brainstorm on the 5 open design points; D4 + per-row prior art NOT re-litigated)

Architecture: **per-row submit** (mirror scheduled-follow-up-dispatch): retry cron findDue -> per-row step.run -> submit
the NEW auto-execute intent through PlatformIngress (seeded system). Per-row step.run gives Inngest memoization (closes a
double-send window a batch-in-executor would leave open, since the retry path has no dedup claim). Decisions a-e:
(a) BACKOFF: MAX_SEND_ATTEMPTS=3 (1 cohort + 2 retries), BASE=15m, CAP=6h (recovery is time-sensitive; < follow-up's 24h),
MAX_AGE=24h (findDue ignores rows older than 24h -> belt-and-suspenders stale guard), FULL JITTER via injectable random.
(b) RETRY ENTRY: NEW intent `robin.recovery_send.retry` (NOT reuse — reuse parks). Auto-executes via ALLOW-ONLY gov +
platform-direct. New cron `robin-recovery-retry-dispatch` (\*/15) findDue -> per-row submit. Own clean params schema
(rowId/contactId/bookingId/campaignKind/attempts) — NOT a discriminated union on the cohort schema.
(c) DEAD-LETTER: status="failed" + nextRetryAt=null after N (markFailed terminal branch). On that transition the retry
executor inc's `robinRecoverySendFailed` ({intent,reason:"max_retries_exhausted"|"config_missing"}) + returns
deadLettered:true; the retry cron sums deadLettered and fires a high-ratio OperatorAlerter.alert (warning). Metric =
always (never silent); alert = systemic only (single isolated dead-letter is metric-only, won't page).
(d) EXTRACT: a shared `dispatchRecoveryRow({rowId,attempts,ctx,eligibility,rebooked,creds},deps)` in NEW
robin-recovery-send-core.ts (also holds computeRecoveryNextRetry+constants+isOrgConfigSkip+shared types+defaultSendTemplate).
The cohort loop AND the retry executor both call it -> one send+consent+template+state+backoff path. Cohort markFailed
now computes computeNextRetry(0) -> schedules retry1 (behavior change: a cohort send-fail is no longer terminal — THE D4 point).
Re-validation (getSendContext + eligibility + rebooked) at retry time lives in the retry executor before dispatchRecoveryRow.
(e) MIGRATION: `attempts Int @default(0)` + `nextRetryAt DateTime?` + `@@index([status, nextRetryAt])` on RobinRecoverySend.
File layout (keep both executor files < 400 lines): robin-recovery-send-core.ts (NEW shared) + robin-recovery-executor.ts
(cohort + retry executors, import -core) + robin-recovery-retry-dispatch.ts (NEW cron). Extend: schemas/robin-recovery.ts,
robin-recovery-request.ts, core+db store, metrics x3, proactive-intake-governance OR robin-recovery-governance (decide at PLAN),
platform-deployment-resolver, contained-workflows (register retry handler+intent+wire cron deps+store findDue), inngest.ts (register cron).
Merge-stop: external send + prisma + governance -> SURFACE-before-merge (human merge call). Re-fetched, no concurrent session.

## Log

- 2026-06-21: A4 merged (bdb2c2117). A5 ORIENT+decompose(A5a/A5b)+A5a FRAME. A5a executed+verified(SHIP)+merged (8bbe997bf, PR #1231).
  A5b worktree created off 8bbe997bf + ORIENT complete (retry-cron prior art mapped); decided A5b=ONE PR. READY for FRAME/PLAN/execute.
- 2026-06-21: A5b ORIENT re-verified @ 2dac4ef82 + deepened (governance: cohort parks -> retry needs NEW auto-execute intent;
  metric x3 factories; per-row-submit architecture). FRAME LOCKED (5 design points a-e). -> PLAN.
- 2026-06-21: PLAN written (.claude/agents-fix-A5b-plan.md, T1-T11+VERIFY). FAN-OUT GRADE (3 opus lenses, wf_58728ed7-b66):
  CRITIC=PASS, CODE-GROUNDED=PASS (architecture/correctness/types/exports all verified), COMPLETENESS=REVISE (test-coverage gaps only).
  REVISE applied (1 pass): (1) cohort test has TWO 2-arg markFailed asserts :245+:291 (2-lens agree) -> name both; (2) Task 10 re-anchored
  to robin-recovery-gate.test.ts builder pattern (no apps/api test imports seedRobinRecoveryPolicies); (3) ADDED e2e auto-execute proof in
  robin-recovery-cron-live-path.test.ts (retry submit -> REAL ingress -> executes not parks); (4) PLATFORM_DIRECT is ReadonlySet -> array
  initializer not .add(); (5) migration hand-authored (shadow-URL query-string bug avoided); (6) full alert payload spelled out;
  (7) approvalPolicy decorative comment; (8) eligibility typed ProactiveSendEligibility. Design CONFIRMED sound. -> EXECUTE (TDD).

## Log

- 2026-06-21: A4 merged (bdb2c2117) + cleaned up. A5 ORIENT done; decomposed A5->A5a(guardrails)+A5b(retry machinery);
  A5a FRAME locked (rank7 reorder + rank14 batch re-check). -> PLAN.
