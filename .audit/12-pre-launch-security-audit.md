# Pre-Launch Security Audit

**Date started:** 2026-04-29
**Spec:** `docs/superpowers/specs/2026-04-29-pre-launch-security-audit-design.md`
**Status:** In progress
**Owner:** Jason

This audit covers six priority areas before the first paying-customer cohort. HIGH/CRITICAL findings block first paying customer; report completion blocks launch.

---

## Severity Rubric

| Severity     | Definition                                                                                              | Disposition                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **CRITICAL** | Actively exploitable; cross-tenant data access, full takeover, or governance bypass.                    | Launch-blocking. Fix-now spec required before first customer.|
| **HIGH**     | Exploitable with low effort; data/credential exposure, privilege escalation, prompt-injection-driven side effects. | Launch-blocking. Fix-now spec required before first customer.|
| **MEDIUM**   | Defense-in-depth gap; requires non-trivial chain or has limited blast radius.                           | Fix-soon (within 30 days post-launch).                       |
| **LOW**      | Best-practice gap; theoretical or low-impact.                                                           | Defer-post-launch unless cheap.                              |
| **INFO**     | Hardening recommendation; no exploitable defect.                                                        | Track only.                                                  |

---

## Section 1: Tenant Isolation

### Scope

Every persistence path that reads or writes tenant-owned data: 86 Prisma models, every Store under `packages/db/src/stores/` and `packages/db/src/storage/`, every route handler in `apps/api`, `apps/chat`, `apps/dashboard`, `apps/mcp-server`, the auth middleware that derives `organizationIdFromAuth`, and every cache that holds tenant data.

### Method

- Enumerated all 86 Prisma models and classified each by tenant-scoping mechanism (direct `organizationId` / `orgId`, FK-inherited, shared, operational).
- Audited query patterns for the highest-risk models (ConversationState, Approval, ApprovalLifecycle, Handoff, AgentDeployment) in stores and routes.
- Audited the auth middleware (`apps/api/src/middleware/auth.ts`) and the org-access guard (`apps/api/src/utils/org-access.ts`) to understand how `request.organizationIdFromAuth` is derived and enforced.
- Reviewed every `updateMany` / `deleteMany` callsite in stores and apps for orgId scoping.
- Audited cache-key construction in `packages/core/src/policy-cache.ts`, `packages/core/src/orchestrator/propose-helpers.ts`, in-memory caches, and the in-memory IdempotencyStore.
- Reviewed cross-tenant primitives in route handlers: places that take `organizationId` from request body.
- Cross-tenant probes are documented as **code-level claims** (no live test harness in this session).

### Model classification (high-level)

86 models total. Three tenant-scoping conventions in use:

| Convention | Count (approx) | Examples |
| ---------- | -------------- | -------- |
| `organizationId String` (non-null direct) | ~35 | DashboardUser, AgentRoster, AgentState, ManagedChannel, BusinessConfig, Handoff, KnowledgeChunk, DeploymentMemory, ActivityLog, ExecutionTrace, AgentSession, ConversationThread, AgentDeployment, AgentTask, AgentPersona, CreativeJob, WebhookRegistration, WorkflowExecution, ScheduledTriggerRecord, OperatorRequestRecord, OperatorCommandRecord, Contact, Opportunity, LifecycleRevenueEvent, OwnerTask, KnowledgeEntry, WorkTrace, Booking, ConversionRecord, ReconciliationReport, PendingLeadRetry |
| `organizationId String?` (NULLABLE) | 11 | Principal, IdentitySpec, Policy, ActionEnvelope, ConversationState, AuditEntry, Connection, ApprovalRecord, ApprovalLifecycle, FailedMessage, WhatsAppMessageStatus |
| `orgId String` (non-null, alternative naming) | 7 | ConversationMessage, ContactLifecycle, AgentRegistration, LlmUsageLog, EscalationRecord, ConsentRecord, ProductIdentity |
| `id // orgId` (id-as-orgId convention) | 1 | OrganizationConfig |
| FK-inherited (no own org field) | ~20 | ApprovalRevision→ApprovalLifecycle, AgentRun/AgentPause/ToolEvent→AgentSession, ConfigVersion→BusinessConfig, DeploymentConnection/DeploymentState→AgentDeployment, ExecutableWorkUnit→ApprovalLifecycle, DispatchRecord→ExecutableWorkUnit, AssetRecord→CreativeJob, ProductImage/ProductQcResult→ProductIdentity, PcdIdentitySnapshot→AssetRecord, ActionRequest/CreatorIdentity→AgentDeployment, DashboardSession→DashboardUser, DelegationRule→Principal, TrustScoreRecord→AgentListing, RoleOverlay→IdentitySpec, ApprovalCheckpointRecord→WorkflowExecution |
| Shared / operational (no org field, intentional or implicit) | ~12 | DashboardVerificationToken, IdempotencyRecord, ProcessedMessage, WebhookEventLog, OutboxEvent, DispatchLog, SystemRiskPosture, CompetencePolicy, CartridgeRegistration, AgentListing, CompetenceRecord, AgentRoleOverride |

Naming inconsistency: schema mixes `orgId` and `organizationId`. Increases audit complexity and makes pattern-matching grep less reliable.

### Items checked

- [✓] Every Prisma model classified.
- [✗] Every read query for tenant-scoped models has orgId scoping. (See TI-4, TI-5.)
- [✗] Every write query for tenant-scoped models has orgId scoping. (See TI-1, TI-2, TI-6.)
- [✗] No `updateMany`/`deleteMany` operates without orgId. (See TI-7, TI-8.)
- [✓] Store methods that take orgId require it (PrismaConversationStore — `packages/db/src/stores/prisma-conversation-store.ts:18-22` — orgId is constructor-injected and applied to every query).
- [✓] AgentDeployment governance bypass via `updateMany` (REFACTOR-PLAN P1) — every site (`apps/api/src/routes/billing.ts:247`, `apps/api/src/routes/governance.ts:184,318`) is now properly scoped with `where: { organizationId: orgId, ... }`.
- [✓] In-memory spend / composite caches (`packages/core/src/orchestrator/propose-helpers.ts:102, 171`) include `organizationId` in cache key.
- [✓] Policy cache (`packages/core/src/policy-cache.ts:26`) namespaces by `(cartridgeId, organizationId)`.
- [✗] No raw query string interpolation for tenant data → not exhaustively verified; covered by Section 6 OWASP injection sweep.
- [✗] Cross-tenant probes for each entity type → **deferred** to post-fix verification; replaced with code-level claims here. See "Coverage gaps".
- [✗] Sentry/logs do not leak cross-tenant data in error responses → not exhaustively verified; spot-checked Sentry instrumentation in `apps/api/src/bootstrap/sentry.ts` and `apps/chat/src/bootstrap/sentry.ts` (no `setUser`/`setTag` with orgId observed — separate observability gap, but not a leak).

### Findings

| ID    | Severity | Title                                                                       | Evidence (file:line)                                                                                              | Recommended fix                                                                                                                                                                                                                                                                                       | Status      |
| ----- | -------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| TI-1  | CRITICAL | `/api/ingress/submit` takes `organizationId` from request body, no auth-derived check | `apps/api/src/routes/ingress.ts:21-36`                                                                            | Replace `body.organizationId` with `request.organizationIdFromAuth`; reject the request if auth-derived org is missing or differs from body org. The canonical mutation entry point must derive org from auth context, not body.                                                                          | _untriaged_ |
| TI-2  | CRITICAL | `/api/governance/emergency-halt` and other governance routes use `body.organizationId ?? request.organizationIdFromAuth` (body wins) | `apps/api/src/routes/governance.ts:161`                                                                           | Reverse the precedence to `request.organizationIdFromAuth ?? body.organizationId`, and fail-closed when the two are both set and differ. Better: require `request.organizationIdFromAuth` and treat any body-supplied orgId as a 400 error.                                                                | _untriaged_ |
| TI-3  | CRITICAL | Static API keys without `API_KEY_METADATA` produce `organizationIdFromAuth = undefined`, which `assertOrgAccess` treats as "no auth configured" and allows all orgs | `apps/api/src/middleware/auth.ts:114-121`, `apps/api/src/utils/org-access.ts:13-19`                               | (a) Reject any unscoped API key in production (require `API_KEY_METADATA` for every static key), and (b) make `assertOrgAccess` distinguish between "auth disabled (dev)" and "auth succeeded but no org bound" — the latter must deny by default in production.                                              | _untriaged_ |
| TI-4  | HIGH     | `apps/api/src/routes/actions.ts` and `execute.ts` fall back to `body.organizationId` when API key is unscoped | `apps/api/src/routes/actions.ts:62`, `apps/api/src/routes/actions.ts:351`, `apps/api/src/routes/execute.ts:62`     | Same as TI-3: require `request.organizationIdFromAuth` to be set. Remove the `?? body.organizationId` fallback. The "Phase 2" comment in `execute.ts:61` indicates this fallback was a transition path; the transition should be completed before launch.                                                  | _untriaged_ |
| TI-5  | HIGH     | `apps/chat` PrismaConversationStore reads/deletes by `threadId` only; `listActive()` returns all-tenant data | `apps/chat/src/conversation/prisma-store.ts:9-15` (get), `:58-62` (delete), `:64-71` (listActive)                 | Add orgId to the Store API surface (constructor-inject like `packages/db/src/stores/prisma-conversation-store.ts` does, or pass per-call). Scope `get`/`delete` queries by `(threadId, organizationId)`. `listActive` should be either removed or scoped per org with a recovery-orchestrator-only annotation. | _untriaged_ |
| TI-6  | HIGH     | `apps/api/src/routes/escalations.ts` looks up ConversationState by `threadId` only (no orgId), relying on a prior Handoff guard | `apps/api/src/routes/escalations.ts:99-101, 183-185, 198-205, 227-229`                                            | Add `organizationId: orgId` to each `conversationState.findUnique`/`update` call. Defense-in-depth — even though Handoff is checked first, ConversationState's nullable `organizationId` allows divergence between Handoff.organizationId and ConversationState.organizationId.                                | _untriaged_ |
| TI-7  | MEDIUM   | `prisma-approval-store` updates and lists approvals without orgId scoping                          | `packages/db/src/storage/prisma-approval-store.ts:42-51` (updateMany), `:71-78` (listPending with optional orgId) | Add `organizationId` to the `updateMany` `where` clause; make `listPending(organizationId)` non-optional and require it.                                                                                                                                                                              | _untriaged_ |
| TI-8  | MEDIUM   | `prisma-lifecycle-store` updates approvalLifecycle without orgId scoping                                              | `packages/db/src/storage/prisma-lifecycle-store.ts:133-145, 182-189`                                              | Add `organizationId` to the `where` clause of every lifecycle `updateMany`. Defense-in-depth; PK collision is unlikely but the pattern is the same one REFACTOR-PLAN P1 flagged for AgentDeployment.                                                                                                  | _untriaged_ |
| TI-9  | MEDIUM   | 11 tenant-scoped models have **nullable** `organizationId String?` — orphan rows possible                            | `packages/db/prisma/schema.prisma:14` (Principal), `:43` (IdentitySpec), `:83` (Policy), `:105` (ActionEnvelope), `:133` (ConversationState), `:170` (AuditEntry), `:197` (Connection), `:235` (ApprovalRecord), `:258` (ApprovalLifecycle), `:506` (FailedMessage), `:1070` (WhatsAppMessageStatus) | Plan migrations to make `organizationId` non-null on each. Each migration needs a backfill rule for existing rows; for ConversationState specifically, the chat ingress should already be writing orgId on create (verify in TI-5 fix).                                                                | _untriaged_ |
| TI-10 | MEDIUM   | `IdempotencyRecord` lacks `organizationId`; relies on hash-based key uniqueness for tenant isolation                 | `packages/db/prisma/schema.prisma:214-221`, `packages/core/src/idempotency/guard.ts:60-70`                        | Add `organizationId` to `IdempotencyRecord`; namespace lookups by `(organizationId, key)`. The current `sha256(principalId + actionType + params)` key construction makes practical exploitation infeasible (UUID-guessing required), but defense-in-depth.                                                  | _untriaged_ |
| TI-11 | LOW      | Schema mixes `orgId` and `organizationId` field names                                                | `packages/db/prisma/schema.prisma` (multiple)                                                                     | Pick one (recommend `organizationId` since it's the majority). Migrate the `orgId` models in a single PR with a Prisma `@map` to keep the column name unchanged for backward compatibility.                                                                                                          | _untriaged_ |
| TI-12 | INFO     | No global "tenant-isolation extension" enforces scoping at the Prisma layer                                          | (architectural)                                                                                                   | Consider a Prisma client extension or middleware that requires every query on a tenant-scoped model to include orgId, raising at runtime if absent. Heavy lift, post-launch.                                                                                                                          | _untriaged_ |

### Coverage gaps

- **No live cross-tenant probes**: probes were performed via code-reading, not by running two-org integration tests. Recommend authoring a cross-tenant integration test under `apps/api/src/__tests__/cross-tenant.test.ts` that boots the test stack with two orgs and probes every ingress endpoint with org-A credentials targeting org-B entities. This test belongs in the fix-now spec for TI-1.
- **Dashboard server actions and Next.js API routes** were not exhaustively audited. The dashboard largely talks to `apps/api`, but any direct Prisma usage in dashboard route handlers needs the same scoping discipline. Scope this as a follow-up after Section 6.
- **Sentry/log scrubbing** beyond a spot-check is in Section 6 (OWASP error-leakage subitem); not exhaustively covered here.
- **FK-inherited models** were classified but their query call sites were not individually traced. The trust assumption is that joins go through the FK-bearing parent's orgId scoping — verified for AgentDeployment children (DeploymentConnection, DeploymentState, ActionRequest, CreatorIdentity), AgentSession children (AgentRun, AgentPause, ToolEvent), and AssetRecord chain. Other FK chains (ApprovalLifecycle children, IdentitySpec → RoleOverlay, Principal → DelegationRule) were not individually verified — covered by parent-model findings TI-7, TI-8, TI-9.
- **86 models is a large surface; this audit covered the highest-risk areas** (ingress, governance, conversation, approval, handoff, deployment-management) but did not exhaustively trace every model's query call sites. The recommendation in TI-12 (a Prisma extension that enforces scoping) is the long-term fix; in the short term, the fix-now specs spawned from this section should each include a cross-tenant test for the affected model.

---

## Section 2: AI / Skill-Runtime Security

### Scope

The skill runtime, tool registry, agent runtime, and tool implementations: `packages/core/src/skill-runtime/`, `packages/core/src/tool-registry/`, `packages/core/src/agent-runtime/`. Specifically the tool execution boundary (where LLM output flows into side-effect-producing functions) and the system-prompt assembly (where operator-controlled data flows into model context).

### Method

- Catalogued every tool in `packages/core/src/skill-runtime/tools/` and noted side-effect class, idempotency, and how each tool sources its `orgId`.
- Read `packages/core/src/skill-runtime/skill-executor.ts` to confirm how LLM-produced `toolUse.input` is dispatched to tool `execute()` functions.
- Read `packages/core/src/agent-runtime/system-prompt-assembler.ts` to assess injection surface.
- Read `packages/core/src/skill-runtime/governance.ts`, `governance-injector.ts`, and the trust-level resolver to confirm what governance does and does not enforce.
- Read `packages/core/src/skill-runtime/reinjection-filter.ts` to assess output-as-input contamination risk.
- Searched for any tool/op that uses a trusted `SkillRequestContext` (only `escalate.ts` does — it's the documented "target shape").

### Tool catalog (high-level)

| Tool          | Operation         | Effect class        | Idempotent | orgId source                                                                                       |
| ------------- | ----------------- | ------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| calendar-book | slots.query       | read                | yes        | **LLM input** (`params.orgId`) — flagged TODO in source                                            |
| calendar-book | booking.create    | external_mutation   | yes        | **LLM input** (`params.orgId`) — flagged TODO in source                                            |
| crm-write     | stage.update      | write               | yes        | **LLM input** (`params.orgId`)                                                                      |
| crm-write     | activity.log      | write               | no         | **LLM input** (`params.organizationId`)                                                             |
| crm-query     | (read ops)        | read                | yes        | (read-only; analyzed lower-risk)                                                                    |
| escalate      | handoff.create    | write               | no         | **Trusted `ctx.orgId`** via `SkillRequestContext` factory closure — **the correct pattern**          |
| web-scanner   | various           | tier-dependent      | varies     | (scoped read; analyzed lower-risk)                                                                  |
| booking-failure-handler | various | write/external_mutation | varies | (handler invoked from calendar-book; inherits the upstream orgId)                                  |

### Items checked

- [✓] Every tool catalogued and classified.
- [✗] Every mutating tool routes through PlatformIngress. *(See AI-3 — calendar-book and crm-write call stores directly. They produce side effects without going through the canonical mutation pipeline.)*
- [✗] System prompts cannot be extracted via crafted input. *(Not directly verified, but no sentinels or output-filtering exist; depends on Anthropic's model behavior.)*
- [✗] No tool can be invoked outside the approval policy via prompt injection. *(See AI-1: orgId in tool input is LLM-controlled — even if governance allows the action, it can target the wrong tenant.)*
- [✗] Tool outputs are sanitized before re-entering LLM context. *(Reinjection-filter handles size/truncation but not adversarial-content marking — see AI-4.)*
- [✓] DeploymentMemory / ConversationState writes from skill execution cannot escalate trust on later turns. *(Trust level is derived from `deployment.trustLevel` via `skill-runtime-policy-resolver.ts:22`, not from conversation state; LLM cannot rewrite it.)*
- [✗] Skill execution cannot reach cross-tenant data. *(Same root cause as AI-1: LLM-controlled orgId in tool input bypasses tenant binding.)*
- [✓] No credentials or secrets are placed in LLM prompts. *(Verified `system-prompt-assembler.ts` does not include credentials. Operator persona fields are interpolated, not credentials.)*

### Findings

| ID   | Severity | Title                                                                                                | Evidence (file:line)                                                                                                                                            | Recommended fix                                                                                                                                                                                                                                                                                                                                                | Status      |
| ---- | -------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| AI-1 | CRITICAL | `calendar-book` and `crm-write` tools take `orgId` from LLM-controlled tool input                    | `packages/core/src/skill-runtime/tools/calendar-book.ts:79-82, 122-138, 152-180` (TODO); `packages/core/src/skill-runtime/tools/crm-write.ts:53-61, 73-80`     | Convert calendar-book and crm-write to factory-based tools that close over a trusted `SkillRequestContext` (matching `escalate.ts:22-23, 67`). Remove `orgId` from `inputSchema` so the LLM cannot supply it. The TODO comment in calendar-book.ts:79-81 already names this fix and references the executor-contract follow-up PR — ship it before launch. | _untriaged_ |
| AI-2 | HIGH     | `op.execute(toolUse.input)` passes raw LLM output to tool with no runtime schema validation          | `packages/core/src/skill-runtime/skill-executor.ts:221, 247`                                                                                                    | Validate `toolUse.input` against `op.inputSchema` (Zod or JSON-Schema) before calling `op.execute`. Currently the schema is only used to advertise the contract to the LLM; tools must defensively re-parse. Defense-in-depth alongside AI-1.                                                                                                                  | _untriaged_ |
| AI-3 | HIGH     | `system-prompt-assembler.ts` interpolates operator-controlled persona fields directly with no sentinels | `packages/core/src/agent-runtime/system-prompt-assembler.ts:21-54`                                                                                              | Wrap operator-controlled fields (businessName, productService, valueProposition, tone, customInstructions, qualificationCriteria) in clear sentinel markers (e.g., `<|operator-content|>...<|/operator-content|>`) and instruct the model to treat sentinel-wrapped content as data, not instructions. Verify that no upstream flow accepts these fields from customer input. | _untriaged_ |
| AI-4 | MEDIUM   | Tool outputs are reinjected to LLM context with no adversarial-content marking                       | `packages/core/src/skill-runtime/reinjection-filter.ts:1-80`, `packages/core/src/skill-runtime/skill-executor.ts:274-280`                                       | Wrap tool results in sentinels too (e.g., `<|tool-output|>...<|/tool-output|>`). Mitigates the case where an external tool (web-scanner, crm-query) returns content containing fake "system" markers that the LLM might re-interpret as instructions.                                                                                                          | _untriaged_ |
| AI-5 | MEDIUM   | `console.warn` logs first 200 chars of `toolUse.input` JSON unredacted                               | `packages/core/src/skill-runtime/skill-executor.ts:208-210`                                                                                                     | Apply a redaction filter to known sensitive keys (orgId, attendeeEmail, anything matching `*token*`/`*secret*`/`*key*`). Slice limits exposure but does not redact.                                                                                                                                                                                            | _untriaged_ |
| AI-6 | MEDIUM   | Mutating tools bypass `PlatformIngress.submit()` and write directly to stores                        | `packages/core/src/skill-runtime/tools/calendar-book.ts:204-213, 274-282`; `packages/core/src/skill-runtime/tools/crm-write.ts:55-64`                          | This is a DOCTRINE §1 deviation that the architecture has tolerated as "tool-internal mutations" but it means WorkTrace anchoring, idempotency, and governance one-time evaluation invariants don't apply uniformly. Confirm this is intentional under DOCTRINE; if so, document the exception. If not, route through PlatformIngress.                          | _untriaged_ |
| AI-7 | INFO     | No AI-specific monitoring (prompt-injection detection, anomalous tool-call patterns)                 | (architectural)                                                                                                                                                 | Track post-launch. Sentry integration could log structured events for `unexpected_tool_orgid_mismatch`, `tool_call_count_spike`, `system_prompt_extraction_pattern`. Out of scope pre-launch.                                                                                                                                                                  | _untriaged_ |

### Coverage gaps

- **Live prompt-injection probing** was not performed (no live LLM session in this audit). Findings AI-1 through AI-3 are based on code reading. A fix-now spec for AI-1 should include an automated test that simulates an LLM tool_use block with a mismatched `orgId` and asserts the tool refuses (or, post-fix, proves the tool ignores `params.orgId` and uses `ctx.orgId` instead).
- **Memory poisoning paths** were not traced end-to-end. The architecture has DeploymentMemory and ConversationState; LLM writes to these must not be able to escalate trust on later turns. Trust resolution from `deployment.trustLevel` (server-side) was verified; verifying that no path uses memory-derived trust signals is left as a follow-up under AI-7's post-launch monitoring scope.
- **Output-redaction in error responses to the LLM**: the `fail()` function (e.g., `tool-result.ts`) was not reviewed for whether failure messages might leak server-side state to the LLM. Spot check showed messages like "Calendar provider could not be initialized" — generic enough — but a full sweep was not performed.
- **Conversation-history role tampering**: the path that translates inbound chat messages into `role: "user"` LLM messages was not traced. If any path ever produces `role: "assistant"` from customer-controlled content, that is a prompt-injection primitive. Out of scope of this audit's depth; recommend a focused spec if launch blockers in chat-ingress reveal the relevant code.

---

## Section 3: Auth Surface

### Scope

Three subsystems plus all webhook signature verifiers:
- Dashboard auth: NextAuth (Credentials + Email + Google) in `apps/dashboard/src/lib/auth.ts`.
- API auth: `apps/api/src/middleware/auth.ts` + session-token JWT in `apps/api/src/auth/session-token.ts`.
- MCP auth: `apps/mcp-server/src/auth.ts` (separate from `session-guard.ts`, which is a runtime quota guard, not auth).
- Webhook signature verifiers: Meta (WhatsApp, Instagram), Stripe, Telegram, managed-webhook, alert-webhook.

### Method

- Read each auth subsystem's entry point and traced session/token verification.
- Reviewed cookie configuration (NextAuth defaults are Secure + HttpOnly + SameSite=lax in prod).
- Audited password hashing in `apps/dashboard/src/lib/password.ts` and the bootstrap-endpoint hash in `apps/api/src/routes/setup.ts`.
- Reviewed every webhook signature verifier for: timing-safe compare, replay protection (timestamp tolerance), raw-body capture, fail-closed behavior.
- Reviewed rate limiting in `apps/api/src/middleware/rate-limit.ts` (per-IP) and the global Fastify rate-limit registration in `apps/api/src/app.ts:126`.
- Surveyed admin/internal route exposure in `apps/api/src/routes/`.
- Reviewed setup-bootstrap protection.

### Items checked

- [✓] NextAuth config audited (`apps/dashboard/src/lib/auth.ts`) — JWT strategy, NEXTAUTH_SECRET enforced in production, prisma adapter, callbacks populate organizationId/principalId from DB on magic-link sign-in.
- [✓] session-token implementation audited (`apps/api/src/auth/session-token.ts`) — HS256, expiry, issuer claim, jose library.
- [✓] MCP auth audited (`apps/mcp-server/src/auth.ts`) — SHA-256 hash on load, timing-safe compare, fail-closed in production.
- [✓] API keys stored hashed (apiKeyHash, SHA-256) with high-entropy random source (`provision-dashboard-user.ts:20, 83`); also stored encrypted-at-rest for display recovery.
- [✗] API key revocation invalidates active sessions immediately. *(See AU-3 — 60s in-memory cache TTL on `dbKeyCache` in `apps/api/src/middleware/auth.ts:21`.)*
- [✓] Stripe webhook handler verifies signature with timing-safe compare and replay-tolerance (Stripe library default 300s) — `apps/api/src/services/stripe-service.ts:73`. Raw body correctly preserved via `config: { rawBody: true }` in `apps/api/src/routes/billing.ts:160`.
- [✓] WhatsApp/Instagram webhook signatures verified with HMAC-SHA256 + timing-safe compare; fails closed when appSecret missing.
- [✗] Webhook replay protection. *(See AU-1 — Meta-family webhooks have no timestamp tolerance check.)*
- [✗] Telegram webhook signature verifier fails open. *(See AU-2.)*
- [✗] Login/reset endpoints rate-limited per IP and per account. *(See AU-4 — per-IP only.)*
- [✓] No internal admin routes exposed without auth. `/api/setup/bootstrap` is the only sensitive setup route; protected by `INTERNAL_SETUP_SECRET` with timing-safe compare (`apps/api/src/routes/setup.ts:47-50`) and idempotency (one-time-only with 0-user check). Auth middleware exemptions are explicit and minimal (`/health`, `/metrics`, `/docs`, `/api/setup/*`, `/api/billing/webhook`).
- [✓] Password hashing uses bcrypt cost 12 + scrypt fallback (`apps/dashboard/src/lib/password.ts`); both modern and adequately costed. Verification uses `bcrypt.compare` and `timingSafeEqual` for scrypt.

### Findings

| ID   | Severity | Title                                                                                                | Evidence (file:line)                                                                                                                                              | Recommended fix                                                                                                                                                                                                                                                                                              | Status      |
| ---- | -------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| AU-1 | HIGH     | Meta-family webhook signatures (WhatsApp, Instagram) have no timestamp / replay-protection window    | `apps/chat/src/adapters/whatsapp.ts:97-113`, `apps/chat/src/adapters/instagram.ts:92-` (similar pattern)                                                          | Add a timestamp header check (Meta sends `x-hub-signature-256` but does not include a timestamp; consider tracking `(messageId, timestamp)` pairs for a deduplication window of ~10 minutes, or rely on the existing `WebhookEventLog` for idempotency — currently used only by Stripe). Document choice in adapter. | _untriaged_ |
| AU-2 | HIGH     | Telegram adapter `verifyRequest` returns `true` (fail-open) if `webhookSecret` is not configured     | `apps/chat/src/adapters/telegram.ts:82-83`                                                                                                                        | Match the WhatsApp pattern: fail-closed (return `false`) when `webhookSecret` is missing in production. Optionally allow a dev-mode override gated by `NODE_ENV !== "production"`.                                                                                                                            | _untriaged_ |
| AU-3 | MEDIUM   | API key revocation has up to 60s of latency due to in-memory `dbKeyCache` TTL                        | `apps/api/src/middleware/auth.ts:21, 128-137, 152`                                                                                                                | Either lower TTL (e.g., 10s) or invalidate the cache on revocation via a Redis pub/sub (or DB row-version). Acceptable risk at 10 customers but worth documenting. Defense-in-depth: a revoked key remains valid for ≤60s.                                                                                       | _untriaged_ |
| AU-4 | MEDIUM   | Auth rate limit is per-IP only; no per-account brute-force protection                                | `apps/api/src/middleware/rate-limit.ts:14-15, 33-50`                                                                                                              | Add a per-account counter on login/reset endpoints (key: `auth-rl-account:<email-hash>`) with a tighter limit (e.g., 5/15min) and a lockout/CAPTCHA on threshold breach. Pairs with the existing per-IP limit, not a replacement.                                                                                | _untriaged_ |
| AU-5 | LOW      | Session JWT uses HS256 (symmetric)                                                                   | `apps/api/src/auth/session-token.ts:33`                                                                                                                           | Acceptable for single-service use. If session tokens will ever be verified by external services (e.g., MCP from dashboard, dashboard from API in a future deployment topology), switch to RS256 or EdDSA. Track for post-launch reassessment.                                                                  | _untriaged_ |
| AU-6 | LOW      | `INTERNAL_SETUP_SECRET` rotation strategy not documented                                             | `apps/api/src/routes/setup.ts:27`                                                                                                                                 | The bootstrap endpoint is hard-gated by 0-user check, so post-bootstrap it is effectively dormant. Still: documented runbook for rotating `INTERNAL_SETUP_SECRET` after bootstrap (or removing it from production env vars entirely) reduces blast radius if leaked.                                              | _untriaged_ |
| AU-7 | INFO     | NextAuth secret rotation strategy not documented                                                     | `apps/dashboard/src/lib/auth.ts:84`                                                                                                                               | Document the JWT-rotation procedure for `NEXTAUTH_SECRET`. Rotation invalidates all active sessions, so plan a maintenance window. Track post-launch.                                                                                                                                                          | _untriaged_ |

### Coverage gaps

- **OAuth provider trust** (Google) was not audited beyond confirming standard NextAuth provider config. The full OAuth flow (state parameter, PKCE, redirect URI allowlist) relies on NextAuth defaults; if a launch-blocker spec calls for SOC2-grade OAuth review, do it then.
- **Email verification flow** was not deeply audited. The token model `DashboardVerificationToken` has standard NextAuth shape with expiry; not exhaustively tested for token-reuse, time-based attacks, or single-use enforcement.
- **CSRF on dashboard mutations** was not specifically tested; relies on NextAuth's defaults plus SameSite cookie semantics. Spot check OK; full CSRF audit recommended pre-SOC2.
- **Webhook signing-secret rotation** procedures were not documented. Stripe publishes a tool for rotating the webhook signing secret; Meta requires re-pairing. Operational runbook recommended.
- **Logout / session invalidation** not specifically traced. NextAuth sign-out destroys the session cookie but the JWT is self-contained (no server-side denylist). A stolen JWT remains valid until expiry. Trade-off — acceptable at this scale, not at SOC2-grade.

---

## Section 4: Credential Storage

### Scope

Concentrated credential surface: `packages/db/src/crypto/credentials.ts` (encryption/decryption helpers), `packages/db/src/storage/prisma-connection-store.ts` (storage boundary), `packages/db/src/oauth/token-refresh.ts` (Meta OAuth refresh), `packages/core/src/credentials/resolver.ts` (read-side resolver), and every call-site that uses these helpers.

### Method

- Read the encryption helper end-to-end (`packages/db/src/crypto/credentials.ts:1-92`).
- Read the connection store (`packages/db/src/storage/prisma-connection-store.ts`) to confirm encryption-at-write and decryption-at-read are uniformly applied.
- Read the OAuth refresh path (`packages/db/src/oauth/token-refresh.ts`).
- Searched every call-site of `encryptCredentials` / `decryptCredentials` to confirm no plaintext leaks into logs, Sentry, or response bodies.
- Reviewed `.env.example`, `.gitignore`, and tracked-file content for credential leakage.
- Reviewed Sentry instrumentation (`apps/api/src/bootstrap/sentry.ts`, `apps/chat/src/bootstrap/sentry.ts`) — Sentry capture only includes `error`, `url`, `method`, `traceId`. No request-body breadcrumbs that could carry credentials.

### Items checked

- [✓] Encryption algorithm: AES-256-GCM (AEAD, authenticated). `packages/db/src/crypto/credentials.ts:3`.
- [✓] Per-write random salt (32 bytes) and IV (16 bytes); authTag verified on decrypt; fail-closed on auth-tag mismatch.
- [✓] Key derivation via scrypt (`scryptSync(secret, salt, KEY_LENGTH)`); per-write salt prevents key reuse.
- [✓] Encryption key from env (`CREDENTIALS_ENCRYPTION_KEY`); helper throws if missing.
- [✓] Encryption key not in source control (`.gitignore` covers `.env`, `.env.local`, `.env.*.local`).
- [✓] All credential writes go through `encryptCredentials` (verified call-sites in `apps/api/src/routes/onboard.ts:118`, `apps/api/src/routes/google-calendar-oauth.ts:171`, `apps/api/src/routes/organizations.ts:257`, `apps/api/src/bootstrap/routes.ts:77`, `packages/db/src/storage/prisma-connection-store.ts:23`, `packages/db/src/oauth/token-refresh.ts:73`).
- [✓] All credential reads go through `decryptCredentials` (verified call-sites in `apps/api/src/services/cron/meta-token-refresh.ts:48`, `apps/api/src/bootstrap/inngest.ts:112, 307`, `apps/api/src/lib/check-v1-channel-limit.ts:74`, `apps/api/src/routes/google-calendar-oauth.ts:246`, `apps/api/src/routes/organizations.ts:369`, `packages/db/src/storage/prisma-connection-store.ts` toConnectionRecord).
- [✓] Decrypted plaintexts not logged. `console.warn` calls in `apps/api/src/services/cron/meta-token-refresh.ts:53, 83` log connection IDs and error messages, not credential plaintext. `app.log.warn` in `apps/api/src/bootstrap/inngest.ts` logs connection metadata, not credential bodies.
- [✓] Decrypted plaintexts not in Sentry breadcrumbs. Sentry init does not enable request-body breadcrumbs.
- [✓] Error responses do not include credential plaintext. Decryption failures surface as Stripe-style "Internal error" or "Connection error" without exposing the ciphertext or attempted plaintext.
- [✓] OAuth refresh flow maintains encryption invariants: `refreshMetaOAuthToken` re-encrypts before writing back to the connection row (`packages/db/src/oauth/token-refresh.ts:73-83`). Concurrent refresh handling: relies on Prisma's row-level update; not single-flight-protected. See CR-5.
- [✓] No real credentials in fixtures, seeds, or tracked files. `git ls-files | xargs rg -l "BEGIN PRIVATE KEY|sk_live_|whsec_"` returns nothing tracked.
- [✓] `.env.example` uses placeholder empty values for all secrets (`API_KEYS=`, `STRIPE_WEBHOOK_SECRET=`, etc.). One exception: `POSTGRES_PASSWORD=switchboard` is a known dev-default — see CR-3.

### Findings

| ID   | Severity | Title                                                                                  | Evidence (file:line)                                                                                                                | Recommended fix                                                                                                                                                                                                                                                                                                                              | Status      |
| ---- | -------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| CR-1 | LOW      | GCM IV is 16 bytes; recommended is 12                                                  | `packages/db/src/crypto/credentials.ts:4`                                                                                           | Change `IV_LENGTH = 12`. NIST SP 800-38D recommends 96-bit IVs for GCM. 128-bit IVs work but are not the standard. Migration: gracefully accept 12 OR 16 byte IVs (decrypt with whichever was used at encrypt time). For all new writes use 12.                                                                                              | _untriaged_ |
| CR-2 | LOW      | No AAD binding — ciphertexts could theoretically be moved between connection rows by a DB-write attacker | `packages/db/src/crypto/credentials.ts:40-46`                                                                                       | Optional: pass AAD = `${connectionId}:${organizationId ?? ""}` to `cipher.setAAD(...)` and `decipher.setAAD(...)`. Defense-in-depth — prevents an attacker with raw DB write access from swapping ciphertexts between connections. Migration adds complexity; defer post-launch unless threat model includes DB-write attackers.                | _untriaged_ |
| CR-3 | LOW      | `.env.example` ships `POSTGRES_PASSWORD=switchboard` as a default                      | `.env.example` (POSTGRES_PASSWORD line)                                                                                             | Acceptable as a dev-stack convenience but document explicitly that `POSTGRES_PASSWORD` MUST be changed in production. Consider replacing with `POSTGRES_PASSWORD=changeme-in-prod` to make the requirement loud at copy time.                                                                                                                | _untriaged_ |
| CR-4 | LOW      | `.gitignore` covers `.env*.local` but not `.env.production`, `.env.staging`            | `.gitignore`                                                                                                                        | Add `.env.production`, `.env.staging`, `.env.development` (without `.local`) to `.gitignore` to defend against accidental tracking when a production env file is named without the `.local` suffix.                                                                                                                                          | _untriaged_ |
| CR-5 | LOW      | OAuth refresh is not single-flight-protected; concurrent refreshes for the same connection can race | `packages/db/src/oauth/token-refresh.ts:35-90`                                                                                      | Two concurrent calls to `refreshMetaOAuthToken` for the same connection both call Meta and both write back. Last write wins. Risk: brief credential thrash. Add a single-flight lock keyed by `connection.id` (Redis SETNX with TTL or Postgres advisory lock).                                                                              | _untriaged_ |
| CR-6 | INFO     | scrypt key derivation runs on every encryption call                                    | `packages/db/src/crypto/credentials.ts:13-15, 36-37`                                                                                | Per-write scrypt is a performance cost (each encrypt = one scrypt op = ~50–100ms). Consider caching the derived key per-salt OR using an HMAC-based KDF for higher throughput. Not a security issue; defer post-launch unless throughput becomes an issue.                                                                                   | _untriaged_ |

### Coverage gaps

- **Plaintext lifetime in long-lived objects** was not exhaustively traced. The `ConnectionRecord` returned by the store holds plaintext credentials and may be cached upstream. If the orchestrator caches `ConnectionRecord` instances longer than necessary, plaintext lives in memory. Recommend: read once per-action, do not cache.
- **Key rotation procedure** is not documented. The audit confirmed `CREDENTIALS_ENCRYPTION_KEY` is the master secret; rotation would require re-encrypting every Connection row. Operational runbook recommended pre-launch.
- **HSM / KMS integration** is out of scope. At 10 customers, env-var key storage is acceptable. At enterprise scale, recommend AWS KMS / Vault for the master key with envelope encryption.
- **Audit of secret-exfiltration paths via tool calls** was deferred to Section 2 (AI / Skill-Runtime). Confirmed there that no credentials appear in LLM-visible prompts or tool inputs.

---

## Section 5: Mutation Bypass — Verification

### Scope

Confirm DOCTRINE §1 (single ingress) and the recent shipped controls (PR #305 chat approval block, PR #308 WorkTrace integrity, PR #293 terminal locking, PR #290 governance error visibility) remain intact. This is a verification pass, not discovery; new findings in this section are upgrades from previously-known issues that didn't make Section 1.

### Method

- Read `apps/api/src/__tests__/ingress-boundary.test.ts` to confirm the test still gates orchestrator-method calls in routes.
- Grep'd every mutating Prisma call across `packages/core/` and `apps/*/routes/` to identify direct writes outside the platform layer.
- Verified `bindingHash` coverage across api/chat/mcp-server.
- Reviewed `IdempotencyRecord` usage and orgId namespacing.
- Reviewed approval-lifecycle / WorkTrace alignment via PR #293's terminal locking and PR #308's WorkTrace integrity.
- Verified the AgentDeployment governance bypass status from REFACTOR-PLAN P1.

### Items checked

- [✓] Ingress-boundary test (`apps/api/src/__tests__/ingress-boundary.test.ts`) covers all route files. `LEGACY_EXCEPTIONS` is empty (line 33), `FULLY_EXEMPT` is empty (line 35). Phase 2 cleared all legacy bridges.
- [✗] No new direct-Prisma mutating writes outside platform layer. *(See MB-1.)*
- [✓] Every approval-respond endpoint that exists verifies `bindingHash`. `apps/api/src/routes/approvals.ts:58-62` requires bindingHash for `approve` / `patch`. `apps/api/src/routes/approval-factory.ts:44-93` computes and returns it on issuance. `apps/mcp-server/src/adapters/api-execution-adapter.ts:25, 70` carries it through.
- [✓] `apps/chat` does not accept approval responses on the conversational path (PR #305 blocked them). This is the intentional asymmetry — chat is **not** an approval-respond surface; only api and mcp are. The "chat asymmetry" REFACTOR-PLAN P2 flagged was resolved by removing the path, not by adding bindingHash to it.
- [✗] Idempotency keys are orgId-namespaced. *(See TI-10 in Section 1; cross-referenced here as MB-2.)*
- [✓] AgentDeployment governance bypass via `updateMany` (REFACTOR-PLAN P1) **resolved**. All call-sites (`apps/api/src/routes/billing.ts:247`, `apps/api/src/routes/governance.ts:184, 318`) include `organizationId: orgId` in the `where` clause.
- [✓] Approval lifecycle / WorkTrace alignment intact. PR #293 (terminal locking) ensures terminal states cannot be re-mutated. PR #308 (WorkTrace cryptographic integrity) anchors content hashes. The duplicate-persistence concern from REFACTOR-PLAN P1 is mitigated by these recent changes.

### Findings

| ID   | Severity | Title                                                                                                          | Evidence (file:line)                                                                                                                | Recommended fix                                                                                                                                                                                                                                                                                | Status      |
| ---- | -------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| MB-1 | INFO     | 39 mutating Prisma calls exist in `apps/api/src/routes/` that bypass `PlatformIngress.submit()`                | counts via `rg "prisma\\.\\w+\\.(create\|update\|upsert\|delete\|createMany\|updateMany\|deleteMany)" apps/api/src/routes/`        | These are platform-administration mutations (organizationConfig, agentRoster, managedChannel, scheduledReport, competencePolicy) — explicitly outside the "governed action" lifecycle per DOCTRINE. Document this distinction in DOCTRINE §1 so reviewers can quickly classify mutating writes. | _untriaged_ |
| MB-2 | (DUPE)   | IdempotencyRecord lacks orgId namespacing                                                                       | (see TI-10)                                                                                                                         | (see TI-10)                                                                                                                                                                                                                                                                                    | _untriaged_ |

### Coverage gaps

- **Cross-reference with Section 1**: Section 5's items are mostly verified-OK. The remaining mutation-related issues surfaced in Section 1 (TI-1 ingress body-orgId, TI-2 governance body-precedence, TI-7/TI-8 updateMany without orgId in approval stores) are tracked there to avoid duplication.
- **Workflow-mode mutations**: `WorkflowExecution`-driven mutations were not separately audited; they go through PlatformLifecycle which is itself bound to PlatformIngress. Trust assumption verified by the ingress-boundary test's coverage of all routes.
- **Cron / scheduled-trigger mutations**: cron jobs (`apps/api/src/services/cron/meta-token-refresh.ts`) write directly to the connection table without going through PlatformIngress. This is by design — cron is a system actor, not a user. No finding; documented for clarity.

---

## Section 6: OWASP Lightweight Sweep

### Scope

`apps/api`, `apps/chat`, `apps/dashboard`, `apps/mcp-server`, plus `packages/creative-pipeline` (because of its shell-exec surface). One-pass review across OWASP-relevant subjects: input validation, SSRF, injection, headers (CORS/CSP), cookies, redirects, rate limiting, error leakage, file uploads, dependency CVEs.

### Method

- Counted Zod usage in routes (60+ schemas) and verified `bodyLimit` (1 MB explicit, `apps/api/src/app.ts:101`).
- Grep'd outbound `fetch(` calls for SSRF surface; specifically reviewed creative-pipeline (file downloads), marketplace (Telegram bot setup), and OAuth handlers.
- Searched for raw queries (`$queryRaw`, `$executeRaw`, ``sql` `` template) and shell exec (`exec(`, `execFile`, `spawn`).
- Read `apps/api/src/app.ts` for global helmet/CORS/rate-limit/error-handler config.
- Read `apps/dashboard/next.config.mjs` for CSP and security headers.
- Read OAuth route handlers (`facebook-oauth.ts`, `google-calendar-oauth.ts`) for open-redirect risk.
- Ran `pnpm audit` and triaged advisories.

### Items checked

- [✓] Input validation present on most routes via Zod (`60` Zod usages across `apps/api/src/routes/`); body size capped at 1 MB.
- [✗] No unvalidated SSRF surfaces. *(See OW-1.)*
- [✓] No raw query / shell injection paths from user input. The single `Prisma.sql` use (`packages/db/src/stores/prisma-knowledge-store.ts:87`) uses parameterized substitution. Shell exec is limited to ffmpeg in creative-pipeline; args are server-constructed. Concat file path quoting (line 102) is a minor concern noted in OW-2.
- [✓] CORS origin allowlist explicit; production refuses cross-origin without `CORS_ORIGIN` env (`apps/api/src/app.ts:111-123`). No wildcard with credentials.
- [✗] CSP set in production but uses `'unsafe-inline'` for scripts and styles. *(See OW-3.)*
- [✓] Auth cookies have Secure / HttpOnly / SameSite via NextAuth defaults; HSTS, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin set on dashboard.
- [✓] Redirects use server-side `dashboardUrl` from env, not user input. `apps/api/src/routes/facebook-oauth.ts:138` and `apps/api/src/routes/google-calendar-oauth.ts:202` are safe.
- [✗] Sensitive endpoints rate-limited separately from reads. *(See AU-4 in Section 3 — only login/setup/billing-checkout get the stricter `authRateLimit`; approval/execute share with reads. Cross-referenced as OW-4.)*
- [✓] Production error handler hides error message for 5xx (`apps/api/src/app.ts:143-155`). Logger redacts `Authorization`, `Cookie`, `stripe-signature`, `body.apiKey`, `body.password`, `body.secret`, `body.token`, `body.accessToken`.
- [✓] No file-upload endpoints exposed. Multipart parsing exists for OAuth flows but not for arbitrary file ingest.
- [✗] Dependency vulnerabilities. *(See OW-5.)*

### Findings

| ID   | Severity | Title                                                                                                | Evidence (file:line)                                                                                                                                              | Recommended fix                                                                                                                                                                                                                                                                                                                                              | Status      |
| ---- | -------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| OW-1 | HIGH     | `creative-pipeline` `VideoAssembler.downloadClips` fetches arbitrary HTTP URLs from input (SSRF)     | `packages/creative-pipeline/src/stages/video-assembler.ts:136-152` (downloadClips), `:140-141` (`fetch(clip.videoUrl)`)                                          | Apply the WhatsApp-test pattern from PR #285: validate `clip.videoUrl` against an allowlist (e.g., S3, signed-URL host, known CDN) and reject non-HTTPS or private/internal IPs. Also add a max-size guard on the response body to prevent resource exhaustion via massive downloads.                                                                            | _untriaged_ |
| OW-2 | LOW      | `ffmpeg concat` file paths are quoted with single quotes; a path containing a single quote could break parsing | `packages/creative-pipeline/src/stages/video-assembler.ts:102`                                                                                                  | Paths today are server-constructed `clip-${i}.mp4`, so no immediate exploit. As defense-in-depth, escape single quotes in paths or use ffmpeg's `-safe 0` with absolute paths and a sanitized list. Minor.                                                                                                                                              | _untriaged_ |
| OW-3 | MEDIUM   | Dashboard CSP includes `'unsafe-inline'` for scripts and styles in production                        | `apps/dashboard/next.config.mjs:13` (script-src), `:14` (style-src)                                                                                              | Migrate to nonce-based CSP for scripts. Standard for Next.js 14 — use middleware to inject a nonce per-request and reference it in `<Script>` tags. Style-src nonces are harder; consider keeping `'unsafe-inline'` for styles but locking down scripts. Significant work; defer post-launch unless launch-day XSS coverage matters.                              | _untriaged_ |
| OW-4 | (DUPE)   | Sensitive endpoints share rate limit with reads                                                      | (see AU-4)                                                                                                                                                        | (see AU-4)                                                                                                                                                                                                                                                                                                                                                | _untriaged_ |
| OW-5 | LOW      | 3 moderate dev/transitive dependency CVEs in `pnpm audit`                                            | Vite ≤6.4.1 (path traversal in optimized deps; vitest transitive — dev-only); uuid <14.0.0 (buffer bounds; transitive); postcss <8.5.10 (XSS via `</style>`; Next.js transitive) | Upgrade vite to ≥6.4.2 (vitest), bump direct uuid usage to 14.x where applicable (review usages first), upgrade postcss to ≥8.5.10 via Next.js bump. None are direct production dependencies, but housekeeping reduces signal noise in future audits.                                                                                                | _untriaged_ |
| OW-6 | LOW      | Two `async headers()` functions defined in `apps/dashboard/next.config.mjs`; the second silently overrides the first | `apps/dashboard/next.config.mjs:28-46, 64-71`                                                                                                                    | Merge into a single `headers()` function returning all required headers. The current shadowing means a future edit to the first block has no effect — a maintenance trap.                                                                                                                                                                                | _untriaged_ |

### Coverage gaps

- **Dashboard server-action audit**: Next.js server actions were not exhaustively reviewed; they share NextAuth session context but each action's authorization needs to be individually checked. Recommend a focused dashboard-route audit pre-SOC2.
- **HSTS preload list**: HSTS is set with `preload` directive but the domain is not yet on Chrome's preload list. Out of scope; track for post-launch ops.
- **Subresource integrity (SRI)**: not enforced for external script tags. Minor — dashboard loads few external scripts; verify any third-party scripts (analytics, Sentry-frontend) use SRI.
- **Email-verification endpoint flow**: not specifically reviewed for token-reuse / single-use enforcement (covered briefly in Section 3 coverage gaps).
- **Webhook IP allowlists**: not currently enforced (Stripe and Meta publish IP ranges; an additional allowlist on top of signature verification is defense-in-depth). Out of scope at this stage.

---

## Triage Summary

_Populated after Task 8._

| Severity | Count | Fix-now | Fix-soon | Accept-risk | Defer |
| -------- | ----- | ------- | -------- | ----------- | ----- |
| CRITICAL |       |         |          |             |       |
| HIGH     |       |         |          |             |       |
| MEDIUM   |       |         |          |             |       |
| LOW      |       |         |          |             |       |
| INFO     |       |         |          |             |       |

---

## Verification Ledger

_Updated as fix-now items ship. One row per launch-blocking finding._

| Finding ID | Severity | Status | Spec / PR | Notes |
| ---------- | -------- | ------ | --------- | ----- |
