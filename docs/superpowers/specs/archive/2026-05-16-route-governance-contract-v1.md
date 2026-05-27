# Route Governance Contract v1 — Classify First, Enforce by Class, Audit Every User-Initiated Mutation

**Date:** 2026-05-16
**Status:** Implemented & enforced — all PRs merged 2026-05-22→2026-05-24 (PR-1 #614, PR-2 #624, PR-2.5 #627, PR-3 #632/#641/#636/#638, PR-4 #645/#651/#656); `check-routes --mode=error` is blocking on `main` as of `61d3495f`. This spec is now the historical design record.
**Source:** Wave 2 Phase 3A of the architecture cleanup audit (synthesis at `docs/superpowers/specs/2026-05-15-architecture-cleanup-audit-design.md`, Phase 0 triage at `docs/audits/2026-05-15-cleanup/_phase-0-triage.md`, source lane at `docs/audits/2026-05-15-cleanup/api-consistency.md`). This spec is the load-bearing prerequisite for the 17 Cat 3 findings ("contract consistency").
**Prerequisite:** `docs/superpowers/specs/2026-05-15-operator-direct-ingress-pattern.md` — three Amendments captured the cohort variations this contract unifies.

---

## Goal

Convert API routes from ad-hoc handlers into governed product surfaces. Define a route classification taxonomy, a per-class contract, and a migration sequence that closes the 17 Cat 3 findings as instances of the same architectural decision rather than 17 separate cleanups.

This is not "tidy up the routes." This is "the route layer has a doctrine, every new route follows it, and `check-routes` enforces it."

## Constraints

- **Doctrine invariants** (recap from `docs/DOCTRINE.md` + `.agent/conventions/architecture-invariants.md`):
  - Mutating actions enter through `PlatformIngress.submit()`.
  - WorkTrace is canonical persistence.
  - Approval is lifecycle state, not a route-owned side effect.
  - Idempotency and dead-letter handling are business-critical.
  - No non-converged mutating path should survive launch.
- **No new mutating bypass paths** — even temporarily. The route layer's job is to enforce the contract, not work around it.
- **No new execution mode** beyond the four already in `ExecutionModeName` (`skill`, `pipeline`, `cartridge`, `workflow`, `operator_mutation`). The contract works inside the existing modes.
- **Phase 3B (Inngest Failure Contract) is out of scope** — this spec terminates at "route observed a `failed` outcome and produced a typed HTTP response"; Phase 3B picks up at "async function observed a non-recoverable failure and emits a DLQ envelope." They share types but diverge on retry semantics.
- **Implementation lives in separate PRs** — this spec is docs-only per CLAUDE.md branch doctrine ("Specs and plans land on `main` via focused PRs").

## Code-grounded current state (verified 2026-05-16 on `main`)

| Cat 3 finding                                             | Verified state                                                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 Audit-trail gap (48 of 64 mutating routes)            | Open. 4 routes migrated via Phase 1b; ~50 sit under `route-allowlist.yaml` rationales; ~13 remain unclassified or pending migration.                                              |
| 3.2 Idempotency-key gap (38 of 42 mutating routes)        | Open. Only `actions.ts:33` + `execute.ts` enforce; the 4 ingress-migrated routes accept the header optionally via `getIdempotencyKey()`.                                          |
| 3.3 Error response shape inconsistency (7+ routes)        | Open. `whatsapp-send-test.ts` uses `{ error: { code, message, retryable } }`; others use `{ error: string, statusCode }`; `admin-consent.ts` uses 4 typed envelopes.              |
| 3.4 ApprovalRecord duplicated locally                     | Open. 4 local sites: `dashboard-overview.ts:64`, `platform-lifecycle.ts:36` (`NonNullable<getById()>` derived), `prisma-approval-store.ts:6`, `channel-gateway-approval.test.ts`. |
| 3.5 ConversationState duplicated in chat + api            | **Partially closed** — `export type ConversationState` already exists in `packages/schemas/src/chat.ts:64`. Consumer migration in chat + api is the residual.                     |
| 3.6 Handoff type missing                                  | Open. No `Handoff` interface exists in any app or schema.                                                                                                                         |
| 3.7 Validation error structure inconsistent               | Open. Mix of `{ details: error.format() }`, `{ issues: error.issues.map(...) }`, `{ details: error.issues }`.                                                                     |
| 3.8 Optional audit hooks on conversations.ts              | Open. `conversations.ts:286` `setOverride` + `:336` `sendOperatorMessage` lack `auditLedger.record()`.                                                                            |
| 3.9 Surface-URL strings in core (4 sites)                 | Open. `packages/core/src/contacts/list.ts:63`, `contacts/detail.ts:39`, `decisions/adapters/handoff-adapter.ts:22`, `decisions/adapters/recommendation-adapter.ts:48`.            |
| 3.10 DashboardOverview named after surface                | Open. `packages/schemas/src/dashboard.ts:3`.                                                                                                                                      |
| 3.11 meta-deletion.ts lacks WorkTrace                     | Open (allowlisted as permanently justified webhook receiver).                                                                                                                     |
| 3.12 dashboard-reports.ts cache mutation lacks governance | Open (allowlisted as permanently justified read-side refresh).                                                                                                                    |
| 3.13 whatsapp-send-test.ts lacks audit + idempotency      | Open (allowlisted as permanently justified Tech Provider surface).                                                                                                                |
| 3.14 `verdictStore.save as any` in 5+ sites               | Open. `consent-service.ts:130`, `pdpa-consent-gate.ts:233`, `claim-classifier.ts:294,341,388`.                                                                                    |
| 3.15 Untyped Graph API response fields                    | Open in `whatsapp-management.ts`.                                                                                                                                                 |
| 3.16 Missing null guard on agentContext                   | Open in re-engagement reader (verify during impl).                                                                                                                                |
| 3.17 Allowlist gaps (3 routes)                            | **Closed** — all 3 routes now under "Permanently justified" in `route-allowlist.yaml:154–161`.                                                                                    |

15 of 17 still open; 1 partially closed; 1 closed.

---

## Section 1 — Route classification decision table (LOAD-BEARING)

Every route under `apps/api/src/routes/` and `apps/dashboard/src/app/api/**` answers these questions in order. The first "yes" wins.

| #   | Question                                                                                                                                                           | Class                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| 1   | Does the route only read, derive, or refresh a cached projection? (No state mutation; cache invalidation counts as "refresh.")                                     | **read-only / derived-read**    |
| 2   | Does the route accept an external inbound event (webhook, OAuth callback, channel receiver) before normal ingress can construct a `CanonicalSubmitRequest`?        | **ingress-equivalent receiver** |
| 3   | Does the route transition the state of an already-created governance record — approval response, DLQ retry, escalation reply, lifecycle service action?            | **lifecycle transition**        |
| 4   | Does the route configure org / agent / policy / credentials / identity / billing — settings the system reads, not actions the system takes?                        | **control-plane configuration** |
| 5   | Does the route represent an operator asking the system to change business state (opportunity stage, recommendation action, contact consent, lifecycle resolution)? | **operator-direct mutation**    |

Two test cases from the current codebase that show why the order matters:

- `dashboard-reports.ts` POST `/refresh` matches question 1 (cache invalidation + recomputation), not question 5. Its existing allowlist rationale ("cache invalidation + read-side computation; no business state mutation") is the right call — the contract under this taxonomy classifies it as **read-only**.
- `meta-deletion.ts` POST matches question 2 (Meta-signed inbound webhook), not question 5. Even though it mutates contact PII, the operator did not initiate it — Meta did. Its allowlist rationale ("HMAC-verified inbound webhook; pre-ingress channel receiver") aligns.

**Edge cases that are NOT class boundaries:**

- A route that internally fans out to multiple stores is still one class — the class is decided by the user's intent, not the implementation.
- A route that returns 503 when a dependency is missing is still a member of its class (the 503 is a system-failure response, not a separate behavior).
- A route under `apps/dashboard/src/app/api/dashboard/**` is **always** "dashboard proxy" — already allowlisted as a structural forwarding layer. The classification applies at the API tier where the actual handler lives.

**Classification is permanent.** A route's class is declared in a header comment (`// @route-class: <name>`) and verified by `check-routes` (Section 12). Promoting a route across classes — e.g., moving an old control-plane config route into operator-direct mutation — requires the same migration discipline as moving from "no class" to "operator-direct."

---

## Section 2 — The five route classes

### 2.1 Operator-direct mutation

**Definition:** An operator (a human via an API key bound to an organization) asks the system to change business state.

**Examples on `main`:** `dashboard-opportunities.ts` PATCH `/:id/stage`, `recommendations.ts` POST `/:id/act`, `lifecycle-disqualifications.ts` POST `/:threadId/confirm` and `/dismiss`, `admin-consent.ts` POST `/grant`, `/revoke`, `/clear`.

**Canonical pattern:** the Phase 1b exemplar — `requireOrganizationScope` → `getIdempotencyKey` → `app.platformIngress.submit({ trigger: "api", surface: { surface: "api" } })` → `ingressErrorToReply` for system errors → typed `OPERATOR_INTENT_ERROR_CODES` for domain failures → throw-to-500 for unexpected → typed unwrap of `outputs` for non-error structured payload.

**This is the class that the operator-direct-ingress-pattern.md spec codified.** The contract here makes its conventions normative.

### 2.2 Lifecycle transition

**Definition:** Operates on the state of a record that already passed through ingress. The transition is the lifecycle's own state machine, not a new governed action.

**Examples on `main`:** `approvals.ts` (approval response via `transitionApproval` / `ApprovalLifecycleService`), `dlq.ts` (retry/resolve failed messages), `escalations.ts` (owner reply on existing escalation record).

**Why distinct from operator-direct:** The original action already passed ingress; re-routing the response through ingress would double-govern it. DOCTRINE explicitly carves this out ("Approval is lifecycle state, not a route-owned side effect").

**Contract obligation:** the lifecycle service (not the route) MUST persist its own audit record. Routes in this class are thin transports — `transitionApproval(...)` → unwrap → reply. The route does not own the audit trail; the service does.

### 2.3 Control-plane configuration

**Definition:** Owner-controlled platform configuration. Settings the system reads when it constructs ingress requests, not actions the system takes.

**Examples on `main`:** `governance.ts` (governance profile + halt/resume), `policies.ts` (policy CRUD), `identity.ts` (agent identity spec), `organizations.ts` (org settings), `agents.ts` (agent roster), `connections.ts` (encrypted credential CRUD), `billing.ts` (Stripe lifecycle), `marketplace.ts` (listings + deployments), `knowledge.ts`, `knowledge-entries.ts`, `deployment-memory.ts`, `playbook.ts`.

**Why distinct from operator-direct:** these mutate platform configuration and external-service auth state, not business state executed by an agent on the operator's behalf. Sending `policies.ts` PUT through `platformIngress.submit({ intent: "operator.update_policy" })` adds ceremony without governance value — the policy itself is what governance evaluates.

**Contract obligation:** still mutating, still requires the auth-guard + validation + error-envelope contract; **does not** require WorkTrace or `Idempotency-Key`. The audit trail is owned by `auditLedger.record()` called directly in the handler (already in `policies.ts` — the existing exemplar).

### 2.4 Ingress-equivalent receiver

**Definition:** External inbound event handler. Receives a payload before a `CanonicalSubmitRequest` can be constructed; hands off to a gateway or async worker that subsequently invokes ingress.

**Examples on `main`:** `ad-optimizer.ts` (Meta CTWA lead webhook), `meta-deletion.ts` (Meta GDPR data-deletion callback), `managed-webhook.ts` (WhatsApp / Slack / Telegram inbound chat), `whatsapp-onboarding.ts` (Meta Embedded Signup OAuth), `whatsapp-flows.ts` (Meta Flows RSA/AES decrypt), `facebook-oauth.ts`, `google-calendar-oauth.ts`.

**Why distinct:** the caller is not the operator. Operator intent (the `actor.id` for any downstream ingress call) is reconstructed inside the receiver from the payload + a webhook signature or OAuth state. Imposing an `Idempotency-Key` header contract on a Meta webhook is meaningless — Meta doesn't send one.

**Contract obligation:** signature/secret verification + auth-on-the-handoff (the gateway or worker that this receiver calls into MUST itself satisfy the operator-direct contract if it constructs an operator-attributed mutation). Validation, error-envelope, and observability obligations apply; WorkTrace + idempotency-key do not.

### 2.5 Read-only / derived-read

**Definition:** No **business-state** mutation. Includes pure GET endpoints, query-derived projections, cache-invalidation/recomputation endpoints (`dashboard-reports.ts` POST `/refresh`), and **diagnostic-write surfaces** that persist non-business state (Tech Provider test sends, health-probe results, audit-of-self records) where the persisted row exists for observability rather than customer-facing business effect.

**Examples on `main`:** `dashboard-overview.ts`, `dashboard-activity.ts`, `dashboard-contacts.ts`, `dashboard-reports.ts` (both GET + POST `/refresh`), `agents.ts` GET, `health.ts`, `readiness.ts`, `roi.ts`, `whatsapp-send-test.ts` (diagnostic-write — see §4.7 envelope exception).

**Contract obligation:** auth-guard + validation + error-envelope. **No WorkTrace, no idempotency, no audit.** A `/refresh` POST is still in this class because it recomputes from already-persisted data — no business state changes. A diagnostic-write surface is still in this class because the persisted row is observability, not a customer-facing mutation; the class exception is documented in `route-allowlist.yaml` rationale (whatsapp-send-test's existing rationale is the exemplar).

---

## Section 3 — Per-class contract matrix

Each cell is mandatory unless marked optional. The matrix is the doctrine; everything else in this spec is the _implementation_ of these cells.

| Concern                                    | operator-direct                                    | lifecycle                               | control-plane                            | ingress-receiver                        | read-only                  |
| ------------------------------------------ | -------------------------------------------------- | --------------------------------------- | ---------------------------------------- | --------------------------------------- | -------------------------- |
| Auth guard                                 | `app.requireOrgForMutation` decorator              | `app.requireOrgForMutation` decorator   | `app.requireOrgForMutation` decorator    | signature/secret verification           | `app.requireOrg` decorator |
| Idempotency-Key header                     | **Required (400 if absent)**                       | optional (lifecycle service idempotent) | optional (CRUD safety is store-side)     | n/a (caller doesn't send)               | n/a                        |
| WorkTrace persistence                      | **Required** (via `PlatformIngress.submit`)        | service-owned (transitionApproval/etc.) | n/a (auditLedger.record in handler)      | downstream worker's obligation          | n/a                        |
| Audit ledger entry                         | derived from WorkTrace                             | service-owned                           | **Required (handler-level)**             | optional (handler-level if useful)      | n/a                        |
| Success response envelope                  | typed payload, no wrapper                          | typed payload, no wrapper               | typed payload, no wrapper                | `{ ok: true, ... }` or 204              | typed payload, no wrapper  |
| Domain failure envelope                    | `{ error: <CODE>, ...structured }`                 | `{ error: <CODE>, ...structured }`      | `{ error: <CODE>, ...structured }`       | n/a (`error: "invalid_signature"` etc.) | n/a                        |
| Validation failure envelope                | `{ error: "invalid_body", issues: ZodIssue[] }`    | same                                    | same                                     | same                                    | same                       |
| System failure envelope                    | `ingressErrorToReply(error, reply)`                | same (or service-owned)                 | `{ error: "internal_error" }` (scrubbed) | same                                    | same                       |
| Unexpected handler exception               | throw → global handler → 500 scrubbed              | same                                    | same                                     | same                                    | same                       |
| Cross-app types source                     | `@switchboard/schemas` (mandatory)                 | same                                    | same                                     | same                                    | same                       |
| Store-layer mutation contract (Section 10) | required `organizationId` arg + `updateMany` WHERE | same                                    | same                                     | same                                    | n/a                        |
| `// @route-class:` header comment          | required                                           | required                                | required                                 | required                                | required                   |

**Routes that violate a cell are non-conformant.** PR-4 in the migration strategy is where `check-routes` flips from "warn if cell violated on touched routes" to "error if any route violates any cell."

---

## Section 4 — The Mutating Route Contract envelope

The single shape every mutating route emits. Replaces the 7+ inconsistent envelopes flagged by Cat 3.3.

### 4.1 Success

```ts
reply.code(2xx).send(<typed-payload>);
// Payload type imported from @switchboard/schemas. No envelope wrapper.
```

Examples (already conformant):

- `dashboard-opportunities.ts:90` → `{ opportunity }`
- `lifecycle-disqualifications.ts:192` → `{ result: "confirmed", alreadyApplied?: boolean }`
- `admin-consent.ts:153` → `await respondWithState(parsed.data.contactId)` (typed PDPA state)

### 4.2 Domain failure

```ts
reply.code(4xx).send({
  error: <CODE from OPERATOR_INTENT_ERROR_CODES or class-equivalent>,
  ...structuredFields,
});
```

`<CODE>` is a stable upper-snake-case string literal exported as a constant. The structured fields are typed in the class's intent's `OutputsSchema` (Section 9).

Examples (already conformant):

- `dashboard-opportunities.ts:77` → `{ error: OPERATOR_INTENT_ERROR_CODES.OPPORTUNITY_NOT_FOUND }`
- `admin-consent.ts:272` → `{ error: "contact_not_found", contactId: o["contactId"] }`
- `lifecycle-disqualifications.ts:170` → `{ reason }`

### 4.3 Validation failure (uniform across all routes)

```ts
reply.code(400).send({
  error: "invalid_body",
  issues: parsed.error.issues, // raw ZodIssue[]
  statusCode: 400,
});
```

Closes Cat 3.7. Removes the current mix of `{ details: error.format() }` / `{ issues: error.issues.map(...) }` / `{ details: error.issues }`. The helper lives in `apps/api/src/utils/validation-error.ts` (Section 7).

### 4.4 System failure (PlatformIngress error path)

```ts
return ingressErrorToReply(response.error, reply);
```

Already implemented at `apps/api/src/utils/ingress-error-to-reply.ts`. Maps:

- `intent_not_found` / `deployment_not_found` → 404
- `entitlement_required` → 402 with `blockedStatus`
- everything else → 400

### 4.5 Auth failure

```ts
reply.code(403).send({
  error: "forbidden",
  reason: "organization_mismatch" | "no_org_binding" | "no_principal_binding",
  statusCode: 403,
});
```

Routes never write this directly — the `requireOrg` / `requireOrgForMutation` / `requireOrgForAuditedMutation` decorators emit it (Section 6). `no_principal_binding` is emitted only by `requireOrgForAuditedMutation` and only in production: it fails closed when a PDPA-regulated mutation lacks a bound principal, restoring the pre-Impl-PR-1 `bootstrap/routes.ts` `resolveActor` guard that ensured the audit trail always records a real actor for consent grant/revoke/clear.

### 4.6 Unexpected handler exception

`throw new Error(...)`. The global Fastify error handler catches and returns:

```ts
reply.code(500).send({ error: "internal_error", statusCode: 500 });
```

The error is logged with the structured codes intact; the client envelope is scrubbed. Pattern already in use at `dashboard-opportunities.ts:83`, `recommendations.ts:219`, `lifecycle-disqualifications.ts:176`, `admin-consent.ts:297`.

### 4.7 Response-envelope conformance check

`check-routes` (PR-4) will grep each route's `reply.code(...)` calls and verify every response shape matches one of the six envelopes above. Routes with legacy envelopes (e.g. `{ error: { code, message, retryable } }` for external-API integration surfaces) are flagged unless their `route-allowlist.yaml` rationale explicitly documents the envelope divergence as required by the upstream API contract. The Tech Provider verification surface (`whatsapp-send-test.ts`) is the current exemplar of this exception — Meta's error model surfaces a `retryable` hint to clients for upstream rate-limit handling, and the legacy envelope is the most honest way to forward that hint.

---

## Section 5 — WorkTrace coverage rule + cohort canonicalization

**The rule:** any user-initiated mutation (class: operator-direct), including its tenant-isolation reject path, MUST produce a WorkTrace.

This is the closing of the audit-trail gap (Cat 3.1) for the operator-direct class. The other classes have their own audit obligations (Section 3) but do not pay the WorkTrace cost.

### 5.1 Cohort canonicalization (resolves Phase 1b Amendment 3)

The three migrated cohorts diverged in how they handle domain rejection:

- **Cohort A (1b.1, opportunities):** handler returns `outcome: "failed"` with typed code → route maps to HTTP. **WorkTrace persisted with failed outcome (audit-trail captures domain failure).** ✅ canonical.
- **Cohort B (1b.2, recommendations):** pre-flight 404/403 in route before ingress (`recommendations.ts:178-184`). ❌ **WorkTrace absent for cross-tenant access attempts** — gap.
- **Cohort C (1b.3, disqualifications):** handler always `outcome: "completed"`; route unwraps `outputs.result` to decide HTTP. ❌ **WorkTrace conflates handler-success with domain-failure** — gap.
- **Cohort D (1b.4, consent):** hybrid — typed `failed` outcomes for domain rejections + post-mutation reader read for response shape. ✅ matches cohort A semantics.

**The contract picks Cohort A as canonical.** Cohorts B and C migrate to it under PR-1:

- **Cohort B → A:** the org-mismatch check (`row.orgId !== orgId`) moves into the handler. The handler returns `outcome: "failed"` with an entity-not-found code (`RECOMMENDATION_NOT_FOUND`, `OPPORTUNITY_NOT_FOUND`, etc. — see "naming policy" below) and a WorkTrace is persisted. Tenant-reject attempts now appear in the audit trail.
- **Cohort C → A:** the handler stops always-returning `completed`. Domain failures map to typed `failed` codes (`DISQUALIFICATION_NOT_FOUND`, `DISQUALIFICATION_CONFLICT` already exist in `OPERATOR_INTENT_ERROR_CODES`; reuse them). The route's outcome-unwrap logic stays the same; only the handler's outcome value changes.

**Naming policy for the tenant-reject code:** return `<ENTITY>_NOT_FOUND`, not a `TENANT_MISMATCH`-style code. The latter leaks information ("this resource exists, you just don't own it") that the former conceals. This matches the existing `prisma-approval-store.ts:62` rationale (PR #590 / #598) where `count===0` cannot differentiate tenant-mismatch from missing-row, and the security-correct response is to treat them identically at the HTTP boundary. Observability for tripwire purposes uses log-side fields (e.g., `attempted_org_id` vs `resource_org_id` in the WorkTrace `error.metadata`), not the client-facing code.

### 5.2 Required test coverage per operator-direct intent

Each intent's test file (`apps/api/src/routes/__tests__/<route>-ingress.test.ts`) MUST assert all of:

- Happy path: WorkTrace persisted with `outcome: "completed"` and `mode: "operator_mutation"`.
- Domain-failure path: WorkTrace persisted with `outcome: "failed"`, typed `error.code`, and HTTP response shape matching Section 4.2.
- **Tenant-reject path:** WorkTrace persisted with `outcome: "failed"` and code matching the entity-not-found convention; HTTP 404.
- Idempotency replay: same `Idempotency-Key` + payload → cached response on second call; WorkTrace count does not increment.

This list extends the operator-direct-ingress-pattern.md "Migration checklist" step 5 by adding the explicit tenant-reject case.

### 5.3 Non-operator-direct classes

- **Lifecycle transition:** service (`transitionApproval`, `ApprovalLifecycleService.respond`, DLQ retry workers) owns the audit record. Routes are thin transports; contract verifies the service was called, not that the route called `auditLedger.record()`.
- **Control-plane configuration:** handler-level `app.auditLedger.record({ action: "<resource>.<verb>", actor, snapshot })` is required. `policies.ts` is the existing exemplar.
- **Ingress-equivalent receiver:** the downstream gateway/worker is on the hook for WorkTrace when it constructs an operator-attributed mutation. The receiver itself can optionally `auditLedger.record()` the inbound event (e.g., "Meta webhook received, signature valid").
- **Read-only:** no obligation.

---

## Section 6 — Auth-guard middleware (decorators)

Promote the existing `requireOrganizationScope` / `resolveOrganizationForMutation` helpers to typed Fastify decorators. Eliminates the duplicated preHandler block currently in every migrated route (`dashboard-opportunities.ts:21-33`, `recommendations.ts:80-89`, `lifecycle-disqualifications.ts:42-54`, `admin-consent.ts:84-99`).

### 6.1 The two decorators

```ts
// apps/api/src/decorators/require-org.ts
declare module "fastify" {
  interface FastifyRequest {
    orgId: string; // narrowed, non-nullable, available after requireOrg preHandler
    actorId: string; // narrowed, non-nullable
  }
}

// Register at bootstrap:
app.decorate("requireOrg", {
  /* preHandler that narrows orgId */
});
app.decorate("requireOrgForMutation", {
  /* read-side + body-orgId enforcement */
});
app.decorate("devAuthFallback", {
  /* x-org-id header preHandler for authDisabled */
});
```

### 6.2 Route registration shape

```ts
app.patch(
  "/api/dashboard/opportunities/:id/stage",
  {
    preHandler: [app.devAuthFallback, app.requireOrgForMutation],
    schema: {
      /* zod-to-json-schema */
    },
  },
  async (request, reply) => {
    // request.orgId and request.actorId are already narrowed string (no `?? "unknown"`).
    // No `if (!orgId) return;` boilerplate.
  },
);
```

### 6.3 Migration semantics

- `requireOrganizationScope(request, reply)` → `app.requireOrg` preHandler. Trigger conditions unchanged (403 if `organizationIdFromAuth` absent); **envelope normalizes** to §4.5 (`{ error: "forbidden", reason, statusCode: 403 }`), replacing the current English `error` string. Clients reading HTTP status code keep working; clients reading the message string break.
- `resolveOrganizationForMutation(request, reply, bodyOrgId)` → `app.requireOrgForMutation` preHandler. Trigger conditions unchanged (dev-mode accepts body orgId; auth-enabled mode requires header match; mismatch → 400); envelope normalizes per §4.5.
- `devAuthFallback` consolidates the `app.addHook("preHandler", async (request) => { if (app.authDisabled) ... })` block currently duplicated in 4+ routes.

The decorator replaces the boilerplate and tightens the envelope contract. Tests covering trigger conditions keep their shape; envelope assertions (the few tests that check the English `error` string) update in the same PR. PR-1's plan audits which clients/UIs read `error: string` vs HTTP code and includes any consumer fixes alongside the route changes.

### 6.4 Closes Cat 1 residual

This decorator change is also the planned site for closing Cat 1 finding 1.5 (`(req as any).principalIdFromAuth` / `organizationIdFromAuth` casts at `apps/api/src/bootstrap/routes.ts:215,227`). With the decorator declaring the augmented `FastifyRequest`, the casts become unnecessary.

---

## Section 7 — Idempotency-key enforcement

`Idempotency-Key` is **mandatory** on operator-direct mutating routes and **optional** on control-plane / lifecycle routes. Webhooks and read-only routes are exempt.

### 7.1 Mandatory branch (operator-direct class)

```ts
// apps/api/src/utils/idempotency-key.ts (extends current shape)
export function requireIdempotencyKey(request: FastifyRequest, reply: FastifyReply): string | null {
  const key = getIdempotencyKey(request);
  if (!key) {
    reply.code(400).send({
      error: "missing_idempotency_key",
      hint: "Idempotency-Key header is required for this endpoint",
      statusCode: 400,
    });
    return null;
  }
  return key;
}
```

Operator-direct routes use `requireIdempotencyKey` instead of `getIdempotencyKey`. The current optional pattern (4 migrated routes) becomes mandatory under PR-1.

### 7.2 Optional branch (control-plane / lifecycle)

Existing `getIdempotencyKey(request): string | undefined` is unchanged. Control-plane CRUD endpoints (knowledge-entries, deployment-memory, scheduled-reports) MAY accept the header for client retry safety, but the absence is not an error. The store-layer mutation contract (Section 10) provides the actual idempotency guarantee at the database level for these classes.

### 7.3 Webhook + read-only branch

No idempotency obligation. Webhooks rely on the external sender's retry semantics + signature/dedup-store; read-only routes have nothing to dedup.

### 7.4 HTTP idempotency middleware (issue #575)

Issue #575 (fingerprint-ordering bug in HTTP idempotency middleware) is **not** resolved by this spec. The contract assumes the middleware works correctly; #575 is a separate fix that PR-1 verifies once before mandating the header. If #575 still bites, the impl PR documents the workaround and defers the mandate to a follow-up.

---

## Section 8 — Cross-app types in `@switchboard/schemas`

The rule: **any type that crosses an app boundary lives in `@switchboard/schemas`. Local interface declarations of cross-boundary shapes are a CI-checked violation.**

Closes Cat 3.4, 3.5, 3.6, 3.10, 3.9 in one PR (PR-2 in the migration strategy).

### 8.1 ApprovalRecord (3.4)

Extract to `packages/schemas/src/approval.ts`:

```ts
export const ApprovalRecordSchema = z.object({
  request: ApprovalRequestSchema,
  state: ApprovalStateSchema,
  envelopeId: z.string(),
  organizationId: z.string().nullable(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
```

Consumers:

- `apps/api/src/routes/dashboard-overview.ts:64` — import schema type, delete local interface.
- `packages/core/src/platform/platform-lifecycle.ts:36` — replace `NonNullable<Awaited<ReturnType<CoreApprovalStore["getById"]>>>` with the imported type.
- `packages/db/src/storage/prisma-approval-store.ts:6` — local type becomes a row-to-schema mapper (`toApprovalRecord(row)` already exists at line 78).
- `packages/core/src/channel-gateway/__tests__/channel-gateway-approval.test.ts` — import schema type.

### 8.2 ConversationState (3.5)

Already at `packages/schemas/src/chat.ts:64` (verified). Residual:

- `apps/chat/src/conversation/state.ts:10` — re-export from schemas; remove local `ConversationStateData` interface.
- `apps/api/src/routes/conversations.ts:20` — replace `ConversationRow` + `ConversationSummary` + `ConversationDetail` local interfaces with schema-derived types; if the API needs a public projection, add `ConversationSummarySchema` / `ConversationDetailSchema` to `packages/schemas/src/chat.ts` as named projections of `ConversationStateSchema`.

### 8.3 Handoff (3.6)

Add `packages/schemas/src/handoff.ts`:

```ts
export const HandoffSchema = z.object({
  id: z.string(),
  conversationThreadId: z.string(),
  contactId: z.string().nullable(),
  reason: z.string(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().nullable(),
  context: z.record(z.unknown()).nullable(),
});
export type Handoff = z.infer<typeof HandoffSchema>;
```

Audit during PR-2: which call sites currently use ad-hoc handoff shapes (`escalations.ts`, `decisions/adapters/handoff-adapter.ts`)? The PR-2 plan documents the exact field set after grep.

### 8.4 DashboardOverview → OperatorOverview (3.10)

Rename in `packages/schemas/src/dashboard.ts`:

```ts
export const OperatorOverviewSchema = z.object({
  /* current DashboardOverview shape */
});
export type OperatorOverview = z.infer<typeof OperatorOverviewSchema>;

// One-cycle back-compat alias. Remove in PR-4.
export const DashboardOverviewSchema = OperatorOverviewSchema;
export type DashboardOverview = OperatorOverview;
```

Consumer migration is opportunistic during PR-2 (api + dashboard imports); the alias keeps any unmigrated consumer compiling. PR-4 removes the alias once `check-routes` reports zero `DashboardOverview` references.

### 8.5 Surface-URL strings in core (3.9)

Routes are presentation; they belong to surfaces. Core projections injecting `/contacts/${id}` literals violate the surface-agnostic-backend principle.

Resolution: extract URL templates into a `routeTemplates` dependency parameter, injected by the surface adapter at the API boundary.

```ts
// packages/core/src/contacts/list.ts
export interface ContactListDeps {
  contactStore: ContactStore;
  routeTemplates: {
    contactDetail: (id: string) => string; // e.g. id => `/contacts/${id}`
  };
}
```

The API + chat + dashboard adapters each construct `routeTemplates` once at bootstrap. Core no longer knows about URLs.

### 8.6 The doctrine line

Add to `docs/DOCTRINE.md` under the cross-app type section:

> **Cross-app types live in `@switchboard/schemas`.** A type declared in `apps/api/`, `apps/chat/`, or `apps/dashboard/` that is also defined elsewhere — by name, by shape, or by structural duplication — is a contract violation. `check-routes` flags new local declarations of types that match a `@switchboard/schemas` export.

---

## Section 9 — `outputs`-as-structured-payload sub-pattern (typed)

`OperatorMutationHandlerResult.outputs` is `Record<string, unknown>` at the runtime boundary (`packages/core/src/platform/modes/operator-mutation-mode.ts:20`). The current pattern (`result.outputs as { opportunity?: T }`) loses compile-time safety.

### 9.1 The typed extension

Each registered intent declares an `OutputsSchema` alongside `parameterSchema`:

```ts
intentRegistry.register({
  intent: TRANSITION_OPPORTUNITY_STAGE_INTENT,
  defaultMode: "operator_mutation",
  parameterSchema: TransitionOpportunityStageParametersSchema.shape,
  outputsSchema: TransitionOpportunityStageOutputsSchema.shape, // NEW
  // ... rest unchanged
});
```

`OutputsSchema` lives in `apps/api/src/routes/operator-intents-schemas.ts` alongside the parameters schema. The handler returns `outputs` matching the schema; the route parses with the schema rather than casting.

### 9.2 Route unwrap pattern

```ts
// Before (current):
const outputs = result.outputs as { opportunity?: PipelineBoardOpportunity };
const opportunity = outputs.opportunity;

// After:
const outputs = TransitionOpportunityStageOutputsSchema.parse(result.outputs);
return { opportunity: outputs.opportunity };
```

Compile-time safety + runtime validation. If a handler regression returns the wrong shape, the route's parse throws (→ scrubbed 500) rather than silently returning `undefined`.

### 9.3 Handler return-type tightening

Strongly-typed handler factories use the parsed Outputs type:

```ts
export function buildTransitionOpportunityStageHandler(
  opportunityStore: OpportunityStore,
): OperatorMutationHandler<TransitionOpportunityStageOutputs> {
  return {
    async execute(workUnit) {
      // outputs return type is typed; mistakes are compile errors
    },
  };
}
```

`OperatorMutationHandler<TOutputs>` is the typed generic; the existing untyped version stays as `OperatorMutationHandler = OperatorMutationHandler<Record<string, unknown>>` for back-compat during migration.

### 9.4 Closes "Open risks" item

The operator-direct-ingress-pattern.md spec flagged:

> `outputs` typing in `WorkflowHandlerResult` is loose (`Record<string, unknown>`). Routes parse outputs at the boundary. Acceptable for Phase 1b; tighten in Design A.

This section is the tightening.

---

## Section 10 — Store-layer mutation contract

The PR #590 + PR #598 pattern is **normative for ALL store-side writes** (mutating routes' downstream stores, regardless of class).

### 10.1 The contract

- Every `update` / `updateMany` / `delete` method on a Prisma store takes a required `organizationId: string | null` argument. The argument is nullable only for resources without a tenant binding (audit ledger global rows, system config); per-tenant resources must declare it non-nullable.
- The WHERE clause includes `organizationId`. **Use `updateMany` even for single-row updates** so `count === 0` semantically represents "row missing, version stale, OR tenant mismatch" — the security-correct conflation.
- Throw a typed error: `StaleVersionError` for prisma stores (cannot differentiate cases without an extra read); subclass for in-memory stores where the case is observable (`TenantMismatchError extends StaleVersionError` for tripwire-style observability).
- Remove any unversioned `update` branch from the same method when tightening — the dead code path is a future foot-gun.

### 10.2 The exemplar (already on `main`)

`PrismaApprovalStore.updateState` at `packages/db/src/storage/prisma-approval-store.ts:39-65` is the canonical shape. PR-3 in the migration strategy applies this pattern to the 17+ Round-2 candidates tracked in [issue #601](https://github.com/jsonljc/switchboard/issues/601), highest priority `prisma-deployment-connection-store.ts:41` (live prod callers via Inngest webhook).

### 10.3 Closes Cat 3.14 in the same PR

`verdictStore.save` is currently cast `as any` in 5+ sites (`consent-service.ts:130`, `pdpa-consent-gate.ts:233`, `claim-classifier.ts:294,341,388`). The casts exist because `VerdictStore.save`'s parameter type doesn't accept the call-site shapes cleanly.

PR-3 tightens the verdict types in `@switchboard/schemas`, removes the casts, and adds the tenant-isolation contract to verdict stores.

### 10.4 Cat 1 residual capture

This contract makes the open Cat 1 items 1.7 + 1.8 (already shipped via PR #590) the doctrine baseline, not exceptional fixes. Future store work that omits the contract is a regression detectable by:

- New store methods missing `organizationId` arg flagged in code review.
- `check-routes` extension (PR-4) scans Prisma store files for `update(` / `delete(` / `updateMany(` calls without an `organizationId` reference in the surrounding 10 lines.

---

## Section 11 — Cat 3 finding crosswalk

Each Cat 3 finding closes via a contract clause and a specific impl PR. Useful for tracking + post-merge verification.

| Finding                                | Closing clause                                                                                                                            | Impl PR                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 3.1 Audit-trail gap (48 routes)        | §3 matrix + §5 WorkTrace rule + §1 classification table                                                                                   | PR-1 + PR-4C                                             |
| 3.2 Idempotency-key gap                | §7 (mandatory on operator-direct)                                                                                                         | PR-1                                                     |
| 3.3 Error response shape               | §4 envelope                                                                                                                               | PR-1 + PR-4C                                             |
| 3.4 ApprovalRecord dup                 | §8.1                                                                                                                                      | PR-2                                                     |
| 3.5 ConversationState dup              | §8.2 (residual consumer migration)                                                                                                        | PR-2                                                     |
| 3.6 Handoff type missing               | §8.3                                                                                                                                      | PR-2                                                     |
| 3.7 Validation error structure         | §4.3                                                                                                                                      | PR-1                                                     |
| 3.8 Optional audit on conversations.ts | §3 matrix (control-plane class requires handler-level audit)                                                                              | PR-1                                                     |
| 3.9 Surface-URL strings in core        | §8.5                                                                                                                                      | PR-2                                                     |
| 3.10 DashboardOverview                 | §8.4                                                                                                                                      | PR-2                                                     |
| 3.11 meta-deletion lacks WorkTrace     | §2.4 (ingress-receiver: receiver-level obligation, downstream worker owns WorkTrace)                                                      | (already allowlisted; doctrine just makes it explicit)   |
| 3.12 dashboard-reports.ts              | §2.5 (read-only: no WorkTrace obligation)                                                                                                 | (already allowlisted; doctrine makes it explicit)        |
| 3.13 whatsapp-send-test.ts             | §2.5 diagnostic-write + §4.7 envelope exception (Tech Provider verification surface — class exception documented in route-allowlist.yaml) | (already allowlisted; doctrine documents the exception)  |
| 3.14 `verdictStore.save as any`        | §10.3                                                                                                                                     | PR-3                                                     |
| 3.15 Untyped Graph API response        | Section 8.6 doctrine line (cross-app types) — Graph API response shapes belong in a typed wrapper, not raw casts                          | Deferred → #655 (deferred from PR-4; not closed in PR-3) |
| 3.16 Null guard on agentContext        | Captured via §9 typed outputs (re-engagement reader is a downstream consumer)                                                             | Deferred → #655 (deferred from PR-4; not closed in PR-3) |
| 3.17 Allowlist gaps (3 routes)         | **Already closed**                                                                                                                        | n/a                                                      |

**Deferred store tenant-scoping:** `CreatorIdentity` (×5) + `storage/prisma-lifecycle-store.updateDispatchRecord` mutations reach `organizationId` only via an FK with no Prisma `@relation`; tenant-scoping awaits a schema migration (suppressed `// route-governance: store-mutation-deferred`) — tracked in #643.

**Deferred operator-direct contract:** `actions.ts` / `execute.ts` / `ingress.ts` / `revenue.ts` are classified operator-direct but carry `// route-governance: operator-direct-contract-deferred` (matrix cell deferred pending decorator wiring / ingress migration) — tracked in #654.

---

## Section 12 — Migration strategy

Four implementation PRs grouped by tree, each landing on `main` independently. Each PR is brainstorm-or-plan-first per CLAUDE.md branch doctrine.

### PR-1 — Operator-direct cohort completion + warning-mode checker

**Scope:**

- Codify `app.requireOrg` + `app.requireOrgForMutation` + `app.devAuthFallback` decorators (Section 6).
- Replace duplicated preHandlers in the 4 ingress-migrated routes.
- Mandate `Idempotency-Key` via `requireIdempotencyKey` on operator-direct routes (Section 7.1).
- Normalize validation error envelope per §4.3 across all routes via a shared `replyValidationError(reply, parsed.error)` helper.
- Migrate Cohort B (`recommendations.ts`) and Cohort C (`lifecycle-disqualifications.ts`) to Cohort A WorkTrace semantics (Section 5.1).
- Add `// @route-class:` headers to **all 4 ingress-migrated routes + all routes touched in this PR** (subset; not the full 67).
- Ship `check-routes` extension in **warning mode for touched routes only**: parses `@route-class` header, validates against per-class matrix, prints warnings (not errors) for non-conformant cells. The checker is wired into CI as a non-blocking advisory.

**Files:** ~12 (4 routes + 3 utils/decorators + 2 schema files + 3 test files + check-routes.ts).

**Why first:** small + recently-touched surface + closes the highest-density Cat 3 findings (3.2, 3.3, 3.7, parts of 3.1 and 3.8) + establishes the doctrine that every subsequent PR consumes.

### PR-2 — Cross-app type relocation

**Scope:**

- Extract `ApprovalRecord` → `packages/schemas/src/approval.ts` (Section 8.1).
- Extract `Handoff` → `packages/schemas/src/handoff.ts` (Section 8.3).
- Finish `ConversationState` consumer migration in chat + api (Section 8.2).
- Rename `DashboardOverview` → `OperatorOverview` with back-compat alias (Section 8.4).
- Extract `routeTemplates` from core projections — eliminate 4 surface-URL string sites (Section 8.5).
- Doctrine line added to `docs/DOCTRINE.md` (Section 8.6).
- Add `check-routes` rule: new local interface declaration matching a `@switchboard/schemas` export name is a warning.

**Files:** ~20 (new schema files + consumer migrations across api + chat + dashboard + core).

**Independence:** can land before or after PR-1; the schema additions are pure additions until the consumer migrations land.

**Collision risk with parallel cockpit work:** the cockpit session active on 2026-05-16 touches `apps/dashboard/src/components/cockpit/**`; consumer migration in PR-2 may touch `apps/dashboard/src/lib/api-client-types.ts` and dashboard hook files. Grep before sequencing; the back-compat alias on `DashboardOverview` keeps cockpit consumers compiling without coordinated change.

### PR-3 — Store-layer contract sweep

**Scope:**

- Apply Section 10 contract to all 17+ Round-2 candidates in issue #601, sequenced 3a (deployment-connection — live prod callers) → 3b (bundled deployment-tier + per-org stores) → 3c (`prisma-lifecycle-store.ts:261` DispatchRecord.update).
- Tighten `VerdictStore.save` types in `@switchboard/schemas`; remove `as any` casts at the 5+ sites in Cat 3.14.
- Add `check-routes` rule: store methods with `update` / `updateMany` / `delete` lacking `organizationId` reference in surrounding context produce a warning.

**Files:** ~30 (17 stores + verdict-related core files + test additions matching the PR #598 pattern).

**Independence:** Entirely backend; no dashboard collision. Independent of PR-1 and PR-2.

### PR-4 — Backfill + flip enforcement

**Scope:**

- Add `// @route-class:` headers to all remaining 67 - <PR-1 set> routes (the 4 PR-1 routes already have them).
- Flip `check-routes` from warning to error: per-class matrix violations now fail CI.
- Remove the `DashboardOverview` back-compat alias from §8.4 (verify zero remaining references first).
- Document any class exceptions explicitly in `route-allowlist.yaml` rationale lines (the existing rationale field is the right place; this PR audits each entry against the new taxonomy).
- Update `docs/DOCTRINE.md` and `docs/ARCHITECTURE.md` with the route taxonomy + per-class matrix.

**Files:** ~75 (mostly one-line header additions + check-routes mode flip + doc updates).

**Why last:** validation of the full route taxonomy requires the doctrine to be present in code first. The flip from warning to error is reversible if a class boundary turns out to be wrong; running in warning mode for one CI cycle catches misclassifications before they block merges.

### Sequence + dependencies

```
PR-1 (operator-direct + checker warning mode) ──┐
PR-2 (cross-app types)                          ├─→ PR-4 (backfill + flip enforcement)
PR-3 (store-layer + verdict types)              ─┘
```

PR-1/2/3 can land in any order. PR-4 lands last so it observes the final state of all three.

---

## Section 13 — Seam with Phase 3B (Inngest Failure Contract)

Phase 3B is the next structural design phase (Cat 2 reliability findings). The two contracts share types but diverge on retry semantics.

**Shared (both contracts consume from `@switchboard/schemas`):**

- The typed-error envelope: `{ code: string; message: string }`.
- The operator alerter shape (`OperatorAlerter` in `packages/core/src/observability/operator-alerter.ts`).
- The audit ledger entry shape (`AuditLedger.record({...})` in `packages/core/src/audit/ledger.ts`).
- The `outputs`-as-structured-payload sub-pattern (Section 9) — an Inngest function result has the same "structured non-error payload" need as a route handler result.
- The `IngressError` discriminated union — async functions that call into ingress see the same error types.

**Diverged (Phase 3B owns):**

- Retry policy classification (recoverable vs non-recoverable failures).
- DLQ envelope shape (`FailedMessageStore` / `OutboxEvent` wiring).
- `onFailure` handler pattern (Cat 2.1 — currently absent on 7+ functions).
- Replay semantics (which functions are allowed to drop on terminal failure vs must persist for retry).
- Sentry parity for `mcp-server` (Cat 2.4).

**The seam:** this contract terminates at "route observed a `failed` outcome and produced a typed HTTP response." Phase 3B picks up at "async function observed a non-recoverable failure and emits a DLQ envelope." If a single async function is invoked both directly (route handler) and asynchronously (Inngest trigger), it satisfies _this_ contract on the synchronous path and _Phase 3B's_ contract on the async path. Same function; different obligations per call surface.

Phase 3B brainstorm should consume Sections 4 + 9 of this spec as inputs.

---

## Section 14 — Open risks + verifications during implementation

| Risk                                                                                            | Verification step                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.requireOrg` decorator changes test-harness wiring                                          | PR-1 must register decorators in `apps/api/src/__tests__/test-server.ts` (mirror existing `bootstrapOperatorIntents` registration pattern); regression test that all 4 migrated routes still pass their suite.                                       |
| Mandating `Idempotency-Key` breaks dashboard clients that don't send it                         | PR-1's dashboard proxy routes (under `apps/dashboard/src/app/api/dashboard/**`) get a thin wrapper that generates a UUID key when the operator UI doesn't supply one; or the operator UI is updated to supply one. Decision deferred to PR-1's plan. |
| Issue #575 (HTTP idempotency middleware fingerprint-ordering bug) blocks PR-1                   | Verify the bug before mandating; if still active, PR-1 documents the workaround and defers the mandate to a follow-up that ships after #575 fixes.                                                                                                   |
| Class misclassification in PR-4                                                                 | The warning-mode period (PR-1 through PR-4) is where reviewers can re-class without breaking CI; PR-4 enforces only after the warning-mode run identified zero contested boundaries.                                                                 |
| `DashboardOverview` alias removal breaks parallel cockpit work                                  | Grep cockpit tree for `DashboardOverview` references before PR-4 lands; coordinate with cockpit-session owner if any consumer is still un-migrated.                                                                                                  |
| Cohort B/C migration breaks existing tests                                                      | Cohort migration PRs include test updates for the new WorkTrace assertion; pre-merge run of `pnpm --filter @switchboard/api test` is mandatory.                                                                                                      |
| Cat 3.11/3.12/3.13 are flagged "open" but the doctrine treats them as class exceptions          | The Cat 3 crosswalk (§11) explicitly marks them as resolved-via-classification, not resolved-via-migration. Audit memory updates to reflect this when PR-4 lands.                                                                                    |
| `check-routes` warning-mode-only behavior allows silent regressions during the migration window | The window is bounded by PR-4 landing; CI advisory output is reviewed at each intermediate PR. If the window stretches beyond one calendar month, escalate to flip enforcement partial-class-by-partial-class rather than waiting for full backfill. |

---

## Section 15 — Success criteria

This spec is successful when, post-PR-4:

1. **Every route under `apps/api/src/routes/` carries a `// @route-class:` header** that matches one of the five classes and conforms to the per-class matrix in §3.
2. **`check-routes` enforces per-class compliance in CI** with errors (not warnings) on violations.
3. **Operator-direct routes** uniformly: use `app.requireOrgForMutation`, require `Idempotency-Key`, submit via `PlatformIngress.submit`, persist WorkTrace including tenant-reject paths, emit the §4 response envelope, unwrap `outputs` via typed `OutputsSchema`.
4. **All 15 still-open Cat 3 findings** map to a contract clause + a merged PR (per the §11 crosswalk).
5. **No cross-app type is declared locally** — duplicates flagged by `check-routes` produce a warning the first time and an error after the rule's grace cycle.
6. **Store-layer mutations carry the §10 tenant-isolation contract** with `check-routes` validating new store methods.
7. **`docs/DOCTRINE.md` + `docs/ARCHITECTURE.md`** document the route taxonomy + per-class matrix as load-bearing architecture, not just historical cleanup.
8. **Phase 3B (Inngest Failure Contract) consumes Sections 4 + 9 as inputs** — the type seam is real, not aspirational.

The audit's Cat 3 lane closes when criteria 1, 2, and 4 are met; criteria 5–8 are the architectural value-add that prevents the same cleanup from being needed again in 6 months.

---

## Next step

After user review and approval, merge this spec to `main` via focused PR (`docs/audit-phase3a-route-governance-contract` branch). Then **Phase 3A implementation runs as four PRs** per Section 12, each with its own plan via `superpowers:writing-plans`. Each impl PR lands on `main` independently.

After the spec PR opens, update `project_audit_wave_2_phased_state.md` to reflect Phase 3A in flight + the spec PR number + the Cat 3 verification results (3.5 partially closed, 3.17 closed).
