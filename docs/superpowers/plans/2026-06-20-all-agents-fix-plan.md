# All-Agents Fix Plan (2026-06-20)

Decision-resolved, sequenced execution ledger for the all-agents improvement audit backlog
(audit: `docs/audits/2026-06-20-all-agents-improvement-audit/README.md`, PR #1199; memory
[[project_all_agents_improvement_audit]]). This is the brainstorming deliverable AND the
build-loop's slice ledger.

## How to use this doc

- Consumed by `.claude/build-loop.md`: one slice below = one PR. The loop picks the next
  un-started, dependency-unblocked slice, runs it through ORIENT -> FRAME -> PLAN -> FAN-OUT grade
  -> EXECUTE (TDD) -> VERIFY (independent review) -> CONVERGE, and SURFACES the PR for the human
  merge call. Nearly every slice touches a merge-stop glob (send / consent / credentials / prisma
  / governance / money), so the default posture is SURFACE-before-merge.
- Re-verified against `origin/main` on 2026-06-20 by 6 parallel agents that read the cited code and
  traced producer to consumer. All 35 findings still present. Deltas are noted inline. Base at
  verification was `0121d39a0`; main has since advanced (`c019796d1`, #1202, unrelated). Re-confirm
  each slice against fresh `origin/main` at ORIENT, per build-loop doctrine.
- Completion: the loop is DONE when every slice below is merged or surfaced-awaiting-merge. Do NOT
  invent work beyond this list. If a slice is found already-fixed on `origin/main` at ORIENT, mark
  it done and continue. Stop clean and surface if any slice hits a build-loop stop condition.
- Status legend: `[ ]` not started, `[~]` PR open (surfaced), `[x]` merged, `[skip]` already-fixed.

## Verification deltas vs the audit text

- **#4 (CTWA attribution) narrows to ActivityLog only.** `Contact` has no `deploymentId` column
  (`upsertContact` drops the value), so the audit's "Contact.deploymentId" half is wrong. Fix is
  `ActivityLog` attribution only.
- **#5 (approvalId) is confirmed but currently MOOT.** No receipt-bearing booking parks through a
  real human-approval lifecycle today (booking.create auto-approves; operator intents are
  system_auto_approved). Stamping `approvalId` is correct hygiene but `humanApprovalId` stays null
  until a future approval-bearing booking intent exists. Assert the trace field, not the receipt.
- **#10 (Resend) is partial.** `send-email.ts` was hardened to not throw but still ignores the
  resolved `{error}`; `email-escalation-notifier.ts` is unchanged. Both need the `{error}` inspect.
- **Scope nuances:** #1 resolver is a NEW api-side build (the per-org resolver exists only in
  `apps/chat` today; 3 of 4 sends inline the Graph call); #3 a plain `@@unique` is not viable
  (nullable phone, email-only leads, Postgres NULL-distinct); #6 a reallocate guardrail monitor is
  net-new (the outcome cron does not observe reallocate); #15 arming the escalation hook needs a
  shape-adapter, not just a composed callback; #7 and #16 share one root cause (the Robin dedup key
  has no attempt/epoch axis).

## Locked decisions (research-backed 2026-06-20; do not re-litigate)

- **D1 (identity, #3): flag-only + dedup-by-reuse at intake.** At write, look up by normalized
  phone-or-email (org-scoped, null-tolerant); reuse the existing Contact only on an exact single
  match corroborated by a second attribute (name); flag `duplicate_contact_risk` (a real producer
  feeding `evaluateExceptions`) on ambiguity or conflicting fields; never auto-merge two persisted
  patient records; on reuse take the most-restrictive consent state; NO DB unique constraint.
  Basis: EMPI literature (over-merge is the higher-severity error; gray zone goes to a human;
  merges must be reversible), HubSpot/Segment dedup-at-write on exact identifier, SG/MY PDPA
  person-level accuracy + cease-on-withdrawal duties. Phone/email are pseudo-unique (recycled /
  shared numbers) so corroborate, do not constrain.
- **D2 (greeting, #2): approved Marketing template (mandatory) + source-aware opt-in.** A
  business-initiated first message MUST be a pre-approved template (Meta hard-rejects otherwise) so
  route the greeting through `evaluateProactiveSendEligibility`. The opt-in basis is source-aware:
  an Instant-Form lead (no inbound message) is business-initiated and uses the ad-form
  `messagingOptIn` as the basis; a genuine CTWA lead (an inbound message exists) is `USER_INITIATED`
  and rides the free-entry-point window; a bare CTWA click is NEITHER a window nor an opt-in. Add a
  first-touch intentClass to the WhatsApp registry; include sender identity + an opt-out path in the
  first message (SG DNC ss.44/45, MY s.43). The greeting actually fires for Instant-Form leads
  today (meta.lead.intake child), so the operative path is business-initiated + ad-form opt-in.
  Basis: Meta Business Messaging policy + conversation-direction semantics, SG PDPC DNC guidelines,
  MY PDPA express-consent.
- **D3 (Riley, #6): down-scope now + gate the real wiring to the flag-flip.** Make the blast-radius
  contract honest (mark the guardrails + `reset_prior_budget` rollback as not-yet-wired; document
  the pre-write cap as the only active protection); add minimal detective telemetry to the pre-write
  cap now so it is observable; do NOT build the forward monitor speculatively. The forward
  guardrail-evaluation + automated rollback + a genuine kill-switch are a HARD, TESTED (wired AND
  exercised end-to-end at least once) precondition of ever flipping
  `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED`. Basis: security-theater / calibrated-trust / "inaccurate
  comments are worse than none"; Knight Capital (an off-flag is not a safety boundary, an unexercised
  rollback is assumed broken); staged-autonomy guidance (NIST AI RMF, Anthropic, OpenAI); Fowler
  YAGNI scoping. `observedPriorCents` is already durably persisted, so the deferred rollback is
  buildable from stored state.
- **D4 (Robin, #16): bounded retry on transient failures only.** Distinguish transient failures
  (`failed`: Graph not-ok, network, thrown, 429/5xx) from terminal outcomes (`sent`, consent-skip,
  no-phone); reclaim only `failed` rows up to a small bound N (about 2-3) with capped exponential
  backoff + full jitter and a short max-age; keep terminal outcomes permanent; add an explicit
  status field plus an attempt/epoch component to the dedup key; after the bound, transition to a
  distinct dead-letter terminal state that emits a failure metric and alerts (never silent). Basis:
  brandur.org idempotency-key state machine (seal terminal, release transient), Stripe / Google SRE
  / AWS retry-and-idempotency canon. This subsumes #27 (failure metric) and #20-degraded-signal.

## Cross-slice coordination

- **A1 before A3 and A5.** A1 introduces the per-org WhatsApp send-cred resolver; the greeting (A3)
  and Robin (A5) send paths should consume it rather than re-add global env reads.
- **A2 before A4** (both edit `lead-intake-handler.ts`); land A2's small attribution fix first, then
  A4's matcher, to avoid a self-conflict.
- **A6 and A12** are the two prerequisites for ever flipping `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED`
  (honest contract + tested wiring gate; count-vs-value gate). Keep them sequenced together.
- **A7 overlaps PR #782** (`feat/work-trace-bypass-guard`, touches `buildWorkTrace`). A7 touches the
  approval-response WorkTrace update, a different function, but run the build-loop pre-merge
  divergence re-check (`gh pr list` + `git worktree list` + re-fetch) before merging A7.
- **A3, A4, A10** all sit in the Casey/consent area; sequence them so consent-state edits do not
  collide.
- A concurrent session was active on `s6b-review` (ai-infra-uplift) at session time; that workstream
  does not overlap this backlog, but keep the concurrent-session discipline (re-check worktrees + PRs
  at every CONVERGE).

## Slice sequence

Order below is recommended (leverage + dependency). The loop may reorder within dependency
constraints by its own judgment. Workstream tag selects the memory hub + the CI eval per build-loop
Maps. "Brainstorm" = whether FRAME needs a focused `superpowers:brainstorming` pass (most slices
design against named existing files and skip it).

### A1 - Multi-tenant WhatsApp send identity (P1, rank 1) [x] (merged 2026-06-21, PR #1208)
- Workstream: launch. Merge-stop: external send + credentials. Brainstorm: light (cred storage +
  cache strategy). Model: opus (multi-tenant isolation).
- Findings: all four proactive send sites read a single global env phone-number-id + token. Current:
  `conversation-reminder-send-workflow.ts:103-104`, `conversation-followup-send-workflow.ts:104-105`,
  `meta-lead-greeting-workflow.ts:125-126` (alias resolver :17-18),
  `robin-recovery-executor.ts:111-113` (consumed :134-135). Per-org `{token, phoneNumberId}` already
  persists (`whatsapp-connection-data.ts:52-59`).
- Approach: build a NEW api-side per-org WhatsApp send-cred resolver mirroring PR #1197's
  `apps/api/src/bootstrap/calendar-provider-factory.ts` + `deployment-calendar-creds.ts` (org-scoped
  via a DeploymentConnection relation join; precedence per-org Connection/DeploymentConnection ->
  global env fallback for the single-tenant pilot; decrypt injectable). Thread it into all four send
  sites, replacing the global `process.env` reads. Keep resolution per-request or invalidatable (do
  not introduce the rank-13 cache-staleness twin; note api runs multiple instances). The chat-side
  `runtime-registry.ts:152-180` + `whatsapp-runtime-token.ts` show the inbound precedence pattern.
- Acceptance: a per-number integration test proves tenant #2 sends from tenant #2's number/token;
  all four sends resolve per-org creds; single-tenant pilot unaffected via global fallback;
  `--filter api test` green.

### A2 - CTWA lead attribution to the Alex AgentDeployment id (P1, rank 4) [x] (merged 2026-06-21, PR #1210)
- Workstream: launch/alex. Merge-stop: lead-intake (review). Brainstorm: no. Model: opus.
- Finding (narrowed to ActivityLog): `managed-webhook.ts:161` passes
  `deploymentId: gatewayEntry.deploymentConnectionId` into the CTWA lead.intake -> `ctwa-adapter.ts:71`
  -> `lead-intake-handler.ts:68,84` -> `ActivityLog.deploymentId`. The Meta IF producer instead uses
  the resolved Alex id (`meta-lead-intake-workflow.ts:128`). Consumer `prisma-activity-log-store.ts:31`
  / `crm-query.ts:60`. `Contact` has no deploymentId column (drop confirmed), so fix ActivityLog only.
- Approach: resolve the org's Alex via `resolveByOrgAndSlug(orgId, "alex")`
  (`prisma-deployment-resolver.ts:69-83`) in the CTWA producer (chat side, CtwaAdapter construction)
  and pass that id, mirroring the Meta IF path.
- Acceptance: CTWA `lead_received` ActivityLog rows carry the Alex AgentDeployment id; a per-Alex
  activity feed surfaces CTWA leads; CTWA-attribution test.

### A3 - First-touch greeting gate (P1, rank 2; D2) [ ]
- Workstream: launch/governance. Merge-stop: consent + external send + templates. Brainstorm: yes
  (source-aware design). Model: opus (compliance).
- Finding: `meta-lead-greeting-workflow.ts:89` gates only on `evaluateConsentGate`, then POSTs
  `templateName` directly (:148-169), skipping the template-approval + window/opt-in gates the
  siblings enforce (`proactive-eligibility.ts:46-102`). Registry has no first-touch intentClass
  (`whatsapp-registry.ts:48-218`, 5 classes). Trigger is the Instant-Form lead path
  (`meta-lead-intake-workflow.ts:148-162`).
- Approach (per D2): add a first-touch intentClass to the registry; route the greeting through
  `evaluateProactiveSendEligibility` to enforce an approved Marketing-category template; make the
  opt-in basis source-aware (Instant-Form = ad-form `messagingOptIn`; recognize a user-initiated
  CTWA/free-entry-point conversation as a valid eligibility branch when an inbound exists; never
  treat a bare CTWA click as window or opt-in); include sender identity + an opt-out path in the
  first message.
- Acceptance: a draft/unapproved greeting template is blocked; the greeting sends only with a valid
  source-aware opt-in basis; disclosure present; tests for the Instant-Form path and the
  draft-template block.

### A4 - Contact identity matcher (P1, rank 3; D1) [ ]
- Workstream: governance/alex. Merge-stop: consent (and prisma only if a partial index is added).
  Brainstorm: yes (match-confidence rules, PHI tolerance). Model: opus.
- Finding: duplicate Contacts created freely; `lead-intake-handler.ts:48-53` dedups only on
  idempotencyKey and never calls findByPhone; the WA gateway does (`resolve-contact-identity.ts:27`,
  `prisma-contact-store.ts:86-117`); `duplicate_contact_risk` hardcoded false
  (`build-receipted-booking-data.ts:72`, `prisma-receipted-booking-store.ts:190`); Contact has
  `@@index([organizationId, phoneE164])` but no `@@unique` (`schema.prisma:1784-1833`).
- Approach (per D1): app-level matcher in `LeadIntakeHandler` (findByPhoneOrEmail, org-scoped,
  normalized E.164 or lowercased email, coalesce, null-tolerant); reuse existing Contact on an exact
  single match corroborated by name; flag `duplicate_contact_risk` (real producer feeding
  `evaluateExceptions`) on ambiguity/conflict; most-restrictive consent on reuse; no `@@unique`.
- Acceptance: a same-person CTWA + Instant-Form pair collapses to one Contact on a corroborated
  match; same-phone-different-name is flagged not merged; `duplicate_contact_risk` has a live
  producer; consent consolidated; tests for reuse, flag, and the null-phone email-only case.

### A5 - Robin send hardening (P1 rank 7 + P2 rank 16 + P2 rank 14 + P3 rank 27; D4) [ ]
- Workstream: launch. Merge-stop: external send + prisma (dedup migration). Brainstorm: light.
  Model: opus.
- Findings: claim-first precedes the template-approval check so a draft-template run burns the whole
  cohort's dedup rows (rank 7, `robin-recovery-executor.ts:173-225`, `proactive-eligibility.ts:89-96`);
  the creds short-circuit at :136-156 already runs pre-claim (the pattern to mirror); transient
  failure is terminal with no reclaim (rank 16, :240-250; key `robin-recovery-send.ts:13-19` has no
  attempt axis; store markFailed terminal `prisma-robin-recovery-send-store.ts:43-49`); a fully-failed
  campaign returns completed with no failure metric (rank 27, :253-257; `metrics.ts` has no
  ...Failed); self-rebooked exclusion is frozen at dispatch, not re-checked (rank 14,
  `robin-recovery-dispatch.ts:92-100`).
- Approach (per D4): hoist the org-wide template-approval check above the per-recipient claim loop
  (rank 7); add an explicit status field + attempt/epoch axis to the dedup key (migration ->
  db:check-drift); bounded retry on transient `failed` only (N about 2-3, capped backoff + full
  jitter, short max-age), keeping sent/consent-skip/no-phone terminal (rank 16); dead-letter terminal
  + per-recipient failure metric + high-failure-ratio alert (rank 27); re-check future bookings at
  dispatch via `findFutureBookingContactIds` -> `markSkipped("already_rebooked")` (rank 14).
- Acceptance: a draft-template run claims zero rows (whole-campaign skip, mirrors the creds
  short-circuit); a transient failure is reclaimable up to N then dead-letters with a metric+alert; a
  self-rebooker is skipped at dispatch; an approve->dispatch loop test asserts the send ran; migration
  db:check-drift green.

### A6 - Riley contract honesty + cap telemetry (P1 rank 6 + P3 rank 31 + P3 rank 24; D3) [ ]
- Workstream: riley. Merge-stop: money-adjacent (review). Brainstorm: no. Model: opus.
- Findings: blast-radius guardrails + `reset_prior_budget` rollback have zero consumer
  (`blast-radius-contract.ts:37-60,147-155`; cron `riley-outcome-attribution.ts` observes only
  pause/refresh_creative); the pre-write cap is the only live protection
  (`blast-radius-contract.ts:115-136`, consumed `riley-budget-execution-workflow.ts:304-318`);
  `observedPriorCents` is persisted (:326); stale EXECUTOR_NOT_WIRED comment
  (`contained-workflows.ts:559-560`); scale-up-only naming (`budget-reallocation-plan.ts:48`,
  `source-reallocation.ts:118-123` advisory-only).
- Approach (per D3): make the contract honest (mark guardrails + rollback as not-yet-wired; document
  the pre-write cap as the only active protection); add minimal detective telemetry to the pre-write
  cap path; fix the stale comment (rank 31); clarify scale-up-only = budget-increase-only in the
  approval cards + go-live brief (rank 24); record the flag-flip gate (forward monitor + rollback +
  kill-switch must be wired and exercised end-to-end before `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED`).
  Do NOT build the forward monitor here (deferred, gated to the flag-flip).
- Acceptance: the contract no longer advertises unwired guardrails; the cap emits telemetry; comment
  fixed; go-live brief updated; eval:riley green if the engine is touched.

### A7 - Proof-chain integrity (P1 rank 5 + P2 rank 11 + P2 rank 12 + P2 rank 19) [ ]
- Workstream: governance/alex. Merge-stop: prisma (schema comment) + governance + work-trace
  (overlaps PR #782, re-check at converge). Brainstorm: no. Model: opus.
- Findings: `writeApprovedPayloadToTrace` omits `approvalId` (rank 5, `lifecycle-dispatch.ts:47-77`;
  live paths `respond-via-lifecycle.ts:139-149`, `respond-to-parked-lifecycle.ts:168`; store supports
  it; read `prisma-receipted-booking-store.ts:231`; MOOT today, assert the trace field not the
  receipt); Receipt partial-unique exists only in raw SQL not schema (rank 11,
  `migrations/20260606120000_add_receipt/migration.sql:36-38`; mirror-comment convention at
  `schema.prisma:1888-1891` LifecycleRevenueEvent); attended->no_show leaves the receipt at held (rank
  12, `attendance.ts:58-64`, no inverse in `prisma-receipt-store.ts:63-74`); cohort assembled twice
  per cache-miss with divergent now (rank 19, `period-rollup.ts:52-64`,
  `prisma-receipted-booking-store.ts:262-284`).
- Approach: add `approvalId: lifecycle.id` to `writeApprovedPayloadToTrace` + a parked-then-approved
  trace test; add the Receipt model mirror-comment + a positive db/integration assertion that
  `Receipt_org_kind_externalRef_key` exists; add `demoteCalendarHeldToBooked(org, bookingId)` on
  `outcome === "no_show"` + an attended-then-no_show test; assemble the cohort once in period-rollup
  and thread a single `ctx` clock into both compute fns.
- Acceptance: approvalId stamped (test asserts the trace field); db assertion fails if the index is
  dropped; a no_show demotes the receipt to booked; single cohort assembly + single now; tests.

### A8 - Alex booking correctness (P2 rank 17 + P2 rank 18 + P2 rank 20) [ ]
- Workstream: alex. Merge-stop: booking/calendar (cancel is irreversible; review). Brainstorm: no.
  Model: opus.
- Findings: reschedule/cancel fall back to the soonest of ALL bookings on a service mismatch (rank 17,
  `calendar-reschedule.ts:42-47`, shared by cancel :194); booking.create persists pending_confirmation
  pre-provider and a thrown failure-handler tx leaves it blocking the slot (rank 18,
  `calendar-book.ts:350-361`, `booking-failure-handler.ts:88-137`, overlap predicate
  `prisma-booking-store.ts:56-65`, no reaper); booked outbox occurredAt is the future slotStart (rank
  20, `calendar-book.ts:460`, slotStart already in metadata :466; CAPI rejects future event_time).
- Approach: when `service` is supplied but matches no upcoming booking, escalate NO_UPCOMING_BOOKING
  instead of falling back (soonest-first only when no service filter); add a stalled-pending sweep/TTL
  (age out to failed) or exclude pending_confirmation from overlap after a TTL, and at minimum
  metric/log when the failure handler throws; set occurredAt to commit-time `now` and keep slotStart
  in metadata.
- Acceptance: a two-service-mismatch test proves no wrong-target cancel; a stalled pending row is
  handled + metric emitted; the CAPI event_time is the booking moment; eval:alex-conversation if
  booking tools are touched.

### A9 - Ledger delivery integrity + go-live docs (P2 rank 10 + P2 rank 21 + P2 rank 28) [ ]
- Workstream: launch. Merge-stop: external send (email); docs trivial. Brainstorm: no. Model: sonnet
  (opus for the send-result change).
- Findings: Resend resolved `{error}` ignored -> API-rejected email recorded as delivered (rank 10,
  `send-email.ts:33-52`, `email-escalation-notifier.ts:54-71`); no_recipients collapses into the
  success path with no warn (rank 21, `weekly-report-delivery.ts:124-127` ->
  `deliver-weekly-report.ts:39-44` -> `ledger-weekly-report.ts:126-134`; an unused
  WEEKLY_REPORT_NO_RECIPIENTS code exists at `shared.ts:67`); stale docs (rank 28,
  `DEPLOYMENT-CHECKLIST.md:38`, `.env.example:126-131` stale #1156).
- Approach: destructure `{error}` from the resolved send and return `{ok:false, reason:"send_error"}`
  when present (both files) + a non-throwing `{data:null,error}` unit test; surface no_recipients
  distinctly from the cron worker; checklist multi-tenant caveat + replace the stale .env.example
  #1156 paragraph.
- Acceptance: an API-rejected email yields a failed (not "delivered") WorkTrace; no_recipients is
  distinguishable in run history; docs corrected.

### A10 - Consent propagation + greeting snapshot (P2 rank 8 + P3 rank 25) [ ]
- Workstream: governance. Merge-stop: consent/pdpa. Brainstorm: no. Model: opus.
- Findings: operator revoke does not thread `openConversationSessionId`, so the status-flip + handoff
  branch is skipped (rank 8, `consent-service.ts:245-307`, `operator-intents/consent.ts:88-123`,
  schema `operator-intents-schemas.ts:65-71`; gateway does pass it `consent-revocation-gate.ts:106`);
  disclosure detection is a brittle substring + no point-in-time consent snapshot (rank 25,
  `pdpa-consent-gate.ts:182-183,213`, `prisma-receipted-booking-store.ts:181-204`).
- Approach: thread `openConversationSessionId` from the admin revoke route through `recordRevocation`
  (schema + handler) so an operator revoke flips an open conversation to human_override + handoff +
  test; replace the disclosure substring with the scaffolded structured sentinel and snapshot
  pdpaJurisdiction + consent timestamps onto the ReceiptedBooking at issuance (mirror
  expectedValueAtIssue).
- Acceptance: an operator-revoke-flips-to-human_override test; disclosure via sentinel; receipt
  carries a consent snapshot.

### A11 - Governance safety taxonomy + escalation wiring (P2 rank 15 + P3 rank 32 + P3 rank 33 + P3 rank 26) [ ]
- Workstream: governance. Merge-stop: governance. Brainstorm: light (the rank-15 adapter). Model: opus.
  May split rank 15 into its own PR if too large.
- Findings: escalation hook built but never fired and needs a shape-adapter (rank 15,
  `claim-classifier.ts:391`, `skill-mode.ts:194-196` onWrite metric-only, `app.ts:899-900` readMode
  "off" + no-op registrar, `inngest.ts:1142`, `governance-verdict-escalation-hook.ts:14-35`; store
  record lacks org/contact/thread ids the event needs); financial denylist is 3 prefixes (rank 32,
  `governance-gate.ts:103-134`, invariant home `intent-registration.ts:106-110`); reversibility brake
  degrades to mutationClass-only in prod (rank 33, `spend-approval-threshold.ts:60-66`); verdict-store
  reads have no org filter (rank 26, `prisma-governance-verdict-store.ts:98-119`, latent, no exposed
  caller).
- Approach: arm the escalation hook (compose `onGovernanceVerdictWritten` into the store onWrite
  alongside the metric; real registrar at both sites; readMode "on" for the org; add the adapter
  resolving org+contact+thread) + an escalate-with-lifecycle-on integration test; add a
  registration-time invariant that any outbound-money executor binding is spendBearing:true + a
  taxonomy test; pin a test that an irreversible-financial intent is not relaxed under threshold; add
  organizationId to the verdict-store list/count reads (join deployment.organizationId).
- Acceptance: an escalate verdict produces an escalated transition; taxonomy + reversibility tests
  pin the invariants; verdict reads are org-scoped; eval:governance green.

### A12 - Riley count-vs-value reallocation gate (P2 rank 9) [ ]
- Workstream: riley. Merge-stop: money-adjacent (review). Brainstorm: no. Model: opus. Prereq (with
  A6) before flipping self-execution.
- Finding: the executable money-move fires on a count-CPA scale rec, not paid value
  (`riley-budget-dispatch.ts:72`, `recommendation-engine.ts:340-360`, `campaign-decision.ts:30-31`);
  `queryBookedValueCentsByCampaign` feeds display only (`source-reallocation.ts:311`); no
  queryPaidValueCentsByCampaign exists.
- Approach: gate the scale-to-reallocate transition on a paid-value/trueROAS floor before the
  money-move; plumb trueROAS into the decision input (today computed only for display); graduate
  toward proven-paid receipts.
- Acceptance: a cheap-CPA-but-unpaid campaign does not auto-scale; the floor is enforced; eval:riley.

### A13 - Test-harness integrity (P2 rank 23 + P3 rank 29) [ ]
- Workstream: governance/launch. Merge-stop: none likely (test-only). Brainstorm: no. Model: sonnet.
- Findings: the api test harness short-circuits all intents to platform-direct and disables the
  entitlement gate (rank 23, `test-server.ts:470,472`, options `:126-182`; prod wires both
  `app.ts:780-790`); the report seam is validated only against an empty cohort (rank 29,
  `test-server.ts:411`, `api-reports.test.ts:24-38`).
- Approach: thread optional `{isPlatformDirectIntent, entitlementResolver}` into
  `BuildTestServerOptions` so suites can opt into production-shaped resolution + entitlement; seed one
  populated `ReceiptedBookingView` so the route -> rollup -> computeReceiptedBookingRevenue seam is
  covered.
- Acceptance: a strict-lookup/entitlement branch is exercisable via the shared harness; a
  populated-cohort seam test catches a dropped paidRevenueCents/cohortSize.

### A14 - Mira cleanups (P3 rank 34 + P3 rank 35 + P3 rank 36; deferred-tier) [ ]
- Workstream: mira. Merge-stop: route-allowlist if touched. Brainstorm: no. Model: sonnet/haiku.
- Findings: Keep/Pass writes a publish-gating field via direct updateMany with no WorkTrace (rank 34,
  `mira-decision.ts:59-62`, allowlisted `route-allowlist.yaml:145`); unused dual-lifecycle-blind
  polling hooks (rank 35, `use-creative-pipeline.ts:23,44`, unmounted dead code); hardcoded
  deploymentType="standard" inert on both ends (rank 36, `inngest.ts:1399-1405`,
  `approval-config.ts:22-33`).
- Approach: emit a lightweight audit/WorkTrace entry for Keep/Pass (or route via operator_mutation) +
  tighten the route comment; delete the unused polling hooks; pass the real deployment.type through or
  drop the inert deploymentType axis.
- Acceptance: keep/pass is auditable; the dead hooks are gone (grep clean); the inert axis is
  resolved.

## Out of scope (correctly deferred, do NOT build)

- The Riley forward guardrail-monitor + automated rollback (deferred per D3; gated to the
  `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` flag-flip).
- Operational go-live levers (flag flips, creds, template approvals, embedded-signup onboarding):
  these are operator actions, not code, per [[project_north_star_activation_gap]] /
  [[project_show_rate_recovery]].
- v2 recovery workflows (cancellation/waitlist), Mira creative beyond the rank 34-36 cleanups, and
  any net-new agent capability.
