# robin-recovery loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory note project_revenue_proof_direction + project_show_rate_recovery.

> > > LOOP STOPPED 2026-06-18: ROBIN v1 IMPLEMENTATION HANDED OFF to a separate session
> > > (worktree feat/robin-recovery-v1, building the governed recovery intent). DO NOT resume Robin
> > > here. If a scheduled wakeup fires with the Robin /loop prompt, NO-OP it (do not re-arm, do not
> > > rebuild). This session shipped S0 spec (#1163 MERGED) + S1 observe tile (#1166 OPEN, merge-ready).
> > > Handoff + the deployment_not_found finding recorded in project_show_rate_recovery +
> > > feedback_workflow_intent_deployment_not_found. Full S2 design in .claude/robin-gate-send-plan.md.

Goal: Build Robin v1 = leanest governed recovery capability that lifts held-appointment-rate.
Authority: AUTO-MERGE safe docs-spec + pure-read slices only (gates green + independent review zero
findings >= warn + NO merge-stop glob + high confidence). EXPECT governance/send/consent/schema
slices to TRIP stop-globs -> SURFACE merge-ready. STOP only for genuine user-only compliance ruling.
Base: origin/main @ ebd58b252 (re-fetch each slice)

## Ground-truth (verified 2026-06-18, file:line)

- Robin GREENFIELD confirmed: no "robin" agent, no recovery/reconversion/cancellation intents (grep zero).
  The substrate exists; the recovery WORKFLOWS + the mass-outbound gate do NOT. NOT a Casey/Quinn "already built".
- Proactive-send infra (reuse): contained-workflows.ts conversation.reminder.send (hourly cron,
  findUpcomingConfirmed +-24h, approvalPolicy "none", consent-gated), conversation.followup.send
  (15m cron, ScheduledFollowUp.dedupeKey), meta.lead.greeting.send (event, NO consent gate). All send
  DIRECT to Meta WhatsApp Cloud API; seeded {id:"system",type:"system"} principal for cron roots.
- Consent gate (reuse Casey): evaluateProactiveSendEligibility(input) -> {eligible:true,template} |
  {eligible:false,reason}; checks PDPA proactive matrix (block pending+revoked) + 24h window + approved
  template. Org-scoped ContactConsentReader.read(orgId,contactId). consentState.mode off/observe/enforce default off.
- Governance gate (reuse Quinn-lite): approvalPolicy {none|threshold|always} but "always" is NOT consumed
  by the gate (only metadata, work-unit-adapter.ts:57). require_approval comes from a SEEDED ANCHORED
  POLICY (policy.effect==="require_approval" && approvalRequirement, policy-engine.ts:327). Precedent =
  packages/db/src/seed/riley-budget-governance.ts ("the seeded require_approval(mandatory) policy is the
  real human gate"). Spend-approval threshold is SPEND-AMOUNT ONLY (cannot key on recipient-count).
- Booking model: status {pending_confirmation|confirmed|cancelled|no_show|completed|failed}, attendance
  {attended|no_show|null}. @@index([organizationId, attendance]) ALREADY EXISTS (Robin's no-show query
  substrate). Org-scoped LIST-by-status/attendance/window reads do NOT exist (only counts) = a gap.
- Attendance arc: recordAttendance + countMaturedAttendance + computeHeldRate (attended/matured, NaN-safe)
  - booked->held promotion on attended. ScheduledFollowUp/ScheduledReminder carry dedupeKey for send dedup.

## Design decisions (forks resolved, safe defaults)

- (a) Workflow = NO-SHOW RECONVERSION (genuinely new; purpose-built attendance index; highest $; crisp
  reliably-populated trigger; "confirmation" reminder already partly exists; cancellation=v2; waitlist needs new model=defer).
- (b) Mass-outbound gate = seed an anchored require_approval policy for the campaign intent (mirror Riley
  budget seed). v1: EVERY campaign manager-approved. Recipient-count auto-approve-below-threshold = v2
  (threshold machinery is spend-only; needs policy-condition or threshold generalization).
- (c) Trigger = cron over recent no-shows (org-scoped), assembles a campaign, submits ONE
  robin.recovery_campaign.send intent via PlatformIngress (seeded system principal), parks for approval,
  on approval the executor sends each (consent-gated), WorkTraced. Persisted campaign/send row for dedup+audit.
- (d) Enforcement vs measurement = v1 SENDS but SAFE-BY-CONSTRUCTION: default-off flag
  governanceConfig.recovery.mode off->observe->active (mirror consentState.mode); consent-gated per
  recipient; approval-gated every campaign. Nothing sends until operator flips flag AND approves. The
  compliance ruling (autonomous-outreach jurisdiction posture / ever-auto-approve) is OPERATIONAL go-live
  - v2, documented as the user's call -> NO hard-stop needed to build.

## Slice plan (PR-sized)

- S0 docs spec (docs/superpowers/specs/2026-06-18-robin-recovery-showrate.md) — AUTO-MERGE candidate (no stop-glob path).
- S1 org-scoped no-show recovery-candidate read + observe surface (report tile) — pure read, AUTO-MERGE candidate.
- S2 recovery.mode flag in governance-config + resolver + producer pop — TRIPS governance stop-glob -> SURFACE.
- S3 campaign intent + seeded require_approval policy + executor — governance+ingress+send stop-glob -> SURFACE.
- S4 cron trigger + consent-gated send + dedup persistence (+migration) — send+schema stop-glob -> SURFACE.

| step         | done-condition (test/cmd)                                        | RED proof         | status          | evidence                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------- | ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0 spec      | format:check + em-dash grep + indep review zero>=warn + CI green | n/a (docs)        | MERGED #1163    | 86b2708d0 on main; 2 indep reviews CLEAN; all CI green                                                                                                              |
| S1 read+tile | RED test + full typecheck + indep review zero>=warn              | seen RED per step | SURFACED #1166  | 3 commits (9882cdab4 impl, 1cb420e31 stale-test, 3d25a4edb em-dash fix); indep review CLEAN; surfaced for (auth) route-group glob false-positive (human merge call) |
| S2 gate+send | the coherent governed capability (see below)                     | pending           | NEXT (delegate) | one slice; trips every stop-glob -> surface                                                                                                                         |

gate_results (S0): typecheck=pass test=pass lint=pass format=pass arch=pass security=pass build=pass eval=pass review=CLEAN
carry_forward: S0 MERGED (#1163). S1 SURFACED (#1166, CI running). REVISED PLAN: the spec's S2/S3/S4
collapse into ONE coherent governed slice "S2 gate+send" because the producer-population lesson forbids
shipping the recovery.mode flag unread or the campaign intent unsubmitted (each inert alone). So the
minimal NON-INERT unit = flag(off/observe/enforce, reuse GovernanceModeSchema) + resolver + db
findNoShowRecoveryCandidates(list) + pure selectRecoveryCandidates + campaign intent
robin.recovery_campaign.send (NOT system_auto_approved) + seeded riley-style allow+require_approval
policy pair + executor (on approval iterate cohort, consent-gate each via evaluateProactiveSendEligibility,
WhatsApp send) + Inngest cron (enforce-mode: assemble+submit via PlatformIngress seeded system principal;
observe: log only; off: noop) + durable dedup row (+migration, hand-write since Postgres down) + the
real-gate PARKS test. Trips every stop-glob (governance/ingress/consent/send/schema) -> SURFACE.
DELEGATE execution to fresh subagents (anti-context-rot) with a written plan; I orchestrate + opus-review.
Worktree: .claude/worktrees/robin-recovery (built; currently on S1 branch -> switch to a gate branch off
fresh origin/main, or stack). Loop continues; stops at 2 consecutive surfaces (S1=1) OR v1 complete.

## Log

- 2026-06-18: ORIENT+FRAME done. Ground-truth complete (4 explorers + direct gate verify). Forks resolved.
- 2026-06-18: S0 spec MERGED #1163 (86b2708d0). 2 indep reviews CLEAN (C1/C2 fixed). All CI green.
  Auto-merged per granted authority (docs-spec, no stop-glob, review clean). -> S1 next.
- 2026-06-18: S1 observe tile built (delegated sonnet, TDD) + indep opus review CLEAN + em-dash gate
  caught+fixed 2 CSS comments. SURFACED #1166 (not auto-merged: (auth) route-group fixtures trip \**/*auth\* glob = known false positive, human merge call). CI ALL GREEN (typecheck/test/lint/arch/
  security/build/evals all pass). -> S2 gate+send next (delegate).
- 2026-06-18: S2 PLAN written + code-grounded plan-grade (opus). Grade caught a CRITICAL would-be inert
  ship; I VERIFIED in code: a workflow-mode intent throws deployment_not_found at the ingress resolver
  (platform-deployment-resolver.ts:37-39) for an unseeded slug; the #1119 platform-direct carve-out
  covers ONLY operator_mutation (app.ts:783-784). robin.recovery_campaign.send (slug "robin") would die
  in prod while tests pass (null-resolver masks). FIX DECIDED (A0, my engineering fork): extend the
  platform-direct predicate to robin's campaign intent (mirror #1119). Plan revised (A0 + 4 grade fixes).
  SEPARATE FINDING (out of Robin scope): the EXISTING reminder/followup/greeting workflows hit the SAME
  gap (slug "conversation"/"meta" unseeded) -> proactive sends INERT in prod (latent, un-exercised
  pre-launch). Surfaced to user; recommend a separate fix slice. -> NEXT: delegate Layer A build.
