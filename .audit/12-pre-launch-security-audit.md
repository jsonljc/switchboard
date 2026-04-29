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

_Pending — see Task 2 of plan._

---

## Section 3: Auth Surface

_Pending — see Task 3 of plan._

---

## Section 4: Credential Storage

_Pending — see Task 4 of plan._

---

## Section 5: Mutation Bypass — Verification

_Pending — see Task 5 of plan._

---

## Section 6: OWASP Lightweight Sweep

_Pending — see Task 6 of plan._

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
