# prisma-hygiene

**Charter:** Migration drift, missing indexes, N+1 includes, raw SQL audit, encryption boundary checks. Enumerate index names >63 chars; re-verify 11 nullable organizationId fields for orphan-row risk.

**Method:** Static schema analysis on `packages/db/prisma/schema.prisma`; grep for raw SQL ($queryRaw/$executeRaw/Prisma.sql), encryption call sites (encryptCredentials/decryptCredentials), and N+1 patterns in stores; cross-check against pre-dispatch baseline and TI-9 from 12-pre-launch-security-audit.md.

**Scope exclusions applied:** None identified at this codebase level.

## (a) Index name >63 char audit

Found **10 indexes with implicit names exceeding 63 characters** (Postgres truncates silently):

| Model                           | Fields                                                    | Current Length | Exceeds By | Truncated to 63                                                 |
| ------------------------------- | --------------------------------------------------------- | -------------- | ---------- | --------------------------------------------------------------- |
| ConversationLifecycleSnapshot   | organizationId, qualificationStatus, bookingStatus        | 82             | +19        | ConversationLifecycleSnapshot_organizationId_qualificationStatu |
| ConversationLifecycleTransition | organizationId, conversationThreadId, occurredAt          | 82             | +19        | ConversationLifecycleTransition_organizationId_conversationThre |
| PreSwitchboardBaseline          | organizationId, dimension, metric, periodStart, periodEnd | 80             | +17        | PreSwitchboardBaseline_organizationId_dimension_metric_periodSt |
| ConversationLifecycleSnapshot   | organizationId, currentState, lastTransitionAt            | 78             | +15        | ConversationLifecycleSnapshot_organizationId_currentState_lastT |
| DeploymentMemory                | organizationId, deploymentId, category, canonicalKey      | 70             | +7         | DeploymentMemory_organizationId_deploymentId_category_canonical |
| ConversationLifecycleTransition | organizationId, toState, occurredAt                       | 69             | +6         | ConversationLifecycleTransition_organizationId_toState_occurred |
| ConversationLifecycleTransition | organizationId, trigger, occurredAt                       | 69             | +6         | ConversationLifecycleTransition_organizationId_trigger_occurred |
| OperatorChannelBinding          | organizationId, channel, channelIdentifier                | 67             | +4         | OperatorChannelBinding_organizationId_channel_channelIdentifier |
| DeploymentMemory                | organizationId, deploymentId, category, content           | 65             | +2         | DeploymentMemory_organizationId_deploymentId_category_content_i |
| ConversationLifecycleSnapshot   | organizationId, lastEvaluatedAt                           | 64             | +1         | ConversationLifecycleSnapshot_organizationId_lastEvaluatedAt_id |

**Recommended action:** Add explicit `name:` clauses with truncated names to ensure schema declares what Postgres actually creates.

## (b) Nullable organizationId re-verify (delta against TI-9)

**Baseline:** TI-9 pre-dispatch identified 11 models. Current schema: all 11 remain. **Perfect match.**

| Model                 | Risk Classification | Reasoning                                                                 |
| --------------------- | ------------------- | ------------------------------------------------------------------------- |
| Principal             | ORPHAN-RISK         | System/service principals can be org-independent; nullable allows orphans |
| IdentitySpec          | ORPHAN-RISK         | Direct tenant-scoped entity                                               |
| Policy                | ORPHAN-RISK         | Policy scope inherently tenant-bound                                      |
| ActionEnvelope        | ORPHAN-RISK         | Mutation envelope tied to tenant actions                                  |
| ConversationState     | ORPHAN-RISK         | **TI-5/TI-6 flagged**; conversation state must be org-scoped              |
| AuditEntry            | ORPHAN-RISK         | Audit records must be org-scoped                                          |
| Connection            | ORPHAN-RISK         | Nullable intentional for system-wide OAuth apps; **needs documentation**  |
| ApprovalRecord        | ORPHAN-RISK         | Approval tied to action envelopes                                         |
| ApprovalLifecycle     | ORPHAN-RISK         | Lifecycle management org-scoped                                           |
| FailedMessage         | ORPHAN-RISK         | Error logs for org message handling                                       |
| WhatsAppMessageStatus | ORPHAN-RISK         | Message tracking is org-scoped                                            |

## Findings

### [MED] Index name truncation — 10 implicit indexes >63 chars

- **Where:** `packages/db/prisma/schema.prisma`, 10 indexes across 4 models
- **Evidence:** See table above
- **Why it matters:** Prisma's default index-naming exceeds Postgres's 63-char limit; Postgres silently truncates, creating silent divergence between Prisma metadata and actual database state
- **Fix:** Add explicit `name:` clause with 63-char truncated name to each of the 10 indexes; verify no migrations reference these indexes by implicit name; document the truncation pattern in a schema-linting rule
- **Effort:** M
- **Risk if untouched:** Future migrations or schema introspection may fail to recognize indexes
- **Collides with active work?:** no

### [MED] 11 models with nullable organizationId — orphan-row risk (TI-9 re-verify)

- **Where:** `packages/db/prisma/schema.prisma` lines 14, 43, 83, 105, 133, 170, 197, 235, 258, 528, 1198
- **Evidence:** All 11 from TI-9 still present; classifications above
- **Why it matters:** Same as TI-9 (fix-soon, not launch-blocking per triage)
- **Fix:** Plan migrations to make organizationId NOT NULL with appropriate backfill rules per model (system sentinel org, parent FK org, or deletion)
- **Effort:** M
- **Risk if untouched:** Orphan rows; cross-tenant pollution risk
- **Collides with active work?:** no

### [LOW] Raw SQL present but properly parameterized

- **Where:** `packages/db/src/stores/prisma-knowledge-store.ts` (2 sites), `packages/db/src/storage/prisma-ledger-storage.ts` (advisory lock), `apps/api/src/bootstrap/storage.ts` (connectivity check), `apps/chat/src/main.ts` (connectivity check)
- **Evidence:** All $queryRaw / $executeRaw usage employs Prisma's template-literal syntax; no string interpolation observed
- **Status:** PASS — audit confirms conformance to injection controls
- **Collides with active work?:** no

### [LOW] Encryption boundary respected

- **Where:** `packages/db/src/crypto/credentials.ts` (central encryption helpers), `packages/db/src/storage/prisma-connection-store.ts` (encrypt-on-write, decrypt-on-read), `packages/db/src/oauth/token-refresh.ts`
- **Evidence:** All credential encryption/decryption isolated to `packages/db`; no encryption call sites in `packages/core` or app code; AES-256-GCM with authenticated decryption and per-write random salt/IV
- **Status:** PASS — boundary respected
- **Collides with active work?:** no

### [LOW] N+1 pattern — selective usage, no systemic risk

- **Where:** Spot-checked stores in `packages/db/src/stores/`
- **Evidence:** CRM funnel store and workflow store use findMany without include in some paths; these are typically leaf queries that don't fetch related records
- **Status:** No systemic N+1 pattern; recommend post-launch performance audit to profile slow-query logs
- **Collides with active work?:** no

## Out of scope / deferred for this lane

- Migration backfill rules for TI-9 nullable fields (deferred to fix-soon spec)
- Index-naming lint rule (post-launch schema-quality improvement)
- Live database validation (Postgres not reachable in this worktree)
- Performance profiling for N+1 (post-launch slow-query review)

## Summary

- Total indexes: 187
- Exceeding 63 chars: 10 (MED — silent truncation)
- Nullable organizationId models: 11 (all present; tracked as TI-9 fix-soon)
- Raw SQL audit: Conformant
- Encryption boundary: Respected
- N+1 patterns: No systemic risk
