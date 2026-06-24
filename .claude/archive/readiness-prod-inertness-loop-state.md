# readiness prod-inertness gates loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_north_star_activation_gap (P1 go-live lane) + moc_launch_readiness.

Goal: extend apps/api/src/routes/readiness.ts with REAL, codeable prod-inertness gates (read-only, additive checks).
Authority: AUTONOMOUS-WITH-GUARDRAILS (auto-merge only if no merge-stop glob, gates green, independent review 0>=warn, divergence clean, high confidence).
Task-size: standard (one bounded PR; 2 files: readiness.ts + readiness.test.ts).
Base: origin/main @ 7942503723b1f25e5d52ba6dafd394c357a4e437 (re-fetch each slice) baseline_sha: 7942503723b1
Worktree: .claude/worktrees/readiness-prod-inertness Branch: feat/readiness-prod-inertness-gates
merge_safety: stop-glob touched = NO (read-only readiness route + test; imports existing barrel helpers; no governance/ingress/send/cred/auth/migration/env-allowlist file modified) independent_review = pending

## GROUND-TRUTH DECISION (brainstorm gate, evidence-backed)

Proposed 3 gates -> reshaped against ground truth into 3 REAL gates (1 blocking + 2 advisory); 3 sub-proposals REJECTED with evidence (honest outcome, not padding).

REJECTED:

- WhatsApp template-approval (proposed gate 1): INERT. `runtimeConfig.whatsappTemplateApprovals` has ZERO writers in prod (own grep: only readers contained-workflows.ts:343, skill-mode.ts:646 + doc comments). Default-absent parses to "draft" => a gate would fail-FOREVER for every org. Real gap = a missing Meta-status PRODUCER (a write path touching WhatsApp template/send = merge-stop, out of scope). feedback_safety_gate_needs_producer_population.
- consentState.mode (part of proposed gate 2): REJECTED — fail-OPEN. Default "off" => bookings PROCEED; "enforce" => bookings can be BLOCKED. "off" is the permissive/shippable state, so a readiness gate would flag the GOOD state (backwards). (governance-config.ts:84-100, calendar-book-consent.ts:97-131)
- "deployment-slug resolvability" (proposed gate 3, as literally framed): DUPLICATE/STALE. The deployment_not_found throw was designed out — proactive intents are in PLATFORM_DIRECT_WORKFLOW_INTENTS (platform-deployment-resolver.ts:44-54) and bypass deployment re-resolution (synthetic platform-direct ctx). checkDeploymentExists already covers "active alex deployment". REFRAMED -> gate C below (the REAL one layer deeper).

ADDED — exactly ONE gate after plan-grade adversarial review (2 fresh-context agents) NARROWED the set:

- C. proactive-governance-seeded (BLOCKING id=`proactive-governance-seeded`): per-org policy `proactiveIntakeAllowPolicyId(orgId)` (=`policy_allow_proactive_intake_${orgId}`) active:true. Seeded by provisionOrgAgentDeployments (provision-org-agents.ts:171, $transaction). WITHOUT it, PolicyEngine default-DENIES => greeting/reminder/followup/lead-intake sends ship prod-inert by DENY even though checkDeploymentExists passes (proactive-intake-governance.ts:6-10 + provision-org-agents.ts:166-170 confirm). Reuse the EXPORTED id-builder (@switchboard/db barrel index.ts:237) => zero drift. Conservative: error/absent => fail (blocks), mirroring alexSkillPack. Producer verified UNIVERSAL + idempotent (runs on every GET /config; pilot path seeds inline) => BLOCKING is false-block-safe. The Resume gate (governance.ts:298-306) reuses checkReadiness => transitively (correctly) gated; its own comment says every blocking check must pass to resume.

DROPPED after review (producer-population / noise — honest, not padding):

- A. recovery-mode (ADVISORY, was proposed): SECRETLY INERT. VERIFIED no prod producer writes governanceConfig.recovery.mode to non-off (seed MEDSPA_PILOT_GOVERNANCE_CONFIG omits the recovery key; no operator/route/dashboard control; provision-org-agents.ts:161 "default off ... cron initiator land in a later slice"). A gate would advisory-FAIL for 100% of orgs forever with no remediation. Defer until an operator recovery-mode writer ships (producer+gate same PR, feedback_safety_gate_needs_producer_population).
- B. weekly-report-enabled (ADVISORY, was proposed): GLOBAL env LEDGER_WEEKLY_REPORT_ENABLED — identical for every org, zero per-org signal => platform-status NOISE in a per-org preflight (calendar precedent doesn't hold: it mixes per-org businessHours). DROP.

Import surface (barrel-exported; apps/api precedent proactive-intake-live-path.test.ts:38): @switchboard/db {proactiveIntakeAllowPolicyId}. NO lower-package edit. (recovery/env imports no longer needed.)

Consumer seam: dashboard renders checks[] GENERICALLY by `blocking` (go-live.tsx:152,208,232) — no Zod ConsumerSchema, no count/id-enum assert. Adding the check is ADDITIVE-SAFE; the new blocking fail correctly disables Launch. Resume gate (governance.ts:303 spread) inherits it. Only mandatory edits are the API's OWN unit-test assertions (readiness.test.ts:77 toHaveLength 13->14 + :336 id-list append). No external ReadinessContext constructor (code-grounded agent confirmed).

Test pattern: EXISTING readiness.test.ts pattern (pure checkReadiness + buildReadinessContext via PrismaLike mock). NOT a buildTestServer route test — readinessRoutes is not registered in test-server.ts and returns 503 on null prisma, so an HTTP test needs harness changes = scope creep. Deviation noted; the route handler is a thin call of the two tested functions.

| step | done-condition (test/cmd)                                                        | RED proof                                                  | status | evidence |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ | -------- |
| 1    | RED: readiness.test.ts gate-C tests fail (pure + builder); structure test 14 ids | check refs ctx.proactiveGovernanceSeeded (missing) -> fail | todo   |          |
| 2    | GREEN: readiness.ts impl; full readiness.test.ts green                           | n/a (after RED)                                            | todo   |          |
| 3    | full VERIFY gates + independent fresh-context review                             | n/a                                                        | todo   |          |

gate_results: typecheck=PASS(api tsc exit0) test=PASS(api 2396) lint=PASS(0 err) format=PASS arch=PASS(no err-level) verify-fast=PASS security=PASS(audit exit0) build=PASS(api) eval=n/a review=SHIP(0>=warn, independent fresh-context)
commit: aa5bccbda (3-dot diff 2 files +141/-2). RED proof: 10 tests failed (count 13!=14, find()=undefined, builder undefined) then GREEN 38/38.
carry_forward: 2-file additive read-only slice. ONE new BLOCKING check (proactive-governance-seeded). 13->14 checks. No merge-stop glob. Reuse exported proactiveIntakeAllowPolicyId. Conservative fail-closed on error (mirror alexSkillPack). A+B dropped (producer-population/noise). Resume gate (governance.ts) transitively + correctly inherits.

## Log

- 2026-06-22: ORIENT+FRAME done. Collision scan clean (no PR/worktree on readiness.ts). Ground-truth via 4 research agents + own greps. Worktree created @ 7942503. Setup (install/db:generate/build) backgrounded.
- 2026-06-22: FRAME->PLAN: plan-grade 2-agent adversarial review NARROWED 3 gates -> 1 (A recovery.mode = no prod producer/inert; B weekly-report = global noise; both DROPPED with evidence). Gate C (proactive-governance-seeded, blocking) confirmed real+safe.
- 2026-06-22: EXECUTE TDD: RED (10 tests fail, feature-missing) -> GREEN (38/38). 2 files, +141/-2. commit aa5bccbda.
- 2026-06-22: VERIFY: all gates PASS (tsc exit0, api test 2396, lint 0err, format, arch no-err, verify-fast, build, audit exit0). Independent fresh-context review = SHIP (0>=warn, all 8 criteria). Divergence re-check clean (origin/main unmoved 794250372; diff still 2 files; no concurrent readiness work).
- 2026-06-22: CONVERGE: pushed; PR #1244 opened (transparent body: 1 shipped / 5 rejected w/ evidence). Polling CI; auto-merge on green per AUTONOMOUS-WITH-GUARDRAILS (no merge-stop glob, review clean, divergence clean, confidence high).
- 2026-06-22: MERGED. CI all-green (typecheck/test/lint/security/architecture/docker/CodeQL/5 evals; CI fresh-checkout typecheck confirmed the reviewer's worktree-tsc note = stale-dist noise). Squash 1c7dae39c. main ff-synced; worktree removed+pruned; local+remote branch deleted. SLICE DONE.
