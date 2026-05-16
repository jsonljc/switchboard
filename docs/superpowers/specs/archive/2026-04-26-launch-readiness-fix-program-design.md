# Launch Readiness Fix Program — Design Spec

> **Date:** 2026-04-26
> **Status:** Approved
> **Timeline:** 1 month to launch-ready
> **Audit reference:** `docs/audits/2026-04-26-readiness/synthesis.md`
> **Scope:** Fix all 16 P0s + 27 P1s. P2s deferred to backlog.

---

## Goal

Make Switchboard self-serve launch-ready for 10-50 orgs. Fix every P0 (launch blocker) and P1 (trust degrader) identified in the readiness audit. Ship without breaking existing functionality.

---

## Structure

Four independent fix chains, each on its own branch off `main`, each producing its own PR. Chains are named by the customer journey they unblock.

| Chain | Branch                      | Journey                       | P0s | P1s | Scope   |
| ----- | --------------------------- | ----------------------------- | --- | --- | ------- |
| A     | `fix/channel-provisioning`  | J1: Signup → First Agent Live | 6   | 6   | ~3 days |
| B     | `fix/revenue-loop`          | J2: Lead → Response → Booking | 4   | 5   | ~4 days |
| C     | `fix/billing-ops`           | J3 + J5: Billing + Day-2 Ops  | 5   | 13  | ~5 days |
| D     | `fix/operator-intervention` | J4: Operator Controls         | 1   | 8   | ~2 days |

---

## Safety Contract

Every chain PR must:

1. **Pass CI** — `pnpm typecheck && pnpm lint && pnpm test` green before merge
2. **Test every P0** — each P0 fix has at least one test proving the fix works
3. **Test P1s where non-trivial** — logic changes get tests; config/docs changes don't need them
4. **No cross-chain file edits** — each chain only touches files in its scope. If two chains need the same file, the second chain's edit is designed to not conflict (different functions, different lines)
5. **Independently mergeable** — no chain requires another to be merged first
6. **No regressions** — full test suite passes, not just new tests

## Merge Order

A → B → C → D (journey order). Each is independently safe, but this order means each PR builds on the previous customer journey for integration testing.

---

## Chain A: Channel Provisioning — `fix/channel-provisioning`

**Unblocks:** A fresh user can sign up, connect WhatsApp, pass readiness checks, and go live.

### P0 Fixes

#### P0-1: Webhook path mismatch

**Problem:** Provisioned channels get `/webhooks/whatsapp/{uuid}` paths but the HTTP handler only serves `/webhook/managed/:id`.
**Fix:** Change provision route to generate `/webhook/managed/${connectionId}` paths matching the existing handler.
**Files:** `apps/api/src/routes/organizations.ts`
**Test:** Unit test verifying provisioned webhook path matches the managed webhook route pattern.

#### P0-3: WhatsApp Embedded Signup routes not registered

**Problem:** `whatsappOnboardingRoutes` is defined but never imported in route bootstrap.
**Fix:** Add import and registration in `apps/api/src/bootstrap/routes.ts`.
**Files:** `apps/api/src/bootstrap/routes.ts`
**Test:** Integration test verifying `/whatsapp/onboard` returns non-404.

#### P0-2: No webhook auto-registration with Meta

**Problem:** Provisioning creates DB records but never calls Meta's webhook subscription API.
**Fix:** After creating ManagedChannel, call Meta Graph API to subscribe the webhook URL. Gated on having a system user token (`META_SYSTEM_USER_TOKEN`). Falls back to manual setup with clear instructions if token unavailable.
**Files:** `apps/api/src/routes/organizations.ts` or `apps/api/src/routes/whatsapp-onboarding.ts`
**Test:** Unit test with mocked Graph API verifying webhook subscription is called.

#### P0-4: Provision-notify never called

**Problem:** API server never notifies chat server about new channels via `/internal/provision-notify`.
**Fix:** After successful channel provision, POST to chat server's provision-notify endpoint. Handle failure gracefully (log warning, surface in response).
**Files:** `apps/api/src/routes/organizations.ts`
**Test:** Integration test verifying provision-notify is called after channel creation.

#### P0-5: lastHealthCheck never set for WhatsApp

**Problem:** Readiness check requires `lastHealthCheck !== null` for WhatsApp, but no flow sets it.
**Fix:** Update the WhatsApp credential test route to set `lastHealthCheck` on the Connection after a successful Graph API validation.
**Files:** `apps/api/src/routes/whatsapp-test.ts`
**Test:** Unit test verifying `lastHealthCheck` is set after successful credential test.

#### P0-6: Alex listing seed data required

**Problem:** Provision fails with "Run database seed first" if Alex listing doesn't exist.
**Fix:** Auto-create the Alex listing via an upsert if it doesn't exist, triggered during provision. No dependency on manual seed.
**Files:** `apps/api/src/routes/organizations.ts`
**Test:** Unit test verifying provision succeeds on empty database (listing auto-created).

### P1 Fixes

#### P1: Non-atomic provisioning

**Fix:** Move password hash into `provisionDashboardUser` transaction. Make channel provision flow use `prisma.$transaction`.
**Files:** `apps/dashboard/src/app/api/auth/register/route.ts`, `apps/dashboard/src/lib/provision-dashboard-user.ts`, `apps/api/src/routes/organizations.ts`

#### P1: Email verification silent degradation

**Fix:** When `RESEND_API_KEY` is not set, auto-verify the user's email (set `emailVerified: new Date()` on the dashboard user). This ensures the readiness check passes in all environments.
**Files:** `apps/dashboard/src/lib/email.ts` or `apps/dashboard/src/app/api/auth/register/route.ts`

#### P1: appSecret marked as optional but required

**Fix:** Make appSecret required in the channel management UI for WhatsApp. Update label from "(optional)" to "(required for message delivery)". Validate presence before saving.
**Files:** `apps/dashboard/src/components/settings/channel-management.tsx`

#### P1: Org creator gets operator role only

**Fix:** Grant `["operator", "admin", "approver"]` to the first user (org creator) in `provisionDashboardUser`.
**Files:** `apps/dashboard/src/lib/provision-dashboard-user.ts`

#### P1: Readiness check mapping fragile

**Fix:** Add a mapping layer in the readiness check builder that translates onboarding wizard output to readiness-compatible structure. Show individual failing checks with actionable messages in the go-live UI.
**Files:** `apps/api/src/routes/readiness.ts`, `apps/dashboard/src/app/(auth)/onboarding/page.tsx`

#### P1: Provision flow not transactional

**Fix:** Wrap the full provision flow (Connection, ManagedChannel, AgentDeployment, DeploymentConnection) in `prisma.$transaction`.
**Files:** `apps/api/src/routes/organizations.ts`

---

## Chain B: Revenue Loop — `fix/revenue-loop`

**Unblocks:** An inbound WhatsApp lead gets a real agent conversation, books a real appointment, and attribution flows to Meta CAPI + dashboard.

### P0 Fixes

#### P0-7: Alex skill parameter builder not registered

**Problem:** `alexBuilder` is exported but never registered in `BuilderRegistry`.
**Fix:** Register `alexBuilder` in `apps/api/src/bootstrap/skill-mode.ts` during bootstrap.
**Files:** `apps/api/src/bootstrap/skill-mode.ts`
**Test:** Integration test verifying skill execution resolves business context via builder.

#### P0-8: No contact/opportunity auto-creation

**Problem:** `alexBuilder` throws `ParameterResolutionError("no-active-opportunity")` for new leads.
**Fix:** In the builder's resolve function, if no active opportunity exists for the contact, auto-create both a Contact and an Opportunity. Use the WhatsApp phone number as the contact identifier.
**Files:** `packages/core/src/skill-runtime/builders/alex.ts`
**Test:** Unit test verifying first-time lead gets auto-created contact + opportunity.

#### P0-9: Calendar provider produces fake/incomplete bookings

**Problem:** NoopCalendarProvider returns fake bookings. LocalCalendarProvider creates DB records but sends no calendar invite or email confirmation.
**Fix:** Add email confirmation sending to LocalCalendarProvider (use Resend). When a booking is created, send an email to both the lead (if email available) and the operator with booking details. Make calendar setup a mandatory readiness check (at least business hours configured).
**Files:** `packages/core/src/calendar/local-calendar-provider.ts`, new booking confirmation email, `apps/api/src/routes/readiness.ts`
**Test:** Unit test verifying LocalCalendarProvider triggers email confirmation on booking creation.

#### P0-10: MetaCAPIDispatcher not wired

**Problem:** Fully implemented dispatcher never subscribed to ConversionBus.
**Fix:** In `conversion-bus-bootstrap.ts`, instantiate `MetaCAPIDispatcher` when `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` are set, and subscribe it to the bus. Log when CAPI is disabled due to missing config.
**Files:** `apps/api/src/bootstrap/conversion-bus-bootstrap.ts`
**Test:** Unit test verifying dispatcher receives conversion events when wired.

### P1 Fixes

#### P1: Calendar provider is global singleton

**Fix:** Make `resolveCalendarProvider` per-org. Move from bootstrap-time singleton to per-request resolution using org's stored calendar credentials or business hours.
**Files:** `apps/api/src/bootstrap/skill-mode.ts`

#### P1: LocalCalendarProvider overlap query not org-scoped

**Fix:** Add `organizationId` to the `findOverlapping` query.
**Files:** `packages/core/src/calendar/local-calendar-provider.ts`, `apps/api/src/bootstrap/skill-mode.ts`

#### P1: Booking confirmation has no delivery guarantee

**Fix:** Add the outbound booking confirmation to an outbox/retry queue. On send failure, create an escalation.
**Files:** `packages/core/src/channel-gateway/channel-gateway.ts`

#### P1: WorkTrace fire-and-forget

**Fix:** Add a single retry on WorkTrace persistence failure. Emit a metric on permanent failure.
**Files:** `packages/core/src/platform/platform-ingress.ts`

#### P1: ConversionRecord lacks booking linkage

**Fix:** Add `bookingId` as an indexed column on ConversionRecord via Prisma migration.
**Files:** Prisma migration, `packages/db/src/stores/prisma-conversion-record-store.ts`

---

## Chain C: Billing + Ops — `fix/billing-ops`

**Unblocks:** Stripe billing works end-to-end. System can sustain itself in production with monitoring and alerting.

### P0 Fixes

#### P0-12: Stripe webhook blocked by auth

**Fix:** Add `/api/billing/webhook` to auth middleware exclusion list.
**Files:** `apps/api/src/middleware/auth.ts`
**Test:** Integration test verifying webhook endpoint is reachable without Bearer token.

#### P0-13: Raw body not available

**Fix:** Install `@fastify/raw-body` and register in `apps/api/src/app.ts`.
**Files:** `apps/api/package.json`, `apps/api/src/app.ts`
**Test:** Integration test verifying `request.rawBody` is defined on billing webhook route.

#### P0-14: No Stripe reconciliation

**Fix:** Add an Inngest cron (daily, 4 AM UTC) that scans orgs with `stripeSubscriptionId`, calls `stripe.subscriptions.retrieve()`, and updates local state if diverged. Log all corrections.
**Files:** `apps/api/src/services/cron/stripe-reconciliation.ts`, `apps/api/src/bootstrap/inngest.ts`
**Test:** Unit test with mocked Stripe verifying state correction.

#### P0-11: No feature gating

**Fix:** Create a `billingGuard` Fastify plugin that checks `organizationConfig.subscriptionStatus` before allowing access. Define tier gates: free tier gets onboarding + limited conversations; paid tiers get full access. Register on all non-billing, non-public routes.
**Files:** `apps/api/src/middleware/billing-guard.ts`, `apps/api/src/bootstrap/routes.ts`
**Test:** Unit test verifying guard rejects requests from `subscriptionStatus: "canceled"` orgs.

#### P0-16: No Sentry on chat server + no alerting

**Fix:** Add Sentry to chat server following the API server pattern. Add a simple webhook-based alerting integration (Slack/email) triggered by Sentry and health check failures.
**Files:** `apps/chat/src/bootstrap/sentry.ts` (new), `apps/chat/src/main.ts`
**Test:** Unit test verifying Sentry is initialized when `SENTRY_DSN` is set.

### P1 Fixes (13)

#### Billing P1s (5)

- **API response shape**: Align field names with dashboard client type (`status` not `subscriptionStatus`, etc.)
- **cancelAtPeriodEnd**: Add to Prisma schema, persist from webhook, return in API
- **Cancellation side effects**: On `customer.subscription.deleted`, pause active deployments and notify operator
- **Webhook idempotency**: Store processed Stripe event IDs, skip duplicates, compare timestamps for ordering
- **Stripe env var documentation**: Update `docs/DEPLOYMENT-CHECKLIST.md` with required Stripe configuration

#### Ops P1s (8)

- **Token refresh notification**: Send email/dashboard alert when connection transitions to `needs_reauth`
- **Inngest cron heartbeat**: Each cron writes `lastExecuted` timestamp; health endpoint alerts if stale
- **Chat health endpoint**: Reuse shared Redis client, add 3-second timeout matching API pattern
- **Pino log redaction**: Add `redact` paths for authorization headers, API keys, passwords, credentials
- **Redis error handler**: Add `.on("error", ...)` handler, configure `maxRetriesPerRequest`
- **Zero-downtime deploy docs**: Document rolling update strategy for Railway/Fly.io in deployment checklist
- **Nginx TLS placeholder**: Use envsubst in docker-compose entrypoint for DOMAIN substitution
- **Redis-backed auth rate limiter**: Use Redis when available for the sensitive-endpoint rate limiter

---

## Chain D: Operator Intervention — `fix/operator-intervention`

**Unblocks:** Owner can see, control, and communicate through the dashboard. Escalation replies reach the customer.

### P0 Fix

#### P0-15: Escalation reply never delivered to channel

**Problem:** `POST /api/escalations/:id/reply` writes to DB but never sends to WhatsApp/Telegram.
**Fix:** After writing the reply to the conversation, resolve the channel adapter from the conversation's deployment connection, and deliver the message via the adapter. Only return `replySent: true` after actual delivery succeeds. On delivery failure, return `replySent: false` with error details.
**Files:** `apps/api/src/routes/escalations.ts`, new channel delivery helper (or reuse existing adapter resolution from chat server)
**Test:** Integration test with mocked channel adapter verifying message delivery is attempted.

### P1 Fixes (8)

- **Override race condition**: Re-check conversation status after skill execution, before sending reply
- **Operator message endpoint**: Add `POST /api/conversations/:threadId/send` that resolves channel and delivers
- **ProactiveSender wiring**: Either wire into app bootstrap or remove dead `agentNotifier` decoration
- **Email escalation retry**: Record delivery status on handoff, retry via outbox pattern
- **SLA Monitor**: Wire into BullMQ scheduled job, scan pending handoffs, trigger breach notifications
- **Governance auth pattern**: Replace conditional auth check with `requireOrganizationScope` on status/profile endpoints
- **Per-org escalation config**: Move notification channel + approver config from global env vars to `OrganizationConfig` (Prisma migration)
- **Per-org escalation approvers**: Look up org's configured approvers when creating handoff notifications

---

## Cross-Chain File Ownership

To prevent merge conflicts:

| File                                                   | Owner Chain                              | Other chains must not edit                                          |
| ------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------- |
| `apps/api/src/middleware/auth.ts`                      | C                                        | —                                                                   |
| `apps/api/src/bootstrap/routes.ts`                     | A                                        | C adds billing guard registration via plugin, not route-level edits |
| `apps/api/src/bootstrap/skill-mode.ts`                 | B                                        | —                                                                   |
| `apps/api/src/bootstrap/inngest.ts`                    | C                                        | —                                                                   |
| `apps/api/src/routes/organizations.ts`                 | A                                        | —                                                                   |
| `apps/api/src/routes/billing.ts`                       | C                                        | —                                                                   |
| `apps/api/src/routes/escalations.ts`                   | D                                        | —                                                                   |
| `apps/api/src/routes/governance.ts`                    | D                                        | —                                                                   |
| `apps/api/src/routes/conversations.ts`                 | D                                        | —                                                                   |
| `apps/api/src/routes/readiness.ts`                     | A (readiness checks), B (calendar check) | Split: A owns existing checks, B adds calendar-configured check     |
| `apps/api/src/app.ts`                                  | C (raw-body, Pino redaction)             | —                                                                   |
| `apps/chat/src/main.ts`                                | C (Sentry, health fix, log redaction)    | —                                                                   |
| `packages/core/src/channel-gateway/channel-gateway.ts` | B (delivery guarantee)                   | D (override re-check) — non-overlapping edits                       |
| `packages/core/src/platform/platform-ingress.ts`       | B (WorkTrace retry)                      | —                                                                   |

---

## Validation Plan

After all 4 chains merge:

1. **Full CI pass** — typecheck + lint + test + coverage thresholds
2. **Re-run audit J1-J2 steps manually** — trace the signup and booking paths to verify P0s are resolved
3. **Stripe webhook test** — use Stripe CLI to send test events, verify state syncs
4. **Docker compose smoke test** — `docker compose up`, verify all 3 services healthy
5. **Update synthesis.md** — re-evaluate go/no-go verdict with fixes applied

---

## P2 Backlog (not in scope)

23 P2s remain tracked in `docs/audits/2026-04-26-readiness/synthesis.md`. These are polish items that don't block launch or degrade trust. Address post-launch.
