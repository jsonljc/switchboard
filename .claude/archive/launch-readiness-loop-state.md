# launch-readiness loop — externalized state (orchestration scratch, not committed)

Durable record lives in memory notes project_pilot_spine_audit_2026_06_07 + moc_launch_readiness.

Goal: complete the CODE residuals of the launch/pilot-readiness workstream (the security audit, just closed, was its gate).
Authority: autonomous, auto-merge per slice after green CI + clean review (user re-confirmed 2026-06-14).
Task-size: multi-slice -> drive ONE slice at a time.

Base: origin/main re-fetched per slice (it MOVES mid-session — three-dot diffs only).

## Residual decomposition (launch/pilot readiness)

| #   | slice                                                                                                                                                                            | type     | status                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| 0   | provisioning runbook doc                                                                                                                                                         | docs     | MERGED #957 (1ff5af4f)                                                                   |
| 1   | scripts/provision-pilot.mts (F-05 REQUIRED before waitlist flip)                                                                                                                 | code     | PR #1046 OPEN auto-merge set (head 5c652287); worktree .claude/worktrees/provision-pilot |
| 2   | reply-route hardening: idempotency on double-POST + resolve-and-deliver BEFORE the released-flip; naive status!=released guard regresses re-reply-after-failure — #1040 deferred | code     | NEXT                                                                                     |
| 3   | owner-vs-agent attribution: GET+dashboard map on `direction` only; reply has metadata.sender:"owner" but renders as agent; cross-app api+dashboard — #1040 deferred              | code     | TODO                                                                                     |
| 4   | gateway visitor-<digits> WA `to` delivery bug (verify real first; part of WhatsApp-not-live-proven)                                                                              | code     | TODO(verify)                                                                             |
| X   | WhatsApp live round-trip; Stripe live-flip                                                                                                                                       | external | SURFACE to user (real infra/accounts)                                                    |

## Slice 1 durable outcome (provision-pilot)

Branch launch/provision-pilot-script @ worktree .claude/worktrees/provision-pilot. 5 files (+553/-2):
provision-pilot-org.ts (DI core; NO @switchboard/db runtime import — vite can't resolve it), provision-pilot-deps.ts (typechecked real-dep wiring = drift guard), **tests**/provision-pilot-org.test.ts (7), scripts/provision-pilot.mts (CLI .mts, --reissue-link, argv guards, no-clobber), provision-dashboard-user.ts (+explicit Promise<DashboardUser> return).
Design: reuse provisionDashboardUser (entitled+bookable+day-one) + best-effort eager provisionOrgAgentDeployments(mira:false) + 72h set-password link (reuses hashResetToken + dashboardPasswordResetToken, bypasses passwordHash gate).
gate_results: typecheck=PASS test=PASS(2276) lint=PASS format=PASS arch=PASS build=PASS(next) review=SHIP-fixes-applied.
POST-MERGE TODO: update pilot-spine memory F-05 (follow-up DONE) + receipted-bookings note (pre-flip provisioning now exists); remove worktree+branch+prune.

## Slice 2 grounding (reply-route hardening) — worktree .claude/worktrees/reply-route-hardening, branch launch/reply-route-hardening

Route: apps/api/src/routes/escalations.ts POST /:id/reply (~174-352). CURRENT order: (1) handoff.updateMany status->"released"+acknowledgedAt @219 [count===0 guard @226], (2) resolve contact via WorkTrace @273, (3) releaseEscalationToAi @288 [writes ConversationMessage transcript + flips ConversationState->active], (4) agentNotifier.sendProactive DELIVER @321, 200 if delivered else 502.
releaseEscalationToAi: packages/db/src/stores/prisma-conversation-state-store.ts:223 (dispatch) -> releaseEscalationToContact ~320 (writes ConversationMessage direction:outbound metadata.sender:"owner", best-effort ConvState->active) | releaseEscalationToThread ~233 (appends to .messages in tx). Status enum (Handoff): pending|assigned|active|released; arrives "pending".
DEFECTS: (b) released flipped @219 BEFORE deliver @321 -> delivery fail leaves released-but-undelivered; (a) NO idempotency -> double-POST = 2 ConversationMessages + 2 sends; (c) naive status!=pending guard would block re-reply-after-failed-delivery.
Existing tests: apps/api/src/routes/**tests**/escalations-reply-delivery.test.ts (escalate-tool path, gateway fallback, ContactNotFound 502, delivery-fail 502, 404s, no-sessionId). MISSING: double-POST idempotency, retry-after-failure, deliver-before-release order.
Idempotency precedent: booking-attendance.ts:45 requireIdempotencyKey -> workTraceStore.getByIdempotencyKey (but reply route does NOT go through platformIngress).
DESIGN (locked): move handoff release-flip to AFTER successful delivery; entry short-circuit status===released -> idempotent 200; atomic claim via acknowledgedAt compare-and-set (updateMany where status!=released AND acknowledgedAt=null) to serialize concurrent POSTs, rollback acknowledgedAt=null on delivery failure so retry re-claims. Determine transcript-dup-on-retry handling after reading real code (prefer deliver-before-transcript-write; else document).
SLICE 2 REWORK (verifier caught): deliver-then-release (approach A) regressed escalations-cross-tenant.test.ts "scopes the release mutation...404s fail-closed when no row" (got 503) because the early org-scoped release updateMany (its count===0->404 guard) is a tenant-isolation defense-in-depth. Also `import type {Handoff} from "@prisma/client"` fails api typecheck (api has no @prisma/client dep; @switchboard/db doesn't re-export Handoff) — vitest hid it (esbuild erases import type). DECISION: switch to approach B-minimal = KEEP original early org-scoped release (preserves ALL security tests UNCHANGED) + ADD idempotency short-circuit (status===released -> 200) BEFORE it + ADD rollback updateMany (status->pending, acknowledgedAt->null) on delivery-fail / ContactNotFound / ConvStateNotFound so released<=>delivered and re-reply-after-failure works. Fix Handoff type: use a local structural interface (no @prisma/client import). Re-align the 3 new tests to B (delivery-fail now calls updateMany twice = release+rollback; assert rollback to pending).

## SESSION OUTCOME (2026-06-14) — slices 0,1,2 resolved; 3,4 handed off

- Slice 0 (runbook): MERGED #957 (1ff5af4f). DONE.
- Slice 1 (provision-pilot CLI): DONE via a PARALLEL session's #1045 (dcf2c14d, "canonical org provisioning + provision-pilot ops cli" — puts provisionPilotOrg in @switchboard/db + scripts/provision-pilot.mts + temp-password login + canonical apiKey crypto). My #1046 (dashboard-DI + set-password-LINK variant) was built concurrently, then CONFLICTED (DIRTY) on scripts/provision-pilot.mts and was redundant -> CLOSED #1046, worktree+branch removed. F-05 "provision-pilot REQUIRED before waitlist flip" is now SATISFIED by #1045. LESSON: a parallel session shipped it mid-build; `gh pr list` + grep main for the target file BEFORE building ([[feedback_concurrent_session_cross_cutting_actions]] + verify-first). Possible tiny follow-up to #1045: swap its printed temp-password for a minted set-password link (no credential in shell history).
- Slice 2 (reply-route hardening): SHIPPED PR #1051 (auto-merge set, CI running). Branch launch/reply-route-hardening @ worktree .claude/worktrees/reply-route-hardening. B-minimal: idempotent short-circuit (status===released->200) + early org-scoped release (tenant isolation UNCHANGED, cross-tenant tests pass) + rollback-to-pending on every non-delivery exit. 10 reply tests + 8 cross-tenant green; full api 2015; typecheck/lint/format/arch green; review SHIP-WITH-FIXES (doc applied). DOCUMENTED follow-up: releaseEscalationToAi writes transcript pre-delivery -> retry re-appends owner line (pre-existing store dup; make it idempotent or post-delivery).
- POST-MERGE for #1051: remove .claude/worktrees/reply-route-hardening + branch + prune; update pilot-spine memory (reply-route follow-up shipped, transcript-dedup residual).

## REMAINING (hand off to a fresh context — this session is large)

- Slice 3: owner-vs-agent attribution. GET escalation transcript + dashboard map on `direction` only; reply is written with metadata.sender:"owner" but renders as the agent. Cross-app (api GET + dashboard render). Read the GET transcript builder in apps/api/src/routes/escalations.ts + the dashboard handoff-sheet renderer; surface sender via metadata.sender, not just direction.
- Slice 4: gateway visitor-<digits> WA `to` bug. ALREADY IN-FLIGHT by a PARALLEL session: worktree .claude/worktrees/gateway-visitor-fix, branch fix/gateway-principal-deliverable. DO NOT duplicate — check its PR before any work.
- External (NOT code): WhatsApp live round-trip; Stripe live-flip. Need real infra/accounts -> surface to user.

## Log

- 2026-06-14: ORIENT. Wider workstream = launch/pilot readiness. Decomposed residuals.
- 2026-06-14: Slice 0 runbook MERGED #957.
- 2026-06-14: Slice 1 #1046 built then CLOSED (superseded by parallel #1045). provision-pilot DONE via #1045.
- 2026-06-14: Slice 2 reply-route #1051 shipped (auto-merge); B-minimal idempotent+rollback, tenant-iso unchanged, transcript-dedup follow-up documented.

## Log

- 2026-06-14: ORIENT. Wider workstream = launch/pilot readiness. Decomposed residuals.
- 2026-06-14: Slice 0 runbook MERGED #957.
- 2026-06-14: Slice 1 provision-pilot built+verified(all gates)+reviewed(SHIP-fixes-applied); PR #1046 open + auto-merge.
