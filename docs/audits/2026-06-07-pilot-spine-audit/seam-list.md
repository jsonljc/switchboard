# Pilot-Spine Audit — Phase 0 Static Seam-Trace

Date: 2026-06-07
Branch: `audit/pilot-spine` (based on origin/main)
Scope: the pilot spine only — onboarding, channel connect, the Alex booking loop
(inbound → response → booking → receipt → revenue → WorkTrace → dashboard),
approval lifecycle, dashboard Home/Inbox/Results, escalation/handoff, and the two
unattended crons. Mira/Riley flag-off code is OUT of scope.

## Method

- Churn window: `2026-05-17 .. origin/main` (base `8fe72c620`). The window is
  dominated by Spec-1A "close the revenue loop" (#932–#949): phone normalization,
  WorkTrace lineage welding, calendar/payment receipts, the payments webhook,
  paid-visits read surface, and the two dispatch crons. This is squarely the spine.
- For each seam: read the producer's output construction and the consumer's
  parse/destructure. `SUSPECTED` = a static smell that needs live confirmation
  before any BROKEN verdict. `UNVERIFIED-COMPLEX` = boundary requires
  whole-subsystem reading to settle.
- Gotchas checked explicitly: `"approvalRequired" in response` branching before
  destructure; seeded `{id:"system",type:"system"}` cron principal; updateMany
  losing the P2025 no-match throw; NaN-blind comparison gates.

---

## J1 — Onboarding

No high-churn onboarding seams landed in this window; onboarding/provisioning
code was not materially touched by Spec-1A. No seams recorded. (Re-scan if a
later phase widens scope to provisioning.)

---

## J2 — Channel connect (inbound webhook → gateway)

### S-01 — Managed webhook → ChannelGateway.handleIncoming

- Producer: `apps/chat/src/routes/managed-webhook.ts:172` (builds the
  `IncomingChannelMessage`: `channel, token, sessionId, principalId, text,
providerMessageId`).
- Consumer: `packages/core/src/channel-gateway/types.ts:198`
  (`IncomingChannelMessage`) consumed in
  `packages/core/src/channel-gateway/channel-gateway.ts`.
- Payload: `IncomingChannelMessage`.
- Verdict: **OK.** Every field the producer sends is declared on the consumer
  interface; `principalId`/`providerMessageId` are optional on both sides and the
  producer passes `rawMessageId ?? undefined`. No dropped/renamed field. This is
  the exact seam-class of the historical `bookingId` drop; it is clean here.

### S-02 — Webhook → CtwaAdapter.ingest (CTWA lead intake)

- Producer: `apps/chat/src/routes/managed-webhook.ts:143` (reads
  `incoming.metadata["ctwaClid"]`, forwards `from/metadata/organizationId/
deploymentId`).
- Consumer: `CtwaAdapterLike.ingest` (`managed-webhook.ts:12`), real impl in
  `@switchboard/ad-optimizer`.
- Payload: `{ from, metadata, organizationId, deploymentId }`.
- Verdict: **OK.** Fire-and-forget, gated on a present non-empty `ctwaClid`
  string; failures are swallowed by design and cannot block message handling.
  Field names match the consumer interface. (Live note: depends on the adapter
  reading `ctwaClid` out of `metadata` — confirm during walkthrough that the
  metadata key the producer writes matches what the adapter reads.)

---

## J3 — Booking loop (gateway → ingress → skill → booking → receipt → WorkTrace)

### S-03 — Gateway submit → PlatformIngress (lineage weld)

- Producer: `packages/core/src/channel-gateway/channel-gateway.ts:315`
  (`CanonicalSubmitRequest` with top-level `contactId`, `conversationThreadId`,
  and a provider-message-derived `idempotencyKey`).
- Consumer: `normalizeWorkUnit` (`packages/core/src/platform/work-unit.ts:49`) →
  `work-trace-recorder.ts:119,172`.
- Payload: `CanonicalSubmitRequest` → `WorkUnit` → `WorkTrace`.
- Verdict: **OK.** `contactId`/`conversationThreadId` are declared on
  `CanonicalSubmitRequest` (`canonical-request.ts:35,38`), copied verbatim into
  the work unit, and persisted as trace lineage columns. Threading is complete
  end-to-end and pinned by `test(db): pin one-query booking-to-worktrace chain
join shape`.

### S-04 — Intent resolution `{slug}.respond`

- Producer: `channel-gateway.ts:318` (`intent: "${resolved.skillSlug}.respond"`).
- Consumer: skill-intent registrar (`a9792de5 fix(core): register {slug}.respond
so managed inbound resolves at ingress`).
- Payload: intent string.
- Verdict: **OK.** A recent fix registered `{slug}.respond`; smoke test
  `6ed05547` confirms a real Alex SKILL.md reaches a registered respond intent.
  Flag for the walkthrough only because a missing registration here silently
  fails the whole inbound path.

### S-05 — Skill context workUnitId → booking row workTraceId

- Producer: `packages/core/src/platform/modes/skill-mode.ts:95,107,201`
  (`workUnitId: workUnit.id` into the skill request context).
- Consumer: `packages/core/src/skill-runtime/tools/calendar-book.ts:281`
  (`workTraceId: ctx.workUnitId ?? null`).
- Payload: `SkillRequestContext.workUnitId`.
- Verdict: **OK.** `ctx.workUnitId` is populated (not the "stored-but-never-set"
  class) so the booking row carries the real trace id, not null.

### S-06 — Booking confirm tx → calendar receipt + booked outbox

- Producer/consumer co-located: `calendar-book.ts:353-407` mints the calendar
  receipt (`buildCalendarReceiptData`) and writes the `evt_booked_${booking.id}`
  outbox event in the same confirm transaction.
- Payload: receipt row + `booked` outbox event.
- Verdict: **OK.** Receipt + confirm + outbox are one durable tx welded to the
  booking; eventId is deterministic off `booking.id` (replay-stable). Tier is
  injected by apps/api (`receiptTierForProvider`) so core stays surface-agnostic.

---

## J4 — Approval lifecycle (park → approve/reject → dispatch)

### S-07 — Approvals route → respondToApproval

- Producer/consumer: `apps/api/src/routes/approvals.ts:246`
  (`respondToApproval(...)`).
- Payload: approve/reject/patch action + `bindingHash`.
- Verdict: **OK.** The approve→dispatch path goes through core
  `respondToApproval` / `respondToParkedLifecycle`, NOT through
  `PlatformIngress.submit()` — so the "branch on `approvalRequired` before
  destructure" gotcha does not apply to this route. `bindingHash` required for
  approve/patch; conflict/expiry mapped to 409.

### S-08 — record_revenue operator submit (phantom-success structural check)

- Producer: `apps/api/src/routes/revenue.ts:77` (`platformIngress.submit({intent:
RECORD_REVENUE_INTENT, ...})`), then `if (!response.ok)` →
  `response.result.outcome` at line 90.
- Consumer: ingress; intent registered in
  `apps/api/src/bootstrap/operator-intents.ts:111` as `system_auto_approved`,
  `approvalPolicy:"none"`.
- Payload: `SubmitWorkResponse`.
- Verdict: **OK (with latent fragility).** The route checks `!response.ok` then
  reads `response.result.*` WITHOUT branching on `"approvalRequired" in
response`. `SubmitWorkResponse` has a third variant
  (`{ok:true, approvalRequired:true, workUnit}` with NO `result` — see
  `platform-ingress.ts:87-94`). Because `RECORD_REVENUE_INTENT` is
  `system_auto_approved`, the gate short-circuits to `execute`
  (`governance-gate.ts:100`) and never parks, so the unhandled branch is
  unreachable today. If this intent's approvalMode ever changes, this becomes a
  phantom-success 2xx / undefined-read. Not BROKEN; record as a latent.

---

## J5 — Results (paid-visits read surface)

### S-09 — usePaidVisits → Next proxy → api-client → revenue route

- Producers/consumers along the chain:
  - hook `apps/dashboard/.../reports/hooks/use-paid-visits.ts:21` expects
    `{ paidVisits: PaidVisitRow[] }`, queries `?window=`.
  - proxy `apps/dashboard/src/app/api/dashboard/revenue/paid-visits/route.ts:31`
    maps window→{from,to} and forwards verbatim.
  - client `apps/dashboard/src/lib/api-client/dashboard.ts:90`
    (`getPaidVisitsByCampaign`) hits
    `/:orgId/revenue/by-campaign?detail=paid-visits&from&to`, typed
    `{ paidVisits: PaidVisitRow[] }`.
  - api `apps/api/src/routes/revenue.ts:152-167` returns `{ paidVisits }`.
- Payload: `PaidVisitRow[]` (schema in `@switchboard/schemas`).
- Verdict: **OK.** Shape `{paidVisits}` is identical at all four hops. Date
  parsing is NaN-guarded on both the proxy (`windowToRange` falls back to 90d)
  and the api (`Number.isNaN(parsed.getTime())` → defaults, `revenue.ts:158`),
  satisfying the NaN-blind-gate gotcha. cents→major conversion happens once
  (`toPaidVisitRow`).

### S-10 — paid-visits store read production-exclusion flag

- Producer: `revenue.ts:164` passes `isProduction: NODE_ENV==="production"` to
  `store.paidVisitsByCampaign`.
- Consumer: `packages/db/src/stores/prisma-revenue-store.ts`
  (`paidVisitsByCampaign`, noop-excluded in prod).
- Payload: `{ orgId, from, to, isProduction }`.
- Verdict: **OK.** Boolean flag, no field rename. (Walkthrough note: the
  production exclusion of noop-tier receipts is the honest-attribution gate;
  confirm live that T3/degraded rows are excluded in prod and included in dev.)

---

## J6 — Escalation / handoff

### S-11 — Escalation detail: route → proxy → useEscalationDetail

- Producer: `apps/api/src/routes/escalations.ts:118-135` returns
  `{ escalation, conversationHistory }` where `conversationHistory =
conversation.messages` (raw ConversationState JSONB).
- Proxy: `apps/dashboard/src/app/api/dashboard/escalations/[id]/route.ts:11`
  forwards verbatim.
- Consumer: `apps/dashboard/src/hooks/use-escalation-detail.ts:16,63` —
  `ConversationTurn` reads `text` (NOT `content`), role "owner" = operator.
- Payload: `{ escalation, conversationHistory: ConversationTurn[] }`.
- Verdict: **SUSPECTED.** Field-name divergence is real and is the exact
  audit-target class. `ConversationState.messages` operator turns ARE written
  with `text` (`prisma-conversation-state-store.ts:155-156,231-232`), matching
  the consumer. BUT the gateway's user/assistant turns are persisted to a
  DIFFERENT table (`Conversation` via `prisma-conversation-store.ts`) using
  `content`, and I could not locate the writer that populates the lead/agent
  turns INTO `ConversationState.messages`. If those lead turns are stored with
  `content` (or never stored), the HandoffDetailSheet will render blank lead
  message bodies. Needs live confirmation: open a real escalation and check
  whether lead turns show text. See also S-12.

### S-12 — Who writes lead/agent turns into ConversationState.messages

- Producer: unresolved statically. `prisma-conversation-state-store.ts` only
  appends `owner` turns; no create/initial-messages path and no user/assistant
  append found in this store.
- Consumer: S-11 above.
- Verdict: **UNVERIFIED-COMPLEX.** Settling the lead-turn field name requires
  tracing the full ConversationState population path across the gateway
  pre-input upsert and any sync writer — beyond a single-seam boundary. Resolve
  during the live walkthrough (inspect a real ConversationState.messages row).

---

## J7 — Unattended crons

### S-13 — appointment-reminder-dispatch → conversation.reminder.send (ingress)

- Producer: `apps/api/src/services/workflows/reminder-send-request.ts:26`
  (`actor: {id:"system", type:"system"}`, intent `conversation.reminder.send`,
  trigger `schedule`).
- Consumer: ingress; intent registered
  `apps/api/src/bootstrap/contained-workflows.ts:475`
  (`approvalPolicy:"none"`, `allowedTriggers:["schedule"]`).
- Payload: `CanonicalSubmitRequest`.
- Verdict: **OK.** Uses the seeded `{id:"system",type:"system"}` principal
  verbatim (satisfies the cron-principal gotcha; a bespoke `system:<x>` would
  hard-deny). Trigger `schedule` is in the allowlist.

### S-14 — reminder cron outcome consumption (`outputs.sent`)

- Producer: `apps/api/src/services/workflows/conversation-reminder-send-workflow.ts`
  returns `outputs: { sent: boolean, skipReason? }`.
- Consumer: `apps/api/src/services/cron/appointment-reminder-dispatch.ts:96-113`
  (`!response.ok` → markFailed; `outputs.sent===true/false` → markSent/markSkipped;
  else `no_terminal_outcome`).
- Payload: `SubmitWorkResponse.result.outputs`.
- Verdict: **SUSPECTED (latent).** The `{sent, skipReason}` contract matches
  exactly — that part is OK. The latent: the cron reads `response.result.outputs`
  guarded only by `!response.ok`. If the submit ever PARKS (`approvalRequired:
true` → `ok:true`, NO `result`), `response.result.outputs` throws / the row is
  marked `no_terminal_outcome`. Today `approvalPolicy:"none"` so it should not
  park, but unlike S-08 there is no `system_auto_approved` short-circuit — the
  gate still runs the policy lookup, so an org-level governance override that
  injects require_approval could flip this. Confirm live that no posture/override
  can force a `schedule`-trigger send to park.

### S-15 — scheduled-follow-up-dispatch → conversation.followup.send (ingress)

- Producer: `apps/api/src/services/workflows/followup-send-request.ts:20`
  (`actor: {id:"system", type:"system"}`, intent `conversation.followup.send`,
  trigger `schedule`).
- Consumer: intent registered `contained-workflows.ts:468`
  (`approvalPolicy:"none"`, `allowedTriggers:["schedule"]`).
- Payload: `CanonicalSubmitRequest`.
- Verdict: **OK.** Seeded system principal used correctly; trigger allowlisted.

### S-16 — follow-up cron outcome consumption (`outputs.sent`)

- Producer: `conversation-followup-send-workflow.ts` returns
  `outputs:{ sent, skipReason }`.
- Consumer: `scheduled-follow-up-dispatch.ts:75-119`.
- Payload: `SubmitWorkResponse.result.outputs`.
- Verdict: **SUSPECTED (latent).** Same structure as S-14: `{sent,skipReason}`
  contract matches; the unhandled `approvalRequired` variant is the latent.
  Additionally relies on `classifyCadenceSkip(reason)` and
  `ACTIVATION_*` constants — confirm the workflow's `skipReason` strings are in
  the set `classifyCadenceSkip` recognizes (an unrecognized reason silently falls
  to the generic skip branch).

---

## J3/J5 cross-seam — Payments webhook → verified-payment writer

### S-17 — Payments webhook → payment.record_verified (ingress)

- Producer: `apps/api/src/routes/payments-webhook.ts:109` (`platformIngress.submit
({intent:"payment.record_verified", parameters:{contactId, opportunityId,
bookingId, externalReference, amountCents, currency, provider}, actor:
{id:"system",type:"service"}, trigger:"api", idempotencyKey:"psp-<id>"})`),
  then `if (!result.ok)` → `result.workUnit.id/traceId`.
- Consumer:
  `apps/api/src/bootstrap/operator-intents/record-verified-payment.ts:42`
  (`RecordVerifiedPaymentParametersSchema.parse(workUnit.parameters)`); schema
  `apps/api/src/routes/operator-intents-schemas-payment.ts:10`.
- Payload: `RecordVerifiedPaymentParameters`.
- Verdict: **OK (with two notes).**
  1. The handler ALSO reads `params.connectionId`, `params.sourceCampaignId`,
     `params.sourceAdId` — fields the webhook does NOT send — but all three are
     `.optional()` in the schema and `currency`/`provider` carry defaults, so the
     `.parse()` does not fail. Not a dropped-field break.
  2. Same latent phantom-success structure as S-08: `if (!result.ok)` then
     `result.workUnit` with no `"approvalRequired" in response` branch. Intent is
     `system_auto_approved` (`operator-intents.ts:121`) so the gate short-circuits
     and never parks (`governance-gate.ts:100`); unreachable today. Actor is
     `{id:"system",type:"service"}` (not `type:"system"`) — fine because the
     `system_auto_approved` short-circuit returns `execute` before any
     actor-type policy lookup, and `allowedTriggers:["api"]` matches `trigger:
"api"`.

### S-18 — Charge re-fetch → revenue/attribution fields

- Producer: webhook re-fetches the charge via `paymentPortFactory(org)
.retrievePayment(chargeId)` and submits `charge.amountCents/currency/provider/
externalReference/bookingId`; contact/opportunity resolved server-side from the
  Booking row (`payments-webhook.ts:91-118`).
- Consumer: `record-verified-payment.ts:78-95` writes the
  LifecycleRevenueEvent / receipt.
- Payload: re-fetched charge → revenue event.
- Verdict: **SUSPECTED.** Amount/booking linkage are correctly authoritative
  (re-fetched + booking-join, never body). BUT the webhook path never supplies
  `sourceCampaignId` / `sourceAdId`, so verified-purchase revenue events from a
  paid CTWA ad will carry NULL ad attribution. The paid-visits / Results surface
  (S-09/S-10) reports per-ad attribution; a deposit paid via this webhook may be
  unattributed there. May be by-design (attribution welded at booking time, not
  payment time) — confirm live whether the Booking/revenue row already carries the
  campaign/ad linkage so the Results panel still attributes the visit.
  Secondary: `currency: z.string().length(3)` will reject a charge whose currency
  is not exactly 3 chars → `result.ok=false` → 500; confirm the adapter always
  returns a 3-letter ISO code.

---

## Summary

| Journey        | Seam IDs               | Count |
| -------------- | ---------------------- | ----- |
| J1 onboarding  | (none in window)       | 0     |
| J2 channel     | S-01, S-02             | 2     |
| J3 booking     | S-03, S-04, S-05, S-06 | 4     |
| J4 approval    | S-07, S-08             | 2     |
| J5 results     | S-09, S-10             | 2     |
| J6 escalation  | S-11, S-12             | 2     |
| J7 crons       | S-13, S-14, S-15, S-16 | 4     |
| J3/J5 payments | S-17, S-18             | 2     |

| Verdict            | Count  | Seam IDs                                                                     |
| ------------------ | ------ | ---------------------------------------------------------------------------- |
| OK                 | 13     | S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-09, S-10, S-13, S-15, S-17 |
| SUSPECTED          | 4      | S-11, S-14, S-16, S-18                                                       |
| UNVERIFIED-COMPLEX | 1      | S-12                                                                         |
| **Total**          | **18** |                                                                              |

Note: S-08 and S-17 are verdict OK today (the `system_auto_approved`
short-circuit makes the unhandled `approvalRequired` branch unreachable) but
carry documented latent phantom-success concerns; they are counted as OK per
their current safety but flagged in-line for the live walkthrough.

### SUSPECTED list (feeds the live walkthrough)

- **S-11** — escalation `conversationHistory` turns: consumer reads `text`;
  lead/agent turns may be stored with `content` (or not at all) → blank lead
  bubbles in HandoffDetailSheet.
- **S-12** (UNVERIFIED-COMPLEX) — identify the writer that populates lead/agent
  turns into `ConversationState.messages` and its field name; settles S-11.
- **S-14** — reminder cron: `approvalRequired` variant unhandled (latent;
  no `system_auto_approved` short-circuit, so an org override could park).
- **S-16** — follow-up cron: same unhandled `approvalRequired` variant; plus
  confirm `skipReason` strings are recognized by `classifyCadenceSkip`.
- **S-18** — verified-payment revenue events lack `sourceCampaignId`/`sourceAdId`
  → possible NULL ad attribution on the Results paid-visits surface; plus
  `currency.length(3)` rejection risk.
