# Switchboard Exhaustive Agent Eval + System Review (2026-06-24)

## Method

- 36 fan-out finders: 28 user-persona simulations (10 Alex, 5 Mira, 6 Riley, 3 Robin, 4 operator/multi-tenant) role-played against each agent's REAL `SKILL.md` + tool + governance code, plus 8 code-grounded system-review dimensions.
- Each material finding routed to an adversarial verifier (refute-by-default) that confirmed against code and de-duped vs the known audit backlog (A1-A22, F1-F11, P0/P1/P2/P3).
- 3 synthesis stages (per-agent scorecards + system verdict).
- 151 agents ran, ~5.5M subagent tokens, ~22 min.

## Truncation caveat (important)

A weekly usage limit hit mid-Verify. Consequence:

- VERIFIED (adversarial + deduped): 21 NEW + 20 known-reconfirmed = **41 findings, all Alex + 2 Mira**. Verification spent its whole budget here before the limit.
- CANDIDATE (finder-level, single-pass, code-grounded with file:line, NOT adversarially verified, NOT verifier-deduped): all Riley / Robin / operator / system findings (recovered from subagent transcripts).
- The 4 per-agent scorecard synthesizers + system synthesizer all failed (limit). Scorecards below are author-synthesized on the main thread from the verified + candidate data + deterministic evals + recon.

## Deterministic eval ground truth (ran locally, no creds)

- Governance decisions: 26/26 match the live gate.
- Riley recommendations: 45/45 (29 decideForCampaign + 10 source-reallocation + 6 arbitration).
- Trajectory grading: 13/13.
  Decision logic is well-pinned. The gaps are in activation, multi-tenant, consent, conversation quality, attribution, and dead-ends.

## Coverage + grades

| Agent | Sims | Verified findings   | Candidate findings | Grade    | One-line                                                                                                                                           |
| ----- | ---- | ------------------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alex  | 10   | 19 NEW + 20 known   | (covered)          | C        | Happy path works at autonomous trust; multiple P1 safety-valve / attribution / multi-tenant / fabricated-price gaps; gates fail open for real orgs |
| Riley | 6    | 0 (verifier killed) | 6 finder outputs   | B (live) | Advisory decisions rock-solid (45/45); measurement-trust + config-coercion blind spots; money act-leg dark + not flip-ready                        |
| Mira  | 5    | 2 NEW               | (covered)          | B        | Read-only guardrails sound; weekly reliability brittle (silent skip on parse fail); dark by default                                                |
| Robin | 3    | 0 (verifier killed) | 3 finder outputs   | C+       | Consent re-check at send correct; multi-tenant credential fallback + duplicate-send + retry-bounding defects block tenant #2                       |

---

## ALEX scorecard (frontline conversion agent)

Role: turn an inbound WhatsApp inquiry into a booked + deposited appointment in one conversation.

What works: hot-lead happy path books and persists at `autonomous` trust; operator Inbox Approve genuinely executes (not a state flip); claim classifier + escalation triggers exist for medical-safety; deposit-link + receipted-booking tools exist; clean tool contracts.

Where it breaks (verified NEW):

- P1 Escalation notifications route to ONE global env channel, not per-org. `handoff-notifier.ts:14-27` ignores `pkg.organizationId`; built from global `ESCALATION_CHAT_ID`/`ESCALATION_EMAIL` at `skill-mode.ts:234-274`. Cross-tenant misroute of medical_safety + angry escalations the moment tenant #2 onboards. (The A15/P1-1/P1-2 fix covered the agentNotifier reply path, NOT this handoff path; the P1-3 audit note explicitly deferred it.)
- P1 Receipted-booking proof chain joins on the wrong key. `prisma-receipted-booking-store.ts:137` does `where: { id: booking.workTraceId }`, but `Booking.workTraceId` is set to `ctx.workUnitId` (`calendar-book.ts:360`), which lives in `WorkTrace.workUnitId` (@unique), not `WorkTrace.id` (cuid PK). So `traceId` / `matchedPolicies` / `humanApprovalId` are NULL for 100% of bookings. One-line fix: join on `workUnitId`. Distinct from A7 (A7 only stamps approvalId on the trace, never touches the join key). This is the A7b memory follow-up; not in any plan doc.
- P1 No deterministic gate on fabricated prices. `claim-classifier.ts` enum has no price/quote type; `deterministic-safety-gate.ts:133-138` is phrase/regex only; no numeric/currency scanner in any of the 7 hooks. Only `SKILL.md:404-411` prose ("answer only from Business Facts"). A wrong price passes every enforce-mode hook. NEW, untracked.

Where it breaks (verified KNOWN-OPEN, re-confirmed in code):

- P1 Medical red-flag escalation silently dead-ends at default `supervised` trust: escalate is a `write` with no governanceOverride, hits require-approval, the governance hook returns pending_approval BEFORE execute, so `handoffStore.save` + `notifier.notify` never fire and no human is paged (`escalate.ts:29`, `governance.ts:23`, `governance-hook.ts:38-44`, `skill-executor.ts:555-573`). F2, still open. The F1 booking dead-end was fixed for `calendar-book.booking.create` via a governanceOverride; the SAME fix was NOT applied to escalate.
- P1 Alex falsely tells the customer "someone will reach out" after a blocked escalation. Known F2.
- P1 Escalation can be silently un-delivered (NoopNotifier + swallowed failures + unwired SLA monitor). Readiness J4.4 / P1-4/P1-5.
- P2 For a real org, NO governanceConfig is seeded, so all four jurisdiction gates fail open (no banned-phrase scan, no claim gate, no PDPA consent, no WhatsApp-window). Alex F3 / north-star provisioning. Even dev/demo runs every gate in `observe` (log-only) by design.
- P2 BUSINESS_FACTS fails open to empty; CLAIM_BOUNDARIES placeholder never populated by alexBuilder. F15.
- P2 Operator alert is context-free + mis-sentimented (angry shows neutral/Unknown). P2-9.

Where it breaks (verified NEW, multi-market + attribution + eval-fidelity, P2/P3):

- P2 Deposit is a fixed SGD 50 for every lead incl. MY; booked value defaults SGD; dashboard MYR option is dropped (org currency unpersisted + unconsumed). `deposit-link-wiring.ts:16-17`, `skill-mode.ts:414`, `organizations.ts` has zero currency refs. Corrupts MY revenue attribution.
- P2 SKILL.md persona is hardcoded single-market (Singapore English, "Price in SGD", Asia/Singapore) with no MY/Manglish/MYR branch though the system models an MY market. `SKILL.md:122-131,217`.
- P2 Jurisdiction is deployment-level, never derived from the lead's +60 phone, so a MY lead on an SG deployment gets SG rules, SG consent copy, and is mis-stamped `pdpaJurisdiction='SG'`. `pdpa-consent-gate.ts:89-91`, `governance-config-resolver.ts:8-9`.
- P2 Conversation strong-attribution join compares `workUnit.id` vs `workUnit.traceId` (independent cuids), so every booked conversation downgrades to time-window fallback or 'none'. `calendar-book.ts:360` vs `channel-gateway.ts:147`.
- P2 claim-classifier escalate verdict replaces the ENTIRE customer reply with a cold handoff template (vs surgical rewrite), and the codebase documents it over-flags conversational SDR replies. `claim-classifier.ts:419-420,458-464`.
- P2 Competitor disparagement on a price objection is prompt-only with no enforce-mode gate (inbound competitor-negative IS gated; outbound is not). `classifier/prompt.ts:22`, banned-phrases has no disparagement category.
- P2 After-hours / empty-slots: SKILL.md conflates "no availability" (a success: `ok({slots:[]})`) with a tool FAILURE, so Alex tells the lead the system is broken and hands off instead of offering a wider range. `SKILL.md:244-248` vs `calendar-book.ts:241-244`. Empty path returns bare `ok` with no model guidance.
- P2 Deposit-link is absent from the eval's allowed-tool set + mock harness, so the book->pay revenue leg is never exercised and a correct deposit call would self-flag as `unexpected-tool`. `grade.ts:7-14,188-194`, `mock-tools.ts:376-383`.
- P2/P3 eval-fidelity: after-hours booking oracle rewards booking a slot outside the lead's stated window; no empty-slots coverage; no deposit/proof-chain fixture.
- P3 Cross-session history recovery is silent-best-effort: non-WhatsApp channels get `contactId:null` -> `visitor-${sessionId}` -> returning web lead re-greets cold. `resolve-contact-identity.ts:19-21`.

Top gap: the `supervised`-trust safety-valve dead-end (F2). At the default trust posture Alex cannot escalate a medical red flag OR record the failed attempt, and tells the customer help is coming. Apply the same governanceOverride used for booking to `escalate` (and crm-write.activity.log).

---

## RILEY scorecard (ad-optimizer) [CANDIDATE: verifier killed by limit; finder-level + 45/45 eval]

Role: deterministic weekly recommendations; safe self-execution of reversible actions under mandatory approval (flags OFF by default).

What works (high confidence): decision matrix is 45/45 on the eval; pause contract holds end to end (untrusted-data gate + mandatory non-downgradeable approval + pre-write blast-radius cap); the dark act-leg is HONEST (with `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` off, the budget submitter is never wired, so nothing auto-applies); insufficient-evidence suppression of the "performing well" insight works.

Where it breaks (candidate, code-grounded):

- P1 Account-wide CAPI outage that zeros conversions across BOTH windows is treated as TRUSTED -> can emit a pause on a broken signal. `denominator-step-change.ts:27` early-returns "insufficient prior baseline" when `previous.conversions<=0`.
- P1 Live weekly-audit cron ingests config un-coerced. `inngest-functions.ts:256-257` uses `?? default` which only catches null/undefined; a malformed numeric string ("$1,500", "30%") becomes NaN and silently suppresses all breach/pause/add_creative recs (fail-open). The validated coercion schema (`resolveAdOptimizerConfig`) is wired ONLY to the LLM-batch builder, not the deterministic cron. This is A21, defined but not started; finder pinned the exact mechanism.
- P2 Scale->reallocate money-move fires on cheap CPA alone, not the ROAS/paid-value the operator sees; the paid-value gate is a binary `>0` floor, not a value ranking. `recommendation-engine.ts:341-346`, `recommendation-watches.ts:89-92`. Cross-campaign arbitration ranks on spend-share x tier constant, never on trueROAS/paid value. `opportunity-arbitrator.ts:193-197`. (Known theme: "reallocates on count, not value.")
- P2 Reallocate self-execution forward-guardrail monitor + automated rollback are NOT wired; only the pre-write blast-radius cap protects a live money move. `inngest.ts:593-598`. Known/deferred (D3) but a hard pre-flip blocker.
- P2 Reallocate is env-gated only with no per-deployment flag, so flipping it on reaches every org's runner at once (no per-tenant canary). `inngest-functions.ts:344-347`.
- P2 Zero-conversion burn can never self-execute a pause: the execution floor requires `conversions>=10` (`riley-pause-execution-floor.ts:17-28`), so the worst-case burn is exactly what auto-pause cannot touch.
- P3 `harden_capi_attribution` stale path is dead (`capiAttributionStale` never set by any real caller); pause intent missing from `FINANCIAL_AUTO_APPROVE_DENYLIST`; an approved pause the executor then skips returns outcome `completed` (reads to operator as "Riley paused it").

Top gap: pre-flip, the measurement-trust blind spot (P1 CAPI-outage-as-trusted) + config-coercion fail-open (A21) + missing forward-monitor/rollback. The decision quality is good but the safety scaffolding for real money is incomplete.

---

## MIRA scorecard (creative director) [2 NEW verified; spend/publish verifier killed]

Role: weekly go/no-go on ONE new creative concept; compose a fundable, on-brand, compliant DRAFT brief; never spend/publish/message.

What works: read-only by design; publish requires `reviewDecision==="kept"` (creative-publish-preconditions); $10 spend threshold; day-30 + self-brief dark by default keep live risk low; correctly fail-closed (never fabricate a draft).

Where it breaks (verified NEW):

- P2 Compose parse/length failures silently skip the whole week with no recovery, even on strong demand. `mira-self-brief.ts:228-234` warns + returns; compose is idempotency-keyed on ISO week (`:128-134`) so an Inngest retry replays the same bad output rather than re-prompting; cron is weekly. A single formatting slip drops the week's proposal; only Inngest run history shows it.
- P3 Passed-style exclusion is prompt-only; nothing in code stops Mira proposing a style the operator consistently passed on. `mira.ts:106-118`, `mira-compose.ts:46-49`, `mira-self-brief.ts:236`.

Where it breaks (candidate / known): A20/P1-8 measured-signal gate uses a 5-row display window instead of a true cohort count. (spend/publish-boundary verify did not complete; recon suggests the boundary is sound but it is NOT machine-verified here.)

Top gap: weekly reliability. Make compose parse failure trigger a re-prompt/repair and emit an operator-visible signal rather than a silent skip.

---

## ROBIN scorecard (no-show recovery) [CANDIDATE: verifier killed by limit; finder-level]

Role: cron-driven governed mass-send over a frozen no-show cohort; consent-gated, window-respecting, per-tenant, bounded retries.

What works (code-traced): consent is re-checked LIVE per recipient at send (the frozen cohort carries no consent snapshot), so a STOP after freeze correctly suppresses; mandatory approval pair on the campaign; capped exponential + jittered backoff on retries.

Where it breaks (candidate, code-grounded):

- P1 Per-field credential fallback can route tenant #2's patient message through the global/pilot WhatsApp number. `robin-recovery-executor.ts:118-120`: `perOrg?.token ?? resolveToken()`, `perOrg?.phoneNumberId ?? resolvePhoneId()`. Org-token-present / org-phone-missing is untested.
- P1 Successful Graph send + failed `markSent` write re-queues the row -> DUPLICATE WhatsApp send on retry. `robin-recovery-send-core.ts:182-198` (markSent inside the same try as the send).
- P2 Retry is NOT bounded to transient failures: permanent 4xx is retried to the cap (`defaultSendTemplate` collapses all failures to `{ok:false}`). Contradicts decision D4 ("bounded to transient only").
- P2 Cohort context-resolve throw silently drops a recipient for the whole ISO week (no retry row, no metric). `robin-recovery-executor.ts:168-175` (`failed++; continue`). Known theme P2-14.
- P3 Robin's send bypasses the ChannelGateway egress consent gate (relies solely on the in-executor eligibility check); single dead-lettered row emits no operator alert; `findDue` is an unlocked SELECT.

Top gap: the multi-tenant credential fallback (P1) + duplicate-send-on-markSent-failure (P1). Both block a safe tenant #2 launch and risk double-messaging patients.

---

## SYSTEM-LEVEL REVIEW [mostly CANDIDATE: review-dim verifiers killed]

Strong foundations (finder-confirmed): dependency layering is clean (schemas has zero @switchboard imports; core stays db-free; no circular deps); the store layer is overwhelmingly org-scoped on PII surfaces; the dashboard is well-defended (static NEXT_PUBLIC reads, QueryStates derives loading from {data,error}, request-time activity decay); the second-tenant request path is strongly isolated (assertOrgAccess fails closed); GovernanceGate runs exactly once per submit; trustLevelOverride relaxes only `standard` approvals, never mandatory.

Key findings (candidate, code-grounded):

- Consent/PDPA P1: Instant Form leads are unconditionally treated as a durable WhatsApp opt-in without verifying an opt-in field (`instant-form-adapter.ts:53-58`). Any single organic WhatsApp inbound grants permanent, never-expiring opt-in (`resolve-contact-identity.ts:32-39`). A18 fixed CTWA window-not-permanent; these are the named siblings (Instant-Form checkbox + organic).
- Consent/PDPA P2: outbound consent gate fails OPEN on a governance-resolver error even in enforce mode (`consent-enforcement-gate.ts:41-64`). Operational PDPA gate can only block on `revoked`, not missing/expired opt-in. STOP fast-path is WhatsApp-only + English exact-match.
- Data-integrity P1: Booking.workTraceId join break (independently corroborates Alex NEW #2). PrismaRevenueStore find-then-create TOCTOU can throw P2002 instead of idempotent return.
- Authz P1/P2: policy-engine `requiresManualApproval` gate is unreachable on the live path (`policy-engine.ts:481-496`). `POST /api/actions/:id/undo` lacks the approver-role floor its `/:id/execute` sibling has (`action-lifecycle.ts`). Per-intent `approvalPolicy` is stored on every registration but never read by the enforcement engine. Self-approval guard keys only on NODE_ENV (Vercel preview=production not handled).
- Async/cron P1: the Redis conversion stream is never drained. `redis-stream-conversion-bus.ts:45-62` only `xadd`s; `readGroup`/`ensureConsumerGroup` are never called outside the class/test. ConversionRecord + Meta CAPI go dark whenever `REDIS_URL` is set. (HIGH: a deploy with Redis silently loses conversions/CAPI.)
- Async/cron P2: reconciliation crons + Riley handoff submitter swallow per-org errors into a counter/log with no alert threshold.
- Architecture P1/P2: operator/lifecycle store writes bypass PlatformIngress and self-attest `governanceOutcome:"execute"` with no evaluation (`prisma-conversation-state-store.ts:70-105`); `recommendations/act.ts` transitions lifecycle state outside ingress with no WorkTrace; the bypass guard covers trace construction only, not the running->completed update().
- PDPA erasure P1 (operator sim): the erasure cascade omits contactId-bearing tables (ScheduledFollowUp/Reminder/RobinRecoverySend + ConversationLifecycle snapshot/transitions), so PII survives erasure (`prisma-contact-store.ts:177-249`). Meta deletion matches `Contact.phone` while identity is canonicalized on `phoneE164`, so contacts escape deletion (`meta-deletion.ts:122-135`). Erasure reports `completed` even when external calendar PII cancel was swallowed.
- Approval P2 (operator sim): designated-approver membership floor fails OPEN on a revision-lookup error (`respond-to-parked-lifecycle.ts:304-313`); audit-ledger failure AFTER successful dispatch is reported to the operator as a failed approval.
- Multi-tenant P2/P3 residuals: action-lifecycle execute/undo allows cross-tenant access when envelope `_organizationId` is absent; marketplace submit/review use a fail-open org check; ScheduledTrigger/DLQ/getByWorkUnitId/PrismaContactReader read by id with no org scope (mostly route-gated, tracked for a Round-3 sweep).
- Dashboard P1: cockpit tile hooks cast wire JSON with `as` instead of validating (`use-agent-metrics.ts:33`, use-agent-pipeline/wins), so producer->consumer schema drift silently blanks/crashes the tile (no safeParse).
- Code-health: ~18 files over the 600-line error budget with max-lines disabled (`inngest.ts` 1610, `app.ts` 1263, `skill-mode.ts` 928, `contained-workflows.ts` 842); `scheduled-reports.ts:41` casts prisma to `any` with no test; cartridge-sdk is "pending removal" but still holds a dep-layer slot (zero product imports); 4 barrels over 40 exports (db 123, schemas 104, core 100, ad-optimizer 80); coverage thresholds set below typical floors. Otherwise healthy: 0 console.log in source, ~6 real `any`, 14 TODOs, no FIXME/HACK.

---

## Top cross-cutting gaps (prioritized)

1. (P1, multi-tenant) Escalation + Robin-send + (handoff) credential/recipient resolution falls back to global env/pilot. The moment tenant #2 onboards, medical escalations misroute and patient messages send from the wrong number. Mirror A17's per-org resolver everywhere; remove env fallbacks.
2. (P1, safety) Alex `supervised`-trust dead-end: medical escalation never pages a human and the customer is told help is coming. Apply the booking governanceOverride to escalate + activity.log.
3. (P1, data-integrity) Booking.workTraceId join break: governance/proof lineage is NULL for every booking; conversation strong-attribution never matches. Join on workUnitId; align the conversation workTraceIds source.
4. (P1, consent) Permanent opt-in over-grant (Instant Form + organic inbound) + outbound gate fails open on resolver error. Time-bound the messaging window; fail closed in enforce mode.
5. (P1, async) Redis conversion stream never drained: conversions + Meta CAPI go dark with REDIS_URL set. Wire the consumer or alert.
6. (P1, Riley pre-flip) measurement-trust blind spot (CAPI-outage-as-trusted) + config-coercion fail-open (A21) + unwired forward-monitor/rollback.
7. (P1, Robin) duplicate-send on markSent failure; retry not bounded to transient (D4 incomplete).
8. (P1, PDPA) erasure cascade omits contactId-bearing tables + phone-vs-phoneE164 mismatch -> PII survives a deletion request.
9. (P1, governance) per-intent approvalPolicy stored but never enforced; manual-approval gate unreachable; /undo missing approver floor.
10. (P2, activation) real-org provisioning seeds no governanceConfig -> all four Alex gates fail open; deposit/currency hardcoded SGD for MY.
11. (P2, Mira) compose parse-failure silently skips the week.
12. (P2/P3, code-health) god-files + barrels + cartridge-sdk dead slot.

## NEW vs KNOWN

- 21 verified NEW (untracked by any audit/plan): Alex 19, Mira 2. Headliners: per-org escalation routing, booking proof-chain join key, fabricated-price ungoverned, MY single-market cluster, Mira silent-week-skip.
- 20 verified KNOWN-reconfirmed (still open in code): Alex F2 family (escalation dead-end), F15 (business-facts/claim-boundaries fail-open), F3/north-star provisioning, P2-9, A19 consent, P3-3 reschedule/cancel.
- Candidate (high-value, needs adversarial verification): Riley CAPI-trust + A21 + value-vs-count; Robin credential fallback + duplicate-send; operator erasure cascade + Meta-deletion mismatch; system Redis-stream-dark + approvalPolicy-not-enforced + /undo floor + ingress-bypass writes.

## Status of the candidate findings

The eval workflow (run `wf_1f2bc3fa-f49`) hit a weekly usage limit mid-verify and could not be resumed across sessions, so the Riley / Robin / operator / system candidates were never machine-promoted to verified+deduped. They were instead carried directly into a parallel A+ hardening campaign (branches `fix/alex-aplus`, `fix/riley-aplus`, `fix/robin-aplus`), where each session re-verifies its findings against current code (TDD, ship-clean) before fixing. Treat every CANDIDATE item above as needing independent code confirmation before action.

### Verification update (2026-06-25): opt-in over-grant candidate is VERIFIED CLEAN (defanged)

The consent P1 candidate's opt-in-over-grant half (finding 4, "Permanent opt-in over-grant (Instant Form + organic inbound)": `resolve-contact-identity.ts` organic inbound plus `instant-form-adapter.ts` Instant-Form, both recording `messagingOptIn=true`) received the independent code confirmation this section requires. It is DEFANGED, no fix needed: it cannot reach a marketing or proactive send to a non-consented inbound.

- `messagingOptIn` is the WhatsApp 24h-window PLATFORM opt-in (it gates only `canSendWhatsAppTemplate`), NOT the PDPA marketing-consent basis. Its single product caller is step 2 of `evaluateProactiveSendEligibility`.
- Every proactive WhatsApp send (robin-recovery, conversation-followup, conversation-reminder, meta-lead-greeting) routes through `evaluateProactiveSendEligibility`, which runs the PDPA consent gate (`evaluateConsentGate`, reading `pdpaJurisdiction` / `consentGrantedAt` / `consentRevokedAt`, never `messagingOptIn`) at step 1, before the opt-in/window gate at step 2.
- An organic-inbound-only contact is blocked two ways. Jurisdiction stamped (the afterSkill `PdpaConsentGateHook` stamps it on every governed turn): status `pending`, step 1 blocks `consent_pending`. Jurisdiction still null: `buildWhatsAppSendContext` passes that null as the step-3 template jurisdiction, so step 3 blocks `no_template`.
- The only consent-relaxing path (`firstTouch:true`) is `meta-lead-greeting`, spawned solely by the `meta-lead-intake` orchestrator (Meta leadgen webhook) and gated on lead.intake `outcome==="created"` (A18). An organic inbound never reaches it, and a reused organic contact is never greeted.

Corroborated by existing tests (`pdpa-consent.test.ts` 25 cases, `proactive-eligibility.test.ts` 15 cases, green on main) and two independent reviews (adversarial refutation plus integration/accuracy, both CONFIRM, zero Critical/Important). Latent defense-in-depth note: the greeting reads the `messagingOptIn` boolean, not `messagingOptInSource`, so its safety is trigger-coupled (disjoint spawn paths); any future change that routes an organic or aged contact into `buildMetaLeadGreetingWorkflow` should additionally assert `messagingOptInSource` is `web_form` or `ctwa`.

Scope: this closes ONLY the opt-in over-grant. The separate clause bundled into finding 4, "outbound gate fails open on resolver error" (`consent-enforcement-gate.ts`, the Consent/PDPA P2 item), is NOT covered here; its booking-consent variant was closed by A19 (#1265).

### Closure update (2026-06-26): gap #8 (PDPA erasure completeness) — FIX IN FLIGHT (PR #1303)

Finding 8 / "PDPA erasure P1" (line 142) re-verified still-open on `main` (b05076c8b) and fixed in
**PR #1303** (`fix/pdpa-erasure-completeness`, surfaced for human review, not self-merged — compliance
stop-glob). All three named sub-gaps were confirmed open against live code and closed TDD:

- **Cascade omissions** (`prisma-contact-store.ts`): added the 5 missing contactId tables
  (`ConversationLifecycleSnapshot`/`Transition`, `ScheduledFollowUp`, `ScheduledReminder`,
  `RobinRecoverySend`) + the phone-bearing `WhatsAppTestSend`. The phone-keyed children
  (`recipientId`/`principalId`) were matched with exact `= phone` (+E.164) but WhatsApp wa-id is
  digits-only, so they escaped; now matched across shapes via `buildPhoneMatchCandidates`.
- **Meta-deletion key** (`meta-deletion.ts`): finds by canonical `phoneE164` (normalized wa-id) OR
  the raw shapes, so shape-variant / phoneE164-only contacts no longer escape.
- **Honest outcome** (`erase-contact.ts` + both entrypoints): `eraseContactFully` returns
  `completed | partial | failed | skipped`; a swallowed external-calendar cancel now records
  `partial` (DB erased, event may linger), never `completed`. DB erasure is still never blocked.

Adversarial + data-lineage review (3 read-only agents) additionally found **Receipt** and
**ReceiptedBooking** (keyed by the contact's bookingId/opportunityId/revenueEventId, carrying
transactional PII) surviving the cascade; both are now purged like the sibling revenue tables. Two
review claims were verified-and-rejected: `ConversationState` for non-WhatsApp channels (only
WhatsApp creates erasable contacts, which are phone-keyed and already matched; its `threadId` is the
gateway sessionId, not `ConversationThread.id`) and `DeploymentMemoryEvidence` (opaque dangling ids,
no PII). No schema migration. `WaitlistEntry` / `ConsentRecord` remain out of scope (documented).
