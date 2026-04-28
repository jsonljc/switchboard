# fix/launch-billing-feature-gating — Design

**Branch:** `fix/launch-billing-feature-gating`
**Launch blocker:** #11 (`.audit/08-launch-blocker-sequence.md` lines 266–284)
**Effort:** M (half day)
**Date:** 2026-04-28

## Scope

**Paid / trial / beta entitlement enforcement.** No free plan. No usage metering.

Switchboard is a revenue operator that touches leads, bookings, ads, CRM state, and customer conversations. There is no free usage tier. Every real business action requires entitlement: an active paid subscription, an active trial, or an explicit manual override (internal beta, comped pilot, manually approved exception).

The system asks one question: **is this org entitled to execute paid mutable actions?** It does not ask "which plan?" or "how many conversations remain?"

## Problem

Today the `billingGuard` middleware in `apps/api/src/middleware/billing-guard.ts` only enforces three URL prefixes (`/api/agents/deploy`, `/api/creative-pipeline`, `/api/ad-optimizer`). The remaining ~50 mutating route files are unguarded, and `PlatformIngress.submit()` — the doctrinal mutation chokepoint per `CLAUDE.md` — has no entitlement check at all. Chat, MCP, cron, Inngest, and any future surface can mutate customer state regardless of subscription status.

The existing middleware also models billing as `free | starter | pro | scale` tiers, which encodes a free-usage model the product does not offer.

## Entitlement model

**Allowed (entitled):**

- `subscriptionStatus IN ("active", "trialing")`
- `entitlementOverride = true` (regardless of subscription status)

**Blocked:**

- `subscriptionStatus IN ("none", "canceled", "past_due", "incomplete", "unpaid")`
- Any unknown status value
- Missing `OrganizationConfig` row

`incomplete` is explicitly blocked. Until Stripe confirms `trialing` or `active`, the org cannot execute paid mutable actions; it can still access onboarding, auth, and billing routes to complete checkout.

## Design

### 1. Schema change — `entitlementOverride`

Add to `OrganizationConfig` in `packages/db/prisma/schema.prisma`:

```prisma
/// Manual override that allows an org to execute paid mutable actions without
/// an active Stripe subscription. Intended for internal beta, comped pilots,
/// or manually approved exceptions.
entitlementOverride Boolean @default(false)
```

Migration in the same commit. Default `false` so existing orgs are unaffected unless explicitly flagged. For controlled beta (~10 orgs), the flag is set via SQL or Prisma Studio; no admin UI in this branch.

**Field name rationale:** `entitlementOverride` covers internal beta, founder-assisted setup, partner pilots, comped access, and future enterprise exceptions in one durable concept. It avoids the narrower "comped" framing.

### 2. Core entitlement primitive — `BillingEntitlementResolver`

New interface in `packages/core` (no `packages/db` import):

```ts
// packages/core/src/billing/entitlement-resolver.ts
export interface OrganizationEntitlement {
  organizationId: string;
  entitled: boolean;
  reason: "active" | "trialing" | "override" | "blocked";
  blockedStatus?: string; // e.g. "canceled", "past_due"
}

export interface BillingEntitlementResolver {
  resolve(organizationId: string): Promise<OrganizationEntitlement>;
}
```

The resolution helper is a pure function so both the route layer and the ingress layer share identical logic:

```ts
// packages/core/src/billing/is-entitled.ts
export function evaluateEntitlement(input: {
  subscriptionStatus: string;
  entitlementOverride: boolean;
}): OrganizationEntitlement;
```

Allowed statuses: `active`, `trialing`. Override forces `entitled: true` regardless of status.

A Prisma-backed implementation lives in `packages/db` (or wired in apps; see Layering note) and is injected into PlatformIngress and the Fastify guard.

**Layering note:** `packages/db` already depends on `packages/core`, so the Prisma adapter belongs in `packages/db/src/billing/prisma-entitlement-resolver.ts` and is constructed in apps during bootstrap.

### 3. PlatformIngress integration

`PlatformIngressConfig` gains an optional `entitlementResolver?: BillingEntitlementResolver`. When present, `submit()` calls it as **step 1.5** — after intent lookup, before governance:

```
0. Idempotency check
1. Lookup intent
1.5. Entitlement check (NEW) → return entitlement_required IngressError if blocked
2. Validate trigger
3. Resolve deployment + mode
4. Governance gate
...
```

New `IngressError` variant:

```ts
{ type: "entitlement_required"; intent: string; message: string; blockedStatus?: string }
```

The check uses `request.organizationId` (already on `CanonicalSubmitRequest`). Because the resolver is optional, existing tests that construct `PlatformIngress` without one keep passing; production wiring always provides it.

### 4. Fastify route guard rewrite

`apps/api/src/middleware/billing-guard.ts` is rewritten to **deny-by-default on mutating verbs** with an explicit public allowlist.

**Allowlist (always passes regardless of entitlement):**

- All `GET` and `HEAD` requests (read-only)
- `/health`, `/health/*`
- `/api/auth/*`, `/api/sessions/*`
- `/api/setup/*`, `/api/onboard*` (pre-subscription onboarding)
- `/api/billing/*` (Stripe checkout, portal, status — users must reach these to subscribe)
- `/api/webhooks/*` (signed external callbacks; auth handled separately)

**Everything else with `POST | PUT | PATCH | DELETE` requires entitlement.** Blocked orgs get `402 Payment Required`:

```json
{
  "error": "Active subscription required",
  "statusCode": 402,
  "blockedStatus": "canceled"
}
```

Removed: `BillingTier`, `resolveTier`, `PAID_ROUTE_PREFIXES`, `STRIPE_PRICE_*` env-var resolution. No tier concept remains in this branch.

### 5. Dual enforcement is intentional

Both layers stay:

- **Route preHandler** = early UX-friendly 402 for HTTP callers
- **PlatformIngress** = canonical safety boundary catching chat, MCP, cron, Inngest, and any future surface

They share `evaluateEntitlement`, so the rule lives in one place. Cost is one extra DB read per mutating request — acceptable for ~10 beta orgs, trivially cacheable later (out of scope).

## Acceptance criteria

1. `OrganizationConfig.entitlementOverride Boolean @default(false)` migration committed.
2. `BillingEntitlementResolver` interface + `evaluateEntitlement` helper exist in `packages/core`. Prisma-backed adapter exists in `packages/db` and is wired into `apps/api` and any other ingress consumers.
3. `PlatformIngress.submit()` rejects blocked orgs with `entitlement_required` IngressError. Test proves a `canceled` org cannot submit through ingress; an `active` org can; an org with `entitlementOverride = true` and `subscriptionStatus = "none"` can.
4. Fastify guard rewritten to deny-by-default on mutating verbs. Integration test proves:
   - `canceled` org → 402 on a mutating route (e.g., `POST /api/actions`)
   - `active` org → passes
   - `trialing` org → passes
   - `entitlementOverride = true` org → passes regardless of status
   - `incomplete` org → 402
   - `past_due` org → 402
   - GET request → passes regardless of status
   - Allowlisted route (`POST /api/billing/checkout`, `POST /api/setup/...`, signed webhook) → passes regardless of status
5. Existing `BillingTier` / `resolveTier` / `PAID_ROUTE_PREFIXES` machinery removed.
6. No usage counters, quotas, monthly resets, or dashboard quota UI introduced.

## Out of scope (explicitly deferred)

- Free-tier usage metering, conversation quotas, monthly reset semantics — **deleted, not deferred**. Switchboard does not have a free plan.
- Tier-differentiated feature gating (pro-only features, scale-only features).
- Admin UI for toggling `entitlementOverride` (set via SQL / Prisma Studio for beta).
- Caching the entitlement read (one DB hit per mutating request is fine at beta scale).
- Surfacing entitlement status / trial-end countdown in the dashboard UI.
- Graceful upgrade messaging / paywall UX beyond the 402 response body.

## Risks & mitigations

- **Risk:** A mutating route in the allowlist accidentally exposes paid functionality.
  **Mitigation:** Allowlist is small and explicit. Code review checks any future addition.
- **Risk:** `entitlementOverride` is set incorrectly and grants access broadly.
  **Mitigation:** Defaults to `false`. Set per-org by hand for ~10 beta orgs. Future admin tooling out of scope.
- **Risk:** PlatformIngress test surface grows; existing tests construct `PlatformIngress` without a resolver.
  **Mitigation:** Resolver is optional in `PlatformIngressConfig`; absence = no entitlement check (preserves existing test behavior). Production wiring always provides it.
- **Risk:** Cron / Inngest jobs that submit to PlatformIngress hit the guard and fail silently.
  **Mitigation:** Audit ingress callers during implementation. System jobs that mutate customer/business state on behalf of an org **must still pass that org's entitlement check** — there is no generic system-actor bypass.

## Invariant: no generic system bypass

`actor.kind = "system"` (or any equivalent shorthand) **must not** short-circuit the entitlement resolver. Every real business action needs entitlement, regardless of which surface triggered it — HTTP route, chat, MCP, cron, Inngest, or future ingress.

If a specific internal maintenance job truly needs to run without entitlement (e.g., billing reconciliation that itself has to act on `canceled` orgs to clean up state), it must be explicitly allowlisted by **job/action name** and only for work that does not mutate customer/business state. The allowlist lives next to the resolver, is reviewed in code review, and is not implicitly granted by actor type.

This invariant exists because a generic system bypass becomes the next launch blocker: it creates a backdoor that any future caller can claim by setting `actor.kind = "system"`, recreating the problem this branch is fixing.

## Open implementation questions (for the plan, not the spec)

- Exact list of PlatformIngress callers and, for each, which org's entitlement is being checked (the org being acted on, not the actor's org if different).
- Whether any maintenance job legitimately needs name-allowlisted bypass — and if so, the explicit list (expected to be empty or near-empty at launch).
- Whether `apps/chat` constructs its own `PlatformIngress` or shares the API's instance — affects how the resolver is wired.
- Where to register the public-allowlist constant (likely a typed export from the guard module so it's easy to audit).
