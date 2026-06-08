# F-02: Fresh org is `entitled: false` — every mutating action is 402'd, and no producer ever entitles it

- **Severity:** blocks-pilot
- **Journey/step:** inventory
- **Verdict:** DORMANT
- **Location:** `packages/core/src/billing/entitlement.ts:14`; enforced at `packages/core/src/platform/platform-ingress.ts:196-205` and `apps/api/src/middleware/billing-guard.ts:71` (HTTP 402 at `:74`); `apps/api/src/utils/ingress-error-to-reply.ts:22` (ingress path also 402); wired at `apps/api/src/app.ts:676,878` (verified against main on 2026-06-07)
- **Evidence:**
  - `entitlement.ts`: `evaluateEntitlement` returns `entitled:false reason:"blocked"` unless `entitlementOverride` true OR `subscriptionStatus ∈ {active, trialing}`.
  - Schema defaults (`schema.prisma:444,449`): `subscriptionStatus @default("none")`, `entitlementOverride @default(false)`.
  - Only writer of `subscriptionStatus="trialing"/active` is the Stripe webhook `apps/api/src/routes/billing.ts:223,231`. No signup/seed/provision path sets it — grep of `provision-dashboard-user.ts`, `organizations.ts`, `seed-org-day-one-agents.ts`, `seed.ts` for `subscriptionStatus|entitlementOverride|trialing` returns nothing.
  - Stripe is off at prod defaults (`.env.example`: `STRIPE_SECRET_KEY=` empty, `NEXT_PUBLIC_STRIPE_ENABLED=` empty), so there is no live path for a fresh org to reach `active`/`trialing`.
  - Enforcement is wired, not optional in prod: `app.ts:650-676` constructs `PrismaBillingEntitlementResolver` and passes it as `entitlementResolver`; `app.ts:877-878` registers `billingGuard`. `platform-ingress.ts:195` comment: "every real action checks the org's entitlement."

## What was exercised

Read `evaluateEntitlement`, the ingress enforcement block, and the billing-guard middleware. Traced the only producers of `subscriptionStatus`. Confirmed bootstrap wires both the resolver and the HTTP guard. Checked Stripe env defaults.

## What happened vs expected

Expected: a freshly signed-up pilot org can take mutating actions (book, send, approve) out of the box, or a trial/override is granted at signup. Observed: a fresh org has `subscriptionStatus="none"`, `entitlementOverride=false` ⇒ `entitled:false`. Every `PlatformIngress.submit()` returns `entitlement_required` (HTTP 402 via `ingress-error-to-reply.ts:22`), and every mutating HTTP route outside the public allowlist returns 402 via `billing-guard.ts:74`. With Stripe disabled there is no producer that flips the org to entitled — the org is permanently blocked.

## Suggested fix scope

Grant entitlement at provisioning for pilot orgs (set `subscriptionStatus="trialing"` or `entitlementOverride=true` in `provisionDashboardUser`/`organizations.ts` signup), or gate the pilot behind a manual override runbook step. Add a test asserting a freshly provisioned org passes `evaluateEntitlement`.
