# OpenClaw Session Runtime — Design Spec

**Date:** 2026-03-21
**Status:** Draft
**Scope:** Session persistence, role-scoped agents, and governed runtime contract for OpenClaw integration

---

## 1. System Boundaries and Canonical Flow

### Ownership Split

| Concern                                                     | Owner                         |
| ----------------------------------------------------------- | ----------------------------- |
| Reasoning, planning, tool selection, text generation        | OpenClaw (external)           |
| Tool execution, approvals, audit, policy, session lifecycle | Switchboard                   |
| Credentials, provider integrations, side effects            | Switchboard (cartridges)      |
| Pause/resume state, checkpoint storage                      | Switchboard (core)            |
| OpenClaw invocation, retries, delivery                      | Switchboard (apps/api worker) |

### Canonical Execution Path

1. **Trigger** — event, schedule, or manual goal.
2. **apps/api worker** creates `AgentSession`, invokes OpenClaw.
3. **OpenClaw reasons**, calls Switchboard read tools for context.
4. **OpenClaw decides** on action, calls `switchboard_execute`.
5. **LifecycleOrchestrator** — propose → policy → risk scoring.
6. **Outcome branches:**
   - `EXECUTED` → result back to OpenClaw → loop continues.
   - `DENIED` → OpenClaw receives denial, may re-plan or end.
   - `PENDING_APPROVAL` → OpenClaw returns checkpoint → run pauses.
7. **[time passes]** — human reviews in dashboard/chat.
8. **Approval resolves** → `SessionManager` marks the paused run resumable and records the approval result as part of the session state.
9. **apps/api worker re-invokes OpenClaw** with: original goal, tool call/result history, checkpoint summary, approval outcome, principal/org scope, session/run IDs, and trace/tool history IDs.
10. **OpenClaw resumes** reasoning from checkpoint.
11. **Run completes** → audit entry → operator summary.

### Invariants

- OpenClaw never persists state, never holds credentials, never executes side effects directly. If OpenClaw disappears mid-run, Switchboard has everything needed to resume or cancel.
- Switchboard is the system of record for workflow state; OpenClaw is stateless between invocations except for transient in-memory reasoning state.

---

## Shared Type Definitions

Types referenced across multiple sections. Defined here once to avoid ambiguity.

```typescript
// Session status enum
type SessionStatus = "running" | "paused" | "completed" | "failed" | "cancelled";

// Pause reason enum (matches AgentPause.pauseReason)
type PauseReason = "pending_approval" | "waiting_human" | "rate_limited" | "error_backoff";

// Approval posture enum
type ApprovalPosture = "conservative" | "balanced" | "autonomous";

// A single tool call recorded during a run
interface ToolEvent {
  stepIndex: number;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  timestamp: string;
  outcome: "executed" | "denied" | "pending_approval";
  envelopeId?: string;
  approvalId?: string;
}

// Approval outcome passed to SessionManager.markResumable
interface ApprovalOutcome {
  approvalId: string;
  action: "approve" | "reject" | "patch";
  patchValue?: Record<string, unknown>;
  respondedBy: string;
  resolvedAt: string;
}

// Merged manifest + org overrides, computed at session creation
interface ResolvedRoleConfig {
  roleId: string;
  version: string;

  // Tool surface (preserves read/write distinction)
  toolPack: {
    reads: string[];
    writes: string[];
  };

  // Governance
  governanceProfile: string;
  guardrailSet: string;
  approvalPosture: ApprovalPosture;
  allowedActionTypes: string[];
  thresholds: Record<string, number>;

  // Runtime
  runtimeInstructionTemplate: string; // resolved content, not a path
  checkpointSchema: Record<string, unknown>; // resolved schema, not a path

  // Permissions
  allowedChannels: string[];

  // Limits (enforced at session creation, not passed to OpenClaw)
  maxConcurrentSessions: number;

  // Safety envelope
  safetyEnvelope: {
    maxRunsPerSession: number;
    maxToolCallsPerRun: number;
    sessionTimeoutMs: number;
  };
}
```

---

## 2. Session State Machine

### Three Models

```
AgentSession (the durable container)
  ├── AgentRun (one per invocation of OpenClaw)
  └── AgentPause (one per suspension point)
```

### AgentSession

| Field            | Type     | Notes                                                                                                 |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| id               | uuid     |                                                                                                       |
| organizationId   | string   | Org scope                                                                                             |
| agentRole        | string   | References role manifest                                                                              |
| principalId      | string   | The principal identity this session acts as                                                           |
| status           | enum     | `running`, `paused`, `completed`, `failed`, `cancelled`                                               |
| goal             | string   | The original goal/trigger                                                                             |
| channel          | string   | How initiated: `mcp`, `http`, `schedule`, `event`                                                     |
| currentStep      | int      | Monotonically increasing step counter                                                                 |
| checkpoint       | json     | Structured checkpoint from OpenClaw (nullable until first pause)                                      |
| checkpointAt     | datetime | When the latest checkpoint was recorded                                                               |
| toolHistory      | json     | Denormalized cache for fast resume payload building (materialized from normalized tool-event records) |
| approvalOutcomes | json     | Array of `ApprovalOutcome` accumulated across pauses (see Shared Type Definitions)                    |
| traceId          | string   | Correlation across runs                                                                               |
| createdAt        | datetime |                                                                                                       |
| updatedAt        | datetime |                                                                                                       |

`toolHistory` is append-only and may be materialized from normalized tool-event records. The normalized `ToolEvent` store is the authoritative factual record; the session-level JSON is a denormalized snapshot for fast resume payload building. `toolHistory` size is bounded indirectly by `safetyEnvelope.maxToolCallsPerRun` (per run) and `safetyEnvelope.maxRunsPerSession` (per session). For long sessions approaching practical limits, the resume payload may truncate older entries and rely on the checkpoint's `completedSteps` summaries for continuity. The normalized `ToolEvent` store retains the full untruncated history for audit.

### AgentRun

| Field         | Type     | Notes                                                         |
| ------------- | -------- | ------------------------------------------------------------- |
| id            | uuid     |                                                               |
| sessionId     | fk       | Parent session                                                |
| runIndex      | int      | Sequential within session (0, 1, 2...)                        |
| triggerType   | enum     | `initial`, `resume_approval`, `resume_retry`, `resume_manual` |
| resumeContext | json     | What was passed to OpenClaw on invocation                     |
| outcome       | enum     | `completed`, `paused`, `failed`, `cancelled`                  |
| stepRange     | json     | `{ from: number, to: number }` — step range covered           |
| startedAt     | datetime |                                                               |
| completedAt   | datetime | nullable                                                      |

- One `AgentRun` may create zero or one `AgentPause`.
- A paused run must always have a matching pause row.

### AgentPause

| Field         | Type     | Notes                                                                |
| ------------- | -------- | -------------------------------------------------------------------- |
| id            | uuid     |                                                                      |
| sessionId     | fk       |                                                                      |
| runId         | fk       | The run that paused                                                  |
| pauseReason   | enum     | `pending_approval`, `waiting_human`, `rate_limited`, `error_backoff` |
| approvalId    | string   | nullable — links to Switchboard approval                             |
| checkpoint    | json     | Checkpoint snapshot at pause time                                    |
| pauseSequence | int      | Monotonic counter distinguishing pauses within a session             |
| resumeToken   | string   | Idempotency token for safe re-invocation                             |
| resumeStatus  | enum     | `pending`, `consumed`, `expired`, `cancelled`                        |
| createdAt     | datetime |                                                                      |
| resolvedAt    | datetime | nullable                                                             |

### State Transitions

```
                 ┌─────────────────────────────────┐
                 │                                  │
    ┌────────────▼───┐    ┌──────────┐    ┌────────┴────────┐
    │    running      │───▶│  paused   │───▶│    running       │
    └───┬──────┬──────┘    └──────────┘    └────────┬────────┘
        │      │                                     │
        │      │           ┌──────────┐              │
        │      └──────────▶│  failed   │◀─────────────┘
        │                  └──────────┘
        │
        │                  ┌───────────┐
        └─────────────────▶│ completed  │
                           └───────────┘

                           ┌───────────┐
           (any state) ───▶│ cancelled  │
                           └───────────┘
```

**Valid transitions:**

- `running → paused` — OpenClaw returns checkpoint after `PENDING_APPROVAL` or handoff.
- `paused → running` — Approval resolves, SessionManager triggers resume. Requires an unresolved pause record, a valid unconsumed `resumeToken`, and any required approval outcome persisted in session state. Must atomically consume the pause's `resumeToken`.
- `running → completed` — OpenClaw signals goal achieved or no further actions.
- `running → failed` — Unrecoverable error or max retries exceeded.
- `* → cancelled` — Manual cancellation via dashboard/API.

**Terminal states:** `completed`, `failed`, and `cancelled` are terminal. No transitions out.

**Cancellation from non-terminal states:**

- `running → cancelled` — Active `AgentRun` is marked `cancelled`. If OpenClaw is mid-run, the session-scoped token is invalidated so further tool calls are rejected.
- `paused → cancelled` — Associated `AgentPause.resumeStatus` transitions to `cancelled`. Any pending approval linked to the pause is not automatically resolved (the approval may have independent significance).

**Checkpoint duplication clarification:**

- `AgentSession.checkpoint` is the "current working checkpoint" — used by `buildResumePayload` to construct the resume context.
- `AgentPause.checkpoint` is the historical snapshot for audit and debugging — it records what the checkpoint looked like at the specific moment of that pause.
- On pause, both are written. On resume, `buildResumePayload` reads from `AgentSession.checkpoint`.

**Invariants:**

- Every transition is recorded as an audit entry with the session's `traceId`.
- `running` sessions have exactly one active `AgentRun`; `paused` sessions have zero active runs.
- `checkpoint` on the session is updated every time a run pauses (latest wins).
- Pause/failure reasons live on `AgentPause` or `AgentRun`, not on `AgentSession.status`.

**Resume token expiration:**

- Resume tokens expire after `safetyEnvelope.sessionTimeoutMs` from the pause creation time.
- Expiration is checked at both enqueue time (in the approval handler) and dequeue time (in the worker). If expired at dequeue, the worker transitions `resumeStatus` to `expired` and does not invoke OpenClaw.
- Stale pauses (token expired, approval never resolved) are cleaned up by a periodic sweep that transitions them to `expired` and optionally fails the parent session per policy.

**Concurrent resume handling:**

- If two approval responses arrive for the same pause simultaneously, the atomic `resumeStatus: pending → consumed` transition ensures exactly one succeeds.
- The second caller finds `resumeStatus !== "pending"` and receives: an idempotent success if the approval outcome matches what was already recorded, or a 409 Conflict if a different outcome was recorded.

---

## 3. Checkpoint Contract

### AgentCheckpoint (returned by OpenClaw, stored opaquely by Switchboard)

```typescript
interface AgentCheckpoint {
  // Schema version for backward-compatible evolution
  schemaVersion: number;

  // What the agent is trying to accomplish
  currentGoal: string;

  // The agent's working theory or plan of action
  workingHypothesis: string | null;

  // Steps already completed in this session (summaries, not full tool results)
  completedSteps: Array<{
    stepIndex: number;
    action: string;
    summary: string;
  }>;

  // The step that triggered the pause
  pendingStep: {
    action: string;
    parameters: Record<string, unknown>;
    reason: string;
  } | null;

  // Why the run paused
  whyPaused: string;

  // Business entities the agent is currently working with
  entitiesInFocus: Array<{
    entityType: string;
    entityId: string;
    label: string;
  }>;

  // Options the agent was considering before pause
  decisionCandidates: Array<{
    option: string;
    reasoning: string;
  }> | null;

  // What the agent expects to do after resume
  expectedNextAction: string | null;

  // Plain-language summary for dashboard/operator visibility
  operatorFacingSummary: string;
}
```

**Design rules:**

- Switchboard validates the checkpoint structurally (required fields present, types correct) but never interprets the semantic content. It is an opaque contract between "the agent that paused" and "the agent that resumes."
- Each role manifest may define a checkpoint schema extension (additional domain-specific fields), validated at pause time.
- `completedSteps` is a summary — the authoritative factual record is the normalized tool event store. The checkpoint is working memory, not the source of truth for what happened.
- Tool history is the factual record. Checkpoint summary is the resumable working memory. Full transcript can be optional debug/audit data, but not the core persistence contract.

### SessionResumePayload (Switchboard → OpenClaw on re-invocation)

```typescript
interface SessionResumePayload {
  // Identity and scope
  sessionId: string;
  runId: string;
  organizationId: string;
  principalId: string;
  agentRole: string;
  traceId: string;

  // The original goal
  goal: string;

  // Factual record (uses shared ToolEvent type)
  toolHistory: ToolEvent[];

  // Working memory from last pause
  checkpoint: AgentCheckpoint;

  // What resolved
  resumeTrigger: {
    type: "approval_resolved" | "manual_resume" | "retry";
    approvalOutcome?: ApprovalOutcome;
  };

  // Role config (merged manifest + org overrides, see Shared Type Definitions)
  roleConfig: ResolvedRoleConfig;
}
```

**Key invariant:** The resume payload is self-contained for workflow continuity. OpenClaw should not need additional reads to reconstruct prior reasoning state, prior actions, or the pause cause. Read calls after resume are only for refreshing live business context before taking the next action.

---

## 4. Role Manifests and Org Overrides

### Directory Structure

```
agent-roles/
  ad-operator/
    manifest.ts
    defaults/
      guardrails.ts
      instruction.md
      checkpoint-schema.ts
  support-agent/
    manifest.ts
    defaults/
      guardrails.ts
      instruction.md
      checkpoint-schema.ts
  sales-agent/
    manifest.ts
    defaults/
      guardrails.ts
      instruction.md
      checkpoint-schema.ts
  revenue-operator/
    manifest.ts
    defaults/
      guardrails.ts
      instruction.md
      checkpoint-schema.ts
```

Mirrors the pattern in `cartridges/*/manifest.ts` and `cartridges/*/defaults/guardrails.ts`.

**Layer placement:** `agent-roles/` is a top-level directory consumed by `apps/api` at startup (not a separate pnpm workspace package). Manifests are static TypeScript files that export typed objects conforming to `AgentRoleManifest`. They may import types from `@switchboard/schemas` but must not import runtime code from `core`, `db`, or cartridges. The manifest loader in `apps/api` reads these at startup, resolves `instructionTemplatePath` and `checkpointSchemaPath` to content, and produces normalized `AgentRoleManifest` objects. This follows the same pattern as `skins/` and `profiles/`, which are also top-level directories loaded by apps at startup.

### Manifest Shape

```typescript
interface AgentRoleManifest {
  // Identity
  roleId: string;
  version: string;
  description: string;

  // Tool surface
  toolPack: {
    reads: string[];
    writes: string[];
  };

  // Governance defaults
  governanceProfile: string;
  guardrailSet: string;
  approvalPosture: "conservative" | "balanced" | "autonomous";
  maxConcurrentSessions: number;
  defaultThresholds: Record<string, number>;

  // Runtime
  instructionTemplatePath: string; // loader-resolved, not free-form
  checkpointSchemaPath: string; // loader-resolved, not free-form

  // Channel permissions
  allowedChannels: string[];

  // Required capabilities
  requiredCartridges: string[];

  // Allowed action types (hard pre-policy gate for switchboard_execute)
  allowedActionTypes: string[];

  // Safety envelope
  safetyEnvelope: {
    maxRunsPerSession: number;
    maxToolCallsPerRun: number;
    sessionTimeoutMs: number;
  };
}
```

- `toolPack` defines what OpenClaw can call.
- `allowedActionTypes` gates what `switchboard_execute` may actually request within that role. This is a hard boundary enforced before policy evaluation.
- `instructionTemplatePath` and `checkpointSchemaPath` are loader-resolved assets — the loader resolves them once at startup and the rest of the system works with a normalized manifest object.

### Org Overrides (Database)

```prisma
model AgentRoleOverride {
  id                 String   @id @default(uuid())
  organizationId     String
  agentRole          String
  enabled            Boolean  @default(true)
  principalId        String?
  toolPackOverride   Json?
  thresholds         Json?
  escalationContacts Json?
  autonomyLevel      String?
  channelOverrides   Json?
  schedule           Json?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([organizationId, agentRole])
}
```

### Merge Rules

1. Start with the static manifest as the base.
2. Apply org overrides as **narrowing** operations:
   - `toolPackOverride` must be a **subset** of `manifest.toolPack` — cannot add tools.
   - `autonomyLevel` can only move toward more conservative unless an explicit admin policy permits escalation.
   - `channelOverrides` must be a **subset** of `manifest.allowedChannels`.
   - Overrides cannot widen `allowedActionTypes`.
3. `thresholds`, `escalationContacts`, and `schedule` layer org-specific values onto manifest `defaultThresholds`. The manifest's `defaultThresholds` becomes `thresholds` in the resolved config after org overrides are applied.
4. Merge is computed at session creation time and included in the resume payload as `roleConfig`.

### Validation

- **At startup:** `apps/api` loads all manifests and validates: referenced cartridges exist, tool names resolve, governance profiles exist.
- **At session creation:** Merged config is validated: override doesn't exceed envelope, principal exists, required cartridges are available and enabled for the org.

---

## 5. Tool Surface

### Two Categories, One Governance Boundary

OpenClaw interacts with Switchboard exclusively through tools. Tools are either reads (no side effects) or writes (routed through the orchestrator, governed by policy).

**Read tools** — no side effects, but still require auth, org scoping, and audit/logging. They do not go through approval/risk evaluation like writes.

| Tool                     | Description                                                    | Source              |
| ------------------------ | -------------------------------------------------------------- | ------------------- |
| `get_customer`           | Customer profile, contact info, history                        | crm                 |
| `get_conversation`       | Conversation thread with messages                              | customer-engagement |
| `get_campaign_metrics`   | Spend, CPA, ROAS, pacing                                       | digital-ads         |
| `get_operator_config`    | Operator identity, thresholds, preferences                     | core (identity)     |
| `search_knowledge`       | Knowledge base query with source-type boosting                 | core (knowledge)    |
| `list_pending_approvals` | Approvals awaiting resolution for this org                     | core (approvals)    |
| `get_audit_context`      | Recent audit entries for an entity or trace                    | core (audit)        |
| `get_session_state`      | Current session's own state only (cannot query other sessions) | core (sessions)     |

**Write tools** — all route through `switchboard_execute`:

| Tool                    | Description                            | Governance path                                                               |
| ----------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| `switchboard_execute`   | The canonical governed write primitive | orchestrator → policy → risk → approval/execute                               |
| `respond_to_approval`   | Approve/reject a pending approval      | Only for roles with delegated approval authority; most roles do not have this |
| `request_handoff`       | Escalate to human operator             | session → pause (`waiting_human`)                                             |
| `send_customer_message` | Send a message to a customer           | orchestrator → customer-engagement cartridge                                  |
| `create_followup_task`  | Schedule a follow-up action            | orchestrator → scheduling                                                     |

### Design Rules

1. **`switchboard_execute` is the canonical write primitive.** `send_customer_message` and `create_followup_task` are registered as distinct MCP tools with their own schemas (so OpenClaw sees them as named, typed tools). Internally, they resolve to `switchboard_execute` calls with the appropriate `actionType` and `cartridgeId`. Governance is identical — they are ergonomic aliases, not separate execution paths. They appear in tool pack definitions by their own names (e.g., a role's `toolPack.writes` lists `"send_customer_message"`, not `"switchboard_execute:customer-engagement:send_message"`).

2. **Role manifests control the tool surface.** An `ad-operator` never sees `send_customer_message`. A `support-agent` never sees `get_campaign_metrics`. The merged role config determines which tools are registered for a given session.

3. **Read tools are scoped by org.** Every read tool implicitly receives `organizationId` and `principalId` from the session context.

4. **`allowedActionTypes` gates `switchboard_execute`.** Even if OpenClaw calls `switchboard_execute` with an action type outside its role's envelope, the orchestrator rejects it before policy evaluation. Hard boundary.

5. **Tool registration happens at session creation.** Tool definitions included in the invocation payload are exactly the merged tool pack. OpenClaw cannot discover or request additional tools mid-session.

6. **`send_customer_message` is a governed write.** Outbound messaging is sensitive even when it feels lightweight.

7. **`respond_to_approval` is tightly role-limited.** Only roles/principals with delegated approval authority receive this tool. Most OpenClaw roles do not.

### Reuse of Existing Infrastructure

- MCP server's `toolFilter` parameter filters to the merged tool pack.
- Read tools reuse the existing `CartridgeReadAdapter` path.
- Write tools reuse the existing `ExecutionService.execute()` path.
- No new tool dispatch infrastructure needed.

---

## 6. Integration with Existing Orchestrator

### Philosophy

The existing orchestrator, approval manager, and execution path remain the source of truth for governed actions. The session layer is additive and coordination-focused, but may use small core-level hooks for correlation and idempotent resume handling. No semantic changes to the orchestrator execution model.

### Touchpoint 1: Execution Outcome Feeds Session State

When OpenClaw calls `switchboard_execute`, the existing flow is unchanged:

```
ExecutionService.execute()
  → orchestrator.resolveAndPropose()
    → policy evaluation → risk scoring → approval routing
  → returns RuntimeExecuteResponse { outcome, envelopeId, approvalId, ... }
```

`SessionManager` observes the outcome:

- `EXECUTED` → append to session's tool history, increment `currentStep`, continue.
- `DENIED` → append to tool history with denial reason, OpenClaw receives denial and may re-plan or end.
- `PENDING_APPROVAL` → create `AgentPause` with `approvalId` at pause time (not inferred later), store checkpoint from OpenClaw, persist tool event, then transition session to `paused`.

`SessionManager` does not replace or wrap `ExecutionService`. It observes outcomes and manages session state transitions.

### Touchpoint 2: Approval Resolution Triggers Resume

After `respondToApproval` succeeds, the API layer checks whether the approval is linked to an `AgentPause`:

1. `ApprovalResponse` returned (existing behavior).
2. Look up `AgentPause` by `approvalId`.
3. If found and `resumeStatus === "pending"`:
   a. Store approval outcome in session state.
   b. Transition `resumeStatus`: `pending → consumed` (atomic, with pause row locked by `approvalId`).
   c. Transition `session.status` to `running`.
   d. Create new `AgentRun` (`triggerType: resume_approval`).
   e. Enqueue resume job (once only, via outbox/job record pattern).
4. Return normal approval response (existing behavior unchanged).

### Changes to Existing Code

| File                                          | Change                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/core/src/orchestrator/lifecycle.ts` | No semantic changes; at most small additive hooks for session correlation and resume-safe coordination |
| `packages/core/src/execution-service.ts`      | No semantic changes; SessionManager wraps at a higher level                                            |
| `apps/api/src/routes/approvals.ts`            | After `respondToApproval`, check for linked pause and enqueue resume (~20 lines)                       |
| `apps/api/src/routes/execute.ts`              | No changes; session-scoped execution goes through new session routes                                   |

### New Code in `packages/core/src/sessions/`

```typescript
interface SessionManager {
  // Lifecycle
  createSession(params: {
    organizationId: string;
    agentRole: string;
    principalId: string;
    goal: string;
    channel: string;
    roleConfig: ResolvedRoleConfig;
  }): Promise<AgentSession>;

  // Outcome handling
  recordToolCall(sessionId: string, toolEvent: ToolEvent): Promise<void>;
  pauseSession(
    sessionId: string,
    params: {
      runId: string;
      reason: PauseReason;
      approvalId?: string;
      checkpoint: AgentCheckpoint;
    },
  ): Promise<AgentPause>;

  // Resume
  markResumable(pauseId: string, approvalOutcome: ApprovalOutcome): Promise<void>;
  buildResumePayload(sessionId: string): Promise<SessionResumePayload>;

  // Terminal states
  completeSession(sessionId: string, summary: string): Promise<void>;
  failSession(sessionId: string, error: string): Promise<void>;
  cancelSession(sessionId: string, cancelledBy: string): Promise<void>;

  // Queries
  getSession(sessionId: string): Promise<AgentSession | null>;
  listSessions(filter: {
    organizationId?: string;
    agentRole?: string;
    status?: SessionStatus[];
  }): Promise<AgentSession[]>;
}
```

### Transport Layer in `apps/api`

```typescript
interface SessionWorker {
  // OpenClaw invocation (transport concern)
  invokeOpenClaw(payload: SessionResumePayload): Promise<void>;

  // Resume job handler
  handleResumeJob(sessionId: string): Promise<void>;

  // Retry logic (transport failures only)
  retryInvocation(sessionId: string, attempt: number): Promise<void>;
}
```

---

## 7. API Endpoints and Worker

### Session Endpoints

| Method | Path                                     | Description                                             |
| ------ | ---------------------------------------- | ------------------------------------------------------- |
| `POST` | `/api/sessions`                          | Create session and trigger initial OpenClaw invocation  |
| `GET`  | `/api/sessions`                          | List sessions (filtered by org, role, status)           |
| `GET`  | `/api/sessions/:id`                      | Session detail (runs, pauses, tool history)             |
| `POST` | `/api/sessions/:id/cancel`               | Cancel a running or paused session                      |
| `POST` | `/api/sessions/:id/runs/:runId/callback` | Callback/event ingestion for OpenClaw terminal outcomes |
| `GET`  | `/api/sessions/:id/resume-payload`       | Debug/inspect: preview resume payload                   |

### Session Creation Flow

1. Authenticate request, resolve org + principal.
2. Validate `agentRole` exists in manifests.
3. Load manifest, load org override, merge → `ResolvedRoleConfig`.
4. Validate: required cartridges enabled, principal authorized, concurrent session limit not exceeded.
5. `SessionManager.createSession()` → `AgentSession` (status: `running`).
6. Create `AgentRun` (runIndex: 0, triggerType: `initial`).
7. Build initial invocation payload (goal, roleConfig, session-scoped tool definitions, session/run/trace IDs).
8. Issue session-scoped auth token (short-lived, scoped to org + role tool pack).
9. Enqueue invocation job → worker picks it up.
10. Return `{ sessionId, runId, traceId, status: "running" }`.

### Resume Flow (triggered by approval resolution)

1. `POST /api/approvals/:id/respond` → `orchestrator.respondToApproval()`.
2. Look up `AgentPause` by `approvalId`.
3. If found and `resumeStatus === "pending"`:
   a. Extract `pauseId` from the looked-up `AgentPause`, then call `SessionManager.markResumable(pauseId, approvalOutcome)` — stores approval outcome, transitions `resumeStatus: pending → consumed` (atomic).
   b. Create `AgentRun` (`triggerType: resume_approval`).
   c. Enqueue resume job with `resumeToken` as idempotency key (once only, via outbox pattern).
4. Return normal approval response (existing behavior unchanged).

### Callback Endpoint

`POST /api/sessions/:id/runs/:runId/callback` — transport-dependent ingestion path for OpenClaw terminal outcomes. May be delivered via webhook or event. Accepts:

- Run completed: `{ outcome: "completed", summary, runMetadata }`
- Run paused: `{ outcome: "paused", checkpoint: AgentCheckpoint, pauseReason: PauseReason, approvalId?: string }`
- Run failed: `{ outcome: "failed", error, failureMetadata }`

The authoritative tool execution record lives in Switchboard (recorded via tool calls during the run). The callback carries the terminal outcome, checkpoint, and optional run-level metadata — not the authoritative tool record.

**Callback authentication:** The callback endpoint validates the session-scoped auth token (the same token issued to OpenClaw for tool calls). The token is included in a `Authorization: Bearer <token>` header. Additionally, the endpoint verifies the `runId` matches the currently active run for the session. Requests with expired, invalid, or mismatched tokens are rejected with 401.

### Worker

**Interaction model (Model X):** The worker starts/resumes OpenClaw runs, but OpenClaw calls Switchboard tools directly during its reasoning loop. The worker does not synchronously mediate individual tool calls. Reads and writes flow through the existing Switchboard tool and execution paths.

**Worker flow:**

1. Load session, verify status is `running` and run is active.
2. Verify `resumeToken` hasn't been consumed (idempotent guard).
3. Build payload:
   - Initial run: goal + roleConfig + session-scoped tool definitions + auth token.
   - Resume run: `SessionManager.buildResumePayload()`.
4. Invoke OpenClaw via configured transport (HTTP/webhook).
5. OpenClaw performs its reasoning loop, calling Switchboard tools directly.
6. OpenClaw returns terminal outcome via callback endpoint.
7. Worker (or callback handler) processes outcome:
   - Completed → `SessionManager.completeSession()`.
   - Paused → `SessionManager.pauseSession()`.
   - Failed → `SessionManager.failSession()`.
8. Write audit entry for run completion.

### Retry Semantics

Distinguish transport failure from reasoning failure:

- **Transport failure** (OpenClaw unreachable) → retry with exponential backoff (max 3 attempts). Session transitions to `paused` with `pauseReason: error_backoff`. After max retries, session transitions to `failed`. Each retry creates a new `AgentRun` with `triggerType: resume_retry`.
- **Reasoning failure** (OpenClaw returns structured failure) → record failed run, pause or fail session depending on policy. No automatic retry.
- `resumeToken` ensures a resume job executes at most once even if the queue delivers twice.

---

## 8. Phased Rollout

### Phase 1: Ad Operator Pilot

**Goal:** One role-scoped agent (ad-operator) running end-to-end through the governed path, with approval pause/resume and a stable transport contract.

**Deliverables:**

1. `packages/core/src/sessions/` — SessionManager, state machine, store interfaces, checkpoint schema validation.
2. `packages/db` — Prisma models: `AgentSession`, `AgentRun`, `AgentPause`, `AgentRoleOverride`. Store implementations.
3. `agent-roles/ad-operator/` — Manifest, guardrails, instruction template, checkpoint schema extension.
4. `apps/api` — Session endpoints. Callback/event ingestion path for OpenClaw terminal outcomes. Resume logic in approval route. Worker for invocation/retry.
5. Tool surface for ad-operator: `get_campaign_metrics`, `get_operator_config`, `get_audit_context`, `get_session_state` (reads). `switchboard_execute` with `allowedActionTypes` scoped to digital-ads actions (writes).
6. Session-scoped tool auth: short-lived token issued at invocation, scoped to org + role tool pack.
7. Operator-facing summary: after each run completes or pauses, write operator-readable summary to audit.

**Go/no-go for Phase 2:**

- Session create → invoke → tool calls → execute → audit works end-to-end.
- `PENDING_APPROVAL` → pause → approval resolves → resume works reliably.
- OpenClaw invocation contract is stable for `initial`, `paused`, `completed`, and `failed` outcomes.
- Retry/backoff handles OpenClaw transport failures.
- API inspection plus audit summaries provide sufficient operator visibility. Full dashboard session UI is optional for pilot.
- No credential leakage to OpenClaw.
- Session-scoped tokens expire correctly and cannot be reused outside the session/run boundary.

### Phase 2: Customer Conversations

**Goal:** Support-agent and sales-agent roles, integrated with existing chat infrastructure.

**Deliverables:**

1. `agent-roles/support-agent/` and `agent-roles/sales-agent/` — Manifests with conversation-oriented tool packs.
2. Additional read tools: `get_customer`, `get_conversation`, `search_knowledge`.
3. Additional write tools: `send_customer_message`, `request_handoff` (both resolve to `switchboard_execute`).
4. Chat integration: bridge between `apps/chat` channel adapters and session-scoped OpenClaw runs.
5. Handoff tooling: `request_handoff` pauses session with `pauseReason: waiting_human`. Dashboard shows handoff queue.
6. Knowledge retrieval guardrails: policy-scoped access per role.

**Go/no-go for Phase 3:**

- Customer messages route through governed sessions.
- Handoff pause/resume works with human-in-the-loop.
- Sensitive cases trigger appropriate escalation.
- No customer-facing messages sent outside Switchboard governance.

### Phase 3: Long-Running Autonomy

**Goal:** Durable, recurring, self-recovering agent sessions with performance tracking.

**Deliverables:**

1. `agent-roles/revenue-operator/` — Cross-domain coordination role manifest.
2. Recurring goals: each scheduled review creates a new session (not one immortal session). Keeps state bounded.
3. Recovery/retry: failed sessions retried from last checkpoint. Stale pauses auto-resolve per policy.
4. Performance metrics per agent: per-role success rates, run counts, pause durations, escalation rates.
5. Autonomy promotion: layers onto existing `CompetenceTracker`. Audited and reversible.
6. Session timeout enforcement: sessions exceeding `safetyEnvelope.sessionTimeoutMs` auto-cancelled with audit entry.

**Go/no-go (production readiness):**

- Sessions survive worker restarts (durable state in DB, jobs are resumable).
- No orphaned sessions (timeout + stale-pause cleanup).
- Per-agent metrics visible via API.
- Autonomy promotion is audited and reversible.
- Session-scoped tokens expire correctly and cannot be reused outside the session/run boundary.

---

## Non-Goals

- **Multi-agent coordination** — each role operates independently against Switchboard.
- **OpenClaw-side implementation details** — Switchboard defines the contract; OpenClaw's internals are out of scope.
- **Migration of `packages/agents` event mesh** — it continues to exist; this design runs on the orchestrator path.
- **Dashboard UI for session management** — separate design once the API surface is stable.

---

## Repo Placement Summary

| Component                                                                    | Location                           |
| ---------------------------------------------------------------------------- | ---------------------------------- |
| Session state machine, SessionManager, store interfaces, checkpoint contract | `packages/core/src/sessions/`      |
| Prisma models, store implementations                                         | `packages/db/`                     |
| Role manifests (static, versioned)                                           | `agent-roles/` (top-level)         |
| Session API endpoints, callback endpoint, worker                             | `apps/api/`                        |
| Approval→resume hook                                                         | `apps/api/src/routes/approvals.ts` |
