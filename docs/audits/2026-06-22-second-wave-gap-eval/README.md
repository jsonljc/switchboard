# Second-Wave All-Agents Gap Eval (2026-06-22)

A second, deeper pass over every governed agent, run **after** the A1-A6 fixes from the
2026-06-20 audit had merged, to find gaps **beyond** the existing 35-item backlog and the
A7-A14 plan. Two workflow passes (find -> adversarially verify -> recheck -> blind-spot
sweep) plus an independent three-reviewer code review.

- **Method:** 23 finder lenses (7 agents + 6 seams) -> dedup -> adversarial verify each
  candidate against `main` -> coverage critic (wave 1); then 7 deep single-path rechecks of
  the thin/uncertain findings + 8 sweeps of the surfaces no wave-1 lens reached -> verify
  (wave 2); then 3 independent fresh-context reviewers validated the P1s and the orchestration.
- **Scope:** Alex, Riley, Mira, Robin, Casey (consent), Quinn (approval lifecycle),
  Ledger (weekly digest) + cross-cutting seams (proof-chain, consent-propagation,
  governance/escalation, inter-agent flywheel, A1-A6 regression, activation/prod-wiring).
- **Cost:** ~59 + ~24 subagents, ~7.2M tokens, plus 3 review subagents.

## Verdict

**38 distinct, code-grounded, twice-verified gaps: 9 P1 / 21 P2 / 8 P3.** No core invariant
is broken (PlatformIngress, WorkTrace, approval-as-lifecycle, no-bypass all hold). The
dominant theme is **go-live-flag-gated fail-open / cross-tenant-leak debt plus best-effort
writes that swallow their own failures** - the same family as
`feedback_safety_gate_needs_producer_population` and `feedback_autonomy_fields_stored_not_enforced`,
with one new pattern: **a merged fix closes a class on the path it touched but leaves sibling
paths on the old global/binary behavior.** Three of the nine P1s were introduced or left open
by the A1-A4 merges themselves.

The independent review confirmed all 9 P1s as real with correct `file:line` and correct P1
severity (zero wrong, zero fabricated), and independently reproduced the tally. Two honest
caveats from that review:

1. **38 is a floor, not a ceiling.** Finders were told to skip ~66 already-known items, which
   biases toward undercount (the safe direction). The code-level dedup was a no-op; the
   "distinct" merges were the synthesis model's judgment, backed by the verified evidence.
2. **The single multi-tenant weak point is the boot-singleton `agentNotifier`** (3 P1s trace
   to it). A1 fixed per-org send credentials only for the four automated proactive workflows,
   never this singleton.

Most P1s are latent until a go-live flag, a second tenant, or agent provisioning lands - which
is exactly the fix-before-flip window. The exceptions that bite today: the CTWA permanent
opt-in write, the A4 re-greeting, and (once anything parks) the API approver-role hole.

---

## P1 findings (9)

### P1-1 + P1-2. The boot-singleton `agentNotifier` is multi-tenant-blind (send creds AND window gate)

Both trace to one object built once at boot from process-global env, then called org-blind by
the two human-reply routes. **Fix them together.**

- **Send credentials** (`apps/api/src/app.ts:432-442`, `routes/conversations.ts:341`,
  `routes/escalations.ts:367`, `notifications/proactive-sender.ts:171-175`): `agentNotifier`
  is built once from the global `WHATSAPP_PHONE_NUMBER_ID`/token; both reply routes call
  `app.agentNotifier.sendProactive(destinationPrincipalId, channel, message)` with the
  customer's phone and no org. `resolveOrgWhatsAppSendCreds` (the A1 helper) is imported only
  by `contained-workflows.ts`. A second tenant's operator/escalation reply ships from the
  pilot org's WABA number.
- **Window gate** (`apps/api/src/app.ts:423-431`): `isWithinWindow` runs
  `conversationState.findFirst({ where: { principalId, channel: "whatsapp" }, orderBy: { lastInboundAt: "desc" } })`
  with no `organizationId`. `principalId` is non-unique and `organizationId` is nullable, so
  two tenants can hold separate rows for one phone and the query returns the freshest across
  orgs. Org A's reply to a phone that recently messaged org B passes the 24h gate on **B's**
  window (cross-tenant read + a Meta window-basis error).
- **Fix:** make the singleton resolve per-org send creds via `resolveOrgWhatsAppSendCreds`
  (mirror the four workflows) and add `organizationId` to `isWithinWindow`, passing the
  route's in-scope `orgId` (NOT `storeResult.organizationId`, which does not exist on
  `SendOperatorMessageResult`/`ReleaseEscalationResult`). **Do not build a fresh per-request
  `ProactiveSender`** - that resets the in-memory daily-rate-limit map and defeats
  `MAX_DAILY_MESSAGES`; pass creds through a single notifier instead. Decide the null-org
  policy explicitly (treat null-org rows as not matching a real tenant -> fail closed).
  Converge the operator-reply window source (`ConversationState.lastInboundAt`) with the
  proactive-workflow source (`ConversationThread.lastWhatsAppInboundAt`).
- **Relation to plan:** new-dimension-of-A1. **Live the moment a second tenant onboards** -
  gate before tenant #2.

### P1-3. Weekly owner-report recipients fall back to the global `ESCALATION_EMAIL_RECIPIENTS`

`apps/api/src/services/reports/weekly-report-recipients.ts:27-31` returns `config.emailRecipients`
before the per-org verified-user fallback; prod wires `getConfig = getEscalationConfig(prisma, id)`
(`app.ts:1031`), whose fallback for an org with no stored `escalationConfig` is the process-global
`process.env.ESCALATION_EMAIL_RECIPIENTS` (`escalation-config-service.ts:44-55`), identical for
every org. The dispatch fans out per active-deployment org with that org's revenue/ROAS in the
body, so every config-less org emails its private digest to one shared inbox. Gated behind
`LEDGER_WEEKLY_REPORT_ENABLED` (default off).

- **Fix:** do not use the escalation/breach env var as an owner-report recipient source. Read
  only a per-org stored list (no env fallback), then fall through to the org's verified
  dashboard users. (Note: the same env-as-cross-tenant-default antipattern also affects genuine
  escalation breach emails once a second org is active - out of scope here but worth a follow-up.)
- **Relation to plan:** new-dimension-of-A9.

### P1-4. API approval-respond / execute enforce no approver-role floor (chat does)

`routes/approvals.ts:185-235` and `routes/action-lifecycle.ts:16-62` enforce only auth +
`assertOrgAccess` + bindingHash + `assertNotSelfApproval`; no approver-role check and no
`approvalScopeSnapshot.approvers` membership assertion. The chat surface gates on
`APPROVER_ROLES = ['approver','operator','admin']` (`respond-to-channel-approval.ts:90`).
`require-role.ts` exists and is applied to other routes but not here. Pilot
`DEFAULT_ROUTING_CONFIG.defaultApprovers = []` so every parked action carries an empty approver
scope. Any authenticated org principal can release a parked mandatory action (Robin mass-send,
Riley budget move), defeating four-eyes.

- **Fix:** add `requireRole(request, reply, 'approver','operator','admin')` to the respond and
  execute routes, **and to the third entry `routes/internal-chat-approvals.ts`**
  (INTERNAL_API_SECRET-authenticated) so the floor is not routable-around. Push the
  `approvalScopeSnapshot.approvers` membership check into core
  (`respond-to-parked-lifecycle.ts`) so both surfaces share one spine; enforce membership only
  when the array is non-empty (so the pilot's empty scope is not locked out).
- **Relation to plan:** net-new (A11 is post-verdict escalation wiring, not who may respond).

### P1-5. CTWA intake stamps a permanent `messagingOptIn` (contradicts the locked D2 design)

`intents/lead-intake-handler.ts:101-109,124` sets `optInSource` for a CTWA source then spreads
`messagingOptIn: true` (durable column, no expiry). `canSendWhatsAppTemplate`
(`notifications/whatsapp-window.ts:28-29`) treats that as a standalone, time-unbounded send
basis. The locked D2 design says a bare CTWA click is neither a window nor an opt-in; a genuine
CTWA inbound already stamps `ConversationThread.lastWhatsAppInboundAt`, so the permanent flag is
redundant and over-reaching. **Writes the over-grant today** (intake is live).

- **Fix:** set `optInSource` only for `instant_form`. Verify the Instant Form actually captures
  an opt-in checkbox before relying on its durable opt-in; if not, even that branch over-grants.
- **Relation to plan:** new-dimension-of-A3 (A3/A4 diverged from their own locked D2 decision).

### P1-6. Booking-consent precondition fails open on a governance-resolver error

`governance/governance-config-resolver.ts:32-62` returns `{status:"error"}` (it does not throw)
on a store error or Zod failure. `bootstrap/skill-mode.ts:343-347` `resolveMode` collapses both
`"missing"` and `"error"` to mode `"off"` with no posture-cache consult, so
`enforceConsentPrecondition` returns null and the booking proceeds with no consent check. The
sibling claim-classifier and deterministic-safety-gate fail closed off
`consentPostureCache.lastKnown` when cached mode is `enforce` (the PDPA sibling fails
open-with-audit, so only 2 of 3 truly block). A `consentPostureCache` already exists at
`skill-mode.ts:544`. Inert until an org sets `consentState.mode = "enforce"` (default off;
launch posture `observe`).

- **Fix:** on `status === "error"`, have `resolveMode` return `"enforce"` when
  `consentPostureCache.lastKnown(deploymentId)?.mode === "enforce"` (reusing the existing
  read-error fail-closed path), and `"off"` on `"missing"`. Add a resolver-error counter so the
  blip is observable instead of silent.
- **Relation to plan:** net-new.

### P1-7. A4 dedup-reuse re-fires a billable first-touch greeting

`services/workflows/meta-lead-intake-workflow.ts:139,158` gates greeting on
`ingestResult.duplicate` and fires `meta.lead.greeting.send` keyed `meta-greeting:${leadId}`
(leadgenId-scoped). `intents/lead-intake-handler.ts:70,98,137` returns `duplicate:false` for
**both** the A4 reuse branch and a fresh create (only the idempotency early-return sets
`duplicate:true`). A second Instant Form for the same corroborated person collapses onto one
Contact via reuse but fires a second greeting (two leadgenIds dodge the claim-first guard).
**Live today** (Instant-Form intake + greeting are live); the second send currently goes out
because P1-5 over-grants the opt-in that satisfies the eligibility gate (P1-5 + P1-7 compound).

- **Fix:** extend `LeadIntakeResult` to a discriminated outcome (`created | reused | idempotent-duplicate`)
  and skip greeting **and** the inquiry-record child unless freshly created (Option B). Prefer
  this over a contact-scoped greeting key (Option A), which risks suppressing a legitimately
  wanted future re-greeting and misses the inquiry-record double-write (which inflates funnel
  counts).
- **Relation to plan:** new-dimension-of-A4 (a new-lifecycle-value / unchanged-binary-consumer
  regression introduced by the A4 merge).

### P1-8. Mira self-brief uses the 5-row display window as the measured-signal gate

`services/cron/mira-self-brief.ts:148-163` reads the read model with no `visibleLimit` and gates
on `model.jobs.some(j => j.performance?.delivery === "measured")`.
`creative-read-model/build-read-model.ts:80` slices `jobs` to `DEFAULT_VISIBLE_LIMIT = 5` over a
`createdAt`-desc order, while `inFlight`/`stopped` are computed over the full `FETCH_CAP = 200`
cohort and `MiraCreativeCounts` carries no measured count. Measured performance is written onto
older published jobs and does not bump `createdAt`, so for any org with >= 5 newer drafts the
older measured creatives sort out of the window, `hasMeasured` is false, and Mira returns
`{skipped:"no_signal"}` and never composes.

- **Fix:** add `measuredCount`/`hasMeasured` to `MiraCreativeCounts` computed over the full
  `FETCH_CAP` cohort (like `inFlight`); the worker reads `counts.hasMeasured`. Update the
  worker's inline read-model dep type. (A take-before-filter-starvation instance.)
- **Relation to plan:** net-new (A14 is keep/pass trace + inert deploymentType).

### P1-9. Riley weekly-audit feeds string config into number gates -> `.toFixed` crash

`ad-optimizer/inngest-functions.ts:244-245` reads `inputConfig.targetCPA ?? 100` /
`targetROAS ?? 3.0` (`??` catches only null/undefined). The per-org seeder writes **strings**
(`seed-riley-ad-optimizer-deployment.ts:50-55` `targetCPA:"30"`). `budget-analyzer.ts:49,64`
calls `targetCPA.toFixed(2)` directly -> `"30".toFixed` is undefined -> TypeError, caught
per-deployment by the fleet-isolation try/catch, so that org's whole weekly audit yields zero
output. `resolveAdOptimizerConfig` exists for exactly this reader; the cron is the lone
non-adopter.

- **Fix:** route the **whole** `deployment.inputConfig` through `resolveAdOptimizerConfig` and
  read all numeric fields (including `targetCostPerBooked`) off the parsed result, not just the
  two named fields. Layering-safe (ad-optimizer already depends on schemas).
- **Relation to plan:** net-new (A12 is count-vs-value, a different axis; A6 was contract honesty).

---

## P2 findings (21)

| # | Agent / seam | Gap | File:line |
|---|---|---|---|
| P2-1 | payments-webhook | Entitlement gate blocks a **settled**-payment webhook -> 500 -> Stripe retry-storm -> permanent loss of the proven-paid Receipt for a lapsed org. `record_verified` is revenue PROOF, should be carved out of entitlement (or branch on `error.type` and 200 + reconciliation alert). **Highest-leverage P2.** | `routes/payments-webhook.ts:140-143` |
| P2-2 | Alex | `booking.create`/`reschedule` accept an unvalidated LLM date string; a malformed `slotStart` throws (Prisma validation / RangeError) and kills the whole turn. | `tools/calendar-book.ts:356-357,460`; `calendar-reschedule.ts:97-109` |
| P2-3 | Alex | Claim/safety/consent gates run `afterSkill`, so a same-turn booking mutation completes before the verdict; no mutated-then-escalated metric. | `bootstrap/skill-mode.ts:695-701`; `skill-executor.ts:493` |
| P2-4 | Alex | CTWA fire-and-forget swallows ingress `{ok:false}` (triple-swallowed: shim strips error, adapter discards bool, route `.catch` is throw-only). Accurate gap = the `{ok:false}` infra/entitlement legs + `{ok:true}`+failed-result. | `lead-intake/ctwa-adapter.ts:116-121`; `chat/routes/managed-webhook.ts:188-200` |
| P2-5 | Alex | Health-checker reads `creds.token` directly, ignoring the `META_SYSTEM_USER_TOKEN` fallback the runtime uses, flipping a token-less WA channel to `error` and dropping it on reload. | `chat/managed/health-checker.ts:97-110` |
| P2-6 | Alex | `crm-write.stage.update` store-throw on a deleted/foreign `opportunityId` kills the whole turn (no try/catch; sibling `calendar-book` has one). | `tools/crm-write.ts:62-71` |
| P2-7 | Alex | `crm-query.activity.list` reads any sibling deployment's activity log from an LLM-supplied `deploymentId` (same-org cross-deployment metadata read); contradicts the file's trust-bound-ids doctrine. | `tools/crm-query.ts:56-66` |
| P2-8 | Alex | `web-scanner.fetch-pages` has no SSRF guard and follows redirects without re-checking; dead-code path today (absent from the prod toolFactories map). | `tools/web-scanner.ts:56-63` |
| P2-9 | Alex | `escalate` builds the human handoff from empty messages and drops the LLM-supplied summary/sentiment, so operators get a context-free package. | `tools/escalate.ts:59-78` |
| P2-10 | Riley | Corroboration reader `getBookedStatsForOrgWindow` omits the `origin:'live'` filter every sibling enforces, so a seed/demo booked row can fabricate the "corroborated" outcome. | `stores/prisma-conversion-record-store.ts:350-359` |
| P2-11 | Mira | `revenue_proven` promotion fetches a single global cap of 500 oldest unpromoted jobs then JS-filters, so one high-volume org's never-qualifying backlog starves fleet-wide promotion; no saturation telemetry. | `cron/revenue-proven-promotion.ts:239,255-262` |
| P2-12 | Mira | DALL-E reference-image render at the storyboard stage spends before the only covering spend gate and is absent from every cost estimate; **dormant** (no producer sets `generateReferenceImages=true`). | `creative-pipeline/stages/run-stage.ts:138`; `storyboard-builder.ts:138-139` |
| P2-13 | Robin | Hard crash mid-cohort orphans a claimed row forever: `pending` + `nextRetryAt=NULL` is invisible to the retry cron AND blocks re-engagement via the dedup P2002. | `stores/prisma-robin-recovery-send-store.ts:18-31`; `bootstrap/robin-recovery-executor.ts:191-229` |
| P2-14 | Robin | Cohort `getSendContext` throw silently drops a recipient (no claim, no metric); same-week ISO-week idempotency replay then blocks re-delivery until next week. | `bootstrap/robin-recovery-executor.ts:165-175` |
| P2-15 | Casey / consent | Inbound STOP: a STOP is itself inbound so the 24h window is always open (neutralizing `messagingOptIn=false`), leaving `consentRevokedAt` the sole within-window survivor - and its write is best-effort in a swallowed try/catch. | `notifications/whatsapp-window.ts:25`; `channel-gateway/channel-gateway.ts:270-285` |
| P2-16 | Quinn | `writeApprovedPayloadToTrace` failure strands the lifecycle in `approved` (no dispatch, no recovery, swept by nothing); asymmetric with the envelope-flip try/catch below it. | `approval/lifecycle-dispatch.ts:47-77`; `respond-via-lifecycle.ts:139-178` |
| P2-17 | Quinn | `ApprovalLifecycle` expiry has no production caller and writes no `action.expired` audit (even on a lazy-tap expiry). | `approval/lifecycle-expiry.ts:10-35`; `lifecycle-service.ts:246-257` |
| P2-18 | proof-chain | Cancelling a confirmed booking never voids its calendar receipt, so cancelled bookings stay in the receipted cohort and (if a deposit was paid) inflate proven-paid revenue. No write path ever sets a Receipt to `void`. | `tools/calendar-reschedule.ts:194`; `stores/prisma-receipt-store.ts:91-112` |
| P2-19 | flywheel | ROI `breakdown=agent` is permanently empty: no producer stamps `ConversionRecord.agentDeploymentId`, yet the route exposes it. | `stores/prisma-conversion-record-store.ts:65,129-145` |
| P2-20 | crons | `reconciliation` compares all-time confirmed bookings against a 7-day booked-conversion count, so it persists `overallStatus:"failing"` every run for any org older than a week. | `attribution/reconciliation-runner.ts:37-44` |
| P2-21 | crons | `lifecycle-stalled-sweep` fetches `take:1000` with no `orderBy` while the per-org enabled flag is applied in JS afterward, so a flag-off org can crowd the cap and starve flag-on orgs (take-before-filter). Producers DEFERRED today. | `cron/lifecycle-stalled-sweep.ts:62-77` |

## P3 findings (8)

| # | Agent / seam | Gap | File:line |
|---|---|---|---|
| P3-1 | Riley | Reallocate-dispatch docstring falsely claims arbitration + evidence floor "are applied at the sink wiring"; the sink applies neither (pause path applies both). Self-execution flag off. | `ad-optimizer/riley-budget-dispatch.ts:44-46`; `recommendation-sink.ts:543-558` |
| P3-2 | Riley | Capability-flag toggle flips the DB flag before the audit-ledger write with no transaction, so a ledger failure arms/disarms a money-move capability with no audit row. | `seed/riley-pause-flag-toggle.ts:57-80` |
| P3-3 | Alex | `booking.reschedule`/`cancel` carry only a `guided` auto-approve override (create carries supervised+guided), so at `supervised` trust both dead-end with no parking; the comments mis-state the default trust as `supervised` (it is `guided`). | `tools/calendar-reschedule.ts:61,161`; `calendar-book.ts:254` |
| P3-4 | Alex | CTWA referral attribution is dropped when the lead's first inbound is an unsupported message type (`parseUnsupportedMessage` omits referral extraction). | `chat/adapters/whatsapp-parsers.ts:164-189` |
| P3-5 | Robin | Retry executor treats an org-wide config gap (missing creds / context blip) as a budget-consuming transient that can dead-letter a row, diverging from the cohort path which stays re-engageable. | `bootstrap/robin-recovery-executor.ts:307-335` |
| P3-6 | Mira | Operator's per-org governance dial is bypassed for the actual draft-writing step (`creative.concept.draft` is `system_auto_approved`), so an org-scoped deny is never consulted. No-spend/reversible, so contract-clarity debt. | `governance/governance-gate.ts:182-191`; `contained-workflows.ts:570-575` |
| P3-7 | proof-chain | `paidVisitsByCampaign` keeps the FIRST payment receipt per booking with no `orderBy`, so a booking with both a degraded and a real T1 receipt can be non-deterministically dropped; diverges from the sibling consumer `computeBookingPaidValue`. | `stores/prisma-revenue-store.ts:260-291` |
| P3-8 | Ledger | Weekly digest "View the full report" link falls back to a root-relative `/reports` (dead/wrong-origin in email) when `DASHBOARD_URL` is unset; the same file uses the correct `\|\|`-with-fallback pattern elsewhere. | `app.ts:1056`; `weekly-report-delivery.ts:98,134` |

---

## Relation to the existing A1-A14 plan

~22 gaps are net-new (no plan item touches the root cause); ~8 are new dimensions of merged or
planned work (A1 send-creds -> the reply paths; A2 attribution -> the unsupported-type referral
drop; A3/A4 consent -> the permanent opt-in and the reuse re-greeting; A7 trace-stamping -> the
strand-on-write and the cancel-receipt-void; the take-before-filter gotcha -> the Mira self-brief
and `revenue_proven` instances). No gap is the same root cause as a planned A7-A14 item.

## Methodology and confidence

The two-wave harness biases against false positives (adversarial verify defaults to refute; the
confirm filter requires an affirmative `isReal && !alreadyKnown`; failures count against the
confirm rate, never toward it) and toward undercount (finders skip ~66 known items). The wave-2
rechecks moved 4 of 7 thin findings (recharacterized, none dropped) and corrected two root causes
(F15's resolver returns `{status:"error"}` rather than throwing; DALL-E is dormant). Three
independent reviewers then confirmed every P1 against live code and reproduced the tally. The
remaining residual: code-level dedup did not fire (the distinct count is an LLM merge), and
`SYNTH_SCHEMA.gaps[].severity` was an unconstrained string (clean this run). Two dormant areas
to re-review when their wiring lands: the lifecycle producer hooks (DEFERRED) and web-scanner
productization.

The fix slices and sequencing are in
[`docs/superpowers/plans/2026-06-22-second-wave-fix-plan.md`](../../superpowers/plans/2026-06-22-second-wave-fix-plan.md).
