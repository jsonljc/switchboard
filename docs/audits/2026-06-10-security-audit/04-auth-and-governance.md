# Audit 2 — Authentication, Authorization & Governance Enforcement

_Question: does the server actually enforce approvals, and can anyone act as the wrong clinic or self-approve? Read-only; traced to code._

## The approval wall is structurally solid (verified)

This is the core product promise, and it holds. In `packages/core/src/platform/platform-ingress.ts`:

- A **denied** action returns before any executor (`:282`).
- An action that **needs approval** is parked and returns before any executor (`:289`).
- Only then is execution dispatched (`:421`).

So the executors are physically unreachable unless governance said "execute." Adversarial paths fail closed: if governance throws, the decision is forced to **deny** (`:257-279`); if deployment resolution fails, it returns before governance; an in-flight idempotency claim returns `idempotency_in_flight` and never re-executes. Governance runs **exactly once** (`:256`) and no execution mode re-evaluates it (verified across all four modes — they receive constraints as an intentionally-unused `_constraints`). **An unapproved action of a normal intent cannot execute.**

The only structural nit: the "execute" branch is the implicit fall-through. Today the outcome type is a closed three-value union so nothing leaks through, but a defensive `else if (outcome === "execute")` + `throw` on anything unexpected would make it future-proof.

## CONFIRMED findings

### F3 — The "verified payment" stamp is forgeable — HIGH (prior audit rated CRITICAL)

This is the headline integrity hole, and it required settling a disagreement between two investigators. **I read the code myself: the payment handler does NOT verify with Stripe.** It derives "verified" purely from a caller-supplied string.

`apps/api/src/payments/resolve-payment-tier.ts:20-25`:

```js
export function resolvePaymentReceiptTier(provider: string): PaymentTierVerdict {
  if (provider === "noop") return { tier: "T3_ADMIN_AUDIT", verified: false, degraded: true };
  return { tier: "T1_FETCH_BACK", verified: true, degraded: false };   // ANY other string → verified:true
}
```

`apps/api/src/bootstrap/operator-intents/record-verified-payment.ts:42-44` calls this on `params.provider` — straight from the request — then writes a `verified:true` revenue event, a `T1` "paid" receipt, and a Meta **`purchased`** conversion event (`:78-120`). The file's own comment (`:12-13`) claims _"Authority is the external PSP fetch-back"_ — but **there is no fetch-back in this handler.** The real Stripe verification lives only in the separate HMAC-protected webhook route.

It's reachable: `POST /api/ingress/submit` (`apps/api/src/routes/ingress.ts:12,37-47`) accepts an arbitrary `intent` and a user actor, gated only by `requireOrgForMutation`. The `payment.record_verified` intent is registered `system_auto_approved`, so governance short-circuits (`governance-gate.ts:100-108`) — no spend check, no human approval.

**Exploit:** a clinic insider (anyone with the org's API key) POSTs `intent:"payment.record_verified"`, `provider:"stripe"`, a made-up `externalReference`, any `amountCents`, against one of their own bookings → the system records a "verified" paid visit **and emits a Meta conversion** with no real charge. **Why it matters:** "verified revenue" is the product's proof-of-value and attribution signal; the fake conversion also pollutes Meta ad optimisation; if billing ever becomes performance-based, it's fraud. **Re-opened** from `docs/audits/2026-06-05-receipted-bookings-architecture` (Critical #1) via this newer intent. **Fix:** derive `verified` from a server-side `retrievePayment(externalReference)` against the PSP, not `params.provider`; restrict the intent to a service/system actor or the webhook route only.

### F4 — No guard stops a financial intent from being auto-approved (spend-cap bypass) — HIGH (latent)

`system_auto_approved` returns `execute` at the **top** of `evaluate()` (`governance-gate.ts:100-108`), before the spend-approval threshold (`:178`) **and** the hard spend-limit floor. A test even pins this as expected behaviour with a `budgetChange: 500` (`governance-gate.test.ts:671-687`). `IntentRegistry.register()` (`intent-registry.ts:7-12`) validates only duplicate names — **nothing prevents a future spend-bearing intent from being registered auto-approved.**

Today this is **not exploitable for ad budget** because no outbound-spend intent is auto-approved (verified: the auto-approved set is non-financial operator actions, inbound money-_recording_, and a no-outbound creative draft). But the safety property "a financial action can never skip its spend cap" is enforced **only by developer convention and code comments.** The prior audit's recommended fix (Riley 7.1 / R1: a registry guard + gate assertion) was **never implemented.** The first developer to wire Riley's budget-change leg via the obvious helper ships an unbounded, no-approval, no-cap budget mutator that passes type-check and tests. **Fix:** implement R1 before any outbound-spend execution leg lands.

### F7 — `ALLOW_SELF_APPROVAL` has no production guardrail — MEDIUM (by-design flag, off by default)

A single global env flag (`app.ts:830`, `approvals.ts:163`, `internal-chat-approvals.ts:60`) lets an action's originator approve their own action. It's documented and off by default. It is **not** a tenant or auth bypass — org isolation and server-derived responder identity still apply. The gap: unlike `DEV_BYPASS_AUTH` (which hard-throws in production), nothing stops `ALLOW_SELF_APPROVAL=true` in production. **Fix:** refuse it in production unless paired with an explicit acknowledgement flag.

## Verified SAFE (the scary auth claims — all refuted for production)

| Suspected weakness                           | Verdict     | Why it's safe                                                                                                                                                                                                      |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `x-org-id` header overrides clinic identity  | **REFUTED** | The override is wrapped in `if (app.authDisabled === true)` (dev only); `authDisabled` is provably unreachable in production                                                                                       |
| Dashboard `DEV_BYPASS_AUTH` works in prod    | **REFUTED** | `assertSafeDashboardAuthEnv()` hard-throws if `NODE_ENV==="production"` (`dev-auth.ts:13-38`)                                                                                                                      |
| API silently runs with auth disabled         | **REFUTED** | Becoming `authDisabled` requires no-keys **and** no-DB **and** non-prod; a prod misconfig _crashes at boot_ (`auth.ts:62-77`) — it fails the safe way                                                              |
| Body `organizationId` impersonation          | **REFUTED** | Prod rejects a body org that differs from the auth org with 400; the auth org is the sole source (`org-access.ts:64-102`)                                                                                          |
| Client-supplied approver / missing org check | **REFUTED** | `respondedBy` is server-derived (403 on mismatch); both approval paths call `assertOrgAccess`; the chat bridge makes `respondedBy` structurally unrepresentable and re-derives the operator from a channel binding |

Notably, every gate escalates to a _stricter_ posture when `NODE_ENV==="production"` — so a Vercel/Render "preview" that reports `production` errs safe (crashes on misconfig) rather than open. This is the opposite of the usual preview-≠-prod hazard.

## Bottom line

The approval wall, the login layer, and cross-tenant write protection are solid and fail closed. The two real governance gaps both involve the **auto-approve fast path**: F3 (a "verified payment" can be faked through it today) and F4 (nothing structurally prevents a money-moving action from using it tomorrow). Both trace back to the same missing guard the prior Riley audit recommended and that was never built.
