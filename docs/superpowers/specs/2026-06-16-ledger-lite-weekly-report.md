# Ledger-lite v1: the proactive weekly receipted-bookings owner report

Status: design spec (captured 2026-06-16). Drives the Ledger-lite implementation slices.
Related: `docs/superpowers/specs/2026-06-14-revenue-proof-medspa-direction.md` (agent roadmap, MVP order),
`docs/superpowers/specs/2026-06-14-receipted-booking-object-design.md` (the moat object),
`docs/superpowers/specs/2026-06-15-receipted-booking-override.md` (the override/reconcile write-side),
`project_revenue_proof_direction` (memory).

## 1. Thesis

The north-star metric is weekly receipted bookings. The moat data already exists and is already assembled:
`computeReceiptedBookings` (count), `computeReceiptedBookingQuality` (attribution breakdown plus the
exceptions worklist), `computeReceiptedBookingRevenue` (snapshot revenue), held-appointment rate, consent
completeness, and the override provenance are all computed by `createPeriodRollup` and rendered as dashboard
tiles on `/reports`. The gap is delivery: today the owner must log in and open the reports page to see any of
it. Nothing reaches the owner on its own.

Ledger-lite v1 closes that gap. It is the governed capability that assembles the weekly report from the
existing machinery and delivers it to the owner proactively, once a week, as a trustworthy email digest that
is itself receipted (every delivery is a `WorkTrace`). This is what makes the report indispensable: the owner
receives proof of what the system did, on a predictable cadence, without going to look for it.

This spec is deliberately bounded to the Ledger-lite role in the MVP order
(Ledger-lite, then Casey, then Quinn-lite, then Robin). It does not build any other agent.

## 2. Scope

In scope:

- Assemble the weekly receipted-bookings report by reusing the existing report machinery unchanged.
- Deliver a deterministic email digest to the owner once a week.
- Govern the delivery through `PlatformIngress.submit()` so each delivery produces a canonical `WorkTrace`.
- Ship it safe-by-default: behind a flag, recipient-gated, idempotent per week.

Explicitly out of scope for v1 (do not build any of these here):

- The Casey, Quinn-lite, or Robin agents. Each needs its own product kickoff.
- A conversational or LLM-authored Ledger agent (no `SKILL.md`, no deployment, no skill-mode brief). The report
  is deterministic, so an LLM adds cost, latency, and non-determinism with no owner value over a template.
- An in-app notification surface (badge, inbox). The dashboard tiles already exist; the net-new is push, and
  no proactive in-app push infrastructure exists to reuse.
- A reconciliation extension to `reconciliation.ts`. The lazy `getView` already recomputes derived fields on
  read, so there is no re-scoring gap to fill (see `project_revenue_proof_direction`, the resolved re-eval
  triggers note). This stays a possible later enhancement.
- Per-org timezone scheduling, and any delivery channel other than email (SMS, WhatsApp, Slack).

## 3. Ground truth (reuse, do not rebuild)

Verified against the worktree on 2026-06-16. All of this is reused unchanged.

| Capability | Where | Reuse |
| --- | --- | --- |
| `ReportDataV1` view model (receiptedBookings, receiptedBookingQuality with worklist, receiptedBookingRevenue, heldRate, consentCompleteness, period, label) | `packages/schemas/src/reports/v1.ts:162-240` | source of the digest content |
| `createPeriodRollup(deps)({orgId, current, prior, computedAt})` assembly entry | `packages/core/src/reports/period-rollup.ts:31-89` | call directly with an explicit week range |
| `ReportDependencies` / `ReportStores` (11 store contracts) | `packages/core/src/reports/interfaces.ts:22-163` | build the same deps the route builds |
| `computeReport()` reference assembly plus cache | `apps/api/src/routes/dashboard-reports.ts:71-113` | mirror its deps construction (note: `createPeriodRollup` does not cache; the route caches around it) |
| Report stores decorated on the Fastify app (`reportStores`, `reportCacheStore`, `baselineStore`) | `apps/api/src/app.ts:642-695` | the cron handler reads them off `app` |
| Resend email send (SDK pattern: `new Resend(apiKey)` then `resend.emails.send({from,to,subject,html})`) | `apps/api/src/services/notifications/email-escalation-notifier.ts:34-60` | extract a small generic `sendEmail` port |
| Owner recipients: `getEscalationConfig().emailRecipients` (env fallback `ESCALATION_EMAIL_RECIPIENTS`) | `apps/api/src/services/escalation-config-service.ts:25-56` | primary recipient source |
| `DashboardUser` org users (verified) | `packages/db/prisma/schema.prisma` (`DashboardUser`) | recipient fallback when escalation config is empty |
| Scheduled-cron pattern (Inngest `createFunction({triggers:[{cron}]})`, dispatch fans out events, worker submits with `actor:{id:"system",type:"system"}`, ISO-week idempotency, `entitlement_required` named skip, `approvalRequired` branch) | `apps/api/src/services/cron/mira-self-brief.ts` plus `apps/api/src/bootstrap/inngest.ts` functions array | the delivery cron is modeled on this |
| Active-org list for fan-out | `listActiveOrganizations()` (used by `reconciliation.ts`) | dispatch source |

Confirmed absent: there is no email, cron, digest, or any other proactive delivery of the receipted-bookings
report anywhere in the codebase. `scheduled-reports.ts` is unrelated CRUD for user-defined custom reports.

## 4. Approaches considered

Approach A (recommended): a deterministic weekly Inngest cron that submits a governed `operator_mutation`
intent through `PlatformIngress`; the handler assembles the report from the existing machinery, formats a
deterministic digest, and sends it by email. Reuses everything, governed and WorkTraced, no LLM, no new agent,
lowest build cost. Email is the only owner channel that actually exists end-to-end (Resend is wired, and the
owner already receives escalation emails on the same recipient list).

Approach B (rejected): a full Ledger agent shell, a `SKILL.md` plus an `AgentDeployment`, with a skill-mode
weekly brief modeled on `mira-self-brief`. Mira uses skill-mode because the LLM is the value (it reasons a
creative direction and can abstain). The Ledger report is deterministic, so an LLM brief buys nothing and
costs determinism, money, and latency. Deferred until there is a genuine conversational Ledger need.

Approach C (rejected): an in-app notification surface (a "this week" card plus a badge). The dashboard tiles
already render the full report, so this adds UI without adding reach: the owner only sees it if they log in,
which is the exact gap we are closing. It would also require new push infrastructure (a notification model
plus polling or websockets) that does not exist to reuse. Email is genuinely received.

Channel note: WhatsApp send exists but is patient-PDPA-gated through `evaluateProactiveSendEligibility`, and
the owner has no patient contact record, so it cannot carry an owner report. Slack exists for approvals only,
on a single global channel with no per-org owner binding. Email is the correct owner channel here, forced by
what is actually built, not an open business choice.

## 5. Design

### 5.1 Flow

```
Inngest weekly cron "0 13 * * 1" (Mon 13:00 UTC)
  dispatch: listActiveOrganizations() -> emit one scan event per org
  worker (per org):
    if LEDGER_WEEKLY_REPORT_ENABLED != "true": no-op
    recipients = resolveOwnerReportRecipients(org)        // escalationConfig -> verified DashboardUser fallback
    if recipients empty: skip "no_recipients"
    response = PlatformIngress.submit({
      organizationId, actor:{id:"system",type:"system"},
      intent:"ledger.deliver_weekly_report", trigger:"schedule",
      surface:{surface:"api"},
      idempotencyKey:`ledger-weekly:${orgId}:${isoWeekOfCompletedWeek}`,
      parameters:{ recipients, weekStart, weekEnd },
    })
    if entitlement_required: skip "org_not_entitled"
    if "approvalRequired" in response: skip "parked" (not expected for system_auto_approved)
  handler (OperatorMutationHandler for ledger.deliver_weekly_report):
    report = assembleReport(orgId, {from:weekStart,to:weekEnd})   // createPeriodRollup, null insights, deterministic pull-quote
    digest = buildWeeklyDigest(report, {dashboardUrl, periodLabel})  // pure, NaN-safe
    sendEmail({ to:recipients, subject:digest.subject, html:renderHtml(digest), text:renderText(digest) })
    return { outcome:"completed", summary, outputs:{ recipientCount, receiptedBookings } }
  -> WorkTrace written by PlatformIngress
```

### 5.2 Components

Each component has one purpose, a typed interface, and explicit dependencies.

1. `WeeklyDigest` type (schemas, `packages/schemas/src/reports/`). The content model: subject, headline, an
   ordered list of labelled sections (receipted bookings, revenue, attribution quality, held rate, consent
   completeness, bookings needing attention with the top worklist items), and a dashboard link. No I/O.

2. `buildWeeklyDigest(report: ReportDataV1, opts): WeeklyDigest` and `renderWeeklyDigestText(digest): string`
   (core, `packages/core/src/reports/weekly-digest.ts`). Pure transforms. NaN-safe: every rate or derived
   number is `Number.isFinite`-guarded and rendered as an honest "not enough data yet" when null, never as
   `NaN` or a fabricated zero. Depends only on the `ReportDataV1` shape. This is the trust-critical logic and
   is fully unit tested.

3. `sendEmail(input)` port (apps/api, `apps/api/src/services/notifications/send-email.ts`). A small generic
   Resend sender (`new Resend(RESEND_API_KEY)`, `from = EMAIL_FROM`), reused by the handler. If
   `RESEND_API_KEY` is unset it returns a typed "not configured" result rather than throwing.

4. `resolveOwnerReportRecipients(prisma, orgId): Promise<string[]>` (apps/api,
   `apps/api/src/services/reports/recipients.ts`). Primary: `getEscalationConfig().emailRecipients`. Fallback:
   verified `DashboardUser` emails for the org (`emailVerified != null`). Org-scoped. Empty result means skip.

5. `ledger.deliver_weekly_report` intent plus its `OperatorMutationHandler` (apps/api, registered in
   `operator-intents.ts`, handler in `operator-intents/deliver-weekly-report.ts`). The handler assembles,
   formats, and sends, then returns `{outcome, summary, outputs}`. Registered with `allowedTriggers:
   ["schedule","api"]` (see 5.3).

6. `ledger-weekly-report` cron (apps/api, `apps/api/src/services/cron/ledger-weekly-report.ts`), an Inngest
   dispatch plus worker modeled on `mira-self-brief.ts`, wired into the functions array in
   `apps/api/src/bootstrap/inngest.ts`.

### 5.3 Governance and safety

- Mode: `operator_mutation` with `approvalMode: "system_auto_approved"`, `mutationClass: "write"`,
  `spendBearing: false`. The governance gate short-circuits a non-financial `system_auto_approved` intent
  straight to execute before the policy engine, so this needs no anchored allow-policy seed (the established
  non-conversation owner-mutation recipe, `feedback_operator_mutation_owner_action_recipe`).
- Trigger: the intent must register `allowedTriggers: ["schedule", "api"]`. The shared `registerOperatorIntent`
  helper hardcodes `["api"]`, and `PlatformIngress.submit` rejects an unlisted trigger with
  `trigger_not_allowed` at `platform-ingress.ts:214` before governance runs. This intent therefore registers
  with its own trigger set (a dedicated registration, not the shared helper, leaving the helper's other callers
  untouched). `"api"` is kept so the same intent can be invoked manually for testing.
- Actor: the seeded `{id:"system", type:"system"}` principal (`feedback_cron_submit_seeded_system_principal`).
  A bespoke `system:<x>` id would hard-deny at the identity gate and the send would silently never happen.
- Entitlement: enforced at submit, org-level. The worker maps `entitlement_required` to a named skip so the
  feature is honestly inert on unentitled orgs rather than looking like a silent failure.
- Consent: the recipient is the business owner or operator, addressed on the org's own configured recipient
  list, not a patient. This is a B2B operational notice, not a patient communication, so the patient PDPA and
  WhatsApp 24-hour-window gate (`evaluateProactiveSendEligibility`) does not apply and is not invoked.
- Flag: `LEDGER_WEEKLY_REPORT_ENABLED`, default off. Shipped together with its producer (the wired cron) in the
  same PR and tested from the real default-off path, so the control is never inert-by-omission. The new env var
  is added to `scripts/env-allowlist.local-readiness.json`.
- Idempotency: `idempotencyKey = ledger-weekly:${orgId}:${isoWeekOfCompletedWeek}`. `PlatformIngress` dedupes
  on it, so at most one successful delivery per org per reported week. A submit that fails before the send is
  retried by Inngest and re-executes. A failure after a successful send (rare) could re-send once on retry;
  accepted for v1 and noted in 5.6.

### 5.4 Digest content (the trust)

The digest carries only deterministic, DB-derived figures for the completed week:

- Receipted bookings: the count (the north-star number) as the headline.
- Receipted revenue: the snapshot revenue total with currency, and how many bookings carried a value.
- Attribution quality: the confidence breakdown (deterministic down to unattributed) and the count of bookings
  needing attention, with the top few worklist items (service, appointment time, open exception codes).
- Held appointment rate and consent completeness, each rendered as an honest null when there is not yet enough
  matured or PDPA-applicable data.
- A link to `/reports` for the full interactive view.

No LLM narrative and no pull-quote. To keep assembly fully deterministic and free of external calls, the handler
builds `ReportDependencies` with `insightsProvider: null` (the receipted-bookings, held, and consent figures
come from DB stores, not ad insights) and a deterministic (null-LLM) pull-quote generator. The digest does not
read the pull-quote field.

### 5.5 Cadence and window

- Cadence: weekly, Monday 13:00 UTC. A fixed UTC hour is acceptable for v1; per-org timezone is deferred.
- Window: the just-completed calendar week (Monday through Sunday), passed to `createPeriodRollup` as an
  explicit `current` range, with `prior` set to the week before for optional deltas. This is a retrospective
  ("here is your week"), so it deliberately does not reuse the dashboard "THIS WEEK" window, which is
  current-week-to-date.

### 5.6 Error handling and edge cases

- Flag off: the worker no-ops. Default state.
- No recipients: named skip, no submit.
- Not entitled: named skip on `entitlement_required`.
- `RESEND_API_KEY` unset: `sendEmail` returns "not configured"; the handler returns `outcome: "failed"` with a
  clear summary and the `WorkTrace` records it. No crash, no retry storm beyond Inngest's bounded retries.
- Send failure: `outcome: "failed"`, recorded on the `WorkTrace`; Inngest retries; idempotency prevents a
  double successful send. The rare post-send failure that re-sends once on retry is accepted for v1.
- Empty or sparse week (no receipted bookings yet): the digest renders honest zeros and nulls ("no receipted
  bookings this week yet"), never fabricated numbers.

## 6. Implementation slices

Slice 1 (pure formatter; auto-merge candidate, touches no merge-stop glob): the `WeeklyDigest` schema type plus
`buildWeeklyDigest` and `renderWeeklyDigestText` in core, with co-located NaN-safe tests. Lands the
trust-critical content logic in isolation.

Slice 2 (delivery; expected to surface for a human merge call): the `sendEmail` port, the
`resolveOwnerReportRecipients` resolver, the `ledger.deliver_weekly_report` intent and handler, the weekly
Inngest cron and its wiring, the `LEDGER_WEEKLY_REPORT_ENABLED` flag, and the env-allowlist entry, all shipped
together behind the default-off flag so the feature is live end-to-end (producer plus consumer) the moment the
flag flips. This slice touches several merge-stop globs at once (a new cron, intent registration, an external
send path and report delivery, the `PlatformIngress` submit seam, and a new env var), so it is expected to stop
at a merge-ready PR and be surfaced for the human merge decision rather than auto-merged. If the slice grows
unwieldy during planning it may split internally, but it ships as one coherent feature.

## 7. Testing

- TDD throughout, a real failing test before each implementation step. CI has no Postgres, so store tests use
  mocked Prisma (mirror `prisma-workflow-store.test.ts`); app tests live under `apps/api/src/__tests__`.
- `buildWeeklyDigest`: unit tests over representative `ReportDataV1` inputs, including the sparse and null-rate
  cases, asserting honest nulls and NaN-safety.
- Recipient resolver: escalation-config path, the verified-`DashboardUser` fallback, and the empty case.
- Handler: a unit test with the assemble, format, and send dependencies mocked, asserting the outcome and the
  recipient count, plus a failure test for the unset-key path.
- Governance: at least one through-`submit()` test exercising the trigger and system-principal legs (the trap
  that unit tests wiring straight to the handler cannot catch), plus a pure request-builder test asserting
  `actor.id === "system"` and the ISO-week idempotency key shape.
- `pnpm eval:governance` stays green with no new fixture (the grid is effect-category by trust-level,
  orthogonal to a specific `operator_mutation` intent).

## 8. Non-negotiables compliance

Layering holds: schemas (layer 1) carries `WeeklyDigest`; core (layer 3) carries the pure formatter and imports
only schemas; the handler, resolver, sender, and cron live in apps (layer 5). `PlatformIngress.submit()` is the
only mutating entry and `WorkTrace` stays canonical; the receipted-bookings read-model is never a parallel
control plane. Every store read is org-scoped. All new numerics are `Number.isFinite`-guarded. The flag ships
with its producer in the same PR, tested from real defaults. No schema change, so no migration. No em-dashes in
any artifact. Lowercase conventional-commit subjects. New modules get co-located `*.test.ts`, and `vi.fn` spies
use the single-arg function form.

## 9. Risks and open questions

- Recipient population: `escalationConfig.emailRecipients` is often empty on a fresh org, which is why the
  verified-`DashboardUser` fallback exists; without it the feature would be inert on the only seeded org. The
  fallback makes it live for any org that has a dashboard user.
- Timezone: a fixed UTC send hour can land at an awkward local time. Per-org timezone is a deliberate v1
  deferral.
- Double-send edge: described in 5.6; accepted for v1.
- Slice 2 size: it is a large but coherent PR because shipping the cron, the intent, and the send together is
  what makes the feature live and reviewable as one unit. It surfaces for a human merge regardless.
