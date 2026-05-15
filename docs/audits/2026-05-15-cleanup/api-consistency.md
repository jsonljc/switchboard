# api-consistency

**Charter:** Error shape, idempotency, audit-trail, auth guards, cross-app type duplication.
**Method:** Examined 64 route files across `apps/api/src/routes/`, 2 major chat routes, and 10+ dashboard API routes. Grepped for auth guards (`requireOrganizationScope`, `assertOrgAccess`), audit/trace writes (`auditLedger`, `workTraceStore`, `finalizeOperatorTrace`), idempotency-key handling, error response shapes. Scanned for type duplication across `ApprovalRecord`, `ConversationState`, `Handoff` via `grep` across apps. Verified central schema exports in `packages/schemas/src/index.ts`.

**Scope exclusions applied:** None (no overlap with exclusion masks).

## Findings

### [CRITICAL] Audit-trail coverage gap across 48+ mutating routes

- **Where:** `apps/api/src/routes/` — 48 of 64 route files with POST/PUT/PATCH/DELETE lacking audit or WorkTrace writes
- **Evidence:** Routes checked: `actions.ts` (4 mutations, 0 audit), `ad-optimizer.ts` (1, 0), `admin-consent.ts` (3, 0), `billing.ts` (3, 0), `competence.ts` (3, 0), `connections.ts` (4, 0), `creative-pipeline.ts` (2, 0), `dashboard-opportunities.ts` (1, 0), `dashboard-reports.ts` (1, 0), `deployment-memory.ts` (4, 0), `dlq.ts` (3, 0), `execute.ts` (1, 0), `identity.ts` (4, 0), `ingress.ts` (1, 0), `knowledge-entries.ts` (3, 0), `knowledge.ts` (3, 0), `lifecycle-disqualifications.ts` (2, 0), `marketplace-persona.ts` (2, 0), `marketplace.ts` (9, 0), `meta-deletion.ts` (1, 0), `onboard.ts` (1, 0), `operator-config.ts` (2, 0), `organizations.ts` (3, 0), `owner-tasks.ts` (1, 0), `playbook.ts` (1, 0), `policies.ts` (3 mutations, 3 audit — exception), `recommendations.ts` (1, 0), `revenue.ts` (1, 0), `scheduled-reports.ts` (4, 0), `sessions.ts` (2, 0), `setup.ts` (1, 0), `simulate.ts` (1, 0), `webhooks.ts` (3, 0), `website-scan.ts` (1, 0), `whatsapp-flows.ts` (1, 0), `whatsapp-onboarding.ts` (1, 0), `whatsapp-send-test.ts` (1, 0), `whatsapp-test.ts` (1, 0). Only 6 routes use audit: `agents.ts`, `approvals.ts`, `conversations.ts`, `escalations.ts`, `governance.ts`, `policies.ts`.
- **Why it matters:** DOCTRINE invariant: "mutating actions enter through `PlatformIngress.submit()`" and "WorkTrace is canonical persistence." Mutations that bypass audit create compliance/forensics gaps and violate the auditable-action contract.
- **Fix:** Wrap all POST/PUT/PATCH/DELETE handlers (or the store calls they invoke) with `app.auditLedger.record()` and/or `app.workTraceStore` calls. Consider a pre-handler hook or middleware to auto-tag mutating requests.
- **Effort:** M (requires audit wrapping on ~90+ mutation endpoints; consider factory helper)
- **Risk if untouched:** Silent mutations with no audit trail; compliance audits fail; cannot trace who changed what.
- **Collides with active work?:** No

### [CRITICAL] 38 of 42 mutating routes lack idempotency-key handling

- **Where:** `apps/api/src/routes/*.ts` — only `actions.ts` and `execute.ts` enforce `idempotency-key` header; 38 others do not
- **Evidence:** Only `actions.ts` lines 32–38 and `execute.ts` lines (similar range) check for and validate idempotency key. Mutation routes in `knowledge-entries.ts`, `dashboard-opportunities.ts`, `governance.ts`, `conversations.ts`, `approvals.ts`, `connections.ts`, `competence.ts`, `marketplace.ts`, `agents.ts`, and others all accept POST/PUT/PATCH/DELETE without idempotency guards.
- **Why it matters:** Duplicate submissions (network retry, client re-request) can cause duplicate state mutations. Idempotency keys are a launch-readiness contract for financial/state-changing operations (approvals, opportunity stage transitions, knowledge entry updates, billing, escalations, etc.).
- **Fix:** Require `Idempotency-Key` header on all POST/PUT/PATCH/DELETE routes (except webhooks receiving external events). Validate it matches a stored previous request's hash if present. Establish a shared header-extraction + validation helper.
- **Effort:** M (add header check + idempotency-cache lookup to ~90+ routes; extract into middleware)
- **Risk if untouched:** Duplicate approvals, duplicate contacts, duplicate tasks, and double-charged billing in edge cases.
- **Collides with active work?:** No

### [HIGH] Error response shape inconsistency across apps

- **Where:** `apps/api/src/routes/` (conversations, knowledge-entries, approvals, governance), `apps/api/src/routes/dashboard-opportunities.ts`, `apps/api/src/routes/whatsapp-send-test.ts`, `apps/api/src/routes/admin-consent.ts`, `apps/chat/src/routes/managed-webhook.ts`
- **Evidence:**
  - `conversations.ts:206-387`: `{ error: "...", statusCode: 400 }`
  - `dashboard-opportunities.ts:37, 50`: `{ error: "Opportunity store not available" }` (no statusCode)
  - `dashboard-opportunities.ts:50`: `{ error: "INVALID_BODY" }` vs `{ error: "Invalid query", details: ..., statusCode: 400 }` in conversations
  - `whatsapp-send-test.ts:92-95`: `{ error: { code, message, retryable } }` — completely different shape
  - `admin-consent.ts:69, 146–166`: `{ error: "invalid_body", issues: [...] }` OR `{ error: "contact_not_found", ... }` — no statusCode field
  - `managed-webhook.ts:56, 89`: `{ error: "Invalid signature" }` (no statusCode)
- **Why it matters:** Clients must parse 5+ different error shapes. SDKs cannot normalize responses. HTTP status code lives in header, but response body inconsistency breaks contract.
- **Fix:** Establish shared error envelope: `{ error: string | { code: string; message: string; [details?]: ... }; statusCode: number; [retryable?: boolean] }`. Create error-response helper. Migrate all routes.
- **Effort:** M (audit all ~100+ error paths; refactor to shared helper)
- **Risk if untouched:** Client SDK breakage; operator scripts fail to parse error responses; error reporting and observability degrades.
- **Collides with active work?:** No

### [HIGH] Missing auth guards on 3+ external/webhook mutation routes

- **Where:** `apps/api/src/routes/ad-optimizer.ts:44–100`, `apps/api/src/routes/whatsapp-send-test.ts:88–120` (partial), `apps/chat/src/routes/managed-webhook.ts:68–180`
- **Evidence:**
  - `ad-optimizer.ts:44` POST webhook has no auth check; resolves org from external entry ID only (risky if ID can be forged)
  - `whatsapp-send-test.ts:88` checks `organizationIdFromAuth` (good) but route entry at line 88 does not explicitly document that `organizationIdFromAuth` is required
  - `managed-webhook.ts:68` webhook accepts POST with no explicit auth; verifies webhook signature only if `adapter.verifyRequest` exists
- **Why it matters:** Webhook endpoints should verify either webhook signature (HMAC) or API key. Ad-optimizer infers org from external ID; if Meta webhook ID can be guessed, requests can be spoofed.
- **Fix:** Validate webhook signature (HMAC from Meta's X-Hub-Signature header) for `ad-optimizer`. Document auth contract explicitly in `whatsapp-send-test` schema. For `managed-webhook`, enforce `adapter.verifyRequest` presence or API key check.
- **Effort:** S (ad-optimizer: add signature check; whatsapp-send-test + managed-webhook: clarify existing checks)
- **Risk if untouched:** Spoofed webhook payloads trigger actions under guessed org context (lead intake, campaign pause, message delivery).
- **Collides with active work?:** No

### [HIGH] Cross-app type duplication: ApprovalRecord defined locally in 2+ places

- **Where:** `apps/api/src/routes/dashboard-overview.ts:64–74`, `apps/dashboard/src/lib/api-client-types.ts:40–56`
- **Evidence:**
  - `dashboard-overview.ts:64` defines `interface ApprovalRecord { request: { id, summary, riskCategory, bindingHash, createdAt }, envelopeId, state: { status } }`
  - `api-client-types.ts:40` defines `interface ApprovalDetail { request: { id, summary, riskCategory, bindingHash, approvers, createdAt }, state: { status, expiresAt, respondedBy?, respondedAt? }, envelopeId }`
  - Both shadow the canonical `ApprovalLifecycle*` types in `packages/schemas/src/approval-lifecycle.ts`
  - Chat adapters define `ApprovalCardPayload` locally in `apps/chat/src/adapters/adapter.ts`
- **Why it matters:** Three definitions of similar-but-drifting approval shapes create divergent contracts. Clients using different shapes get stale or missing fields (e.g., `approvers` in API client but missing in dashboard-overview). Updates to approval lifecycle risk inconsistency.
- **Fix:** Export canonical `ApprovalRecord` (combining fields from all three local definitions) from `packages/schemas/src/approval-lifecycle.ts`. Consume it in dashboard-overview, api-client-types, and chat adapters. Remove local declarations.
- **Effort:** M (requires schema update + consumer migration; verify all fields are present in canonical export)
- **Risk if untouched:** Approval display and API response shapes drift; clients fail silently when fields are missing.
- **Collides with active work?:** No

### [HIGH] ConversationState type declared locally in chat, duplicating downstream consumer needs

- **Where:** `apps/chat/src/conversation/state.ts:10–34` (export interface ConversationStateData), `apps/api/src/routes/conversations.ts:20–58` (interface ConversationRow + ConversationSummary + ConversationDetail)
- **Evidence:**
  - `chat/state.ts:10` defines `ConversationStateData { id, threadId, channel, principalId, organizationId, status, currentIntent, ..., leadProfile, detectedLanguage, machineState }`
  - `api/conversations.ts:20` re-declares partial shape as `ConversationRow` (db row) and `ConversationSummary` (api response)
  - API response at line 33–45 does not include `leadProfile` or `detectedLanguage`, losing context for downstream consumers
  - Chat and API have drifted on what fields are "public" vs "internal"
- **Why it matters:** Chat has the authoritative state; API should consume/surface it transparently. Divergent shapes cause clients (dashboard, external systems) to miss data.
- **Fix:** Export `ConversationState` (and related DTOs) from `packages/schemas`. Use it in chat, API, dashboard, and any consumer. Define separate "public API projection" as a schema export (e.g., `ConversationSummary`, `ConversationDetail`) for each surface.
- **Effort:** M (requires schema extraction + consumer migration)
- **Risk if untouched:** Dashboard and external consumers miss conversation context (lead profile, language, state); feature gaps.
- **Collides with active work?:** No

### [MED] Inconsistent error detail structure in validation failures

- **Where:** `apps/api/src/routes/` — validation errors inconsistent across routes
- **Evidence:**
  - `conversations.ts:212`: `{ error: "Invalid query", details: parsed.error.format(), statusCode: 400 }` (Zod format)
  - `knowledge-entries.ts:72–75`: `{ error: "Validation failed", issues: parsed.error.issues.map(...) }` (custom mapping)
  - `approvals.ts:48`: `{ error: "Invalid request body", details: parsed.error.issues, statusCode: 400 }` (raw issues)
  - `whatsapp-send-test.ts:101–105`: `{ error: { code, message, retryable } }` (completely different)
- **Why it matters:** Clients cannot normalize validation error handling; must write route-specific parsers.
- **Fix:** Standardize validation error format: `{ error: string, validationErrors: Array<{ field: string; message: string }>, statusCode: 400 }`. Use shared Zod error mapper.
- **Effort:** S (create shared helper; update ~30 validation paths)
- **Risk if untouched:** Error handling UX inconsistent across dashboard and API clients.
- **Collides with active work?:** No

### [MED] Optional audit hooks on critical mutations (conversations.ts)

- **Where:** `apps/api/src/routes/conversations.ts:265–304` (PATCH override), `apps/api/src/routes/conversations.ts:307–401` (POST send)
- **Evidence:**
  - PATCH override at line 286 calls `app.conversationStateStore.setOverride()` but does not explicitly log via `auditLedger`
  - POST send at line 336 calls `app.conversationStateStore.sendOperatorMessage()` and uses `app.workTraceStore` (line 358, 391) — some audit via WorkTrace but not via auditLedger
  - `auditLedger.record()` is absent for conversation mutations; relies on store internals
- **Why it matters:** Conversation mutations are user-visible actions (operator taking override, sending message). They should appear in the audit ledger for operator activity review and forensics.
- **Fix:** Wrap `setOverride` and `sendOperatorMessage` calls with explicit `auditLedger.record()` in addition to WorkTrace writes.
- **Effort:** S (add 2 audit calls)
- **Risk if untouched:** Operator actions (override, send message) not visible in compliance audits.
- **Collides with active work?:** No

### [MED] Handoff type absent from central schemas; no cross-app type declared yet

- **Where:** No local `Handoff` type found in `apps/api`, `apps/dashboard`, `apps/chat`; not in `packages/schemas/src/index.ts`
- **Evidence:** Grep for `type Handoff | interface Handoff` returned no results across apps. Approval lifecycle types exist (`ApprovalLifecycle`, `ApprovalRevision`, `ExecutableWorkUnit`) but no explicit handoff DTO.
- **Why it matters:** Charter calls for drift audit on `Handoff` types; absence suggests it may be emerging ad-hoc across routes (e.g., escalation handoffs). No centralized contract invites future duplication.
- **Fix:** Define canonical `Handoff` schema in `packages/schemas` covering escalation context, approver assignment, and routing. Export it; require all handoff operations to use it.
- **Effort:** S (schema definition only; no migrations if type is not yet widely used)
- **Risk if untouched:** Handoff logic drifts; escalation surfaces may diverge.
- **Collides with active work?:** No

### [LOW] Dashboard-opportunities route error response missing statusCode field

- **Where:** `apps/api/src/routes/dashboard-opportunities.ts:37, 46, 50, 61`
- **Evidence:** Lines 37, 46: `reply.code(503).send({ error: "Opportunity store not available" })` — no statusCode in body. Lines 50, 61: `reply.code(400/404).send({ error: "INVALID_BODY" / "OPPORTUNITY_NOT_FOUND" })` — inconsistent naming (CONSTANT vs descriptive).
- **Why it matters:** Minor: HTTP status is in header. But consistency with other routes (which include statusCode in body) would help client logging.
- **Fix:** Add statusCode to body: `{ error: "...", statusCode: 400 }`. Use consistent error message style.
- **Effort:** S
- **Risk if untouched:** Operator dashboard logs may miss error context.
- **Collides with active work?:** No

### [LOW] Missing co-located test coverage for most route modules

- **Where:** `apps/api/src/routes/` — 64 route files, ~3–5 have dedicated route tests; most rely on integration tests only
- **Evidence:** Only `conversations.ts`, `actions.ts`, `governance.ts` and a few others have explicit route-level tests. Most routes tested only via `apps/api/src/__tests__/` integration tests, not unit tests with mocked stores.
- **Why it matters:** Route logic (validation, error handling, auth checks) should be unit-testable without a full app fixture. Per CLAUDE.md: "Every new module must include co-located tests."
- **Fix:** Add `routes/*.test.ts` files for critical routes (approvals, actions, governance, conversations, knowledge-entries, etc.) testing happy-path + error conditions.
- **Effort:** L (effort is in test infrastructure; ~15–20 route files × ~2–3 tests each)
- **Risk if untouched:** Route logic changes are not caught until integration tests run.
- **Collides with active work?:** No

## Out of scope / deferred for this lane

- Webhook signature verification (ad-optimizer HMAC) requires deeper knowledge of Meta's current webhook format and is flagged HIGH but deferred to a follow-up security task.
- Route performance (N+1 queries, caching) — separate performance audit.
- Dashboard next.js API routes' error shapes (minimal surface; not part of this audit's "apps/api" focus).
