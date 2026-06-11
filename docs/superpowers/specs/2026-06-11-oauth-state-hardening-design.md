# OAuth self-serve credential-flow hardening (D10-3 / Tier-0 PR 0.2b)

Status: design note for `fix/oauth-state-hardening`. Refines the Tier-0 plan's 0.2b sketch
(`docs/superpowers/plans/2026-06-10-riley-remediation-tier0-pilot-provisioning.md`, Steps 5-7).
This note exists because the plan's sketch is self-contradictory once the Bearer wall is lifted
(see "Deviation" below); the prompt asked for the model to be settled before coding.

## Problem

The facebook and google-calendar OAuth connect flows are dead in production: the Bearer wall
(`middleware/auth.ts`) 401s Facebook's/Google's browser redirect to the callback (D10-1). Their
`state` is unsigned (facebook passes the raw `deploymentId`; google signs but compares with `!==`,
not constant-time). Lifting the wall so the producer can run unmasks a CSRF/connection-fixation hole.
So signing + callback org-binding + the wall-lift must ship together.

## Two questions the plan's sketch left open

1. **Org without a Bearer (callback).** After the wall-lift, Facebook's redirect to the callback
   carries no `Authorization` header, so `request.organizationIdFromAuth` is `undefined`. The plan's
   "assert `deployment.organizationId === request.organizationIdFromAuth`" can never pass.
2. **Who can initiate (authorize).** What stops an attacker initiating a connect for a deployment
   they do not own, then completing OAuth with their _own_ ad account, binding it to a victim's
   deployment (connection-fixation)?

## Resolution

Three coupled mechanisms; the **signed `state` is the unforgeable link** between an authenticated,
ownership-checked authorize leg and an exempt callback.

- **Signed state (integrity / anti-forgery / anti-replay).** `buildSignedState(deploymentId, secret)`
  / `verifySignedState(state, secret)` in `packages/ad-optimizer` (shared, pure). Format
  `base64url(<deploymentId>:<issuedAt_b36>).base64url(hmacSha256(secret, payloadB64))`, compared with
  `crypto.timingSafeEqual` (length-guarded so a malformed sig returns `null`, never throws), with a
  10-minute issued-at expiry. This is the google `signState` concept, upgraded to base64url +
  constant-time + a real expiry, and now shared by both providers.
- **Q1 - org at the callback (trusted lookup, no Bearer).** The callback is **auth-exempt** (it
  cannot carry a Bearer; Facebook controls that redirect). It `verifySignedState` -> `deploymentId`,
  then resolves the org from the deployment via a trusted DB lookup (`deployment.organizationId`),
  never from the request. The connection it writes is org-bound through the deployment. A direct hit
  to the exempt callback with a raw/forged `state` is rejected 400 (no valid signature).
- **Q2 - who can initiate (authed authorize + assertOrgAccess).** The authorize leg **stays
  Bearer-authed** and runs `assertOrgAccess(request, deployment.organizationId, reply)` (the proven
  #968 pattern) before it signs a state. It is reached through the dashboard, which server-proxies it
  with the operator's API key via `getApiClient()` and returns JSON `{ authorizeUrl }` (changed from
  a 302 so the dashboard can read it). An attacker has no Bearer scoped to the victim's org, so they
  cannot mint a state for a deployment they do not own.

### Deviation from the plan's sketch (the "re: the Bearer" refinement)

- The plan says auth-exempt **both** redirect legs and sign the state **at** the authorize leg. An
  exempt, self-signing authorize leg is a **signing oracle**: anyone could mint a valid state for any
  `deploymentId` and reopen Q2. So we exempt **only the callback** and keep the authorize/minting leg
  authed (the smallest possible exempt surface, the security best practice).
- The plan's callback assertion `=== request.organizationIdFromAuth` is replaced by the trusted
  deployment-org lookup (Q1), because the callback has no Bearer.

### Why not sign in the dashboard (so both legs could be exempt)?

That would distribute the signing secret to the dashboard tier. The dashboard's secret is
`NEXTAUTH_SECRET`; the API's is `SESSION_TOKEN_SECRET` (`.env.example:188` vs `:257`) - different
vars in different tiers. Cross-tier signer/verifier would silently break every connect on any
secret mismatch. Keeping sign+verify in the API (one consistent `resolveOAuthStateSecret`) avoids
that landmine. The secret resolver also **throws in production** if neither secret is set, instead
of falling back to the literal `"dev-fallback"` (which would let anyone forge states in prod - a
latent hole in the current google flow we close here).

## Components

- `packages/ad-optimizer/src/facebook-oauth.ts`: `buildSignedState` / `verifySignedState` (+ tests).
- `apps/api/src/utils/oauth-state-secret.ts` (new): `resolveOAuthStateSecret(env)` shared by both
  routes, prod-throw (+ test).
- `apps/api/src/routes/facebook-oauth.ts`: authorize -> load deployment, `assertOrgAccess`, sign,
  return `{ authorizeUrl }`; callback -> `verifySignedState`, trusted lookup, write.
- `apps/api/src/routes/google-calendar-oauth.ts`: same shape; drop the inline `signState`/`verifyState`
  for the shared builder; require a real `deploymentId` (the old `"pending"` default already 404'd at
  the callback).
- `apps/api/src/middleware/auth.ts`: exempt **only** the two callbacks (path match, query stripped).
- `apps/dashboard/.../connections/{facebook,google-calendar}/authorize/route.ts`: server-proxy via
  `getApiClient()`; redirect the browser to the returned `authorizeUrl`.
- `apps/dashboard/src/lib/api-client/marketplace.ts`: `getFacebookAuthorizeUrl` /
  `getGoogleCalendarAuthorizeUrl`.

## Seam tests (producer -> consumer)

- ad-optimizer: round-trip; tampered payload/sig -> null; wrong secret -> null; expired -> null;
  malformed/length-mismatch sig -> null (no throw).
- api callback: forged/tampered/expired `state` -> 400; valid `state` -> writes the connection bound
  to the deployment in the state (mock the ad-optimizer token exchange).
- api authorize: 403 for a foreign deployment (assertOrgAccess); 401 without a Bearer (still authed);
  owned deployment -> `{ authorizeUrl }` carrying a state that `verifySignedState` accepts.
- middleware: the two callbacks are reachable without a Bearer; the two authorize legs are not.

## Done when

A forged/tampered/wrong-secret state is 400'd; a legitimate round-trip writes the DeploymentConnection
for the right deployment/org; the callback is reachable without a Bearer yet safe; the authorize leg
cannot mint a state for a deployment the caller does not own; gates green; one focused PR.
