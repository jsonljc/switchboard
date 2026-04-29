# Launch-Blocker Sequence

**Date:** 2026-04-27
**Sources:** .audit/07-refactor-plan.md + 2026-04-26 self-serve-readiness-audit-design.md + 2026-04-26 launch-readiness-fix-program-design.md
**Mandate:** Self-serve launch readiness. Architecture-quality findings are post-launch. Reconciliation of two audit streams into a single ordered fix sequence.

---

## Self-Serve Customer Journey

1. **Signup / Org Creation** — Register email, password, provision org, API key
2. **Channel Connect** — Add WhatsApp/Telegram, verify credentials, set webhook
3. **Agent Deployment** — Select Alex skill, configure tone, set readiness checks to pass
4. **First Action** — Inbound message → agent converses → proposes booking/escalation
5. **Outcome Tracking & Attribution** — Booking recorded, CAPI event fired, dashboard shows result
6. **Billing / Metering** — Stripe checkout, subscription enforced, usage limits gated
7. **Operator Escalation / DLQ Visibility** — Override messages, escalations delivered, failed jobs visible
8. **Audit Trail** — Compliance-driven; WorkTrace canonical; post-launch concern, not day-1

---

## Findings by Journey Stage

**Legend:** LAUNCH-BLOCKER / LAUNCH-RISK / POST-LAUNCH / DROPPED

| Finding                                                                            | Stage | Priority    | Source                   |
| ---------------------------------------------------------------------------------- | ----- | ----------- | ------------------------ |
| Webhook path mismatch (provisioned routes don't match handler)                     | 2     | BLOCKER     | FIX-PROGRAM P0-1         |
| WhatsApp Embedded Signup routes not registered                                     | 2     | BLOCKER     | FIX-PROGRAM P0-3         |
| No webhook auto-registration with Meta                                             | 2     | BLOCKER     | FIX-PROGRAM P0-2         |
| Provision-notify never called (chat server not informed)                           | 2     | BLOCKER     | FIX-PROGRAM P0-4         |
| lastHealthCheck never set for WhatsApp                                             | 2     | BLOCKER     | FIX-PROGRAM P0-5         |
| Alex listing seed data required for provision                                      | 2     | BLOCKER     | FIX-PROGRAM P0-6         |
| Alex skill parameter builder not registered                                        | 3     | BLOCKER     | FIX-PROGRAM P0-7         |
| No contact/opportunity auto-creation for new leads                                 | 4     | BLOCKER     | FIX-PROGRAM P0-8         |
| Calendar provider produces fake/incomplete bookings (NoopCalendarProvider default) | 4     | BLOCKER     | FIX-PROGRAM P0-9         |
| MetaCAPIDispatcher not wired to ConversionBus                                      | 5     | BLOCKER     | FIX-PROGRAM P0-10        |
| No feature gating by billing plan                                                  | 6     | BLOCKER     | FIX-PROGRAM P0-11        |
| Stripe webhook blocked by auth                                                     | 6     | BLOCKER     | FIX-PROGRAM P0-12        |
| Raw body not available for webhook signature verification                          | 6     | BLOCKER     | FIX-PROGRAM P0-13        |
| No Stripe reconciliation (webhook loss = permanent state divergence)               | 6     | BLOCKER     | FIX-PROGRAM P0-14        |
| Escalation reply never delivered to channel                                        | 7     | BLOCKER     | FIX-PROGRAM P0-15        |
| No Sentry on chat server + no alerting on failures                                 | 7     | BLOCKER     | FIX-PROGRAM P0-16        |
| Creative-pipeline violates DOCTRINE §7 (no dead-letter on job exhaustion)          | 7     | BLOCKER     | REFACTOR-PLAN P0         |
| Governance errors swallowed in critical path                                       | 7     | BLOCKER     | REFACTOR-PLAN P0         |
| WorkTrace lacks cryptographic integrity                                            | 8     | BLOCKER     | REFACTOR-PLAN P0         |
| ConversationState direct Prisma, no Store abstraction                              | 1     | RISK        | REFACTOR-PLAN P1         |
| AgentDeployment governance bypass via updateMany                                   | 3     | RISK        | REFACTOR-PLAN P1         |
| Ad-optimizer outcome dispatcher idempotency incomplete                             | 5     | RISK        | REFACTOR-PLAN P1         |
| ApprovalLifecycle parallel persistence to WorkTrace                                | 8     | RISK        | REFACTOR-PLAN P1         |
| Chat approval binding hash not verified (asymmetry with API)                       | 4     | RISK        | REFACTOR-PLAN P2         |
| Rate limits not per-endpoint (approval/execute share with reads)                   | 2     | RISK        | REFACTOR-PLAN P2         |
| Policy conflict resolution untested                                                | 8     | RISK        | REFACTOR-PLAN P2         |
| Credential decryption failures silent in cron                                      | 5     | RISK        | REFACTOR-PLAN P2         |
| Non-atomic provisioning (password hash, channel state)                             | 2     | RISK        | FIX-PROGRAM P1           |
| Email verification silent degradation                                              | 2     | RISK        | FIX-PROGRAM P1           |
| appSecret marked optional but required for delivery                                | 2     | RISK        | FIX-PROGRAM P1           |
| Org creator gets operator role only (missing admin/approver)                       | 1     | RISK        | FIX-PROGRAM P1           |
| Readiness check mapping fragile to onboarding output                               | 3     | RISK        | FIX-PROGRAM P1           |
| Calendar provider is global singleton (not per-org)                                | 4     | RISK        | FIX-PROGRAM P1           |
| LocalCalendarProvider overlap query not org-scoped                                 | 4     | RISK        | FIX-PROGRAM P1           |
| Booking confirmation has no delivery guarantee                                     | 4     | RISK        | FIX-PROGRAM P1           |
| WorkTrace fire-and-forget (no retry on persist failure)                            | 5     | RISK        | FIX-PROGRAM P1           |
| ConversionRecord lacks booking linkage                                             | 5     | RISK        | FIX-PROGRAM P1           |
| Dashboard TypeScript strictness gap (122 suppressions)                             | —     | POST-LAUNCH | REFACTOR-PLAN P3         |
| Orphaned Stores in db layer (zero callers)                                         | —     | POST-LAUNCH | REFACTOR-PLAN P3         |
| Env var documentation drift (5 undocumented vars)                                  | —     | POST-LAUNCH | REFACTOR-PLAN P3         |
| cartridge-sdk removal gated on Phase 4                                             | —     | POST-LAUNCH | REFACTOR-PLAN P3         |
| e2e testing framework absent (0 E2E tests)                                         | —     | POST-LAUNCH | REFACTOR-PLAN excluded   |
| Creative-pipeline governance convergence                                           | —     | POST-LAUNCH | DECISIONS.md §3 deferred |

---

## Launch-Blockers (ordered)

### 1. **Webhook URL mismatch blocks channel activation**

**Problem:** Provisioned channels receive `/webhooks/whatsapp/{uuid}` paths but HTTP handler only serves `/webhook/managed/:id`. Webhook auto-registration fails or arrives at wrong endpoint.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain A, P0-1
- FIX-PROGRAM: "Provisioned channels get `/webhooks/whatsapp/{uuid}` paths but the HTTP handler only serves `/webhook/managed/:id`"

**Effort:** S (< 2h)

**Dependencies:** None. Unblocks channel connection flow.

**Branch slug:** `fix/launch-webhook-provisioning`

**Acceptance:** Provisioned webhook URL format matches the managed-webhook handler route pattern; integration test confirms webhook POST succeeds.

---

### 2. **WhatsApp Embedded Signup routes not registered**

**Problem:** `whatsappOnboardingRoutes` defined but never imported in bootstrap. Self-serve channel setup UI is unreachable (404).

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain A, P0-3
- FIX-PROGRAM: "`whatsappOnboardingRoutes` is defined but never imported in route bootstrap"

**Effort:** S (< 2h)

**Dependencies:** None.

**Branch slug:** `fix/launch-whatsapp-onboarding-routes`

**Acceptance:** `/whatsapp/onboard` and related Embedded Signup endpoints return 200 (not 404); integration test verifies route availability.

---

### 3. **No webhook auto-registration with Meta (manual setup fallback)**

**Problem:** Provisioning creates DB records but never calls Meta Graph API to subscribe webhook. User must manually configure webhook URL in Meta Developer Console — not self-serve.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain A, P0-2
- FIX-PROGRAM: "Provisioning creates DB records but never calls Meta's webhook subscription API"

**Effort:** M (half day)

**Dependencies:** None. Blocks self-serve channel provisioning unless operator manually configures.

**Branch slug:** `fix/launch-meta-webhook-subscription`

**Acceptance:** After channel creation, webhook subscription API is called to Meta. If `META_SYSTEM_USER_TOKEN` unavailable, clear instructions provided; webhook still must be manually registered but process is explicit.

---

### 4. **Provision-notify never called (chat server not informed)**

**Problem:** API server never notifies chat server about new channels via `/internal/provision-notify`. Chat runtime doesn't know about provisioned channels; messages fail to route.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain A, P0-4
- FIX-PROGRAM: "API server never notifies chat server about new channels via `/internal/provision-notify`"

**Effort:** M (half day)

**Dependencies:** #1, #2 (webhook registration).

**Branch slug:** `fix/launch-provision-notify`

**Acceptance:** After channel provision, chat server `/internal/provision-notify` is called with channel details; integration test verifies chat server receives and registers channel.

---

### 5. **lastHealthCheck never set (readiness check fails)**

**Problem:** Readiness check requires `lastHealthCheck !== null` for WhatsApp, but no flow sets it. Agent cannot go live even after valid credentials.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain A, P0-5
- FIX-PROGRAM: "Readiness check requires `lastHealthCheck !== null` for WhatsApp, but no flow sets it"

**Effort:** S (< 2h)

**Dependencies:** #2 (Embedded Signup exists).

**Branch slug:** `fix/launch-whatsapp-health-check`

**Acceptance:** After successful credential test, `lastHealthCheck` is set on Connection. Readiness check passes for valid, tested credentials.

---

### 6. **Alex listing seed data required (provisioning blocks)**

**Problem:** Provision fails with "Run database seed first" if Alex listing doesn't exist. Not self-serve; requires manual founder action.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain A, P0-6
- FIX-PROGRAM: "Provision fails with 'Run database seed first' if Alex listing doesn't exist"

**Effort:** S (< 2h)

**Dependencies:** None.

**Branch slug:** `fix/launch-alex-listing-auto-create`

**Acceptance:** Provision succeeds on empty database; Alex listing is auto-created via upsert if missing. No manual seed required.

---

### 7. **Alex skill parameter builder not registered**

**Problem:** `alexBuilder` exported but never registered in `BuilderRegistry`. Skill execution fails to resolve business context; agent doesn't work.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain B, P0-7
- FIX-PROGRAM: "`alexBuilder` is exported but never registered in `BuilderRegistry`"

**Effort:** S (< 2h)

**Dependencies:** None. Unblocks first-message execution.

**Branch slug:** `fix/launch-alex-builder-registration`

**Acceptance:** `alexBuilder` registered in skill-mode bootstrap. Integration test verifies skill execution resolves business context.

---

### 8. **No contact/opportunity auto-creation (first lead fails)**

**Problem:** `alexBuilder` throws `ParameterResolutionError("no-active-opportunity")` for new leads with no CRM record. First inbound message fails; no booking possible.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain B, P0-8
- FIX-PROGRAM: "`alexBuilder` throws... for new leads... Fix: auto-create Contact and Opportunity"

**Effort:** M (half day)

**Dependencies:** #7 (builder registered).

**Branch slug:** `fix/launch-first-lead-opportunity-creation`

**Acceptance:** First inbound message from new lead auto-creates Contact + Opportunity. Skill execution succeeds; booking flow available.

---

### 9. **Calendar provider is fake/incomplete (NoopCalendarProvider default)**

**Problem:** NoopCalendarProvider returns stub bookings; LocalCalendarProvider sends no confirmation email. Booking appears in system but customer never receives confirmation. Revenue loop broken.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain B, P0-9
- FIX-PROGRAM: "`NoopCalendarProvider` returns fake bookings. `LocalCalendarProvider` creates DB records but sends no calendar invite or email confirmation"

**Effort:** M (half day)

**Dependencies:** #8 (opportunity creation).

**Branch slug:** `fix/launch-calendar-confirmation-email`

**Acceptance:** LocalCalendarProvider sends confirmation email to lead and operator on booking creation. Resend integration confirmed. Calendar setup is mandatory readiness check.

---

### 10. **MetaCAPIDispatcher not wired to ConversionBus**

**Problem:** Fully implemented dispatcher never subscribed to bus. Conversion events not sent to Meta CAPI. No attribution; revenue metrics invisible.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain B, P0-10
- FIX-PROGRAM: "Fully implemented dispatcher never subscribed to ConversionBus"

**Effort:** S (< 2h)

**Dependencies:** None. Unblocks attribution pipeline.

**Branch slug:** `fix/launch-meta-capi-dispatcher-wiring`

**Acceptance:** `MetaCAPIDispatcher` instantiated and subscribed in conversion-bus bootstrap when `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` set. Test verifies dispatcher receives events.

---

### 11. **No feature gating by billing plan**

**Problem:** Free tier users can access all features; paid limits not enforced. Billing revenue uncollectable; usage metrics meaningless.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain C, P0-11
- FIX-PROGRAM: "No feature gating layer; unknown what prevents a user with `subscriptionStatus: canceled` from using features"

**Effort:** M (half day)

**Dependencies:** None. Unblocks billing enforcement.

**Branch slug:** `fix/launch-billing-feature-gating`

**Acceptance:** `billingGuard` middleware checks `subscriptionStatus` on all mutable routes. Free tier gates features (limited conversations); paid tiers grant access. Test verifies guard rejects canceled orgs.

---

### 12. **Stripe webhook blocked by auth**

**Problem:** `/api/billing/webhook` requires Bearer token but Stripe can't send one. Webhook unreachable (401); payment events never processed.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain C, P0-12
- FIX-PROGRAM: "Add `/api/billing/webhook` to auth middleware exclusion list"

**Effort:** S (< 2h)

**Dependencies:** None. Unblocks webhook ingress.

**Branch slug:** `fix/launch-stripe-webhook-auth-bypass`

**Acceptance:** Webhook endpoint is reachable without Bearer token. Integration test verifies endpoint returns 200 for unsigned requests.

---

### 13. **Raw body not available for webhook signature verification**

**Problem:** Stripe signature verification requires raw request body, but parsed JSON body provided instead. Signature check fails; all webhooks rejected.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain C, P0-13
- FIX-PROGRAM: "Install `@fastify/raw-body` and register in app.ts"

**Effort:** S (< 2h)

**Dependencies:** #12 (webhook reachable).

**Branch slug:** `fix/launch-stripe-raw-body-capture`

**Acceptance:** `@fastify/raw-body` registered. Webhook handler accesses `request.rawBody` and successfully verifies Stripe signature. Integration test confirms valid webhook signature passes.

---

### 14. **No Stripe reconciliation (permanent divergence risk)**

**Problem:** Webhook loss = permanent state divergence. If Stripe says "canceled" but app thinks "active", no recovery path exists. Revenue uncollectable; compliance risk.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain C, P0-14
- FIX-PROGRAM: "Add an Inngest cron (daily) that scans orgs with `stripeSubscriptionId`, calls `stripe.subscriptions.retrieve()`, and updates local state if diverged"

**Effort:** M (half day)

**Dependencies:** #11, #12, #13 (billing foundation).

**Branch slug:** `fix/launch-stripe-reconciliation-cron`

**Acceptance:** Daily cron reconciles Stripe subscription state with app OrganizationConfig. Divergences logged and corrected. Test verifies state correction on mock divergence.

---

### 15. **Escalation reply never delivered to channel**

**Problem:** Owner replies to escalation in dashboard (`POST /api/escalations/:id/reply`), but message never sent to WhatsApp/Telegram. Customer sees no response; trust broken.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain D, P0-15
- FIX-PROGRAM: "API server never notifies chat server about new channels via `/internal/provision-notify`. Escalation reply writes to DB but never sends to WhatsApp/Telegram"

**Effort:** M (half day)

**Dependencies:** #1-#4 (channel infrastructure).

**Branch slug:** `fix/launch-escalation-reply-delivery`

**Acceptance:** Owner reply is sent via channel adapter to customer. Only returns `replySent: true` after actual delivery succeeds. Integration test verifies message delivery attempt.

---

### 16. **No Sentry on chat server + no alerting**

**Problem:** Chat server errors go unmonitored. Production failures invisible; no way to diagnose or alert. Operator blind to outages.

**Evidence:**

- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` §Chain C, P0-16
- FIX-PROGRAM: "Add Sentry to chat server following the API server pattern. Add a simple webhook-based alerting integration"

**Effort:** M (half day)

**Dependencies:** None. Unblocks ops visibility.

**Branch slug:** `fix/launch-chat-server-observability`

**Acceptance:** Sentry initialized on chat server (when `SENTRY_DSN` set). Alerting integrated (Slack/email). Test verifies Sentry initialization.

---

### 17. **Governance errors swallowed in critical path**

**Problem:** `platform-ingress.ts` catches governance eval exceptions and silently converts to deny. `platform-ingress.ts` retries trace persist once with console.error fallback. Operators blind to governance engine failures; approvals mysteriously denied.

**Evidence:**

- `.audit/07-refactor-plan.md` §P0 (line 33-37)
- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` (implicit in governance hardening phase)

**Effort:** S (< 2h)

**Dependencies:** None.

**Branch slug:** `fix/launch-governance-error-visibility`

**Acceptance:** Governance eval failures logged to AuditEntry (error_type field). Trace persist retry upgraded to exponential backoff + alerting. Operator receives notification on governance failure.

---

### 18. **Creative-pipeline violates DOCTRINE §7 (no dead-letter)**

**Problem:** `creative-job-runner` Inngest function defines retries=3 but emits no error event on exhaustion. Failed jobs abandoned with no DLQ record or operator notification.

**Evidence:**

- `.audit/07-refactor-plan.md` §P0 (line 26-31)
- FIX-PROGRAM: Strategic importance for ops visibility

**Effort:** M (half day)

**Dependencies:** #17 (governance error visibility wired).

**Branch slug:** `fix/launch-creative-pipeline-dead-letter`

**Acceptance:** On function failure, `.sendEvent()` emits to `creative-pipeline/job.failed` topic. FailedMessageStore records or OutboxEvent wires the DLQ. Test verifies error event on exhaustion.

---

### 19. **WorkTrace lacks cryptographic integrity**

**Problem:** WorkTrace fields (executionOutputs, approvalId) are mutable via `update()` with no hash chain or integrity verification. Tampering post-execution is undetected. Audit ledger trust compromised.

**Evidence:**

- `.audit/07-refactor-plan.md` §P0 (line 19-24)
- `docs/superpowers/specs/2026-04-26-launch-readiness-fix-program-design.md` (implicit high-complexity item deferred)

**Effort:** L (day+)

**Dependencies:** None structurally, but unblocks audit-ledger hardening (P1/P2).

**Branch slug:** `fix/launch-work-trace-immutability`

**Acceptance:** WorkTrace integrity protected via hash chain OR append-only ledger pattern OR immutability enforcement at storage layer. Tampering post-execution is detectable. Test verifies hash validation on read.

---

## Launch-Risks (ordered)

### 1. **ConversationState direct Prisma bypass (governance not audited)**

**Problem:** `apps/api/routes/conversations.ts` queries ConversationState directly via Prisma with no Store indirection. Mutable chat state unguarded; governance-critical state not recorded in WorkTrace.

**Evidence:** `.audit/07-refactor-plan.md` §P1 (line 44-49)

**Effort:** M (half day)

**Dependencies:** None.

**Branch slug:** `fix/launch-conversation-state-store`

**Acceptance:** PrismaConversationStateStore created and wired into routes. Chat state mutations routed through Store indirection. Conversation updates recorded in WorkTrace.

---

### 2. **AgentDeployment updateMany bypass (halt enforcement not audited)**

**Problem:** `apps/api/routes/governance.ts` calls `prisma.agentDeployment.updateMany()` directly for halt/circuit-breaker updates. Mutations bypass PlatformIngress and Store.

**Evidence:** `.audit/07-refactor-plan.md` §P1 (line 51-56)

**Effort:** M (half day)

**Dependencies:** None.

**Branch slug:** `fix/launch-agent-deployment-store-methods`

**Acceptance:** Store.halt() and Store.updateCircuitBreaker() methods created. Governance routes refactored to use them. Halt enforcement auditable via WorkTrace.

---

### 3. **Ad-optimizer outcome dispatcher idempotency incomplete**

**Problem:** `outcome-dispatcher.ts:68` has TODO: event_id synthesis not done. Inngest retries may send duplicate conversion events to Meta.

**Evidence:** `.audit/07-refactor-plan.md` §P1 (line 58-62)

**Effort:** S (< 2h)

**Dependencies:** None.

**Branch slug:** `fix/launch-outcome-dispatcher-idempotency`

**Acceptance:** Deterministic event_id synthesized from (contactId, bookingId, conversionType, timestamp). Duplicate Inngest retries harmless (deduped by Meta on event_id).

---

### 4. **Chat approval binding hash not verified (asymmetry)**

**Problem:** Chat adapters receive `bindingHash` in approval JSON but do not call `validateBindingHash()`. API approvals verify; chat approvals skip verification.

**Evidence:** `.audit/07-refactor-plan.md` §P2 (line 76-80)

**Effort:** S (< 2h)

**Dependencies:** None.

**Branch slug:** `fix/launch-chat-binding-hash-verification`

**Acceptance:** ChannelGateway.ingestApprovalResponse() validates binding hash before PlatformIngress.submit(). Asymmetry eliminated. Test verifies hash rejection on mismatch.

---

### 4a. **Follow-up: Chat Approval Response Identity Binding** _(deferred from Risk 4)_

**Goal:** Enable deterministic approve/reject execution from chat without bypassing responder authorization.

**Required before enabling chat approval execution:**

- Resolve inbound chat sender to Contact.
- Map Contact to authorized responder principal.
- Pass `respondedBy` into the same responder authorization path used by API approvals.
- Share approval response execution helper between API and chat.
- Preserve terminal approval-payload branch: no LLM, no `PlatformIngress.submit`, no normal chat persistence.
- Add lifecycle mutation tests for approve/reject from chat.
- Do not introduce `skipResponderAuth` or channel-possession-only authorization.

**Effort:** M (chat identity → contact → principal → authorization → lifecycle mutation).

**Dependencies:** Risk 4 must ship first (this slice extends the gateway terminal branch into a deterministic lifecycle call once a verified principal exists).

**Branch slug:** `feat/chat-approval-response-identity-binding`

**Acceptance:** Chat approve/reject buttons mutate approval lifecycle state via the same authorization path as the API. Hash match no longer returns the dashboard-handoff message; it executes the approval. No `skipResponderAuth` flag exists in the codebase.

---

### 5. **Rate limits not per-endpoint (approval/execute starved)**

**Problem:** Global rate limit (100 req/min default) applies to all routes. High-frequency reads can exhaust window, starving approval responses and action execution.

**Evidence:** `.audit/07-refactor-plan.md` §P2 (line 83-88)

**Effort:** S (< 2h)

**Dependencies:** None.

**Branch slug:** `fix/launch-per-endpoint-rate-limits`

**Acceptance:** Separate rate limit overrides for `/api/approvals/:id/respond` and `/api/execute`. Env vars `APPROVAL_RATE_LIMIT_MAX` and `EXECUTE_RATE_LIMIT_MAX` configurable. Test verifies approval endpoints can exceed global limit.

---

### 6. **Policy conflict resolution untested**

**Problem:** No test for "two policy rules match with different effects (allow vs deny)". Conflict precedence logic unverified.

**Evidence:** `.audit/07-refactor-plan.md` §P2 (line 90-95)

**Effort:** S (< 2h)

**Dependencies:** None.

**Branch slug:** `fix/launch-policy-conflict-test`

**Acceptance:** Test added: two policies matching at same priority with conflicting effects (allow vs deny). Verify policy-engine.ts deny-loop-break behavior. Test passes.

---

### 7. **Credential decryption failures silent in cron**

**Problem:** `inngest.ts:109` decrypts credentials inside .run() step; errors logged to console.warn but execution continues with null creds. Cron fails at runtime with no DLQ record.

**Evidence:** `.audit/07-refactor-plan.md` §P2 (line 97-102)

**Effort:** S (< 2h)

**Dependencies:** #18 (dead-letter wiring).

**Branch slug:** `fix/launch-credential-decryption-error-handling`

**Acceptance:** Try/catch with `.sendEvent()` to `credential.decryption.failed` topic on decryption failure. FailedMessageStore records. Operator notified. Test verifies error event on decryption failure.

---

## Post-Launch (important but invisible to first cohort)

- **Dashboard TypeScript strictness gap** (122 suppressions) — Add tsconfig inheritance. REFACTOR-PLAN P3.
- **Orphaned Stores in db layer** — Grep for call sites; remove if truly unused. REFACTOR-PLAN P3.
- **Env var documentation drift** (5 undocumented) — Add to .env.example. REFACTOR-PLAN P3.
- **ApprovalLifecycle parallel persistence** — Refactor to use WorkTrace as sole authority; Phase 2 gate. REFACTOR-PLAN P1 (deferred).
- **cartridge-sdk removal** — Blocked on CartridgeMode deprecation (Phase 4). REFACTOR-PLAN P3.
- **e2e testing framework** — Playwright absent; outside audit scope. REFACTOR-PLAN excluded.

---

## Dropped

- **Creative-pipeline governance convergence** — Explicitly deferred to post-launch per DECISIONS.md §3; ad-optimizer is launch-critical. Not surfaced as action item.
- **Dashboard form UX polish** — Outside self-serve readiness scope.
- **API documentation refresh** — Post-launch capability.

---

## Open Questions for the User

1. **First-cohort ramp-up:** Will launch support 10 self-serve orgs or 50+? (Affects which LAUNCH-RISK items become BLOCKER if multi-tenant isolation bugs go undetected.)

2. **Paid from day-1:** Is this launch charging immediately, or freemium with paid upgrade? (Affects WorkTrace integrity (item #19) and billing reconciliation (item #14) criticality.)

3. **Operator involvement scope:** For the first week post-launch, how involved is the founder? If willing to manually intervene on escalations / billing disputes / stuck states, some LAUNCH-RISK items can be monitored-and-fixed instead of pre-fixed.

4. **Audit trail compliance:** Does legal/compliance require cryptographic proof of WorkTrace integrity pre-launch, or is mutable audit trail acceptable for soft launch?

5. **Calendar provider strategy:** Is LocalCalendarProvider (DB bookings + email) sufficient for launch, or must Google Calendar integration be production-ready?

6. **Stripe production keys:** Are STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET set in production environment, or still in development mode?

---

## Recommended Starting Branch

**Start with:** `fix/launch-webhook-provisioning` (blocker #1)

**Rationale:** This unblocks the entire channel connection flow (items #2–#5). Without webhook routing working, provisioning is dead on arrival. Once webhook provisioning is solid, all channel-downstream fixes (#6–#10, availability/confirmation/attribution) build on working infrastructure. Parallel to channel fixes, start the billing enforcement (#11–#14) independently since it has no dependencies on the Happy Path.

**Execution strategy:**

1. Merge blockers #1–#6 (channel provisioning cluster; ~2 days)
2. Merge blockers #7–#10 in parallel (Alex + booking + attribution; ~2 days)
3. Merge blockers #11–#16 in parallel (billing + ops; ~3 days)
4. Run full integration test (signup → booking → Stripe → escalation → CAPI)
5. Merge LAUNCH-RISK items (#1–#7) incrementally during first week (operators can monitor)

**Critical path:** #1 → #2 → #3 → #4 → #5 → #6 (channel stack), then #7 → #8 → #9 → #10 (Alex stack). Billing (#11–#14) and ops (#15–#16) can run parallel to channel/Alex once started.

---

**End of launch-blocker sequence. Ready for implementation planning.**
