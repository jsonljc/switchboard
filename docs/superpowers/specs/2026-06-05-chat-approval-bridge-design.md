# Chat approval respond bridge: production wiring across the process boundary

Date: 2026-06-05
Status: approved (autonomous slice; builds the deferral designed in
2026-06-04-chat-approval-seam-design.md section 7)
Proving case: a WhatsApp/Slack approve tap, in the real two-process topology, executes
the frozen Riley -> Mira handoff through the REAL engine or surfaces recovery, with the
existing honest replies.

Governing invariant (inherited): **a human approves exactly one frozen action, and the
system either executes that exact action or exposes the failed execution for recovery.**
New corollary for this slice: **`respondedBy` never crosses a process boundary as a
claim.** The chat process attests only webhook-authenticated transport identity; the API
re-derives the operator principal from its own stores.

## 1. Problem

All facts verified against origin/main `6d9151f4` (2026-06-04 evening).

The respond ENGINE is done and proven (#887/#889/#891): `respondToApproval`'s lifecycle
fork and `respondToParkedLifecycle` both end in the shared dispatch engine
(`lifecycle-dispatch.ts`); the chat gateway
(`packages/core/src/channel-gateway/handle-approval-response.ts`) maps outcomes to honest
operator replies; the integration proof (`apps/api/src/__tests__/chat-approval-loop.test.ts`)
drives a chat approve through the REAL `ApprovalLifecycleService` + REAL
`PlatformLifecycle` to a real Mira draft. What is still true in production:

1. **`approvalResponseConfig` is constructed nowhere in apps/chat.** Both
   `ChannelGateway` construction sites (`apps/chat/src/main.ts` single-tenant,
   `apps/chat/src/gateway/gateway-bridge.ts` managed) omit it, so every operator tap on
   a WhatsApp/Slack approve button dies with NOT_AUTHORIZED before reaching the engine.
2. **The chat process cannot host the engine.** It has no `ExecutionModeRegistry` and no
   workflow handlers; all execution is delegated to the API process over HTTP
   (`HttpPlatformIngressAdapter`, `SWITCHBOARD_API_URL` + `SWITCHBOARD_API_KEY`).
   `RespondToApprovalDeps.platformLifecycle` is the dispatch engine; only the API has it.
3. **The trust channel already exists.** `INTERNAL_API_SECRET` authenticates
   api -> chat internal calls today (`notify-chat-provisioned-channel.ts` client,
   `apps/chat/src/main.ts:357-372` server: Bearer token, `timingSafeEqual`, 503 when the
   secret is unset, 401 on mismatch). Both Render services already carry the env var
   (chat validates inbound provision-notify; the API reads it in
   `bootstrap/routes.ts:176` and `routes/organizations.ts:365` as the client). The API
   side has no inbound `INTERNAL_API_SECRET` route yet; this slice adds the first one.
4. **The API-side re-derivation stores exist.** `PrismaOperatorChannelBindingStore`
   (packages/db) implements `OperatorChannelBindingStore.findActiveBinding` over the
   org-scoped unique `(organizationId, channel, channelIdentifier)`;
   `app.storageContext.identity` is Prisma-backed in production (`createPrismaStorage`)
   and resolves principals + roles. No production writer creates binding rows yet
   (manual seed or future admin surface); the bridge fails closed (not_authorized) until
   a binding exists, which is correct.
5. **Channel payloads parse today.** WhatsApp interactive `button_reply.id` and Slack
   `block_actions[0].value` surface as `message.text`
   (`whatsapp-parsers.ts:47-49`, `slack.ts:131-144`);
   `parseApprovalResponsePayload` accepts exactly
   `{ action, approvalId, bindingHash }`. WhatsApp button ids carry 256 bytes, Slack
   action values 2000; the ~160-byte payload fits both. Telegram `callback_data` caps at
   64 bytes and stays broken (section 6).
6. **The API auth middleware is key-based and global.** Every route outside an explicit
   exclusion list requires `Authorization: Bearer <API key>` resolved against
   `API_KEYS`/dashboard keys with per-key org scoping (`middleware/auth.ts`). Existing
   exclusions that self-authenticate: `/api/billing/webhook` (Stripe signature),
   `/api/meta/deletion` (signed_request HMAC). The internal bridge route follows that
   pattern with the internal secret, NOT an API key: static API keys are org-scoped by
   startup invariant, and the bridge serves every org the chat process manages.

## 2. Decision 1: bridge surface shape. CHOSEN: one core respond flow, a dedicated internal route, a transport seam

**Options considered**

- A. Dedicated internal route only; the gateway grows an HTTP branch inline.
- B. Extend `POST /api/approvals/:id/respond` with an internal-attestation mode.
  REJECTED: it mixes two trust models behind one public handler. The public route's
  identity rule (`principalIdFromAuth` is the responder; differing body `respondedBy` is
  a 403 `principal_mismatch`) stays airtight only if no alternate derivation mode lives
  in the same code path. Binding-attestation on the public surface would also have to
  bypass `assertOrgAccess` (API keys are org-bound; the chat process is multi-org),
  weakening the route's org posture for everyone.
- **C. A `RespondTransport` seam on the gateway config, a dedicated internal route on
  the API, and ONE extracted core flow that both the in-process config and the route
  call** (chosen).

**Why C:** the auth-bearing respond flow (approval lookup, org check, state pre-check,
timing-safe hash check, binding + role auth, unified-engine call, error mapping) must
not exist twice. Today it lives inside `handleApprovalResponse` interleaved with
`ReplySink` sends. Extracting it into an outcome-returning core function gives three
consumers one implementation:

- the gateway's in-process mode (tests, the #891 integration proof, any future
  single-process deployment): unchanged behavior, replies byte-identical;
- the API internal route: the same function over API-side stores, serialized to HTTP;
- nothing else. No parallel approve path exists: the flow ends in `respondToApproval`
  or `respondToParkedLifecycle`, exactly as today.

### 2.1 New core module: `packages/core/src/channel-gateway/respond-to-channel-approval.ts`

```
ChannelApprovalRespondRequest = {
  approvalId, action: "approve" | "reject", bindingHash,
  organizationId, channel, channelIdentifier
}
ChannelApprovalRefusalCode =
  "not_found" | "stale" | "not_authorized" | "lookup_error" | "already_responded"
  | "conflict" | "expired" | "self_approval" | "admission_failed" | "execution_error"
ChannelApprovalRespondOutcome =
  | { kind: "responded"; action: "approve" | "reject"; executionSuccess: boolean | null }
  | { kind: "refused"; code: ChannelApprovalRefusalCode }

ChannelApprovalRespondDeps = {
  approvalStore, bindingStore, identityStore, respondDeps  // = today's config + store
}
respondToChannelApproval(deps, request): Promise<ChannelApprovalRespondOutcome>
```

The function body is today's `handleApprovalResponse` + `respondViaLifecycleFallback`
flow moved verbatim, with every `replySink.send(X_MSG)` replaced by the outcome that
maps to it (mapping table in 3.3). `executionSuccess` carries
`executionResult === null ? null : executionResult.success` (null = quorum still open;
reject is null). The error mapper is today's `replyForError` recast to codes:
`StaleVersionError` and the lifecycle-status race -> `conflict`,
`ParkedLifecycleNotFoundError` -> `not_found`, `ParkedLifecycleAlreadyRespondedError` ->
`already_responded`, `ParkedLifecycleExpiredError` -> `expired`,
`DispatchAdmissionError` -> `admission_failed`, `/stale binding/i` -> `stale`,
`/self-approval/i` -> `self_approval`, everything else -> `execution_error`.
`APPROVER_ROLES`, the timing-safe hash compare, and the binding + role authorization
move here with no semantic change.

### 2.2 `handle-approval-response.ts` becomes orchestration + reply rendering

```
HandleApprovalResponseConfig =
  | { bindingStore; identityStore; respondDeps }   // in-process (existing shape)
  | { transport: ApprovalRespondTransport }        // bridged (new)

ApprovalRespondTransport = {
  respond(request: ChannelApprovalRespondRequest): Promise<ChannelApprovalRespondOutcome>
}
```

`handleApprovalResponse` keeps its exact signature and reply constants. Flow: no config
-> NOT_AUTHORIZED (unchanged fail-closed). In-process config ->
`respondToChannelApproval` with local stores. Transport config -> build the request from
`(payload, organizationId, channel, channelIdentifier)` and call
`transport.respond(...)`; the gateway does NO local lookups in transport mode
(thin-forward; rationale in 4.2). Either way the outcome renders through one
`replyForOutcome` mapping (3.3). A transport throw renders APPROVAL_LOOKUP_ERROR_MSG:
honest (nothing was verified, the dashboard works, and a re-tap is safe because a
duplicate respond surfaces as already_responded).

### 2.3 The API internal route: `POST /api/internal/chat-approvals/respond`

New file `apps/api/src/routes/internal-chat-approvals.ts`, registered in
`bootstrap/routes.ts`. The handler: validate the secret (3.2 auth), zod-parse the body,
construct `ChannelApprovalRespondDeps` from app decorations
(`storageContext.approvals`, `new PrismaOperatorChannelBindingStore(app.prisma)`,
`storageContext.identity`, and respondDeps identical to the public route:
envelopes, workTraceStore, lifecycleService, platformLifecycle, sessionManager,
auditLedger, logger, selfApprovalAllowed from ALLOW_SELF_APPROVAL), call
`respondToChannelApproval`, and return 200 with the outcome JSON. When `app.prisma` is
null (dev-no-DB: no binding rows can exist), the route returns 503
`bridge_not_configured` and the chat side renders LOOKUP_ERROR: fail closed, never an
in-memory authority shortcut.

## 3. Decision 2: wire contract

**Options considered**

- A. Reply strings across the wire. REJECTED: couples the API to chat copy; the brief's
  own warning.
- **B. Structured outcome codes + execution success tri-state; replies stay rendered in
  the gateway** (chosen).
- C. Reuse the public route's HTTP statuses (404/409/403 per code). REJECTED for flow
  outcomes: the transport would re-derive semantics from status + body, two sources of
  truth. The internal surface is RPC-shaped, not REST.

### 3.1 Request and response

```
POST /api/internal/chat-approvals/respond
Authorization: Bearer <INTERNAL_API_SECRET>
{ approvalId, action: "approve" | "reject", bindingHash,
  channel, channelIdentifier, organizationId }     // all required, non-empty strings
```

- 200 + `ChannelApprovalRespondOutcome` for every FLOW outcome, refusals included.
- Non-2xx only for bridge-level failures: 400 malformed body (zod, strict object: an
  injected `respondedBy` field is itself a 400), 401 missing/mismatched secret, 503
  secret unset server-side or stores unavailable, 429 rate limited, 500 unexpected.
- The body schema rejects unknown keys. `respondedBy` is not a field; it cannot be
  smuggled.

### 3.2 Transport posture

`HttpApprovalRespondTransport` lives in core next to the seam it implements
(`packages/core/src/channel-gateway/http-approval-respond-transport.ts`): it has zero
chat-app dependencies (fetch + the core types), core already speaks HTTP where a seam
demands it (the WhatsApp/Slack notifiers), and the e2e proof in `apps/api/src/__tests__`
must drive the REAL production class, which a chat-app module could not provide
(apps cannot import other apps). `apps/chat` consumes it from `@switchboard/core`.
Posture: 15s timeout per attempt; ONE retry with a 250ms gap on network error,
timeout, 502/503/504; no retry on 2xx/4xx/429. Retry safety: the engine's optimistic
locks + the deterministic dispatch key make the duplicate respond surface as
`already_responded`, never a second dispatch (proven through the bridge in the e2e
double-tap test). If the first attempt landed and the retry reports
`already_responded`, the operator reply is ALREADY_RESPONDED_MSG ("open the dashboard"):
slightly conservative, never false. Exhausted attempts or bridge-level non-2xx throw;
the gateway renders APPROVAL_LOOKUP_ERROR_MSG. The transport refuses to send (throws)
when constructed without a base URL or secret: belt-and-braces under 4.1's wiring gate.

### 3.3 Outcome -> reply mapping (single table, gateway-owned; replies byte-identical to today)

| outcome                                          | reply constant               |
| ------------------------------------------------ | ---------------------------- |
| responded, action=reject                         | REJECT_SUCCESS_MSG           |
| responded, approve, executionSuccess=true        | APPROVE_EXECUTED_MSG         |
| responded, approve, executionSuccess=false       | APPROVE_DISPATCH_FAILED_MSG  |
| responded, approve, executionSuccess=null        | PARTIAL_APPROVAL_MSG         |
| refused not_found                                | NOT_FOUND_MSG                |
| refused stale, refused expired                   | STALE_MSG                    |
| refused not_authorized                           | NOT_AUTHORIZED_MSG           |
| refused lookup_error                             | APPROVAL_LOOKUP_ERROR_MSG    |
| refused already_responded, refused conflict      | ALREADY_RESPONDED_MSG        |
| refused self_approval                            | SELF_APPROVAL_MSG            |
| refused admission_failed                         | ADMISSION_FAILED_MSG         |
| refused execution_error                          | APPROVAL_EXECUTION_ERROR_MSG |
| transport threw (network, 4xx/5xx, secret unset) | APPROVAL_LOOKUP_ERROR_MSG    |

## 4. Decision 3: auth mechanics and security posture

### 4.1 Secret validation (reuse, do not invent)

The route copies the proven server-side pattern from `apps/chat/src/main.ts:357-372`:
read `INTERNAL_API_SECRET` at request time; 503 + log when unset (fail closed, never
fail open); compare the full `Bearer <secret>` header with `timingSafeEqual` after a
length guard; 401 on mismatch. Auth-middleware exclusion is the EXACT path
`/api/internal/chat-approvals/respond` (precedent: `/api/billing/webhook`,
`/api/meta/deletion`), not a prefix: a future internal route must opt in consciously.
Exclusion exactness is tested: the exact path reaches the route's own auth; a
querystring or trailing-slash variant stays behind the API-key middleware (fail
closed). Per-route rate limit `{ max: 300, timeWindow: 60_000 }` (the approvals-route
values, hardcoded: operator taps are human-scale; a runaway chat process throttles to
429 which the transport surfaces as LOOKUP_ERROR without retry). The route schema sets
`hide: true`: `/docs` is publicly reachable (auth-excluded), and an internal surface
must not advertise itself in the public OpenAPI document. Logging discipline: the route
logs approvalId, organizationId, channel, and the outcome code; it never logs
channelIdentifier (operator phone numbers / user ids), bindingHash, or any part of the
secret.

### 4.2 Identity derivation: the API is the only authority

`respondedBy` is derived server-side, full stop:
`findActiveBinding({ organizationId, channel, channelIdentifier })` ->
`identityStore.getPrincipal(binding.principalId)` -> role check against the same
`APPROVER_ROLES` (approver/operator/admin; emergency_responder deliberately excluded,
unchanged). No binding, revoked binding, missing principal, or missing role ->
`not_authorized`. The chat process attests only `(organizationId, channel,
channelIdentifier)`, each derived from its webhook-authenticated runtime (org from the
ManagedChannel/deployment resolution; identifier from the signature-verified webhook
payload; WhatsApp sessionId IS the phone, see `resolveContactIdentity`).

The gateway in transport mode does NO chat-side pre-checks (no hash compare, no binding
lookup), even though the chat process could read both stores. One authority, not two:
chat-side pre-checks add no security (the API must re-check regardless of what chat
concluded), create dual-maintenance of an auth-bearing flow, and introduce
read-skew between two processes' views of the same rows. The chat side keeps only
payload shape parsing, transport fail-closed checks, and reply rendering.

### 4.3 Org scoping

The binding lookup is keyed by the attested org; the approval (or fallback lifecycle)
must belong to that same org or the outcome is `not_found` (no existence leak,
mirroring the in-process flow). Authority and resource are therefore both pinned to the
attested org: an attested identity can never respond across orgs, because no single org
holds both a foreign approval and the caller's binding.

### 4.4 What a compromised chat process or leaked secret can and cannot do

Stated plainly:

- **Cannot mint a principal.** `respondedBy` never crosses the wire; the binding lookup
  against the API's own database is the only source. The strict body schema 400s any
  injected `respondedBy`.
- **Cannot respond across orgs** (4.3).
- **Cannot replay or duplicate.** Replay is a tested security property, not an
  incidental lock behavior: the same payload cannot execute twice (double-tap ->
  `already_responded`, exactly one succeeded DispatchRecord); replay after expiry
  refuses (`expired`/`stale`); replay against a patched unit refuses via the
  current-revision hash check.
- **Revocation takes effect immediately.** The principal is derived at respond time,
  never cached from button issuance: a binding revoked after the notification went out
  refuses the very next tap with `not_authorized` (tested as a sequence: tap succeeds,
  binding revoked, second approval tap refuses). A role downgrade after binding has the
  same effect (the role check also runs at respond time).
- **Cannot self-approve.** The four-eyes guard compares the WorkTrace originator against
  the server-derived principal, inside the engine, after derivation.
- **Can, with the secret alone:** submit approve/reject for an approval whose id AND
  current bindingHash they ALSO possess, attested as a channel identity that ALREADY has
  an active approver-role binding in that approval's org. Binding hashes live in
  notification payloads and the database, not in the secret; the secret alone names
  nobody and unlocks nothing pending.
- **A fully compromised chat process** already holds `DATABASE_URL` today (it constructs
  `PrismaApprovalStore`); the bridge does not widen that existing blast radius, it
  narrows the respond path through audited, server-derived identity. Rotation: replace
  `INTERNAL_API_SECRET` on both Render services; in-flight taps fail closed to
  LOOKUP_ERROR replies.
- Every bridge respond is attributable: the route logs the attested org/channel, the
  derived principal, and the outcome code (never the channelIdentifier or hash; 4.1);
  the engine writes `action.approved`/`action.patched` ledger events and stamps
  `approvalRespondedBy` on the trace, as on every other surface.

### 4.5 Hard invariants (must not regress; each is pinned by a test)

- `respondedBy` (or any identity field) is unrepresentable in the wire schema and the
  transport request type; smuggled identity keys 400.
- Channel possession alone never authorizes execution; the binding lookup is org-scoped
  and channel-identifier exact, and runs at respond time (revocation is immediate).
- Approval/lifecycle org mismatch returns `not_found` (no existence leak).
- Approve requires the CURRENT bindingHash (legacy row or current revision).
- Reject through the fallback leg deliberately skips the hash pre-check: this mirrors
  the shipped parked-leg and API-route contract (authority from binding + role; reject
  is terminal-safe and does not execute anything). Explicitly tested and kept; both
  surfaces share one flow, so the bridge cannot diverge from the route here.
- Transport mode performs no local approval lookups (one authority path).
- Every transport failure renders non-executing copy (LOOKUP_ERROR); no path silently
  approves.
- An approval-shaped payload is terminal in the gateway: bridge configured or not, it
  never falls through to PlatformIngress.submit() or the LLM.

## 5. Decision 4: wiring and degraded modes

`createGatewayBridge` (managed path) constructs the config when, and only when, both
env vars are present:

```
SWITCHBOARD_API_URL + INTERNAL_API_SECRET set
  -> approvalResponseConfig = { transport: new HttpApprovalRespondTransport(...) }
either missing
  -> console.warn at boot; config omitted; gateway keeps today's fail-closed
     NOT_AUTHORIZED reply on every approval-shaped payload
```

`main.ts` (single-tenant, dev-no-DB) stays unwired DELIBERATELY: no database means no
orgs, no bindings, and no real approvals; its only channel is Telegram, whose outbound
buttons are undeliverable anyway (section 6). A code comment marks the decision.

Degraded-mode matrix (every cell fails closed, never silently approves):

| condition                              | operator-visible behavior            |
| -------------------------------------- | ------------------------------------ |
| chat env incomplete                    | NOT_AUTHORIZED_MSG (config omitted)  |
| API secret unset (route 503)           | APPROVAL_LOOKUP_ERROR_MSG            |
| secret mismatch (route 401)            | APPROVAL_LOOKUP_ERROR_MSG + loud log |
| API unreachable / timeout (post-retry) | APPROVAL_LOOKUP_ERROR_MSG            |
| API deployed without route (404)       | APPROVAL_LOOKUP_ERROR_MSG            |
| no binding row for the tapper          | NOT_AUTHORIZED_MSG                   |
| dev-no-DB API (`app.prisma` null, 503) | APPROVAL_LOOKUP_ERROR_MSG            |

New env vars: NONE. Both services already carry `INTERNAL_API_SECRET` (provisioning
trust channel) and chat already carries `SWITCHBOARD_API_URL` (ingress delegation); both
names are already in `scripts/env-allowlist.local-readiness.json` and `.env.example`.

Network exposure, stated honestly: Render web services are internet-addressable, so the
internal route is publicly reachable; its security rests on the secret (use a
high-entropy value, rotate via the existing mechanism on both services
simultaneously), the timing-safe check, the rate limit, and above all the binding
model (4.4: the secret alone names nobody). If both services run in a Render
environment with private networking, pointing `SWITCHBOARD_API_URL` at the internal
hostname removes the public hop; optional, not assumed.

Activation is gated twice: the wiring PR (the LAST to merge, after the e2e proof is on
main) flips the transport on wherever both env vars are set, and OperatorChannelBinding
rows gate actual authority (none exist until seeded). Pre-flip hardening checklist
(run before merging the wiring PR):

1. PR-2's route is merged, deployed, and reachable from the chat service
   (`curl -X POST <api>/api/internal/chat-approvals/respond` with the secret and a
   nonsense body returns 400, not 404).
2. The route does not appear in the public `/docs` OpenAPI document (`hide: true`).
3. `OperatorChannelBinding` has rows ONLY for intended operators (or none: every tap
   then refuses `not_authorized`, the correct dark state). Seeding uses the
   channel-canonical identifier: for WhatsApp the webhook wa_id phone form (sessionId
   IS the phone), for Slack the user id (`U...`), exactly as the inbound adapter
   surfaces it; a formatting variant fails closed to `not_authorized`.
   Raw-SQL seed must supply `"updatedAt"` (Prisma `@updatedAt` has no DB default):
   `INSERT INTO "OperatorChannelBinding" (id, "organizationId", channel,
"channelIdentifier", "principalId", status, "createdBy", "updatedAt") VALUES
(gen_random_uuid(), '<org>', 'whatsapp', '<wa_id>', '<principalId>', 'active',
'<adminPrincipalId>', now());`
4. Stale pre-bridge approval buttons in operator chats are acceptable by construction
   (responded/expired/patched all refuse honestly), but confirm no unexpected pending
   approvals predate the flip.
5. The e2e bridge proof (PR-3) is green on main.

Merge order makes the API route live before the chat transport ships; a chat that
deploys early gets 404 -> LOOKUP_ERROR, fail-closed.

## 6. Decision 5: scope

- **Telegram outbound stays broken (named follow-up, OUT).** `callback_data` caps at 64
  bytes; the ~160-byte payload needs a short-token indirection in the notifier (token
  store, TTL, single-use semantics): an auth-bearing design of its own, not a small fix.
  The bridge is payload-agnostic; when short tokens land, Telegram taps ride the same
  path unchanged.
- **Pre-fix zombie backfill stays OUT** (seam spec section 8), unchanged.
- **Outbound WhatsApp/Slack approval notifications are NOT wired by this slice, and were
  never wired.** The production notifier chain (`bootstrap/skill-mode.ts:204-233`) is
  Email + Telegram only; `WhatsAppApprovalNotifier`/`SlackApprovalNotifier` exist in
  core with payloads the parser accepts, but nothing constructs them. This slice makes
  every ARRIVING WhatsApp/Slack approve tap real end to end; putting buttons in front of
  operators automatically still requires the outbound notifier wiring (its own small
  slice: construct the notifiers with org channel credentials in the API bootstrap).
  Until then, taps originate from manually delivered or future-wired notifications; the
  dashboard Inbox remains the canonical surface.
- **No new operator copy.** Every reply is an existing exported constant.
- Slack expects interaction acks within ~3s and the managed webhook awaits
  `handleIncoming` before 200ing; chat traffic already exceeds that today (LLM
  round-trips), and the bridge adds one intra-region HTTP hop to approval taps only.
  Pre-existing posture, noted, unchanged.

## 7. Tests (co-located, TDD; api tests use mocked Prisma; core uses InMemoryLifecycleStore)

- **core, respond-to-channel-approval suite** (new; fixtures reused from
  `approval-response-fixtures.ts`): every refusal code from 3.3 (approval-store throw ->
  lookup_error; org mismatch and missing row+lifecycle -> not_found; non-pending ->
  already_responded; hash mismatch -> stale; unwired/missing/revoked binding and
  roleless principal -> not_authorized; engine error classes -> their codes), responded
  outcomes (approve executes via the real in-memory lifecycle world: executionSuccess
  true/false/null), fallback-leg parity (org check, current-revision hash, reject
  without hash pre-check), and the four-eyes refusal.
- **core, handle-approval-response suites**: the existing 18 + lifecycle cases pass
  UNCHANGED (the refactor proof: replies byte-identical). New transport-mode cases: each
  outcome and refusal code renders the mapped constant; transport throw renders
  LOOKUP_ERROR; no local stores are touched in transport mode (spy proof).
- **api, internal route suite** (new, mocked stores): 503 when secret unset; 401 on
  missing/wrong/`Bearer`-less secret (timing-safe path); 400 on schema violations
  INCLUDING smuggled identity keys (respondedBy, principalId, operatorId, userId,
  roles: parameterized); binding re-derivation drives respondedBy (the engine receives
  the binding's principal, never anything from the wire); org-scope enforcement
  (foreign-org approval -> not_found outcome); wrong channel or identifier for a real
  principal -> not_authorized; revocation sequence (first tap responds, binding
  revoked, next tap on a fresh approval -> not_authorized); expiry replay (expired
  parked lifecycle -> expired); refusal codes serialize; double-tap ->
  already_responded with exactly one dispatch; 503 when `app.prisma` is null; 200
  outcomes for approve/reject happy paths over an in-memory engine world.
- **api, auth-middleware exactness** (extends the existing api-auth suite): the exact
  internal path bypasses API-key auth (reaches the route's own 503/401); a querystring
  or trailing-slash variant does NOT bypass (401 from the middleware, fail closed).
- **core, transport suite** (new, beside the class per 3.2): URL/headers/body shape;
  200 outcome passthrough; retry-once on network error/timeout/503 then success; no
  retry on 200 refusals or 401/400/429; throws after exhausted retries; malformed or
  unknown-code outcomes rejected without retry; fail-closed without secret/URL (never
  fetches); timeout-after-server-commit shape (attempt 1 network-fails, attempt 2
  returns already_responded: the outcome passes through, the conservative
  "already handled" reply is the accepted UX for this rare race, spec 3.2).
- **core, gateway terminal-branch** (extends channel-gateway-approval suite): with a
  transport config, an approval-shaped payload gets a reply and NEVER reaches
  platformIngress.submit (no LLM fallthrough), matching the existing config-less pins.
- **chat, gateway-bridge construction suite** (extends the existing reach-in test):
  env present -> approvalResponseConfig with transport; env missing -> undefined +
  warning.
- **e2e bridge proof** (`apps/api/src/__tests__/`, extends the #891 pattern over
  `buildLifecycleWorld`): a fastify app registers the REAL internal route decorated with
  the lifecycle world's stores + a real binding/identity fixture; the REAL
  `handleApprovalResponse` (the gateway's approval entry) runs with an
  `HttpApprovalRespondTransport` whose fetch impl is `app.inject`; assert the HANDLER
  RAN (Mira job exists via the real read model), trace completed, lifecycle approved,
  DispatchRecord succeeded, reply is APPROVE_EXECUTED_MSG. Failure leg:
  `breakHandoffHandlerOnce` -> APPROVE_DISPATCH_FAILED_MSG + recovery_required + retry
  through the bridge recovers (attempt 2 succeeded). Double-tap leg: second identical
  tap -> ALREADY_RESPONDED_MSG, still exactly one succeeded DispatchRecord. Spoof leg:
  request body carrying `respondedBy` 400s at the route; an unbound channel identity
  gets NOT_AUTHORIZED_MSG and mutates nothing.
- **Mutation checks** (each verified RED once during TDD): skip the API-side binding
  re-derivation (pass wire identity through) -> the spoof/derivation test reds; drop the
  org-match check -> the org-scope test reds; drop the dispatch call -> the handler-ran
  assertion reds. The no-duplicate-dispatch guarantee is engine-owned and already pinned
  by the seam suites; the e2e double-tap leg re-proves it through the bridge.

## 8. Delivery: four sequential, file-disjoint PRs after this spec lands

1. **PR-1 core seam**: `respond-to-channel-approval.ts` (new),
   `http-approval-respond-transport.ts` (new; see 3.2 for why core),
   `handle-approval-response.ts` (refactor to outcomes + transport mode), `types.ts`
   (config union), barrel exports, core test additions. Existing suites untouched and
   green. Commits ordered extraction-first, transport-second for review.
2. **PR-2 api route**: `routes/internal-chat-approvals.ts` (new), `middleware/auth.ts`
   (exact-path exclusion), `validation.ts` (body schema), `bootstrap/routes.ts`
   (registration), route test suite + auth-exactness additions.
3. **PR-3 e2e proof**: the bridge-loop integration test over the real engine and the
   real transport (+ shared world extraction from the existing chat-approval-loop
   test). Lands BEFORE the flip so the full proof is on main first (review
   amendment: proof-before-activation).
4. **PR-4 chat wiring (the flip)**: `gateway-bridge.ts` (conditional config from env),
   `main.ts` (decision comment), construction tests. Deliberately tiny and LAST: its
   merge makes the bridge live on the next chat deploy, gated by the section 5
   pre-flip checklist.

## 9. Risks and honest limits

- **Bindings have no production writer yet.** Until an OperatorChannelBinding row is
  seeded (SQL or future admin surface), every bridged tap replies NOT_AUTHORIZED. That
  is the correct fail-closed posture; flipping the feature on requires creating
  bindings, documented in the deploy notes (section 5).
- **Outbound notifier gap** (section 6): the respond path is real; the notification path
  for WhatsApp/Slack buttons is a separate unwired slice. Telegram outbound stays
  undeliverable.
- **Single-tenant path stays unwired** by design (section 5).
- **Indeterminate transport failures** render LOOKUP_ERROR even when the respond may
  have landed server-side (timeout after commit). A re-tap resolves to
  `already_responded`; the dashboard shows truth. Accepted as the honest, retry-safe
  posture.
- **The internal route trusts the secret holder to attest channel identities** (4.4
  states the bounded consequences). Mitigations if the posture ever needs tightening:
  per-channel HMAC of the webhook payload, mTLS between services, or short-lived signed
  attestations; all out of scope while both services share a Render private environment.
- **Approved-then-trace-locked / admission-refused** families are pre-existing engine
  semantics (seam spec section 8), shared by the bridge unchanged.
- The legacy `GET /api/approvals/pending` surface stays deprecated-in-place, untouched.
