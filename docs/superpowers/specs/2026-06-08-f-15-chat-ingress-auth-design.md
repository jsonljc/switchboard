# F-15, Chat→API ingress authentication (design)

**Date:** 2026-06-08
**Finding:** [`docs/audits/2026-06-07-pilot-spine-audit/findings/F-15-chat-api-ingress-unauthenticated-at-prod-default.md`](../../audits/2026-06-07-pilot-spine-audit/findings/F-15-chat-api-ingress-unauthenticated-at-prod-default.md)
**Status:** proposed
**Branch:** `fix/f-15-chat-ingress-auth`

---

## 1. Problem

At production defaults, every managed-channel inbound message (WhatsApp, Telegram,
widget, CTWA) is rejected before it reaches the agent. The chat service forwards
inbound to the API at `POST /api/ingress/submit`, but it sends **no `Authorization`
header**, so the API's auth gate replies `401 "Missing Authorization header"`. The
customer always gets the generic "I'm having trouble right now…" fallback; the skill
(Alex's LLM, booking tools, governance) never runs. This is the single highest-leverage
pre-pilot blocker, it gates **all** inbound on **all** channels.

Verified live in the audit (`evidence/j3-inbound-routing-broken.txt`): the adapter POSTed
to `http://localhost:3000/api/ingress/submit` with no auth header and got
`API error 401: {"error":"Missing Authorization header"}`.

## 2. Root cause (verified against current `main`)

The adapter code is correct, it sends `Authorization: Bearer <key>` when a key is set
(`apps/chat/src/gateway/http-platform-ingress-adapter.ts:19-21`). The failure is that no
key is provisioned, and, critically, **the credential the audit proposes cannot work for
a multi-tenant chat service.**

The chat service is a **single shared process serving every org's managed channels**
(`apps/chat/src/main.ts:185-198`: `RuntimeRegistry.loadAll` + `loadGatewayConnections`
load _all_ orgs' channels into one process). For each inbound it resolves the correct org
**server-side from the channel token** and puts it in the request body:

- `ChannelGateway.handleIncoming` calls `deploymentResolver.resolveByChannelToken(channel, token)`
  → `resolved.organizationId` (`packages/core/src/channel-gateway/channel-gateway.ts:149`)
- It builds the canonical request with `organizationId: resolved.organizationId`
  (`channel-gateway.ts:316`).

But the API **discards that org** and substitutes the org bound to the auth key:

- `apps/api/src/routes/ingress.ts:38` calls `platformIngress.submit({ organizationId: request.orgId, … })`
  , it never reads `body.organizationId`.
- `request.orgId` is set by `requireOrgForMutation` to `request.organizationIdFromAuth`
  (`apps/api/src/decorators/org.ts:76-86`), the org **derived from the API key**.
- Downstream, `request.organizationId` drives everything that matters:
  `resolveAuthoritativeDeployment` resolves the deployment via
  `resolver.resolveByOrgAndSlug(request.organizationId, skillSlug)`
  (`apps/api/src/bootstrap/platform-deployment-resolver.ts:22`); entitlement
  (`platform-ingress.ts:197`), idempotency (`:120`), the gated lifecycle's org (`:315`),
  and WorkTrace attribution are all keyed off `request.organizationId`.

And the API key auth model is **single-org by construction**:

- A static `API_KEYS` entry must carry exactly one `organizationId` in `API_KEY_METADATA`;
  production **refuses to boot** if any static key is unscoped, because an unscoped key is
  "a cross-tenant impersonation primitive" (`apps/api/src/middleware/auth.ts:82-98`).
- A DB key (`DashboardUser.apiKeyHash`, `auth.ts:207-211`) belongs to exactly one org.

**Therefore the audit's literal fix (provision one `SWITCHBOARD_API_KEY` + matching
`API_KEYS`/`DashboardUser.apiKeyHash`) is multi-tenant-incorrect.** A single org-scoped key
would route _every tenant's_ inbound to _one_ org, wrong deployment, wrong entitlement,
wrong governance policies, and WorkTraces attributed to the wrong customer. The audit did
not surface this because it exercised only one org (it bridged F-13/F-14 for the single
audit org via Telegram). This is a "verify against the codebase" correction to the finding.

## 3. The key insight: this is a service-to-service hop, not a tenant call

The chat→API ingress hop is a **first-party, private-network, service-to-service call**
(`render.yaml:190-191`: chat reaches the API at `http://switchboard-api:3000` on Render's
private network). The chat service has already resolved the authoritative org _server-side_
from the managed-channel token, not from untrusted lead input. The correct trust model is
the one the codebase **already uses** for chat↔API internal calls: a shared
`INTERNAL_API_SECRET` that authenticates the **caller process** and trusts the
server-resolved context it carries.

This pattern is already in production for:

- `POST /api/internal/chat-approvals/respond`, self-verifies `INTERNAL_API_SECRET`
  (timing-safe), excluded from the API-key auth gate, fails closed
  (`apps/api/src/routes/internal-chat-approvals.ts:39-53`, allowlisted at `auth.ts:135-137`).
- chat-side `POST /internal/provision-notify`, same `INTERNAL_API_SECRET` self-verify
  (`apps/chat/src/main.ts:356-371`).

And `INTERNAL_API_SECRET` is **already provisioned on both services** in `render.yaml`
(api `:68-69`, chat `:188-189`, both `sync: false`). So the "render.yaml provisions
neither" gap is sidestepped: the _correct_ primitive is already wired, it simply isn't
used for the ingress hop yet.

## 4. Design

Add a dedicated, internal-authenticated ingress entry that honors the chat-resolved org,
re-tier the chat adapter to use it, and add a fail-fast boot guard. The existing
`/api/ingress/submit` (operator-direct, org-from-auth) is **left untouched** for its
intended operator/API callers.

### 4.1 New API route, `POST /api/internal/ingress/submit`

Modeled exactly on `internal-chat-approvals.ts`:

- **Auth:** self-verify `Authorization: Bearer <INTERNAL_API_SECRET>` (timing-safe,
  byte-length-guarded). Excluded from the global API-key auth middleware (exact path added
  to the `auth.ts` skip allowlist). Fail-closed posture:
  - secret configured → require it (`401` on missing/mismatch);
  - secret **not** configured **and** auth is enabled (`app.authDisabled === false`,
    i.e. production or any DB-backed runtime) → `503` "not configured" (defense in depth;
    the chat boot guard already prevents this in managed mode);
  - secret not configured **and** `app.authDisabled === true` (pure dev, no keys + no DB)
    → accept, mirroring the API's existing auth-disabled dev posture.
- **Org:** use `body.organizationId` (the chat-resolved org). This is safe because only the
  trusted chat process holds the secret and it resolved the org server-side from the channel
  token, the same trust basis as every other `INTERNAL_API_SECRET` route.
- **Body validation:** a strict Zod schema (`organizationId` non-empty, `actor`, `intent`
  required; `parameters`, `trigger`, `surface`, `targetHint`, `traceId`, `idempotencyKey`,
  `contactId`, `conversationThreadId` optional). `400` on parse failure.
- **Behavior:** call `app.platformIngress.submit({ … })` with the full canonical request,
  return its response verbatim. **Governance is unchanged**, every submit still runs
  intent lookup → entitlement → trigger validation → deployment resolution → GovernanceGate
  → execute/park/deny. This route is **not** a mutating bypass; it reaches
  `PlatformIngress.submit` like every governed surface.
- **Idempotency:** read `body.idempotencyKey` (the canonical request field the chat already
  sets: `${org}:${channel}:${providerMessageId}`, `channel-gateway.ts:332`) and pass it
  through. (Unlike `/api/ingress/submit`, which requires the `Idempotency-Key` **header**,
  a contract the chat never satisfied; `utils/idempotency-key.ts:21-26` reads the header,
  the chat sends it in the body.)
- **Lineage fix (bonus):** pass `contactId` and `conversationThreadId` through to
  `submit`. The old `/api/ingress/submit` route dropped both, silently breaking the Spec-1A
  WorkTrace lineage weld over the HTTP hop (`canonical-request.ts:33-38`); the new route
  carries them.
- **Hygiene:** `hide: true` from public OpenAPI, generous rate limit (message-rate, not
  human-tap), structured logging of org/intent/outcome, never the secret.

### 4.2 Chat adapter re-tier

`HttpPlatformIngressAdapter` is repointed at `/api/internal/ingress/submit` and
authenticates with `INTERNAL_API_SECRET`:

- `apps/chat/src/main.ts:74` reads `process.env["INTERNAL_API_SECRET"]` (was
  `SWITCHBOARD_API_KEY`) and passes it to the adapter.
- The adapter's HTTP/Bearer logic is unchanged; only the target path and the credential
  source change. The constructor param is renamed `apiKey` → `internalSecret` for clarity
  (semantics changed: it is now a service secret, not a tenant key).
- The same adapter instance serves the managed gateway, the single-tenant gateway, and the
  CTWA adapter, all three correctly route through the internal hop. The single-tenant
  (dev/no-DB) path keeps working: `StaticDeploymentResolver` always yields a non-empty
  `organizationId` (`"default"` fallback), and in pure dev (`authDisabled === true`) the
  route accepts without a secret.

### 4.3 Chat boot guard (fail-fast)

`apps/chat/src/startup-checks.ts` gains: **when `DATABASE_URL` is set (managed-channel mode)
and `INTERNAL_API_SECRET` is empty → hard error** (`runStartupChecks().ok === false`),
which `main.ts:38-44` already turns into `console.error` + `process.exit(1)`. A managed
runtime can never again start silently unable to reach the API.

This is a hard error in **all** environments (not prod-only) because managed-channel mode is
defined by `DATABASE_URL`, and in that mode the ingress hop is the only path inbound reaches
the agent. Standard local dev is unaffected, the shared dev `.env` already sets
`INTERNAL_API_SECRET`; the guard only bites a genuinely misconfigured runtime (DB present,
secret deleted), which is exactly the failure to surface loudly.

### 4.4 Config + docs

- **`render.yaml`:** `INTERNAL_API_SECRET` is already on both services. Add a comment on each
  noting it must be the **same value** across api + chat and that it now also authenticates
  the chat→API ingress hop. (No new secret to provision.)
- **`.env.example`:** mark `INTERNAL_API_SECRET` as **required when `DATABASE_URL` is set**
  (managed-channel mode), with a one-line note. Annotate `SWITCHBOARD_API_KEY` as the legacy
  single-tenant "delegate to central API" credential (it does not authenticate managed
  channels).
- **Audit finding:** append a short "Resolution (2026-06-08)" note to F-15 recording the
  multi-tenant correction and the shipped mechanism.

## 5. Data flow (after fix)

```
WhatsApp/Telegram inbound
  → chat /webhook/managed/:id  (managed webhook route)
  → ChannelGateway.handleIncoming
       resolveByChannelToken(channel, token) → resolved.organizationId   ← correct org
       build CanonicalSubmitRequest { organizationId: resolved.organizationId, … }
  → HttpPlatformIngressAdapter.submit
       POST http://switchboard-api:3000/api/internal/ingress/submit
       Authorization: Bearer <INTERNAL_API_SECRET>                        ← authenticates
  → API: auth middleware SKIPS (allowlisted) → route self-verifies secret
       organizationId = body.organizationId                               ← org honored
  → app.platformIngress.submit({ organizationId, actor, intent, … })
       entitlement → trigger → resolveByOrgAndSlug(organizationId, slug)
       → GovernanceGate → execute / park / deny                          ← governance intact
  → response returned to chat → dispatched to the lead
```

## 6. Security analysis

- **Trust model:** identical to the existing `INTERNAL_API_SECRET` routes, the secret
  authenticates the caller _process_, and the org it carries was resolved server-side from
  the channel token, not from untrusted client input.
- **No governance bypass:** the route reaches `PlatformIngress.submit`; entitlement (F-02),
  GovernanceGate default-deny (F-16), approval parking, and WorkTrace persistence all still
  run. A leaked secret could submit intents, but every submit is governed, and fresh orgs
  default-deny (F-16) and unentitled orgs 402 (F-02), bounding blast radius.
- **Blast-radius of reuse:** reusing `INTERNAL_API_SECRET` widens what a leaked secret can
  do (it already gates provision-notify + chat-approvals). Accepted: chat and api are
  co-deployed first-party services on one private-network trust boundary; one secret per
  boundary is coherent and reduces secret sprawl. A dedicated ingress secret (finer-grained
  rotation) is the considered alternative in §8.
- **Timing-safe compare** with the byte-length guard (`internal-chat-approvals.ts:44-51`) is
  reused verbatim (shared helper) to avoid a `RangeError`→500 on multi-byte headers.

## 7. Scope

**In scope (this slice):**

- New `/api/internal/ingress/submit` route + strict body schema + auth allowlist entry.
- Chat adapter re-tier to the internal hop using `INTERNAL_API_SECRET`.
- Chat boot guard (fail-fast) + co-located test.
- `render.yaml` / `.env.example` documentation; F-15 resolution note.
- Tests: boot guard, route auth (missing/bad/good secret), org-from-body honored,
  multi-tenant (one secret serves two different orgs), lineage pass-through, governance
  reached. A faithful authenticated round-trip proven by integration test through the real
  Fastify app.

**Out of scope (each its own later slice, per the audit ranking):**

- F-16 (per-org Policy/IdentitySpec provisioning), F-02 (entitlement), F-01 (businessHours),
  F-19/F-20 (code bugs), F-13/F-14 (Telegram-only routing/contact bugs).

**Expected post-fix behavior:** inbound now _authenticates and reaches governance_ on all
channels. A fresh pilot org will still **default-deny** (F-16) and **402** (F-02) until
those land, that is correct and expected for this slice. F-15 unblocks the hop; it does not
by itself make a fresh org transact.

## 8. Alternatives considered

1. **Provision one org-scoped `SWITCHBOARD_API_KEY` (audit's literal fix).** Rejected:
   multi-tenant-incorrect (§2), collapses all tenants to one org. Only "works" for a
   single-org deployment and silently mis-attributes the moment a second org connects.
2. **Per-org API keys, looked up per message.** Rejected: requires recoverable per-org
   service credentials + per-message lookup + rotation machinery; heaviest; no existing
   storage for it.
3. **Service-scoped static API key (cross-org) via an `API_KEY_METADATA` service flag.**
   Rejected for this slice: requires carving an exception into the most security-critical
   code (the "unscoped key forbidden" production guard) and changing `requireOrgForMutation`.
   Higher blast radius than a separate internal route that leaves the auth middleware core
   untouched. Reconsider if a non-chat cross-org service caller appears.
4. **Dedicated `INGRESS_SERVICE_SECRET` instead of reusing `INTERNAL_API_SECRET`.** Viable;
   gives finer-grained rotation/revocation. Deferred in favor of reuse (already provisioned
   on both services; one trust boundary). Low-cost to switch later if separation is wanted.

## 9. Risks

- **Touches a security-sensitive surface** (a new ingress entry + an auth-allowlist line).
  Mitigated by mirroring the established `internal-chat-approvals` pattern exactly, a shared
  timing-safe verifier, fail-closed defaults, and thorough tests.
- **New mutating route** must pass the `check-routes` gate (route-class header; reaches
  `PlatformIngress.submit`, so not a bypass) and may need a `route-allowlist.yaml` entry.
  Verified with `CI=1 npx tsx scripts/local-verify-fast.ts` before commit.
- **Divergence from the audit's prescription**, surfaced explicitly at the spec/plan
  check-in; if the pilot is genuinely single-org-first, the simpler key path can be chosen
  instead.

## 10. Testing strategy

- `apps/chat/src/startup-checks.test.ts`, boot guard: errors when `DATABASE_URL` set +
  `INTERNAL_API_SECRET` empty; passes when both set or DB absent.
- `apps/api/src/.../internal-ingress.test.ts` (integration, real app harness):
  - missing header → `401`; wrong secret → `401`; correct secret → reaches `submit`.
  - `submit` invoked with `organizationId === body.organizationId` (org honored).
  - one secret, two different `body.organizationId` → two submits each under its own org
    (multi-tenant proof).
  - `contactId`/`conversationThreadId`/`idempotencyKey` forwarded to `submit`.
  - malformed body → `400`; secret unset in an auth-enabled app → `503`.
- `apps/chat/.../http-platform-ingress-adapter.test.ts`, posts to the internal path with
  `Authorization: Bearer <secret>`; omits header when no secret.
- `pnpm test` + `pnpm typecheck` green before commit.
