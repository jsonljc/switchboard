# Self-Serve Readiness Audit — Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the journey-led readiness audit defined in `docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md` and produce a go/no-go launch verdict with P0/P1/P2 findings, exact code evidence, and fix scope estimates.

**Architecture:** Six sequential audit sessions (J1–J5 + Synthesis). Each session traces one customer journey through actual code paths, evaluates every step through five lenses (Completeness, Production Reality, Security/Multi-tenancy, Reliability & State Integrity, Ops Readiness), and applies the Self-Serve Integrity constraint. Findings are written to `docs/audits/2026-04-26-readiness/` as they're produced.

**Tech Stack:** Code tracing via Read/Grep/Search. No code changes during audit. Findings documented in Markdown.

---

## Audit Principle: No Founder Assist

During audit execution, do not fix, patch, or manually unblock any step. If a step requires intervention to proceed, stop and log it as a P0. The audit observes the system as a customer would encounter it.

---

## Pre-Audit: Create Output Directory

### Task 0: Set Up Audit Output Structure

**Files:**

- Create: `docs/audits/2026-04-26-readiness/j1-signup-to-agent-live.md`
- Create: `docs/audits/2026-04-26-readiness/j2-lead-to-booking.md`
- Create: `docs/audits/2026-04-26-readiness/j3-trial-to-paid.md`
- Create: `docs/audits/2026-04-26-readiness/j4-operator-controls.md`
- Create: `docs/audits/2026-04-26-readiness/j5-day2-ops.md`
- Create: `docs/audits/2026-04-26-readiness/synthesis.md`

- [ ] **Step 1: Create the audit output directory**

```bash
mkdir -p docs/audits/2026-04-26-readiness
```

- [ ] **Step 2: Create empty journey report files with headers**

Each file starts with:

```markdown
# J[N]: [Journey Name] — Readiness Audit

> **Audit date:** 2026-04-26
> **Auditor:** Claude
> **Spec:** docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md

## Findings

[findings go here in step order]
```

- [ ] **Step 3: Commit scaffold**

```bash
git add docs/audits/2026-04-26-readiness/
git commit -m "docs: scaffold readiness audit output files"
```

---

## Task 1: J1 — Signup → First Agent Live

**Core question:** Can a brand-new user go from landing page to a live agent responding on a real WhatsApp/Telegram channel, with zero founder help?

**Production Reality rule:** Any mock/simulated execution at any step = automatic P0.

**Files to trace (in order of execution):**

| Step                  | File(s)                                                                                                                                                                    | What to check                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1. Landing page       | `apps/dashboard/src/app/(public)/page.tsx`, `(public)/pricing/page.tsx`, `src/lib/launch-mode.ts`                                                                          | CTA routing, pricing tier passthrough to signup                                                          |
| 2. Registration       | `apps/dashboard/src/app/(public)/signup/page.tsx`, `src/app/api/auth/register/route.ts`, `src/lib/provision-dashboard-user.ts`                                             | Launch mode gate, email verification blocking vs advisory, what gets provisioned                         |
| 3. Onboarding wizard  | `apps/dashboard/src/app/onboarding/` (if exists), `apps/api/src/routes/playbook.ts`, `apps/api/src/routes/agents.ts` (`wizard-complete`), `apps/api/src/routes/onboard.ts` | Does the onboarding page exist on this branch? Are all steps functional? Is `skillSlug` set?             |
| 4. Channel connection | `apps/dashboard/src/app/settings/` (channel UI), `apps/api/src/routes/connections.ts`, `apps/api/src/routes/whatsapp-test.ts`, `apps/chat/src/managed/runtime-registry.ts` | Self-serve channel setup UI exists? Manual credential entry? Embedded Signup? Webhook auto-registration? |
| 5. Agent activation   | `apps/api/src/routes/agents.ts` (`go-live`), `apps/api/src/routes/readiness.ts`                                                                                            | All 7 blocking readiness checks can be satisfied by user action alone                                    |
| 6. First message      | `apps/chat/src/routes/managed-webhook.ts`, `apps/chat/src/adapters/whatsapp.ts`, `packages/core/src/channel-gateway/channel-gateway.ts`                                    | Message arrives, routes to correct org, agent processes, response sent and persisted                     |

- [ ] **Step 1: Trace landing page → signup CTA**

Read `apps/dashboard/src/app/(public)/page.tsx` and `apps/dashboard/src/lib/launch-mode.ts`.

Check:

- **Completeness:** Does `getCtaHref()` return `/signup` unconditionally or is it gated by launch mode? Is pricing tier passed through?
- **Production Reality:** Are pricing tiers real or decorative (i.e., does selecting a tier affect anything downstream)?
- **Self-Serve Integrity:** Can a user reach signup without any special env var or flag?

Log finding if: CTA is hardcoded, tier selection is decorative, or launch mode gate blocks public access.

- [ ] **Step 2: Trace registration flow**

Read `apps/dashboard/src/app/(public)/signup/page.tsx`, `apps/dashboard/src/app/api/auth/register/route.ts`, `apps/dashboard/src/lib/provision-dashboard-user.ts`, `apps/dashboard/src/lib/email.ts`.

Check:

- **Completeness:** Does registration create all required entities (Org, Principal, IdentitySpec, DashboardUser)?
- **Production Reality:** Is email verification real (Resend) or silently skipped? What happens if `RESEND_API_KEY` is not set?
- **Security:** Is password hashed? Is API key encrypted? Rate limiting on registration?
- **Reliability:** Is provisioning transactional? What happens if it fails mid-way?
- **Self-Serve Integrity:** Does registration require any env var that isn't part of standard deployment?

Log finding if: email verification silently degrades, provisioning isn't atomic, or any manual step is required.

- [ ] **Step 3: Trace onboarding wizard**

Check if `apps/dashboard/src/app/onboarding/page.tsx` exists. If not, check `apps/dashboard/src/app/(authenticated)/onboarding/`.

Read `apps/api/src/routes/playbook.ts`, `apps/api/src/routes/agents.ts` (wizard-complete endpoint), `apps/api/src/routes/onboard.ts`.

Check:

- **Completeness:** Does the onboarding page exist on this branch? Are all wizard steps functional (business basics, agent selection, tone, knowledge, channel, review)?
- **Production Reality:** Does completing onboarding create a functional deployment with `skillSlug` set?
- **Self-Serve Integrity:** Can a user complete onboarding without developer console access, DB seeds, or manual API calls?

Log finding if: onboarding page is missing, `skillSlug` not set, or any step is stubbed.

- [ ] **Step 4: Trace channel connection**

Search for channel setup UI in dashboard. Read `apps/api/src/routes/connections.ts`, `apps/api/src/routes/whatsapp-test.ts`, `apps/chat/src/managed/runtime-registry.ts`, `apps/chat/src/main.ts` (provision-notify endpoint).

Check:

- **Completeness:** Is there a self-serve UI for connecting WhatsApp/Telegram? Or is it API-only?
- **Production Reality:** Does connecting a channel auto-register the webhook with Meta/Telegram? Or does the user need to manually configure webhook URLs in the Meta Developer Console?
- **Security:** Are channel credentials encrypted at rest? Is the provision-notify endpoint properly authenticated?
- **Self-Serve Integrity:** Can a user connect a channel without SSH access, CLI tools, or developer console knowledge?

Log finding if: no channel setup UI, manual webhook configuration required, or Embedded Signup not available.

- [ ] **Step 5: Trace agent activation (go-live)**

Read `apps/api/src/routes/agents.ts` (go-live endpoint at PUT `/api/agents/go-live/:agentId`), `apps/api/src/routes/readiness.ts`.

Check:

- **Completeness:** Are all 10 readiness checks implemented (7 blocking, 3 advisory)?
- **Production Reality:** Can all 7 blocking checks pass for a real user who completed onboarding?
- **Reliability:** Is activation atomic? What happens if channel activation succeeds but org status update fails?
- **Self-Serve Integrity:** Does any readiness check require founder action to satisfy (e.g., `meta-ads-token` requiring manual OAuth)?

Log finding if: any blocking check is unsatisfiable by the user, activation isn't atomic, or go-live requires manual DB update.

- [ ] **Step 6: Trace first inbound message end-to-end**

Read `apps/chat/src/routes/managed-webhook.ts`, `apps/chat/src/adapters/whatsapp.ts` (parseIncomingMessage, verifyRequest), `packages/core/src/channel-gateway/channel-gateway.ts`, `apps/chat/src/gateway/http-platform-ingress-adapter.ts`, `packages/core/src/platform/platform-ingress.ts`, `packages/core/src/platform/modes/skill-mode.ts`, `packages/core/src/skill-runtime/skill-executor.ts`.

Check:

- **Completeness:** Does the full path from webhook → parse → route → LLM → respond → persist work?
- **Production Reality:** Is the LLM call real (Anthropic API) or mocked? Is the response sent back on the real channel?
- **Security/Multi-tenancy:** Does `resolveByChannelToken()` correctly isolate org routing? Can one org's message reach another org's agent?
- **Reliability:** Is message dedup wired for managed webhooks? What happens on duplicate delivery? What happens if the LLM call fails?
- **Ops Readiness:** Is the message processing logged? Is there a DLQ for failed messages?

Log finding if: dedup not wired, routing has tenant isolation gap, LLM calls are simulated, or failures are silent.

- [ ] **Step 7: Write J1 findings to `docs/audits/2026-04-26-readiness/j1-signup-to-agent-live.md`**

Each finding uses the format:

```
[P0/P1/P2] J1.Step# — Lens
Title: one-line description
Evidence: file:line, code snippet
Customer Impact: what the customer experiences
Fix: what needs to change (scope: hours/days)
```

- [ ] **Step 8: Commit J1 audit report**

```bash
git add docs/audits/2026-04-26-readiness/j1-signup-to-agent-live.md
git commit -m "docs: complete J1 readiness audit — signup to first agent live"
```

---

## Task 2: J2 — Lead → Response → Booking

**Core question:** When a real lead messages on WhatsApp, does the system produce a real booked appointment on a real calendar with attribution tracked end-to-end?

**Production Reality rule:** Any mock/simulated execution at any step = automatic P0.

**Files to trace (in order of execution):**

| Step                     | File(s)                                                                                                                                                                                     | What to check                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Webhook receipt       | `apps/chat/src/routes/managed-webhook.ts`, `apps/chat/src/adapters/whatsapp.ts`                                                                                                             | Signature verification, message parsing, dedup                     |
| 2. Org routing           | `packages/core/src/platform/prisma-deployment-resolver.ts`, `apps/chat/src/managed/runtime-registry.ts`                                                                                     | Token hash lookup, correct org/deployment resolution               |
| 3. Agent conversation    | `packages/core/src/skill-runtime/skill-executor.ts`, `skills/alex.md`, `packages/core/src/skill-runtime/builders/alex.ts`                                                                   | Multi-turn handling, parameter resolution, opportunity requirement |
| 4. Calendar availability | `packages/core/src/skill-runtime/tools/calendar-book.ts`, `apps/api/src/bootstrap/skill-mode.ts` (resolveCalendarProvider)                                                                  | Which provider is active? Noop fallback?                           |
| 5. Booking creation      | `packages/core/src/skill-runtime/tools/calendar-book.ts` (booking.create), `packages/core/src/calendar/google-calendar-adapter.ts`, `packages/core/src/calendar/local-calendar-provider.ts` | Real calendar event? Transaction + outbox?                         |
| 6. Confirmation reply    | `packages/core/src/channel-gateway/channel-gateway.ts` (response extraction), `apps/chat/src/adapters/whatsapp.ts` (sendTextReply)                                                          | Response sent to real channel, persisted                           |
| 7. WorkTrace attribution | `packages/core/src/platform/work-trace-recorder.ts`, `packages/db/src/stores/prisma-work-trace-store.ts`                                                                                    | Trace links to conversation, booking, opportunity                  |
| 8. ROI visibility        | `apps/api/src/routes/roi.ts`, `apps/api/src/routes/dashboard-overview.ts`                                                                                                                   | Dashboard shows booking in funnel counts                           |
| 9. CAPI event            | `packages/ad-optimizer/src/meta-capi-dispatcher.ts`, `apps/api/src/bootstrap/conversion-bus-bootstrap.ts`                                                                                   | Dispatcher wired to ConversionBus? Real Meta API call?             |

- [ ] **Step 1: Trace webhook receipt and message parsing**

Read `apps/chat/src/routes/managed-webhook.ts` and `apps/chat/src/adapters/whatsapp.ts`.

Check all five lenses:

- **Completeness:** Are all WhatsApp message types parsed (text, interactive, media, unsupported)?
- **Production Reality:** Is signature verification enforced or skippable? Does `appSecret` have a fallback?
- **Security:** Is HMAC-SHA256 verification correct per Meta's spec?
- **Reliability:** Is dedup wired for managed webhooks? (Known gap from code map: `deps.dedup` is undefined in `main.ts` line 252)
- **Ops Readiness:** Are webhook failures logged? DLQ for failed processing?

- [ ] **Step 2: Trace org/deployment routing**

Read `packages/core/src/platform/prisma-deployment-resolver.ts` (resolveByChannelToken), `apps/chat/src/managed/runtime-registry.ts`.

Check:

- **Security/Multi-tenancy:** Does token-based routing correctly isolate orgs? Can a crafted token reach a wrong deployment?
- **Reliability:** What happens if the deployment is inactive? What if the channel was recently deprovisioned?
- **Production Reality:** Verify the token hash lookup — does the managed webhook path pass `connectionId` as the token, and does the DB store `sha256(connectionId)` in the `tokenHash` column?

- [ ] **Step 3: Trace agent conversation (Alex skill)**

Read `packages/core/src/skill-runtime/skill-executor.ts`, `skills/alex.md`, `packages/core/src/skill-runtime/builders/alex.ts`.

Check:

- **Completeness:** Is Alex's system prompt complete? Are all tools (crm-query, crm-write, calendar-book, escalate) implemented?
- **Production Reality:** Does `alexBuilder` require an existing opportunity? What happens for a brand-new lead with no prior CRM record?
- **Reliability:** What happens if the Anthropic API returns an error? Is there a fallback response? Budget enforcement?

- [ ] **Step 4: Trace calendar availability and booking creation**

Read `packages/core/src/skill-runtime/tools/calendar-book.ts`, `apps/api/src/bootstrap/skill-mode.ts` (resolveCalendarProvider function), `apps/api/src/bootstrap/noop-calendar-provider.ts`, `packages/core/src/calendar/google-calendar-adapter.ts`, `packages/core/src/calendar/local-calendar-provider.ts`.

Check:

- **Production Reality (automatic P0 if fails):** Which CalendarProvider is active by default? Is `NoopCalendarProvider` the fallback? Does it return empty slots and stub bookings?
- **Completeness:** Does `GoogleCalendarAdapter.createBooking()` return a real booking ID? Does `getBooking()` work?
- **Reliability & State Integrity:** Is booking creation transactional with outbox event? Can a booking be created in DB but not on the calendar? Is there a reconciliation path?
- **Self-Serve Integrity:** Can a user configure their calendar provider through the dashboard, or does it require env vars?

- [ ] **Step 5: Trace booking confirmation and channel reply**

Read `packages/core/src/channel-gateway/channel-gateway.ts` (response extraction and reply), `apps/chat/src/adapters/whatsapp.ts` (sendTextReply).

Check:

- **Completeness:** Is the booking confirmation sent back as plain text or rich message (interactive buttons)?
- **Production Reality:** Is the reply sent via real WhatsApp Cloud API?
- **Reliability:** Retry logic on send failure? What if the WhatsApp API rate limits?

- [ ] **Step 6: Trace WorkTrace and attribution chain**

Read `packages/core/src/platform/platform-ingress.ts` (persistTrace), `packages/core/src/platform/work-trace-recorder.ts`, `packages/db/src/stores/prisma-work-trace-store.ts`.

Check:

- **Completeness:** Does WorkTrace capture the full journey (conversation → tool calls → booking → CAPI)?
- **State Integrity:** Is `workTraceId` linked to the booking record? Can WorkTrace and booking records disagree?
- **Reliability:** Is trace persistence idempotent?

- [ ] **Step 7: Trace CAPI event firing**

Read `packages/ad-optimizer/src/meta-capi-dispatcher.ts`, `apps/api/src/bootstrap/conversion-bus-bootstrap.ts`.

Check:

- **Production Reality (automatic P0 if fails):** Is `MetaCAPIDispatcher` subscribed to the ConversionBus? (Known gap from code map: it's NOT wired)
- **Completeness:** Does the dispatcher correctly map conversion stages to Meta event names?
- **Security:** Is user data (email, phone) properly hashed per Meta's requirements?

- [ ] **Step 8: Trace ROI dashboard data path**

Read `apps/api/src/routes/roi.ts`, `apps/api/src/routes/dashboard-overview.ts`, `packages/db/src/stores/prisma-conversion-record-store.ts`.

Check:

- **Completeness:** Does the dashboard show real funnel data (inquiry → qualified → booked → purchased)?
- **State Integrity:** Does the displayed data match actual WorkTrace and ConversionRecord tables?
- **Security/Multi-tenancy:** Is the ROI endpoint org-scoped?

- [ ] **Step 9: Write J2 findings to `docs/audits/2026-04-26-readiness/j2-lead-to-booking.md`**

- [ ] **Step 10: Commit J2 audit report**

```bash
git add docs/audits/2026-04-26-readiness/j2-lead-to-booking.md
git commit -m "docs: complete J2 readiness audit — lead to booking"
```

---

## Task 3: J3 — Trial → Paid → Enforcement

**Core question:** Is billing state always consistent with app state? Can a user ride free or get phantom-charged?

**Files to trace:**

| Step                  | File(s)                                                                                                            | What to check                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| 1. Free signup access | `apps/api/src/routes/` (all route files), `apps/dashboard/src/middleware.ts`                                       | What's gated? What's free?          |
| 2. Checkout           | `apps/api/src/services/stripe-service.ts` (createCheckoutSession), `apps/api/src/routes/billing.ts`                | Trial setup, price ID handling      |
| 3. Payment webhook    | `apps/api/src/routes/billing.ts` (webhook handler), `apps/api/src/services/stripe-service.ts` (handleWebhookEvent) | State sync, event coverage          |
| 4. Feature gating     | Search codebase for subscription/plan checks                                                                       | Any enforcement layer?              |
| 5. Cancel/downgrade   | `apps/api/src/services/stripe-service.ts`                                                                          | Webhook handling, feature lockdown  |
| 6. Reconciliation     | Search for Stripe polling, sync, or catch-up logic                                                                 | Any reconciliation beyond webhooks? |

- [ ] **Step 1: Trace free signup — what's accessible without paying?**

Search all API route files for any middleware or guard that checks `subscriptionStatus`, `stripePriceId`, or plan tier before allowing access.

Check:

- **Completeness:** Is there any feature gating layer? (Known gap: none exists per code map)
- **State Integrity:** What prevents a user with `subscriptionStatus: "canceled"` from using all features?
- **Self-Serve Integrity:** Is the free tier clearly defined and enforced, or is everything implicitly free?

- [ ] **Step 2: Trace Stripe checkout flow**

Read `apps/api/src/services/stripe-service.ts` (createCheckoutSession), `apps/api/src/routes/billing.ts` (checkout endpoint).

Check:

- **Production Reality:** Does checkout create a real Stripe session? Is `STRIPE_SECRET_KEY` required? What happens if not set?
- **Completeness:** Is the pricing tier from the pricing page passed through signup to checkout? (Known gap: it's not)
- **Reliability:** What happens if checkout succeeds on Stripe but the webhook fails?

- [ ] **Step 3: Trace payment webhook handling**

Read `apps/api/src/routes/billing.ts` (webhook handler), `apps/api/src/services/stripe-service.ts` (handleWebhookEvent).

Check:

- **Security:** Is webhook signature verified? Is the raw body used for verification (not parsed JSON)?
- **Reliability:** Which events are handled? Are there events that Stripe sends but aren't handled? Is webhook processing idempotent?
- **State Integrity:** Does the webhook handler update all relevant fields atomically? Can Stripe and app state diverge?

- [ ] **Step 4: Check for feature gating enforcement**

Search codebase-wide for: `subscriptionStatus`, `stripePriceId`, `plan`, `tier`, `billing-guard`, `plan-guard`, `subscription-check`.

Check:

- **Completeness:** Does any middleware, guard, or check enforce plan limits?
- **Customer Impact:** Can a canceled user still operate agents?

- [ ] **Step 5: Trace cancel/downgrade path**

Read `apps/api/src/services/stripe-service.ts` for `customer.subscription.deleted` and `customer.subscription.updated` handlers.

Check:

- **Reliability:** On cancellation, are agents paused? Channels deactivated? Or does nothing happen?
- **State Integrity:** Is `subscriptionStatus` the single source of truth? Can the dashboard show "active" while Stripe says "canceled"?

- [ ] **Step 6: Check for Stripe reconciliation**

Search for any scheduled job, cron, or startup hook that syncs Stripe subscription state with the app. Also check `apps/api/src/bootstrap/inngest.ts` for any reconciliation cron that covers billing (the existing `runReconciliation` function covers revenue attribution — verify if it also covers Stripe subscription state).

Check:

- **Reliability:** What happens if a webhook is lost? Is there a catch-up mechanism?
- **State Integrity:** Can Stripe say "canceled" while the app says "active"? Is there any periodic verification?
- **Ops Readiness:** Can an operator manually trigger a Stripe sync?

- [ ] **Step 7: Check billing page in dashboard**

Search for `apps/dashboard/src/app/settings/billing/page.tsx` or `apps/dashboard/src/app/(authenticated)/settings/billing/page.tsx`.

Check:

- **Completeness:** Does the billing management page exist? Can users view their plan, upgrade, manage payment?
- **Self-Serve Integrity:** Can a user manage their subscription without contacting the founder?

- [ ] **Step 8: Write J3 findings to `docs/audits/2026-04-26-readiness/j3-trial-to-paid.md`**

- [ ] **Step 9: Commit J3 audit report**

```bash
git add docs/audits/2026-04-26-readiness/j3-trial-to-paid.md
git commit -m "docs: complete J3 readiness audit — trial to paid"
```

---

## Task 4: J4 — Operator Monitors → Intervenes

**Core question:** Can the owner see truthful data, control agent behavior, and get alerted when things go wrong — all through the dashboard?

**Files to trace:**

| Step                   | File(s)                                                                                                            | What to check                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1. Conversation list   | `apps/api/src/routes/conversations.ts`, `apps/dashboard/src/hooks/use-conversations.ts`                            | Real data, auto-refresh, org-scoped           |
| 2. Conversation detail | `apps/api/src/routes/conversations.ts` (detail endpoint)                                                           | Full message history, timestamps              |
| 3. Override            | `apps/api/src/routes/conversations.ts` (override endpoint), `packages/core/src/channel-gateway/channel-gateway.ts` | Override stops agent, owner can reply         |
| 4. Escalation          | `apps/api/src/routes/escalations.ts`, `packages/core/src/notifications/proactive-sender.ts`                        | Notification delivery works, reply flow works |
| 5. Performance/ROI     | `apps/api/src/routes/roi.ts`, `apps/api/src/routes/dashboard-overview.ts`                                          | Data reflects truth, not stale cache          |
| 6. Emergency halt      | `apps/api/src/routes/governance.ts` (halt + resume)                                                                | Full lifecycle, reflected in UI               |

- [ ] **Step 1: Trace conversation list — truth and scope**

Read `apps/api/src/routes/conversations.ts` (list endpoint).

Check:

- **Security/Multi-tenancy:** Is the query filtered by `orgId`? Can one org see another's conversations?
- **Production Reality:** Does the list show real conversations from the database, or is there any mock/demo data?
- **Ops Readiness:** Is there pagination? What happens with 10,000+ conversations?

- [ ] **Step 2: Trace conversation detail**

Read `apps/api/src/routes/conversations.ts` (detail endpoint with `buildConversationDetail`).

Check:

- **Completeness:** Does it show full message history with roles (user/assistant/system)?
- **State Integrity:** Do displayed messages match what's in the conversation store? Are tool calls/results included?
- **Security:** Is the conversation scoped to the requesting org?

- [ ] **Step 3: Trace override mechanism**

Read `apps/api/src/routes/conversations.ts` (PATCH override), `packages/core/src/channel-gateway/channel-gateway.ts` (human_override check).

Check:

- **Completeness:** Does override stop the agent immediately? Can the owner inject a response?
- **Reliability:** Is there a race condition between override and in-flight agent response?
- **Production Reality:** Does override work on real channels, not just in test mode?

- [ ] **Step 4: Trace escalation notification delivery**

Read `apps/api/src/routes/escalations.ts`, `packages/core/src/notifications/proactive-sender.ts`, `packages/core/src/notifications/notification-classifier.ts`.

Check:

- **Production Reality:** Do notifications actually send (Telegram/email/WhatsApp)? Or is there a mock path?
- **Self-Serve Integrity:** Can a user configure their notification channel (email, Telegram chat ID) through the dashboard?
- **Reliability:** What happens if notification delivery fails? Is there a retry?

- [ ] **Step 5: Trace performance/ROI data accuracy**

Read `apps/api/src/routes/roi.ts`, `apps/api/src/routes/dashboard-overview.ts`.

Check:

- **State Integrity:** Does the funnel data match actual conversion records? Are the numbers derived from the same source of truth?
- **Security/Multi-tenancy:** Is ROI data org-scoped?
- **Ops Readiness:** Is there a data freshness indicator? Can the user tell if data is stale?

- [ ] **Step 6: Trace emergency halt lifecycle**

Read `apps/api/src/routes/governance.ts` (halt and resume endpoints).

Check:

- **Completeness:** Does halt pause all deployments and ad campaigns? Does resume run readiness checks?
- **Reliability:** What happens if halt succeeds for deployments but fails for ad campaigns? Is it atomic?
- **Ops Readiness:** Are halt/resume events in the audit log?

- [ ] **Step 7: Write J4 findings to `docs/audits/2026-04-26-readiness/j4-operator-controls.md`**

- [ ] **Step 8: Commit J4 audit report**

```bash
git add docs/audits/2026-04-26-readiness/j4-operator-controls.md
git commit -m "docs: complete J4 readiness audit — operator controls"
```

---

## Task 5: J5 — Day-2 Ops

**Core question:** Can the system sustain itself in production? Does it self-heal, alert, and recover without founder intervention?

**Files to trace:**

| Step                | File(s)                                                                                                                | What to check                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1. Token refresh    | `apps/api/src/services/cron/meta-token-refresh.ts`, `apps/api/src/bootstrap/inngest.ts`                                | Cron runs, refresh works, failure notifies           |
| 2. Health endpoints | `apps/api/src/app.ts` (/health), `apps/api/src/routes/health.ts` (/api/health/deep), `apps/chat/src/main.ts` (/health) | Real component checks, correct 503 on degraded       |
| 3. Sentry           | `apps/api/src/bootstrap/sentry.ts`, `apps/dashboard/sentry.client.config.ts`                                           | All services covered? Chat server gap?               |
| 4. Logging          | `apps/api/src/app.ts` (Pino config), `apps/chat/src/main.ts` (Pino config)                                             | Structured, no secret leaks, filterable              |
| 5. Backups          | Search for pg_dump, backup scripts, or DB backup cron                                                                  | Any automated backup?                                |
| 6. Deploy           | `docker-compose.yml`, `Dockerfile`, `docs/DEPLOYMENT-CHECKLIST.md`                                                     | Zero-downtime deploy path? Health check integration? |
| 7. Redis failure    | `apps/api/src/app.ts` (Redis init), `apps/chat/src/main.ts` (Redis init)                                               | Graceful degradation or hard crash?                  |
| 8. Rate limiting    | `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/app.ts` (fastify rate-limit)                                    | Auth routes protected, webhook routes protected      |

- [ ] **Step 1: Trace Meta token refresh cron**

Read `apps/api/src/services/cron/meta-token-refresh.ts`, `apps/api/src/bootstrap/inngest.ts` (registration and deps).

Check:

- **Completeness:** Does the cron run daily? Does it refresh tokens within 7 days of expiry?
- **Production Reality:** Does it call real Meta token exchange API?
- **Reliability:** What happens on refresh failure? Is the connection marked `needs_reauth`? Is the operator notified?
- **Ops Readiness:** Is the cron registered and will it actually fire in production (Inngest service required)?

- [ ] **Step 2: Trace health endpoints**

Read `apps/api/src/app.ts` (GET /health), `apps/api/src/routes/health.ts` (GET /api/health/deep), `apps/chat/src/main.ts` (GET /health).

Check:

- **Completeness:** Do health checks cover all critical dependencies (DB, Redis, queue)?
- **Production Reality:** Do checks actually query the dependency (not just check if client exists)?
- **Reliability:** Do checks have timeouts? Does a slow DB query block the health endpoint?
- **Ops Readiness:** Does Docker healthcheck use these endpoints? Is 503 returned on degraded?

- [ ] **Step 3: Trace Sentry integration coverage**

Read `apps/api/src/bootstrap/sentry.ts`. Check if chat server (`apps/chat/`) has Sentry.

Check:

- **Completeness:** Is Sentry wired in API, dashboard, AND chat server? (Known gap: chat server has no Sentry)
- **Production Reality:** Are errors captured with enough context (traceId, URL, method)?
- **Self-Serve Integrity:** Is `SENTRY_DSN` documented as required for production?

- [ ] **Step 4: Trace logging for secret leaks**

Read `apps/api/src/app.ts` (Pino config). Search for any log statements that might include tokens, passwords, or API keys.

Check:

- **Security:** Are request/response bodies logged? Could they contain tokens?
- **Ops Readiness:** Is `LOG_LEVEL` configurable? Is structured JSON the default in production?

- [ ] **Step 5: Check database backup automation**

Search for: `pg_dump`, `backup`, `snapshot`, `cron.*backup` in the codebase.

Check:

- **Ops Readiness:** Is there any automated backup mechanism? (Known gap: none exists)
- **Self-Serve Integrity:** Is the deployment documentation clear that managed database backups are required?

- [ ] **Step 6: Trace deployment path**

Read `docker-compose.yml` (or `docker-compose.prod.yml`), any Dockerfile files, `docs/DEPLOYMENT-CHECKLIST.md`.

Check:

- **Completeness:** Does the deploy path cover all 3 services + DB + Redis?
- **Reliability:** Is there a zero-downtime deploy strategy? Health check integration with container orchestrator?
- **Self-Serve Integrity:** Can a non-founder follow the deployment checklist and get a running system?

- [ ] **Step 7: Trace Redis failure behavior**

Read `apps/api/src/app.ts` and `apps/chat/src/main.ts` for Redis initialization and error handling.

Check:

- **Reliability:** Does Redis failure crash the server or degrade gracefully? Which features depend on Redis (rate limiting, idempotency, dedup, BullMQ)?
- **Ops Readiness:** Is Redis failure reflected in the health endpoint?

- [ ] **Step 8: Trace rate limiting coverage**

Read `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/app.ts` (fastify rate-limit plugin).

Check:

- **Security:** Are auth endpoints (login, register, reset) rate-limited more strictly?
- **Completeness:** Is webhook ingress rate-limited? Are there any unprotected endpoints?

- [ ] **Step 9: Write J5 findings to `docs/audits/2026-04-26-readiness/j5-day2-ops.md`**

- [ ] **Step 10: Commit J5 audit report**

```bash
git add docs/audits/2026-04-26-readiness/j5-day2-ops.md
git commit -m "docs: complete J5 readiness audit — day-2 ops"
```

---

## Task 6: Synthesis — Go/No-Go Verdict

**Core question:** Can all P0s be resolved within the 1-month window? What's the minimum viable launch surface?

**Files:**

- Read: All 5 journey reports in `docs/audits/2026-04-26-readiness/`
- Create: `docs/audits/2026-04-26-readiness/synthesis.md`

- [ ] **Step 1: Collect all P0 findings across journeys**

Read all 5 journey audit reports. Extract every P0 finding into a summary table:

```markdown
| #   | Finding | Journey | Lens | Fix Scope |
| --- | ------- | ------- | ---- | --------- |
```

- [ ] **Step 2: Build State Integrity Map**

Document which state layers can disagree and where reconciliation exists:

| State Layer A        | State Layer B      | Can Disagree? | Reconciliation? |
| -------------------- | ------------------ | ------------- | --------------- |
| Stripe billing       | OrganizationConfig | ?             | ?               |
| Booking (DB)         | Google Calendar    | ?             | ?               |
| ConversionRecord     | WorkTrace          | ?             | ?               |
| DeploymentConnection | ManagedChannel     | ?             | ?               |

- [ ] **Step 3: Build Self-Serve Integrity Report**

List every step across all journeys that requires founder intervention:

```markdown
| Journey.Step | What requires intervention | Type (env var / manual setup / admin action) |
```

- [ ] **Step 4: Build Production Reality Report**

List every path that uses mock/simulate/noop execution:

```markdown
| Path | Mock/Noop Used | Intentional Degradation? | Impact |
```

- [ ] **Step 5: Write Go/No-Go Verdict**

Answer:

1. How many P0s total?
2. Can all P0s be fixed within 1 month?
3. What's the critical path (dependency-ordered P0 fixes)?
4. What's the minimum viable launch surface if some P0s need descoping?
5. Final verdict: GO / NO-GO / CONDITIONAL GO (with conditions)

- [ ] **Step 6: Write synthesis to `docs/audits/2026-04-26-readiness/synthesis.md`**

Structure:

```markdown
# Self-Serve Readiness Audit — Synthesis

## Go/No-Go Verdict

[verdict and rationale]

## P0 Summary Table

[all P0s with fix scope and dependency order]

## Critical Path

[ordered list of P0 fixes with dependencies]

## State Integrity Map

[which state layers can disagree]

## Self-Serve Integrity Report

[steps requiring founder intervention]

## Production Reality Report

[paths using mock/noop execution]

## P1 Summary

[trust-degrading issues, fix within first week]

## P2 Backlog

[polish items]
```

- [ ] **Step 7: Commit synthesis**

```bash
git add docs/audits/2026-04-26-readiness/synthesis.md
git commit -m "docs: complete readiness audit synthesis — go/no-go verdict"
```

---

## Known Findings from Code Map (Pre-Audit)

These were surfaced during codebase exploration. They must be verified during the audit proper — not assumed correct. Each will be confirmed or corrected when the relevant journey step is traced.

| Candidate Finding                                           | Journey | Needs Verification                                     |
| ----------------------------------------------------------- | ------- | ------------------------------------------------------ |
| Onboarding page may not exist on this branch                | J1.3    | Check if page.tsx exists under any route group         |
| `skillSlug` not set during `onboard.ts` deployment creation | J1.3    | Verify if another endpoint sets it                     |
| WhatsApp Embedded Signup not built (manual creds only)      | J1.4    | Confirm no self-serve channel setup UI                 |
| `NoopCalendarProvider` is default fallback                  | J2.4    | Verify provider resolution logic                       |
| `MetaCAPIDispatcher` not wired to ConversionBus             | J2.9    | Verify no subscriber exists                            |
| WhatsApp managed webhook dedup not wired                    | J2.1    | Verify `deps.dedup` is undefined                       |
| No feature gating by billing plan                           | J3.4    | Search for any enforcement layer                       |
| No Stripe state reconciliation beyond webhooks              | J3.6    | Search for polling/sync mechanism                      |
| No Sentry in chat server                                    | J5.3    | Verify no @sentry import in apps/chat                  |
| No database backup automation                               | J5.5    | Search for backup scripts                              |
| `stepActionExecutor` returns failure for all actions        | J1.5    | Verify stub at app.ts line 229                         |
| Email verification is advisory not blocking                 | J1.2    | Verify readiness check `email-verified` blocks go-live |
