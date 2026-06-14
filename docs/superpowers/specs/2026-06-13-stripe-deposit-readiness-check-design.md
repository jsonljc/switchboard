# Pre-flip deposit-loop Stripe readiness check - design

Date: 2026-06-13
Status: approved (forks resolved autonomously per the requester's standing instruction; rationale recorded inline)
Branch (implementation): `feat/stripe-deposit-readiness`
Author: Claude (Opus 4.8), planning phase

## Problem

The no-PMS deposit loop is code-complete and Noop-proven (settlement #984, issuance
#994, the #999 credential contract, the #1006 provisioning writer, the #1015 redirect
pages), and the issuance-governance posture is resolved (#1016/#1021: issuance stays
autonomous). The remaining live-flip items are operational except one observability gap
that makes the flip dangerous.

`apps/api/src/bootstrap/payment-port-factory.ts` (`resolveForOrg`) fails closed to the
`NoopPaymentAdapter` with only a log line whenever, for an org:

1. there is no connected `stripe` Connection, or
2. the Connection credentials are incomplete (`parseStripeConnectCredentials` returns
   `null`), or
3. `creds.connectedAccountId !== connection.externalAccountId` (the #999 guard).

So an operator can provision a clinic, believe it is live, and not discover it is still
issuing Noop links until a real customer pays and the settlement webhook cannot resolve
the charge. There is no pre-flip way to confirm an org will resolve to the real
`StripeConnectPaymentAdapter`.

This was confirmed end to end against the code. The settlement webhook
(`apps/api/src/routes/payments-webhook.ts`) resolves the org purely by
`Connection.externalAccountId === event.account` with **no status filter**. So a
not-connected (or mis-provisioned) org's real payment would resolve the org, then hit a
`NoopPaymentAdapter` whose `retrievePayment` returns `null` for a charge it never issued,
and the webhook 200-skips `charge_not_found`. The deposit silently never settles. That is
exactly the failure this check closes.

## Goal

A behavior-preserving, tested way to report, per organization, whether live Stripe
deposit issuance will resolve to the real `StripeConnectPaymentAdapter` or fail closed to
Noop, and exactly why, reusing the factory's real decision (no drifting second copy).
Never expose the decrypted Stripe secret.

## Non-goals

- No change to settlement (webhook-only, `retrievePayment` re-fetch authority), the #999
  credential guard logic, the #1006 provisioning writer, the #1015 redirect wiring, or
  the Noop fail-closed posture. A genuinely incomplete or inconsistent provision must
  still resolve to Noop.
- No operator UI. The pilot (10-15 clinics) does not need one.
- No org-entitlement check (see Fork 3).
- No mutation. The check is strictly read-only.

## Verified facts (read against `origin/main` @ 4aba0760)

- **Factory decision** (`payment-port-factory.ts` `resolveForOrg`): queries
  `connection.findFirst({ where: { organizationId, serviceId: "stripe", status:
"connected" }, select: { id, credentials, externalAccountId } })`. On a hit it decrypts,
  parses via `parseStripeConnectCredentials`, and returns the live adapter only when
  `creds && creds.connectedAccountId === connection.externalAccountId`. Every other path
  returns `NoopPaymentAdapter`. The redirect base
  (`PAYMENT_PUBLIC_URL || DASHBOARD_URL || localhost`) is injected by `app.ts` and affects
  only the live adapter's Checkout `success_url`/`cancel_url`; it does **not** change the
  live-vs-Noop decision (a blank base falls back to localhost, still live).
- **The factory's query status filter is load-bearing and pinned.**
  `stripe-provisioning-seam.test.ts` asserts the factory queries with
  `where.serviceId === "stripe" && where.status === "connected"` (a row written with a
  different status would fall through to Noop). The factory query must keep this filter.
- **`decryptCredentials` throws** on a malformed or wrong-key blob (AES-GCM auth failure /
  `JSON.parse`). The factory only ever decrypts a row its query already constrained to
  `status: "connected"`; that must not change.
- **Connection model**: `status String @default("connected")`, `externalAccountId String?`,
  `@@unique([serviceId, organizationId])` (at most one `stripe` Connection per org),
  `@@index([externalAccountId])`. The provisioning writer (#1006) sets
  `status: "connected"` and `externalAccountId := connectedAccountId`.
- **`parseStripeConnectCredentials` (#999)** is imported by exactly one non-test module:
  the factory. No test imports it directly.
- **Env wiring** (`app.ts`): redirect base = `PAYMENT_PUBLIC_URL || DASHBOARD_URL ||
DEFAULT_PAYMENT_REDIRECT_BASE_URL`; webhook verifier requires both `STRIPE_SECRET_KEY`
  and `STRIPE_CONNECT_WEBHOOK_SECRET` (absent either, the payments webhook 503s).
- **No new env var or route.** `PAYMENT_PUBLIC_URL`, `DASHBOARD_URL`,
  `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `CREDENTIALS_ENCRYPTION_KEY`,
  `DATABASE_URL` already exist in `.env.example` and are already in
  `scripts/env-allowlist.local-readiness.json`. The check defines no new route.

## Resolved design forks

### Fork 1 - single source of truth vs drift: extract a shared predicate

**Decision.** Extract the factory's post-query decision into one pure, independently
tested predicate, `classifyStripeReadiness(connection, credentials)`, that BOTH the
factory and the readiness check call. The factory is refactored to **delegate** its
live-vs-Noop decision to this predicate; it keeps its exact query (including
`status: "connected"`, pinned by the seam test) and its redirect-base + adapter
construction. The readiness check calls the same predicate. They cannot diverge because
they run the same code.

A parallel reimplementation that could drift from the factory's real decision is the wrong
answer (`feedback_per_slice_review_misses_cross_slice_seams`). Delegation makes drift
structurally impossible, not merely tested.

Predicate shape (pure, no I/O, never returns the secret):

```ts
export const STRIPE_LIVE_CONNECTION_STATUS = "connected";

export type StripeReadinessReason =
  | "ready"
  | "no_connection"
  | "status_not_connected"
  | "credentials_incomplete"
  | "account_mismatch";

export interface StripeReadinessConnectionView {
  status: string;
  externalAccountId: string | null;
}

export interface StripeReadinessVerdict {
  live: boolean;
  reason: StripeReadinessReason;
  // acct_... identifiers only, for display; never the secret key.
  connectedAccountId: string | null;
  externalAccountId: string | null;
  status: string | null;
}

export function classifyStripeReadiness(
  connection: StripeReadinessConnectionView | null,
  credentials: StripeConnectCredentials | null, // output of parseStripeConnectCredentials
): StripeReadinessVerdict;
```

Gate order (mirrors the factory's real precedence):

1. `connection == null` -> `no_connection`.
2. `connection.status !== STRIPE_LIVE_CONNECTION_STATUS` -> `status_not_connected`.
3. `credentials == null` -> `credentials_incomplete`.
4. `credentials.connectedAccountId !== connection.externalAccountId` -> `account_mismatch`
   (a `null` `externalAccountId` fails this by construction, which is correct: the
   settlement webhook could not resolve such an org).
5. otherwise -> `ready` (`live: true`).

**Why the predicate takes parsed credentials, not raw decrypted creds.** The #999
completeness contract (`parseStripeConnectCredentials`: both `connectedAccountId` and
`secretKey` non-empty) stays the single source of completeness. Callers decrypt and parse
with #999, then pass the parsed result. This avoids a second copy of completeness logic,
avoids a double-parse, and keeps the secret out of the predicate's return value. The
factory needs `secretKey` only to build the live adapter, which it already parses for.

**Why status lives in the predicate even though the factory query also filters it.** The
requester's own output contract enumerates `status_not_connected` as a verdict reason, so
the predicate must produce it. The factory query keeps `status: "connected"` because the
seam test pins it and it (correctly) prevents the factory from ever decrypting a
non-connected row. The shared constant `STRIPE_LIVE_CONNECTION_STATUS` is the single
definition of "connected", referenced by both the factory query and the predicate, so the
value cannot drift. For the factory the predicate's status gate is a confirmed no-op (its
query already guarantees `status: "connected"`); for the readiness check (which queries
more permissively, see Fork 2) it is the live gate.

**Location.** `apps/api/src/payments/stripe-readiness.ts`, next to the #999 contract it
depends on. This keeps #999 exactly where it is (the requester's guardrail) while letting
both the factory (`apps/api/src/bootstrap`) and the CLI (`apps/api`, see Fork 2) import
the predicate by a normal relative import. Putting it in a lower-layer package would force
relocating #999 (it cannot be imported up from `apps/api` into `@switchboard/schemas` or
`@switchboard/db`); that is more change than the guardrail permits.

### Fork 2 - surface: a read-only CLI, no diagnostic route

**Decision.** A single read-only CLI, no HTTP route.

A diagnostic route would need a `route-allowlist.yaml` entry, an auth story, and would put
org ids on the wire. The CLI mirrors the provisioning CLI's posture
(`scripts/provision-stripe-for-org.mts`): it reads the DB, decrypts in-process, prints a
per-org verdict, never prints the secret, takes the org id from a trusted operator
(argv), and needs no route. Smallest correct surface.

**Location.** `apps/api/src/scripts/check-stripe-readiness.ts`, run with
`npx tsx apps/api/src/scripts/check-stripe-readiness.ts [orgId]` in dev, or the compiled
`node apps/api/dist/scripts/check-stripe-readiness.js [orgId]` in a deploy (it builds with
the rest of `apps/api/src`, so it runs with plain node in production where `tsx` may be
absent). It lives in `apps/api` (not root `scripts/`) because it must import the predicate
and the #999 parser, which stay in `apps/api`; root `scripts/` can only import published
`@switchboard/*` packages, and there is no precedent for a root script reaching into app
internals. A `pnpm stripe:readiness` root alias is added for discoverability next to the
provisioning flow.

The script is a thin shell (argv -> Prisma -> fetch -> assemble verdict -> print), guarded
to run only when invoked directly. All non-trivial logic lives in the typechecked, tested
`stripe-readiness.ts` module.

**Modes.**

- `check-stripe-readiness.ts <orgId>`: verdict for one org. Exit 0 iff that org is `ready`
  (live), else exit 1, so a provisioning step can assert success.
- `check-stripe-readiness.ts` (no arg): fleet scan. Reports a verdict for every org that
  has a `stripe` Connection (any status), so the operator sees the whole pilot's readiness
  before the flip. Informational; exit 0. (An org with no `stripe` Connection at all is not
  yet in the deposit pipeline and will not appear; pass its id explicitly to get a
  `no_connection` verdict.)

### Fork 3 - scope boundary: per-org adapter decision + global deploy preconditions, not entitlement

**Decision.** Report the per-org adapter verdict (the core) **and** a separate, clearly
labelled "deployment preconditions" block. Exclude org entitlement.

The per-org verdict answers "will this org resolve to the live adapter." But two
deploy-global conditions decide whether a live org's deposit loop actually closes, and the
requester's output contract explicitly lists the redirect base:

- **Redirect base.** `PAYMENT_PUBLIC_URL || DASHBOARD_URL || localhost`. If it falls back
  to localhost, a live org still resolves to the real adapter but issues Checkout links
  whose `success_url`/`cancel_url` point at localhost, which a real patient cannot use.
  The check reports the effective configured base and warns when it falls back to localhost.
  It mirrors app.ts's resolution exactly: a BARE `||` (so a whitespace-only `PAYMENT_PUBLIC_URL`
  is truthy and shadows `DASHBOARD_URL`) followed by the factory's trim-empty-guard, so the
  fallback is detected when the chosen value trims to empty (neither var set, or a whitespace
  value app.ts picks and the factory then trims to localhost). Reporting `DASHBOARD_URL` as
  used when app.ts actually fell back to localhost would be exactly the false pre-flip
  confidence this tool exists to prevent. It needs no import of the factory's localhost
  constant (which would create a factory <-> readiness import cycle). This is a global
  precondition, not part of the live-vs-Noop verdict, and is labelled as such.
- **Webhook verification.** Both `STRIPE_SECRET_KEY` and `STRIPE_CONNECT_WEBHOOK_SECRET`
  must be set or the payments webhook 503s and no deposit ever settles. The check reports
  each as set/MISSING (never the value).

These are global (identical for every org) and read from `process.env` at CLI runtime, so
the CLI must run in the same environment the API runs in to be meaningful; the output says
so. They do not change the per-org verdict.

**Entitlement is excluded.** It is a different subsystem (governance/entitlements), is not
in the output contract, and would widen the slice past the silent-Noop risk this check
exists to close. Out of scope by YAGNI; noted here so the boundary is deliberate.

### Fork 4 - output contract

Per org, one line: `LIVE` or `NOOP`, the reason, and the `acct_...` identifiers involved
so the verdict is actionable, plus a one-line fix hint. Reasons:

- `ready` -> LIVE (resolves to `StripeConnectPaymentAdapter` on `acct_...`).
- `no_connection` -> NOOP (no `stripe` Connection; run the provisioning CLI).
- `status_not_connected` -> NOOP (`Connection.status` is not `connected`).
- `credentials_incomplete` -> NOOP (missing `connectedAccountId` and/or `secretKey`;
  re-provision).
- `account_mismatch` -> NOOP (`connectedAccountId` != `externalAccountId`; settlement
  could not resolve this org; re-provision so they match).
- `credentials_unreadable` -> NOOP (CLI-only; decrypt threw, e.g. wrong
  `CREDENTIALS_ENCRYPTION_KEY`; run with the API's key). This is surfaced by the CLI's
  decrypt step before the predicate; it is not a predicate reason.

The decrypted secret is never logged, printed, or returned. The CLI prints only
`acct_...` identifiers, the status string, and SET/MISSING booleans for secret env vars.

## Architecture

```
apps/api/src/payments/stripe-connect-credentials.ts   (#999, UNCHANGED)
        |  parseStripeConnectCredentials / StripeConnectCredentials
        v
apps/api/src/payments/stripe-readiness.ts             (NEW, pure, tested)
        |  classifyStripeReadiness, STRIPE_LIVE_CONNECTION_STATUS,
        |  describeReadiness, resolveRedirectPrecondition, resolveWebhookPrecondition,
        |  assembleOrgReadiness
        |
   +----+-----------------------------+
   v                                  v
apps/api/src/bootstrap/               apps/api/src/scripts/
  payment-port-factory.ts (EDIT:      check-stripe-readiness.ts (NEW, thin shell)
  delegate decision to predicate,       argv -> PrismaClient -> connection.findFirst/Many
  keep query + adapter construction)    -> decrypt (guarded) -> parse (#999)
                                        -> classifyStripeReadiness -> print
                                        -> global preconditions from process.env
```

Single source of truth: `classifyStripeReadiness` is the one decision; the factory and the
CLI both call it. `parseStripeConnectCredentials` is the one completeness contract; both
callers parse with it. `STRIPE_LIVE_CONNECTION_STATUS` is the one "connected" value; the
factory query and the predicate both reference it. `DEFAULT_PAYMENT_REDIRECT_BASE_URL` is
the one localhost default; the factory and the CLI both reference it.

## Behavior preservation

The factory must resolve to the identical adapter in the identical cases. Proven by:

- Every existing `payment-port-factory.test.ts` assertion is preserved. The only change is
  the shared fixture helper `makePrismaWithConnection` gains a `status` field defaulting to
  `"connected"` (faithful: the provisioning writer always sets `"connected"`), so the
  predicate's status gate passes for the connected fixtures. Adapter-outcome assertions are
  untouched.
- `stripe-provisioning-seam.test.ts` keeps driving the real writer -> real factory -> real
  decrypt for the live case; its consumer mock row gains `status: "connected"` (faithful).
  It still pins that the factory queries `status === "connected"`.
- New predicate tests cover all five reasons directly.
- A new "agreement" test drives the real factory and the predicate on the same matrix of
  (status, credentials, externalAccountId) inputs and asserts
  `isNoopPaymentAdapter(factory(org)) === !classifyStripeReadiness(view, creds).live`, so
  the factory's adapter choice and the predicate's verdict are pinned to agree.
- The factory still decrypts only `status: "connected"` rows (its query is unchanged), so
  there is no new decrypt-throw exposure.

## Security

- The decrypted secret is never logged, printed, or returned; the CLI prints only
  `acct_...` identifiers and SET/MISSING flags. A test asserts a formatted verdict built
  from credentials containing a sentinel secret does not contain that sentinel.
- `orgId` comes from a trusted operator via argv, never from untrusted input. The DB query
  is org-scoped (`organizationId`, `serviceId: "stripe"`), so no cross-tenant read.
- The CLI guards `decryptCredentials` in try/catch and reports `credentials_unreadable`
  rather than crashing or leaking error internals (mirrors the provisioning CLI's
  message-only error handling).

## Testing strategy (TDD)

`apps/api/src/payments/__tests__/stripe-readiness.test.ts`:

- `classifyStripeReadiness`: null connection; status not connected; null credentials;
  account mismatch; null externalAccountId with valid creds (mismatch); ready.
- `describeReadiness` / formatter: each reason maps to its line; the formatted line for a
  ready verdict built from a sentinel secret never contains the secret.
- `resolveRedirectPrecondition`: PAYMENT_PUBLIC_URL wins; DASHBOARD_URL fallback; localhost
  fallback warns; blank PAYMENT_PUBLIC_URL falls through to DASHBOARD_URL (`||` semantics).
- `resolveWebhookPrecondition`: both set -> ok; either missing -> warn; reports booleans,
  never values.
- `assembleOrgReadiness` (the per-org assembler the CLI calls, taking a connection row and
  an injected decrypt fn): null row -> no_connection without decrypting; status not
  connected -> status_not_connected without decrypting (assert decrypt not called);
  decrypt throws -> credentials_unreadable; happy path -> ready; assembled verdict never
  carries the secret.

`apps/api/src/bootstrap/__tests__/payment-port-factory.test.ts`: existing tests + status
fixture, plus the agreement test.

`apps/api/src/payments/stripe-provisioning-seam.test.ts`: existing test + status fixture.

The thin CLI shell (argv/Prisma/console wiring) is not unit-tested, consistent with the
provisioning CLI; all of its logic is in the tested module.

## Out-of-scope follow-ups (noted, not built)

- Org entitlement readiness.
- A health-check that flips a `stripe` Connection's status (today only provisioning sets
  it); if added later, `status_not_connected` verdicts become more than theoretical.
