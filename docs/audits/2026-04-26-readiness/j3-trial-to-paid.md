# J3: Trial → Paid → Enforcement — Readiness Audit

> **Audit date:** 2026-04-26
> **Auditor:** Claude
> **Spec:** docs/superpowers/specs/2026-04-26-self-serve-readiness-audit-design.md

## Findings

---

### [P0] J3.1 — Completeness

**No feature gating exists anywhere in the codebase**

**Evidence:** Exhaustive search of all route files in `apps/api/src/routes/` for `subscriptionStatus`, `stripePriceId`, `requirePlan`, `planGuard`, `featureGate`, `checkSubscription`, `requireSubscription`, `usageLimit`, `planLimit`. Only `apps/api/src/routes/billing.ts` references these fields, and only to read/write them — never to gate access. No middleware in `apps/api/src/middleware/` checks subscription state. Every API endpoint (`/api/actions`, `/api/marketplace`, `/api/conversations`, `/api/agents`, etc.) is registered in `apps/api/src/bootstrap/routes.ts:49-94` without any billing guard.

**Customer Impact:** A user who signs up but never pays has unlimited access to every feature: deploying agents, running conversations, using the ad optimizer, creative pipeline, WhatsApp integration — everything. The entire billing system is cosmetic. Stripe Price IDs and subscription status are stored in the database but never consulted before allowing operations.

**Fix:** Build a billing enforcement middleware that checks `organizationConfig.subscriptionStatus` before allowing access to paid features. Must define which endpoints are free-tier vs paid, and reject requests from orgs with `subscriptionStatus = "none"` or `"canceled"`. (scope: 2-3 days)

---

### [P0] J3.2 — Production Reality

**Stripe webhook cannot receive events — blocked by auth middleware**

**Evidence:** The webhook route is registered at `/api/billing/webhook` (`apps/api/src/bootstrap/routes.ts:89`). The auth middleware (`apps/api/src/middleware/auth.ts:74-84`) only exempts these paths: `/health`, `/metrics`, `/docs`, `/docs/*`, `/api/setup/*`. All other paths require a `Bearer` token in the `Authorization` header. Stripe's webhook POST requests do not include a Bearer token — they include a `stripe-signature` header. The webhook handler at `apps/api/src/routes/billing.ts:142-239` correctly validates this signature, but the request will be rejected with 401 by the auth middleware before the handler is ever reached.

**Customer Impact:** After completing Stripe checkout, the webhook that stores `stripeCustomerId`, `stripeSubscriptionId`, and `subscriptionStatus` in the app database will never fire. The organization record will remain at `subscriptionStatus: "none"` forever, regardless of what Stripe says. The billing status page will always show "No Subscription".

**Fix:** Add `/api/billing/webhook` to the auth middleware exclusion list in `apps/api/src/middleware/auth.ts:76-84`. (scope: 15 minutes)

---

### [P0] J3.3 — Production Reality

**Raw body not available for Stripe signature verification**

**Evidence:** The webhook handler at `apps/api/src/routes/billing.ts:165` accesses `request.rawBody`, and the route config includes `{ rawBody: true }` at line 146. However, Fastify does not support `rawBody` natively — it requires either `@fastify/raw-body` plugin or a custom content type parser. Neither is installed: `apps/api/package.json` contains no `raw-body` dependency, and `apps/api/src/app.ts` has no raw body parser registration. The `config: { rawBody: true }` setting on line 146 is a no-op — it's route-level metadata that Fastify stores but does not act on without the plugin.

At runtime, `request.rawBody` will be `undefined`, causing the handler to return HTTP 500 with `"Raw body not available"` (line 167-170). Even if auth were fixed, signature verification would fail.

**Customer Impact:** Stripe webhook processing is completely non-functional. No subscription state transitions (checkout completion, trial end, payment failure, cancellation) will ever be recorded in the application database.

**Fix:** Install `@fastify/raw-body` and register it in `apps/api/src/app.ts` before route registration. (scope: 30 minutes)

---

### [P0] J3.4 — State Integrity

**Stripe and app state can permanently diverge with no reconciliation**

**Evidence:** The only mechanism to sync Stripe state into the app database is the webhook handler (`apps/api/src/routes/billing.ts:189-235`). There is no Stripe-specific reconciliation cron. The existing `reconciliation.ts` cron (`apps/api/src/services/cron/reconciliation.ts:29-69`) is a general-purpose reconciliation that returns a stub "healthy" result (lines 195-206 in `apps/api/src/bootstrap/inngest.ts`) — it does not query Stripe.

If a webhook is missed (network glitch, deployment during event delivery, webhook endpoint down), the app will never self-correct. There is no startup hook, scheduled job, or manual endpoint that calls `stripe.subscriptions.retrieve()` to verify state.

**Customer Impact:** A paying customer could be stuck showing "No Subscription" indefinitely if the checkout webhook was missed. A canceled customer could retain paid status if the deletion webhook was missed. There is no admin tooling to trigger a re-sync.

**Fix:** Add a Stripe reconciliation cron (or startup check) that calls `stripe.subscriptions.retrieve()` for orgs with a `stripeSubscriptionId` and reconciles `subscriptionStatus`, `stripePriceId`, `currentPeriodEnd`. (scope: 1 day)

---

### [P1] J3.5 — State Integrity

**Billing status API response shape does not match dashboard client expectations**

**Evidence:** The API returns at `apps/api/src/routes/billing.ts:133-138`:

```typescript
{
  subscriptionStatus: orgConfig.subscriptionStatus,
  currentPlan: orgConfig.stripePriceId ?? null,
  trialEndsAt: orgConfig.trialEndsAt?.toISOString() ?? null,
  currentPeriodEnd: orgConfig.currentPeriodEnd?.toISOString() ?? null,
}
```

The dashboard client at `apps/dashboard/src/lib/api-client/billing.ts:4-11` expects:

```typescript
{
  subscriptionId: string | null;
  status: "active" | "trialing" | "past_due" | "canceled" | "none";
  planName: string | null;
  priceId: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
}
```

Key mismatches: (1) API sends `subscriptionStatus`, client expects `status`; (2) API sends `currentPlan`, client expects `priceId`; (3) API sends `trialEndsAt`, client expects `trialEnd`; (4) client expects `cancelAtPeriodEnd` and `planName` — API does not return either; (5) client expects `subscriptionId` — API does not return it.

The billing page at `apps/dashboard/src/app/(auth)/settings/billing/page.tsx:152` checks `billing.status !== "none"` and line 178 checks `billing.status === "trialing"` — both will be `undefined` since the API sends `subscriptionStatus` not `status`.

**Customer Impact:** The billing page will never show the current subscription summary card, even with a valid subscription. The `hasSubscription` check on line 152 will always be false because `billing.status` will be undefined. Users see only plan selection cards, with no way to know their current plan status.

**Fix:** Align the API response shape with the client type definition. Return `status` instead of `subscriptionStatus`, `priceId` instead of `currentPlan`, `trialEnd` instead of `trialEndsAt`, and add `cancelAtPeriodEnd`, `planName`, and `subscriptionId` to the response. (scope: 1 hour)

---

### [P1] J3.6 — Completeness

**No cancelAtPeriodEnd field in database schema**

**Evidence:** The Prisma schema at `packages/db/prisma/schema.prisma:422-427` defines `OrganizationConfig` with billing fields: `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`, `subscriptionStatus`, `trialEndsAt`, `currentPeriodEnd`. There is no `cancelAtPeriodEnd` column.

The webhook handler at `apps/api/src/routes/billing.ts:203-209` stores `subscriptionStatus`, `stripePriceId`, `currentPeriodEnd`, and `trialEnd` on subscription update — but silently drops `cancelAtPeriodEnd` (extracted at `apps/api/src/services/stripe-service.ts:96` but never persisted).

The dashboard billing page at `apps/dashboard/src/app/(auth)/settings/billing/page.tsx:183-190` displays cancel-at-period-end messaging, but the value can never reach it.

**Customer Impact:** When a user cancels (set to cancel at period end), the billing page will never show "Subscription will cancel at end of billing period" — the data is lost in transit.

**Fix:** Add `cancelAtPeriodEnd Boolean @default(false)` to `OrganizationConfig` in Prisma schema, persist it in the webhook handler, and return it in the status endpoint. (scope: 1 hour)

---

### [P1] J3.7 — Completeness

**Cancellation has no side effects — agents/channels remain active**

**Evidence:** The webhook handler for `customer.subscription.deleted` at `apps/api/src/routes/billing.ts:201-218` only updates billing metadata fields (`subscriptionStatus`, `stripePriceId`, `currentPeriodEnd`). It does not:

- Disable active agent deployments
- Disconnect WhatsApp/Telegram channels
- Pause scheduled cron jobs for the org
- Notify the operator

The `subscriptionStatus` is set to `"canceled"` (from Stripe) but since no feature gating exists (see J3.1), the change is purely informational.

**Customer Impact:** After cancellation, the customer's agents continue to operate, consuming LLM tokens and sending messages indefinitely. The platform bears cost for non-paying users with no enforcement mechanism.

**Fix:** Add cancellation side effects in the webhook handler: set agent deployments to `paused`/`inactive` status, notify the operator, and enforce the feature gate (depends on J3.1 fix). (scope: 1-2 days)

---

### [P1] J3.8 — Reliability

**Webhook handler has no idempotency protection**

**Evidence:** The webhook handler at `apps/api/src/routes/billing.ts:189-235` processes every valid Stripe event and writes to the database. There is no check for whether an event has already been processed. Stripe explicitly documents that webhooks may be delivered more than once. The `event.id` (e.g., `evt_xxx`) is available from the parsed event but is never stored or checked.

While the current writes are "last write wins" (overwriting the same fields with the same values), this could cause issues with: (a) concurrent processing of the same event; (b) out-of-order delivery where an older event overwrites a newer state.

**Customer Impact:** Low risk today since writes are idempotent by nature of overwriting the same fields. However, out-of-order delivery (e.g., `subscription.updated` arriving after `subscription.deleted`) could reactivate a canceled subscription.

**Fix:** Store processed event IDs in a `StripeWebhookEvent` table and skip duplicates. For subscription events, compare `event.created` timestamp to prevent stale overwrites. (scope: 4 hours)

---

### [P1] J3.9 — Self-Serve Integrity

**Stripe Price IDs require manual environment variable configuration**

**Evidence:** The billing page at `apps/dashboard/src/app/(auth)/settings/billing/page.tsx:22-58` defines three plans with prices sourced from environment variables: `NEXT_PUBLIC_STRIPE_PRICE_STARTER`, `NEXT_PUBLIC_STRIPE_PRICE_PRO`, `NEXT_PUBLIC_STRIPE_PRICE_SCALE`. Line 60: `const stripeConfigured = PLANS.some((p) => p.priceId !== "")`.

If none of these env vars are set (which is the case in any fresh deployment), `stripeConfigured` is `false` and the billing page shows a placeholder: "Billing will be available soon. You're on the free beta right now." (lines 121-139).

The `STRIPE_SECRET_KEY` is also required server-side (`apps/api/src/services/stripe-service.ts:11-12`), and `STRIPE_WEBHOOK_SECRET` for webhooks (`apps/api/src/services/stripe-service.ts:71`).

**Customer Impact:** Without Stripe configuration (4 env vars minimum), the entire billing flow is invisible. The page degrades gracefully to "free beta" mode, but there is no in-app path to configure Stripe — it requires environment variable access.

**Fix:** This is expected for a SaaS product (Stripe config is operator setup), but document the required env vars clearly in deployment docs. Consider a setup wizard check that flags missing billing config. (scope: 2 hours)

---

### [P2] J3.10 — Ops Readiness

**No billing-related logging or metrics**

**Evidence:** The webhook handler at `apps/api/src/routes/billing.ts:189-235` performs database writes but emits no structured log entries for successful processing. There are no Prometheus counters for webhook events received, processed, or failed. The checkout and portal routes similarly have no operational logging beyond Fastify's default request logging.

Compare this to the ad optimizer cron (`apps/api/src/bootstrap/inngest.ts:130-143`) which creates audit task records, or the reconciliation cron which logs activity.

**Customer Impact:** When a customer reports "I paid but my dashboard still says free", there are no logs to trace whether the webhook was received, processed, or failed. Debugging requires manual Stripe dashboard inspection.

**Fix:** Add structured logging (event type, org ID, old/new status) on every webhook state change. Add Prometheus counters for `stripe_webhook_received_total{event_type}` and `stripe_webhook_processed_total{event_type}`. (scope: 2 hours)

---

### [P2] J3.11 — Security

**Webhook endpoint requires auth but should be public**

**Evidence:** This is the same root cause as J3.2 but from the security lens. The webhook route at `/api/billing/webhook` is protected by API key auth (`apps/api/src/middleware/auth.ts:74-84`) when it should rely solely on Stripe signature verification (`apps/api/src/services/stripe-service.ts:73`). The Stripe signature is the correct authentication mechanism for webhooks — requiring an additional API key means Stripe cannot call the endpoint.

Currently this "over-protection" manifests as a complete failure (401 for all webhook requests). If the auth exclusion is added, the webhook will correctly rely on `constructEvent()` signature verification, which is the industry-standard approach.

**Customer Impact:** Same as J3.2 — webhook is unreachable.

**Fix:** Same as J3.2 — exempt `/api/billing/webhook` from auth middleware. The signature verification in the handler is the correct security boundary.

---

## Summary

| Severity | Count | Key Theme                                                                             |
| -------- | ----- | ------------------------------------------------------------------------------------- |
| P0       | 4     | No enforcement layer, webhook completely broken, no reconciliation                    |
| P1       | 5     | Response shape mismatch, missing schema field, no cancel side effects, no idempotency |
| P2       | 2     | No observability, auth overlap                                                        |

**Verdict:** The entire J3 journey is non-functional. The billing plumbing (Stripe service, webhook handler, dashboard page) exists structurally but cannot execute in production due to three independent P0 blockers: (1) the webhook is blocked by auth, (2) raw body parsing is not configured, and (3) even if webhooks worked, there is zero feature gating. The billing system is purely cosmetic — it can record subscription state but never enforces it.

**Status: DONE**
