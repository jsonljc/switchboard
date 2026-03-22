# OpenClaw Session Runtime — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the session persistence layer, role manifest system, and session API endpoints so that one role-scoped agent (ad-operator) can run end-to-end through the governed orchestrator path with approval pause/resume.

**Architecture:** Session state machine lives in `packages/core/src/sessions/` following the existing store-interface pattern. Prisma models and store implementations in `packages/db/`. Role manifests in top-level `agent-roles/`. Session API endpoints and worker in `apps/api/`. The session layer is additive — no semantic changes to the existing orchestrator, execution service, or approval flow.

**Tech Stack:** TypeScript, Prisma ORM, Fastify, BullMQ, Vitest, Zod

---

## Architectural Rules (Non-Negotiable)

These rules override any implementation shortcut. If a task requires violating one, stop and redesign.

1. **No session logic inside orchestrator pipelines.** `propose-pipeline.ts`, `execution-manager.ts`, `approval-manager.ts`, `plan-pipeline.ts`, and `lifecycle.ts` are off-limits. The session layer wraps the orchestrator — it never enters it.

2. **SessionManager owns ALL session state transitions.** Create, pause, resume, complete, fail, cancel — every transition flows through `SessionManager`. No route, worker, or hook directly mutates session/run/pause stores.

3. **No route or worker directly mutates session stores.** Routes call `SessionManager` methods. Workers call `SessionManager` methods. If you're importing a session store outside of `SessionManager` (or test code), you're doing it wrong.

4. **Gateway Interface Contract must be written before Wave 3.** The mock Gateway and real Gateway implement the same interface. If the contract changes, both change.

## Three Safety Layers (Crisp Distinction)

| Layer                                          | Scope                                    | Persistence                     | Decides                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SessionGuard** (existing, `apps/mcp-server`) | Single invocation (one Gateway RPC call) | In-memory only                  | "Has this invocation gone runaway?" — call/mutation count, dollar exposure, duplicate detection within one agent turn                                     |
| **safetyEnvelope** (new, on `AgentSession`)    | Entire session (across all runs)         | Persisted in DB                 | "Has this session exceeded its cumulative budget?" — total tool calls, total mutations, total dollar exposure, session timeout across pause/resume cycles |
| **Policy engine** (existing, `packages/core`)  | Per action                               | Persisted via envelopes + audit | "Should this specific action be allowed, denied, or require approval?" — risk scoring, guardrails, approval routing                                       |

These never consult each other. SessionGuard fires first (cheapest). safetyEnvelope fires second (DB read). Policy engine fires third (full governance pipeline).

## ToolEvent Lifecycle Decision

**ToolEvent is operational state for the lifetime of the session, observability data after completion.**

- While `running`/`paused`: needed for resume payload building and safetyEnvelope enforcement
- After terminal state (`completed`/`failed`/`cancelled`): becomes audit/trace data

Phase 1: store in Postgres with `sessionCompletedAt` index. Phase 2 consideration (not built now): archive to cold storage after N days, keep summary row on session as permanent record.

## Wave Structure

**Wave 1 (Tasks 1–4, 10):** Pure contracts — schemas, state machine, store interfaces, role manifest. All parallelizable. No DB, no Fastify, no BullMQ.

**Wave 2 (Tasks 5–9):** Persistence + manager. Exit criterion: SessionManager lifecycle integration test passes with in-memory stores (create → pause → resume → complete).

**Wave 3 (Tasks 11–19):** API surface + wiring. Entry gate: Wave 2 integration test passes AND Gateway Interface Contract written. Exit criterion: same lifecycle test passes end-to-end through HTTP routes + BullMQ + mock Gateway.

**Parallelism:** Tasks 1, 2, 3, 4, and 10 are independent. Task 5 depends on 3+4. Tasks 6-8 depend on 1+3. Task 9 depends on 5-8. Tasks 11-19 depend on 9+10.

---

## File Map

### New Files

```
packages/schemas/src/
  session.ts                                    — Session Zod schemas (statuses, models, payloads)

packages/core/src/sessions/
  index.ts                                      — Barrel exports
  state-machine.ts                              — Pure transition functions
  store-interfaces.ts                           — SessionStore, RunStore, PauseStore, ToolEventStore
  session-manager.ts                            — Lifecycle coordinator (all transitions)
  role-config-merger.ts                         — Merge manifest defaults with org overrides
  checkpoint-validator.ts                       — Structural validation of checkpoints
  resume-payload-builder.ts                     — Build resume payload from session state
  __tests__/state-machine.test.ts
  __tests__/session-manager.test.ts
  __tests__/role-config-merger.test.ts
  __tests__/checkpoint-validator.test.ts
  __tests__/resume-payload-builder.test.ts
  __tests__/test-stores.ts                      — Shared in-memory store implementations for tests

packages/db/prisma/
  migrations/YYYYMMDD_add_agent_sessions/       — Prisma migration (auto-generated)

packages/db/src/storage/
  prisma-session-store.ts                       — SessionStore implementation
  prisma-run-store.ts                           — RunStore implementation
  prisma-pause-store.ts                         — PauseStore implementation
  prisma-tool-event-store.ts                    — ToolEventStore implementation
  prisma-role-override-store.ts                 — RoleOverrideStore implementation

agent-roles/
  tsconfig.json                                 — TypeScript config for manifests
  ad-operator/
    manifest.ts                                 — Role manifest (TypeScript source)
    manifest.json                               — Role manifest (runtime artifact)
    defaults/guardrails.ts                      — Default guardrail config
    defaults/instruction.md                     — System prompt template
    defaults/checkpoint-schema.ts               — Checkpoint Zod schema (TypeScript source)
    defaults/checkpoint-schema.json             — Checkpoint schema (runtime artifact)

apps/api/src/
  auth/session-token.ts                         — Session-scoped JWT issue/validate
  routes/sessions.ts                            — Session CRUD + lifecycle endpoints
  jobs/session-invocation.ts                    — BullMQ worker for Gateway RPC
  bootstrap/role-manifests.ts                   — Manifest loader from filesystem
  __tests__/session-token.test.ts
```

### Modified Files

```
packages/schemas/src/index.ts                   — Add session export
packages/core/src/index.ts                      — Add sessions barrel export
packages/db/prisma/schema.prisma                — Add 5 new models
packages/db/src/storage/index.ts                — Export new stores
packages/db/src/index.ts                        — Re-export new stores
apps/api/src/app.ts                             — Augment FastifyInstance with sessionManager, sessionInvocationQueue
apps/api/src/bootstrap/routes.ts                — Register sessions routes
apps/api/src/bootstrap/jobs.ts                  — Start session invocation worker
apps/api/src/routes/approvals.ts                — Add resume hook after respondToApproval
```

---

## Task 1: Session Zod Schemas (packages/schemas)

**Files:**

- Create: `packages/schemas/src/session.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Write `session.ts` with all session schemas**

Create `packages/schemas/src/session.ts`:

```typescript
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SessionStatusSchema = z.enum([
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const RunTriggerTypeSchema = z.enum([
  "initial",
  "resume_approval",
  "resume_manual",
  "resume_retry",
]);
export type RunTriggerType = z.infer<typeof RunTriggerTypeSchema>;

export const RunOutcomeSchema = z.enum([
  "completed",
  "paused_for_approval",
  "failed",
  "cancelled",
  "timeout",
]);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

export const ResumeStatusSchema = z.enum(["pending", "consumed", "expired", "cancelled"]);
export type ResumeStatus = z.infer<typeof ResumeStatusSchema>;

// ---------------------------------------------------------------------------
// Safety Envelope — persisted cross-run budget
// ---------------------------------------------------------------------------

export const SafetyEnvelopeSchema = z.object({
  maxToolCalls: z.number().int().positive(),
  maxMutations: z.number().int().positive(),
  maxDollarsAtRisk: z.number().positive(),
  sessionTimeoutMs: z.number().int().positive(),
});
export type SafetyEnvelope = z.infer<typeof SafetyEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Checkpoint — opaque to Switchboard, validated structurally only
// ---------------------------------------------------------------------------

export const AgentCheckpointSchema = z.object({
  /** Opaque agent state — Switchboard never interprets this */
  agentState: z.record(z.unknown()),
  /** Last tool call result, for resume context */
  lastToolResult: z.record(z.unknown()).optional(),
  /** Pending approval that caused the pause */
  pendingApprovalId: z.string().optional(),
  /** Role-specific extensions validated by checkpoint schema */
  extensions: z.record(z.unknown()).optional(),
});
export type AgentCheckpoint = z.infer<typeof AgentCheckpointSchema>;

// ---------------------------------------------------------------------------
// Tool Event — individual tool call record
// ---------------------------------------------------------------------------

export const ToolEventSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  toolName: z.string().min(1),
  parameters: z.record(z.unknown()),
  result: z.record(z.unknown()).nullable(),
  isMutation: z.boolean(),
  dollarsAtRisk: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  envelopeId: z.string().uuid().nullable(),
  timestamp: z.coerce.date(),
});
export type ToolEvent = z.infer<typeof ToolEventSchema>;

// ---------------------------------------------------------------------------
// Agent Run — one invocation of the agent within a session
// ---------------------------------------------------------------------------

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  runIndex: z.number().int().nonnegative(),
  triggerType: RunTriggerTypeSchema,
  resumeContext: z.record(z.unknown()).nullable(),
  outcome: RunOutcomeSchema.nullable(),
  stepRange: z
    .object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .nullable(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

// ---------------------------------------------------------------------------
// Agent Pause — approval-gated pause record
// ---------------------------------------------------------------------------

export const AgentPauseSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  pauseIndex: z.number().int().nonnegative(),
  approvalId: z.string().uuid(),
  resumeStatus: ResumeStatusSchema,
  resumeToken: z.string().min(1),
  checkpoint: AgentCheckpointSchema,
  approvalOutcome: z.record(z.unknown()).nullable(),
  createdAt: z.coerce.date(),
  resumedAt: z.coerce.date().nullable(),
});
export type AgentPause = z.infer<typeof AgentPauseSchema>;

// ---------------------------------------------------------------------------
// Agent Session — top-level session record
// ---------------------------------------------------------------------------

export const AgentSessionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  roleId: z.string().min(1),
  principalId: z.string().min(1),
  status: SessionStatusSchema,
  safetyEnvelope: SafetyEnvelopeSchema,
  /** Denormalized cumulative counters for fast safetyEnvelope checks */
  toolCallCount: z.number().int().nonnegative(),
  mutationCount: z.number().int().nonnegative(),
  dollarsAtRisk: z.number().nonnegative(),
  currentStep: z.number().int().nonnegative(),
  /** Denormalized tool history for resume payload building */
  toolHistory: z.array(ToolEventSchema),
  checkpoint: AgentCheckpointSchema.nullable(),
  traceId: z.string().min(1),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type AgentSession = z.infer<typeof AgentSessionSchema>;

// ---------------------------------------------------------------------------
// Agent Role Override — org-level narrowing of role manifest defaults
// ---------------------------------------------------------------------------

export const AgentRoleOverrideSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  roleId: z.string().min(1),
  /** Narrow the allowed tool list (subset of manifest.toolPack) */
  allowedTools: z.array(z.string()).optional(),
  /** Override safety envelope limits (can only tighten, not loosen) */
  safetyEnvelopeOverride: SafetyEnvelopeSchema.partial().optional(),
  /** Override governance profile */
  governanceProfileOverride: z.string().optional(),
  /** Additional guardrail rules */
  additionalGuardrails: z.record(z.unknown()).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AgentRoleOverride = z.infer<typeof AgentRoleOverrideSchema>;

// ---------------------------------------------------------------------------
// Resume Payload — sent to Gateway on resume
// ---------------------------------------------------------------------------

export const ResumePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  roleId: z.string().min(1),
  checkpoint: AgentCheckpointSchema,
  approvalOutcome: z.record(z.unknown()),
  toolHistory: z.array(ToolEventSchema),
  instruction: z.string().min(1),
  safetyBudgetRemaining: z.object({
    toolCalls: z.number().int().nonnegative(),
    mutations: z.number().int().nonnegative(),
    dollarsAtRisk: z.number().nonnegative(),
    timeRemainingMs: z.number().int(),
  }),
});
export type ResumePayload = z.infer<typeof ResumePayloadSchema>;

// ---------------------------------------------------------------------------
// Gateway Interface Contract
// ---------------------------------------------------------------------------

export const GatewayInvokeRequestSchema = z.object({
  sessionId: z.string().uuid(),
  runId: z.string().uuid(),
  roleId: z.string().min(1),
  sessionToken: z.string().min(1),
  /** Initial invocation: instruction + tools + safety limits */
  instruction: z.string().optional(),
  toolPack: z.array(z.string()).optional(),
  safetyLimits: SafetyEnvelopeSchema.optional(),
  /** Resume invocation: checkpoint + approval outcome + history */
  resumePayload: ResumePayloadSchema.optional(),
});
export type GatewayInvokeRequest = z.infer<typeof GatewayInvokeRequestSchema>;

export const GatewayInvokeResponseSchema = z.object({
  status: z.enum(["completed", "paused", "failed"]),
  /** Checkpoint state when paused */
  checkpoint: AgentCheckpointSchema.optional(),
  /** Tool calls made during this invocation */
  toolCalls: z.array(ToolEventSchema.omit({ id: true, sessionId: true, runId: true })).optional(),
  /** Final result when completed */
  result: z.record(z.unknown()).optional(),
  /** Error details when failed */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type GatewayInvokeResponse = z.infer<typeof GatewayInvokeResponseSchema>;

// ---------------------------------------------------------------------------
// API Request/Response schemas
// ---------------------------------------------------------------------------

export const CreateSessionRequestSchema = z.object({
  organizationId: z.string().min(1),
  roleId: z.string().min(1),
  principalId: z.string().min(1),
  /** Override safety envelope (tightening only, validated against role manifest) */
  safetyEnvelopeOverride: SafetyEnvelopeSchema.partial().optional(),
  /** Initial context/instruction for the agent */
  initialContext: z.record(z.unknown()).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

// ---------------------------------------------------------------------------
// Role Manifest — type lives in schemas so all layers can import it cleanly
// ---------------------------------------------------------------------------

export const AgentRoleManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  toolPack: z.array(z.string()),
  governanceProfile: z.string(),
  safetyEnvelope: SafetyEnvelopeSchema,
  /** Relative path to instruction template from manifest directory */
  instructionPath: z.string(),
  /** Relative path to checkpoint schema from manifest directory */
  checkpointSchemaPath: z.string(),
  /** Maximum concurrent sessions per org for this role */
  maxConcurrentSessions: z.number().int().positive(),
});
export type AgentRoleManifest = z.infer<typeof AgentRoleManifestSchema>;
```

- [ ] **Step 2: Add to barrel export**

Add to `packages/schemas/src/index.ts`:

```typescript
export * from "./session.js";
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/schemas typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/session.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add session runtime Zod schemas

Adds AgentSession, AgentRun, AgentPause, ToolEvent, SafetyEnvelope,
ResumePayload, GatewayInvokeRequest/Response, and related types."
```

---

## Task 2: Session State Machine (packages/core)

**Files:**

- Create: `packages/core/src/sessions/state-machine.ts`
- Test: `packages/core/src/sessions/__tests__/state-machine.test.ts`

**Pattern reference:** Follow `packages/core/src/approval/state-machine.ts` — pure functions, explicit transition table, custom error class.

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/sessions/__tests__/state-machine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  canTransition,
  validateTransition,
  SessionTransitionError,
  VALID_TRANSITIONS,
} from "../state-machine.js";

describe("Session State Machine", () => {
  describe("canTransition", () => {
    it("allows running → paused", () => {
      expect(canTransition("running", "paused")).toBe(true);
    });

    it("allows running → completed", () => {
      expect(canTransition("running", "completed")).toBe(true);
    });

    it("allows running → failed", () => {
      expect(canTransition("running", "failed")).toBe(true);
    });

    it("allows running → cancelled", () => {
      expect(canTransition("running", "cancelled")).toBe(true);
    });

    it("allows paused → running (resume)", () => {
      expect(canTransition("paused", "running")).toBe(true);
    });

    it("allows paused → cancelled", () => {
      expect(canTransition("paused", "cancelled")).toBe(true);
    });

    it("rejects paused → completed (must resume first)", () => {
      expect(canTransition("paused", "completed")).toBe(false);
    });

    it("rejects paused → failed (must cancel, not fail directly)", () => {
      expect(canTransition("paused", "failed")).toBe(false);
    });

    it("rejects running → running (no self-transition)", () => {
      expect(canTransition("running", "running")).toBe(false);
    });

    it("rejects completed → any (terminal)", () => {
      expect(canTransition("completed", "running")).toBe(false);
      expect(canTransition("completed", "paused")).toBe(false);
      expect(canTransition("completed", "failed")).toBe(false);
      expect(canTransition("completed", "cancelled")).toBe(false);
    });

    it("rejects failed → any (terminal)", () => {
      expect(canTransition("failed", "running")).toBe(false);
      expect(canTransition("failed", "paused")).toBe(false);
    });

    it("rejects cancelled → any (terminal)", () => {
      expect(canTransition("cancelled", "running")).toBe(false);
    });
  });

  describe("validateTransition", () => {
    it("returns valid for allowed transitions", () => {
      const result = validateTransition("running", "paused");
      expect(result).toEqual({ valid: true });
    });

    it("returns invalid with reason for disallowed transitions", () => {
      const result = validateTransition("completed", "running");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("completed");
      expect(result.reason).toContain("running");
    });

    it("returns invalid for self-transitions", () => {
      const result = validateTransition("running", "running");
      expect(result.valid).toBe(false);
    });
  });

  describe("SessionTransitionError", () => {
    it("has descriptive message", () => {
      const err = new SessionTransitionError("paused", "completed");
      expect(err.message).toContain("paused");
      expect(err.message).toContain("completed");
      expect(err.name).toBe("SessionTransitionError");
    });
  });

  describe("VALID_TRANSITIONS", () => {
    it("exports the full transition table", () => {
      expect(VALID_TRANSITIONS).toBeDefined();
      expect(VALID_TRANSITIONS["running"]).toContain("paused");
      expect(VALID_TRANSITIONS["running"]).toContain("completed");
      expect(VALID_TRANSITIONS["running"]).toContain("failed");
      expect(VALID_TRANSITIONS["running"]).toContain("cancelled");
      expect(VALID_TRANSITIONS["paused"]).toContain("running");
      expect(VALID_TRANSITIONS["paused"]).toContain("cancelled");
    });

    it("has no transitions from terminal states", () => {
      expect(VALID_TRANSITIONS["completed"]).toEqual([]);
      expect(VALID_TRANSITIONS["failed"]).toEqual([]);
      expect(VALID_TRANSITIONS["cancelled"]).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/state-machine.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write implementation**

Create `packages/core/src/sessions/state-machine.ts`:

```typescript
import type { SessionStatus } from "@switchboard/schemas";

/**
 * Session state transition table.
 *
 * running   → paused, completed, failed, cancelled
 * paused    → running (resume), cancelled
 * completed → (terminal)
 * failed    → (terminal)
 * cancelled → (terminal)
 *
 * Notable: paused → failed is NOT allowed. A paused session can only be
 * cancelled (deliberate) or resumed (then it may fail during the next run).
 * paused → completed is NOT allowed — must resume first.
 */
export const VALID_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class SessionTransitionError extends Error {
  constructor(
    public readonly from: SessionStatus,
    public readonly to: SessionStatus,
  ) {
    super(
      `Invalid session transition: cannot move from '${from}' to '${to}'. ` +
        `Valid transitions from '${from}': [${VALID_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
    );
    this.name = "SessionTransitionError";
  }
}

/**
 * Check if a state transition is valid.
 */
export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Validate a transition with a reason for rejection.
 */
export function validateTransition(
  from: SessionStatus,
  to: SessionStatus,
): { valid: true } | { valid: false; reason: string } {
  if (canTransition(from, to)) {
    return { valid: true };
  }
  return {
    valid: false,
    reason:
      `Cannot transition from '${from}' to '${to}'. ` +
      `Valid transitions from '${from}': [${VALID_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/state-machine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sessions/state-machine.ts packages/core/src/sessions/__tests__/state-machine.test.ts
git commit -m "feat(core): add session state machine with pure transition functions"
```

---

## Task 3: Session Store Interfaces (packages/core)

**Files:**

- Create: `packages/core/src/sessions/store-interfaces.ts`

**Pattern reference:** Follow `packages/core/src/storage/interfaces.ts` — same shape with `save`, `getById`, `update`, `list`.

- [ ] **Step 1: Write store interfaces**

Create `packages/core/src/sessions/store-interfaces.ts`:

```typescript
import type {
  AgentSession,
  AgentRun,
  AgentPause,
  ToolEvent,
  AgentRoleOverride,
  SessionStatus,
  ResumeStatus,
} from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export interface SessionStore {
  create(session: AgentSession): Promise<void>;
  getById(id: string): Promise<AgentSession | null>;
  update(id: string, updates: Partial<AgentSession>): Promise<void>;
  list(filter: {
    organizationId?: string;
    roleId?: string;
    status?: SessionStatus;
    principalId?: string;
    limit?: number;
  }): Promise<AgentSession[]>;
  /** Count active (non-terminal) sessions for concurrency limiting */
  countActive(filter: { organizationId: string; roleId?: string }): Promise<number>;
}

// ---------------------------------------------------------------------------
// RunStore
// ---------------------------------------------------------------------------

export interface RunStore {
  save(run: AgentRun): Promise<void>;
  getById(id: string): Promise<AgentRun | null>;
  update(id: string, updates: Partial<AgentRun>): Promise<void>;
  listBySession(sessionId: string): Promise<AgentRun[]>;
}

// ---------------------------------------------------------------------------
// PauseStore
// ---------------------------------------------------------------------------

export interface PauseStore {
  save(pause: AgentPause): Promise<void>;
  getById(id: string): Promise<AgentPause | null>;
  /** Lookup pause by the approval that caused it (for resume hook) */
  getByApprovalId(approvalId: string): Promise<AgentPause | null>;
  update(id: string, updates: Partial<AgentPause>): Promise<void>;
  listBySession(sessionId: string): Promise<AgentPause[]>;
  /**
   * Atomic CAS: transition resumeStatus from expectedStatus to newStatus.
   * Returns true if the update succeeded (status matched), false if it didn't
   * (concurrent resume). This follows the same optimistic concurrency pattern
   * as PrismaApprovalStore.updateState with expectedVersion.
   */
  compareAndSwapResumeStatus(
    id: string,
    expectedStatus: ResumeStatus,
    newStatus: ResumeStatus,
    updates?: Partial<AgentPause>,
  ): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// ToolEventStore
// ---------------------------------------------------------------------------

export interface ToolEventStore {
  record(event: ToolEvent): Promise<void>;
  listBySession(sessionId: string): Promise<ToolEvent[]>;
  listByRun(runId: string): Promise<ToolEvent[]>;
  /** Count for safetyEnvelope checks without loading all records */
  countBySession(sessionId: string): Promise<{
    totalCalls: number;
    mutations: number;
    dollarsAtRisk: number;
  }>;
}

// ---------------------------------------------------------------------------
// RoleOverrideStore
// ---------------------------------------------------------------------------

export interface RoleOverrideStore {
  save(override: AgentRoleOverride): Promise<void>;
  getByOrgAndRole(organizationId: string, roleId: string): Promise<AgentRoleOverride | null>;
  update(id: string, updates: Partial<AgentRoleOverride>): Promise<void>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sessions/store-interfaces.ts
git commit -m "feat(core): add session store interfaces (SessionStore, RunStore, PauseStore, ToolEventStore)"
```

---

## Task 4: Prisma Models (packages/db)

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

**Note:** The existing schema is ~900 lines with models for ActionEnvelope, ApprovalRecord, AuditEntry, etc. We add 5 new models at the end.

- [ ] **Step 1: Read current schema end**

Read the last 20 lines of `packages/db/prisma/schema.prisma` to identify the insertion point.

- [ ] **Step 2: Add session models to schema**

Append to `packages/db/prisma/schema.prisma`:

```prisma
// ---------------------------------------------------------------------------
// OpenClaw Session Runtime (Phase 1)
// ---------------------------------------------------------------------------

model AgentSession {
  id               String   @id @default(uuid())
  organizationId   String
  roleId           String
  principalId      String
  status           String   @default("running")
  safetyEnvelope   Json
  toolCallCount    Int      @default(0)
  mutationCount    Int      @default(0)
  dollarsAtRisk    Float    @default(0)
  currentStep      Int      @default(0)
  toolHistory      Json     @default("[]")
  checkpoint       Json?
  traceId          String
  startedAt        DateTime @default(now())
  completedAt      DateTime?

  runs   AgentRun[]
  pauses AgentPause[]
  toolEvents ToolEvent[]

  @@index([organizationId, status])
  @@index([principalId])
  @@index([traceId])
}

model AgentRun {
  id            String    @id @default(uuid())
  sessionId     String
  runIndex      Int
  triggerType   String    @default("initial")
  resumeContext Json?
  outcome       String?
  stepRange     Json?
  startedAt     DateTime  @default(now())
  completedAt   DateTime?

  session AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@unique([sessionId, runIndex])
}

model AgentPause {
  id              String    @id @default(uuid())
  sessionId       String
  runId           String
  pauseIndex      Int
  approvalId      String
  resumeStatus    String    @default("pending")
  resumeToken     String
  checkpoint      Json
  approvalOutcome Json?
  createdAt       DateTime  @default(now())
  resumedAt       DateTime?

  session AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@unique([sessionId, pauseIndex])
  @@unique([approvalId])
}

model ToolEvent {
  id            String   @id @default(uuid())
  sessionId     String
  runId         String
  stepIndex     Int
  toolName      String
  parameters    Json
  result        Json?
  isMutation    Boolean  @default(false)
  dollarsAtRisk Float    @default(0)
  durationMs    Int?
  envelopeId    String?
  timestamp     DateTime @default(now())

  session AgentSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  // stepIndex is monotonic across all runs in a session (tied to session.currentStep)
  @@unique([sessionId, stepIndex])
  @@index([runId])
}

model AgentRoleOverride {
  id                       String   @id @default(uuid())
  organizationId           String
  roleId                   String
  allowedTools             String[] @default([])
  safetyEnvelopeOverride   Json?
  governanceProfileOverride String?
  additionalGuardrails     Json?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@unique([organizationId, roleId])
}
```

- [ ] **Step 3: Generate Prisma client**

Run: `pnpm db:generate`
Expected: PASS — Prisma client regenerated with new models

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add Prisma models for session runtime (AgentSession, AgentRun, AgentPause, ToolEvent, AgentRoleOverride)"
```

---

## Task 5: Prisma Store Implementations (packages/db)

**Files:**

- Create: `packages/db/src/storage/prisma-session-store.ts`
- Create: `packages/db/src/storage/prisma-run-store.ts`
- Create: `packages/db/src/storage/prisma-pause-store.ts`
- Create: `packages/db/src/storage/prisma-tool-event-store.ts`
- Create: `packages/db/src/storage/prisma-role-override-store.ts`
- Modify: `packages/db/src/storage/index.ts`
- Modify: `packages/db/src/index.ts`

**Pattern reference:** Follow `packages/db/src/storage/prisma-approval-store.ts` — especially `updateState` with optimistic concurrency via `updateMany` + count check.

**Depends on:** Task 3 (store interfaces), Task 4 (Prisma models)

- [ ] **Step 1: Create PrismaSessionStore**

Create `packages/db/src/storage/prisma-session-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { AgentSession, SessionStatus } from "@switchboard/schemas";
import type { SessionStore } from "@switchboard/core";

export class PrismaSessionStore implements SessionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(session: AgentSession): Promise<void> {
    await this.prisma.agentSession.create({
      data: {
        id: session.id,
        organizationId: session.organizationId,
        roleId: session.roleId,
        principalId: session.principalId,
        status: session.status,
        safetyEnvelope: session.safetyEnvelope as Record<string, unknown>,
        toolCallCount: session.toolCallCount,
        mutationCount: session.mutationCount,
        dollarsAtRisk: session.dollarsAtRisk,
        currentStep: session.currentStep,
        toolHistory: session.toolHistory as unknown[],
        checkpoint: session.checkpoint as Record<string, unknown> | undefined,
        traceId: session.traceId,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      },
    });
  }

  async getById(id: string): Promise<AgentSession | null> {
    const row = await this.prisma.agentSession.findUnique({ where: { id } });
    if (!row) return null;
    return this.toAgentSession(row);
  }

  async update(id: string, updates: Partial<AgentSession>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.status !== undefined) data["status"] = updates.status;
    if (updates.toolCallCount !== undefined) data["toolCallCount"] = updates.toolCallCount;
    if (updates.mutationCount !== undefined) data["mutationCount"] = updates.mutationCount;
    if (updates.dollarsAtRisk !== undefined) data["dollarsAtRisk"] = updates.dollarsAtRisk;
    if (updates.currentStep !== undefined) data["currentStep"] = updates.currentStep;
    if (updates.toolHistory !== undefined) data["toolHistory"] = updates.toolHistory as unknown[];
    if (updates.checkpoint !== undefined)
      data["checkpoint"] = updates.checkpoint as Record<string, unknown> | null;
    if (updates.completedAt !== undefined) data["completedAt"] = updates.completedAt;
    await this.prisma.agentSession.update({ where: { id }, data });
  }

  async list(filter: {
    organizationId?: string;
    roleId?: string;
    status?: SessionStatus;
    principalId?: string;
    limit?: number;
  }): Promise<AgentSession[]> {
    const where: Record<string, unknown> = {};
    if (filter.organizationId) where["organizationId"] = filter.organizationId;
    if (filter.roleId) where["roleId"] = filter.roleId;
    if (filter.status) where["status"] = filter.status;
    if (filter.principalId) where["principalId"] = filter.principalId;
    const rows = await this.prisma.agentSession.findMany({
      where,
      take: filter.limit ?? 100,
      orderBy: { startedAt: "desc" },
    });
    return rows.map((r) => this.toAgentSession(r));
  }

  async countActive(filter: { organizationId: string; roleId?: string }): Promise<number> {
    const where: Record<string, unknown> = {
      organizationId: filter.organizationId,
      status: { in: ["running", "paused"] },
    };
    if (filter.roleId) where["roleId"] = filter.roleId;
    return this.prisma.agentSession.count({ where });
  }

  private toAgentSession(row: Record<string, unknown>): AgentSession {
    return {
      id: row["id"] as string,
      organizationId: row["organizationId"] as string,
      roleId: row["roleId"] as string,
      principalId: row["principalId"] as string,
      status: row["status"] as SessionStatus,
      safetyEnvelope: row["safetyEnvelope"] as AgentSession["safetyEnvelope"],
      toolCallCount: row["toolCallCount"] as number,
      mutationCount: row["mutationCount"] as number,
      dollarsAtRisk: row["dollarsAtRisk"] as number,
      currentStep: row["currentStep"] as number,
      toolHistory: row["toolHistory"] as AgentSession["toolHistory"],
      checkpoint: (row["checkpoint"] as AgentSession["checkpoint"]) ?? null,
      traceId: row["traceId"] as string,
      startedAt: row["startedAt"] as Date,
      completedAt: (row["completedAt"] as Date) ?? null,
    };
  }
}
```

- [ ] **Step 2: Create PrismaRunStore**

Create `packages/db/src/storage/prisma-run-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { AgentRun } from "@switchboard/schemas";
import type { RunStore } from "@switchboard/core";

export class PrismaRunStore implements RunStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(run: AgentRun): Promise<void> {
    await this.prisma.agentRun.create({
      data: {
        id: run.id,
        sessionId: run.sessionId,
        runIndex: run.runIndex,
        triggerType: run.triggerType,
        resumeContext: run.resumeContext as Record<string, unknown> | undefined,
        outcome: run.outcome,
        stepRange: run.stepRange as Record<string, unknown> | undefined,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      },
    });
  }

  async getById(id: string): Promise<AgentRun | null> {
    const row = await this.prisma.agentRun.findUnique({ where: { id } });
    if (!row) return null;
    return this.toAgentRun(row);
  }

  async update(id: string, updates: Partial<AgentRun>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.outcome !== undefined) data["outcome"] = updates.outcome;
    if (updates.stepRange !== undefined)
      data["stepRange"] = updates.stepRange as Record<string, unknown> | null;
    if (updates.completedAt !== undefined) data["completedAt"] = updates.completedAt;
    await this.prisma.agentRun.update({ where: { id }, data });
  }

  async listBySession(sessionId: string): Promise<AgentRun[]> {
    const rows = await this.prisma.agentRun.findMany({
      where: { sessionId },
      orderBy: { runIndex: "asc" },
    });
    return rows.map((r) => this.toAgentRun(r));
  }

  private toAgentRun(row: Record<string, unknown>): AgentRun {
    return {
      id: row["id"] as string,
      sessionId: row["sessionId"] as string,
      runIndex: row["runIndex"] as number,
      triggerType: row["triggerType"] as AgentRun["triggerType"],
      resumeContext: (row["resumeContext"] as Record<string, unknown>) ?? null,
      outcome: (row["outcome"] as AgentRun["outcome"]) ?? null,
      stepRange: (row["stepRange"] as AgentRun["stepRange"]) ?? null,
      startedAt: row["startedAt"] as Date,
      completedAt: (row["completedAt"] as Date) ?? null,
    };
  }
}
```

- [ ] **Step 3: Create PrismaPauseStore**

Create `packages/db/src/storage/prisma-pause-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { AgentPause, ResumeStatus } from "@switchboard/schemas";
import type { PauseStore } from "@switchboard/core";

export class PrismaPauseStore implements PauseStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(pause: AgentPause): Promise<void> {
    await this.prisma.agentPause.create({
      data: {
        id: pause.id,
        sessionId: pause.sessionId,
        runId: pause.runId,
        pauseIndex: pause.pauseIndex,
        approvalId: pause.approvalId,
        resumeStatus: pause.resumeStatus,
        resumeToken: pause.resumeToken,
        checkpoint: pause.checkpoint as Record<string, unknown>,
        approvalOutcome: pause.approvalOutcome as Record<string, unknown> | undefined,
        createdAt: pause.createdAt,
        resumedAt: pause.resumedAt,
      },
    });
  }

  async getById(id: string): Promise<AgentPause | null> {
    const row = await this.prisma.agentPause.findUnique({ where: { id } });
    if (!row) return null;
    return this.toAgentPause(row);
  }

  async getByApprovalId(approvalId: string): Promise<AgentPause | null> {
    const row = await this.prisma.agentPause.findUnique({ where: { approvalId } });
    if (!row) return null;
    return this.toAgentPause(row);
  }

  async update(id: string, updates: Partial<AgentPause>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.resumeStatus !== undefined) data["resumeStatus"] = updates.resumeStatus;
    if (updates.approvalOutcome !== undefined) {
      data["approvalOutcome"] = updates.approvalOutcome as Record<string, unknown> | null;
    }
    if (updates.resumedAt !== undefined) data["resumedAt"] = updates.resumedAt;
    await this.prisma.agentPause.update({ where: { id }, data });
  }

  async listBySession(sessionId: string): Promise<AgentPause[]> {
    const rows = await this.prisma.agentPause.findMany({
      where: { sessionId },
      orderBy: { pauseIndex: "asc" },
    });
    return rows.map((r) => this.toAgentPause(r));
  }

  /**
   * Atomic CAS on resumeStatus. Uses Prisma updateMany with a WHERE clause
   * that includes the expected status, then checks count === 1.
   *
   * Same pattern as PrismaApprovalStore.updateState with expectedVersion.
   */
  async compareAndSwapResumeStatus(
    id: string,
    expectedStatus: ResumeStatus,
    newStatus: ResumeStatus,
    updates?: Partial<AgentPause>,
  ): Promise<boolean> {
    const data: Record<string, unknown> = { resumeStatus: newStatus };
    if (updates?.approvalOutcome !== undefined) {
      data["approvalOutcome"] = updates.approvalOutcome as Record<string, unknown> | null;
    }
    if (updates?.resumedAt !== undefined) {
      data["resumedAt"] = updates.resumedAt;
    }
    const result = await this.prisma.agentPause.updateMany({
      where: { id, resumeStatus: expectedStatus },
      data,
    });
    return result.count === 1;
  }

  private toAgentPause(row: Record<string, unknown>): AgentPause {
    return {
      id: row["id"] as string,
      sessionId: row["sessionId"] as string,
      runId: row["runId"] as string,
      pauseIndex: row["pauseIndex"] as number,
      approvalId: row["approvalId"] as string,
      resumeStatus: row["resumeStatus"] as ResumeStatus,
      resumeToken: row["resumeToken"] as string,
      checkpoint: row["checkpoint"] as AgentPause["checkpoint"],
      approvalOutcome: (row["approvalOutcome"] as Record<string, unknown>) ?? null,
      createdAt: row["createdAt"] as Date,
      resumedAt: (row["resumedAt"] as Date) ?? null,
    };
  }
}
```

- [ ] **Step 4: Create PrismaToolEventStore**

Create `packages/db/src/storage/prisma-tool-event-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { ToolEvent } from "@switchboard/schemas";
import type { ToolEventStore } from "@switchboard/core";

export class PrismaToolEventStore implements ToolEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async record(event: ToolEvent): Promise<void> {
    await this.prisma.toolEvent.create({
      data: {
        id: event.id,
        sessionId: event.sessionId,
        runId: event.runId,
        stepIndex: event.stepIndex,
        toolName: event.toolName,
        parameters: event.parameters as Record<string, unknown>,
        result: event.result as Record<string, unknown> | undefined,
        isMutation: event.isMutation,
        dollarsAtRisk: event.dollarsAtRisk,
        durationMs: event.durationMs,
        envelopeId: event.envelopeId,
        timestamp: event.timestamp,
      },
    });
  }

  async listBySession(sessionId: string): Promise<ToolEvent[]> {
    const rows = await this.prisma.toolEvent.findMany({
      where: { sessionId },
      orderBy: { stepIndex: "asc" },
    });
    return rows.map((r) => this.toToolEvent(r));
  }

  async listByRun(runId: string): Promise<ToolEvent[]> {
    const rows = await this.prisma.toolEvent.findMany({
      where: { runId },
      orderBy: { stepIndex: "asc" },
    });
    return rows.map((r) => this.toToolEvent(r));
  }

  async countBySession(sessionId: string): Promise<{
    totalCalls: number;
    mutations: number;
    dollarsAtRisk: number;
  }> {
    const [countResult, dollarResult] = await Promise.all([
      this.prisma.toolEvent.groupBy({
        by: ["isMutation"],
        where: { sessionId },
        _count: true,
      }),
      this.prisma.toolEvent.aggregate({
        where: { sessionId },
        _sum: { dollarsAtRisk: true },
      }),
    ]);

    let totalCalls = 0;
    let mutations = 0;
    for (const group of countResult) {
      totalCalls += group._count;
      if (group.isMutation) mutations = group._count;
    }

    return {
      totalCalls,
      mutations,
      dollarsAtRisk: dollarResult._sum.dollarsAtRisk ?? 0,
    };
  }

  private toToolEvent(row: Record<string, unknown>): ToolEvent {
    return {
      id: row["id"] as string,
      sessionId: row["sessionId"] as string,
      runId: row["runId"] as string,
      stepIndex: row["stepIndex"] as number,
      toolName: row["toolName"] as string,
      parameters: row["parameters"] as Record<string, unknown>,
      result: (row["result"] as Record<string, unknown>) ?? null,
      isMutation: row["isMutation"] as boolean,
      dollarsAtRisk: row["dollarsAtRisk"] as number,
      durationMs: (row["durationMs"] as number) ?? null,
      envelopeId: (row["envelopeId"] as string) ?? null,
      timestamp: row["timestamp"] as Date,
    };
  }
}
```

- [ ] **Step 5: Create PrismaRoleOverrideStore**

Create `packages/db/src/storage/prisma-role-override-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { AgentRoleOverride } from "@switchboard/schemas";
import type { RoleOverrideStore } from "@switchboard/core";

export class PrismaRoleOverrideStore implements RoleOverrideStore {
  constructor(private readonly prisma: PrismaClient) {}

  async save(override: AgentRoleOverride): Promise<void> {
    await this.prisma.agentRoleOverride.create({
      data: {
        id: override.id,
        organizationId: override.organizationId,
        roleId: override.roleId,
        allowedTools: override.allowedTools ?? [],
        safetyEnvelopeOverride: override.safetyEnvelopeOverride as
          | Record<string, unknown>
          | undefined,
        governanceProfileOverride: override.governanceProfileOverride,
        additionalGuardrails: override.additionalGuardrails as Record<string, unknown> | undefined,
      },
    });
  }

  async getByOrgAndRole(organizationId: string, roleId: string): Promise<AgentRoleOverride | null> {
    const row = await this.prisma.agentRoleOverride.findUnique({
      where: { organizationId_roleId: { organizationId, roleId } },
    });
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      roleId: row.roleId,
      allowedTools: row.allowedTools.length > 0 ? row.allowedTools : undefined,
      safetyEnvelopeOverride: (row.safetyEnvelopeOverride as Record<string, unknown>) ?? undefined,
      governanceProfileOverride: row.governanceProfileOverride ?? undefined,
      additionalGuardrails: (row.additionalGuardrails as Record<string, unknown>) ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async update(id: string, updates: Partial<AgentRoleOverride>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.allowedTools !== undefined) data["allowedTools"] = updates.allowedTools;
    if (updates.safetyEnvelopeOverride !== undefined) {
      data["safetyEnvelopeOverride"] = updates.safetyEnvelopeOverride as Record<string, unknown>;
    }
    if (updates.governanceProfileOverride !== undefined) {
      data["governanceProfileOverride"] = updates.governanceProfileOverride;
    }
    if (updates.additionalGuardrails !== undefined) {
      data["additionalGuardrails"] = updates.additionalGuardrails as Record<string, unknown>;
    }
    await this.prisma.agentRoleOverride.update({ where: { id }, data });
  }
}
```

- [ ] **Step 6: Add to barrel exports**

Add to `packages/db/src/storage/index.ts`:

```typescript
export { PrismaSessionStore } from "./prisma-session-store.js";
export { PrismaRunStore } from "./prisma-run-store.js";
export { PrismaPauseStore } from "./prisma-pause-store.js";
export { PrismaToolEventStore } from "./prisma-tool-event-store.js";
export { PrismaRoleOverrideStore } from "./prisma-role-override-store.js";
```

Add to `packages/db/src/index.ts`:

```typescript
export {
  PrismaSessionStore,
  PrismaRunStore,
  PrismaPauseStore,
  PrismaToolEventStore,
  PrismaRoleOverrideStore,
} from "./storage/index.js";
```

- [ ] **Step 7: Run typecheck**

Run: `pnpm --filter @switchboard/db typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/storage/prisma-session-store.ts packages/db/src/storage/prisma-run-store.ts packages/db/src/storage/prisma-pause-store.ts packages/db/src/storage/prisma-tool-event-store.ts packages/db/src/storage/prisma-role-override-store.ts packages/db/src/storage/index.ts packages/db/src/index.ts
git commit -m "feat(db): add Prisma store implementations for session runtime"
```

---

## Task 6: Role Config Merger (packages/core)

**Files:**

- Create: `packages/core/src/sessions/role-config-merger.ts`
- Test: `packages/core/src/sessions/__tests__/role-config-merger.test.ts`

**Depends on:** Task 1 (schemas), Task 3 (store interfaces)

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/sessions/__tests__/role-config-merger.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeRoleConfig } from "../role-config-merger.js";
import type { SafetyEnvelope, AgentRoleOverride } from "@switchboard/schemas";

describe("mergeRoleConfig", () => {
  const defaultEnvelope: SafetyEnvelope = {
    maxToolCalls: 200,
    maxMutations: 50,
    maxDollarsAtRisk: 10_000,
    sessionTimeoutMs: 30 * 60 * 1000,
  };

  const defaultToolPack = ["digital-ads", "crm", "knowledge"];

  it("returns manifest defaults when no override exists", () => {
    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: null,
      requestOverride: undefined,
    });

    expect(result.safetyEnvelope).toEqual(defaultEnvelope);
    expect(result.toolPack).toEqual(defaultToolPack);
    expect(result.governanceProfile).toBe("guarded");
  });

  it("org override can tighten safety envelope (lower limits)", () => {
    const override: Partial<AgentRoleOverride> = {
      safetyEnvelopeOverride: {
        maxToolCalls: 100,
        maxDollarsAtRisk: 5_000,
      },
    };

    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: override as AgentRoleOverride,
      requestOverride: undefined,
    });

    expect(result.safetyEnvelope.maxToolCalls).toBe(100);
    expect(result.safetyEnvelope.maxDollarsAtRisk).toBe(5_000);
    // Unchanged fields keep defaults
    expect(result.safetyEnvelope.maxMutations).toBe(50);
    expect(result.safetyEnvelope.sessionTimeoutMs).toBe(30 * 60 * 1000);
  });

  it("org override CANNOT loosen safety envelope (higher limits ignored)", () => {
    const override: Partial<AgentRoleOverride> = {
      safetyEnvelopeOverride: {
        maxToolCalls: 500, // higher than default 200 — should be ignored
        maxDollarsAtRisk: 5_000, // lower — should apply
      },
    };

    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: override as AgentRoleOverride,
      requestOverride: undefined,
    });

    expect(result.safetyEnvelope.maxToolCalls).toBe(200); // kept at default
    expect(result.safetyEnvelope.maxDollarsAtRisk).toBe(5_000); // tightened
  });

  it("org override can narrow tool pack (subset only)", () => {
    const override: Partial<AgentRoleOverride> = {
      allowedTools: ["digital-ads"], // subset of default
    };

    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: override as AgentRoleOverride,
      requestOverride: undefined,
    });

    expect(result.toolPack).toEqual(["digital-ads"]);
  });

  it("org override cannot add tools not in manifest", () => {
    const override: Partial<AgentRoleOverride> = {
      allowedTools: ["digital-ads", "payments"], // "payments" not in manifest
    };

    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: override as AgentRoleOverride,
      requestOverride: undefined,
    });

    expect(result.toolPack).toEqual(["digital-ads"]); // only intersection
  });

  it("request-level override can further tighten safety envelope", () => {
    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: null,
      requestOverride: {
        maxToolCalls: 50,
      },
    });

    expect(result.safetyEnvelope.maxToolCalls).toBe(50);
    expect(result.safetyEnvelope.maxMutations).toBe(50); // unchanged
  });

  it("request-level override cannot loosen beyond org or manifest", () => {
    const result = mergeRoleConfig({
      manifestDefaults: {
        safetyEnvelope: defaultEnvelope,
        toolPack: defaultToolPack,
        governanceProfile: "guarded",
      },
      orgOverride: null,
      requestOverride: {
        maxToolCalls: 999,
      },
    });

    expect(result.safetyEnvelope.maxToolCalls).toBe(200); // kept at manifest default
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/role-config-merger.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write implementation**

Create `packages/core/src/sessions/role-config-merger.ts`:

```typescript
import type { SafetyEnvelope, AgentRoleOverride } from "@switchboard/schemas";

export interface ManifestDefaults {
  safetyEnvelope: SafetyEnvelope;
  toolPack: string[];
  governanceProfile: string;
}

export interface MergedRoleConfig {
  safetyEnvelope: SafetyEnvelope;
  toolPack: string[];
  governanceProfile: string;
}

/**
 * Merge role manifest defaults with org-level and request-level overrides.
 *
 * Rules:
 * - Safety envelope: overrides can only TIGHTEN (lower) limits, never loosen
 * - Tool pack: overrides can only NARROW (subset), never add tools
 * - Governance profile: org override replaces; request cannot override
 *
 * Merge order: manifest → org override → request override
 * Each layer can only make things stricter.
 */
export function mergeRoleConfig(input: {
  manifestDefaults: ManifestDefaults;
  orgOverride: AgentRoleOverride | null;
  requestOverride: Partial<SafetyEnvelope> | undefined;
}): MergedRoleConfig {
  const { manifestDefaults, orgOverride, requestOverride } = input;

  // Start with manifest defaults
  let envelope = { ...manifestDefaults.safetyEnvelope };
  let toolPack = [...manifestDefaults.toolPack];
  let governanceProfile = manifestDefaults.governanceProfile;

  // Apply org override (tighten only)
  if (orgOverride) {
    envelope = tightenEnvelope(envelope, orgOverride.safetyEnvelopeOverride);

    if (orgOverride.allowedTools && orgOverride.allowedTools.length > 0) {
      // Intersection: only tools that are in BOTH manifest and override
      toolPack = toolPack.filter((t) => orgOverride.allowedTools!.includes(t));
    }

    if (orgOverride.governanceProfileOverride) {
      governanceProfile = orgOverride.governanceProfileOverride;
    }
  }

  // Apply request override (tighten only)
  if (requestOverride) {
    envelope = tightenEnvelope(envelope, requestOverride);
  }

  return { safetyEnvelope: envelope, toolPack, governanceProfile };
}

/**
 * Apply override values only when they are LOWER (stricter) than current.
 */
function tightenEnvelope(
  current: SafetyEnvelope,
  override: Partial<SafetyEnvelope> | undefined | null,
): SafetyEnvelope {
  if (!override) return current;

  return {
    maxToolCalls:
      override.maxToolCalls !== undefined && override.maxToolCalls < current.maxToolCalls
        ? override.maxToolCalls
        : current.maxToolCalls,
    maxMutations:
      override.maxMutations !== undefined && override.maxMutations < current.maxMutations
        ? override.maxMutations
        : current.maxMutations,
    maxDollarsAtRisk:
      override.maxDollarsAtRisk !== undefined &&
      override.maxDollarsAtRisk < current.maxDollarsAtRisk
        ? override.maxDollarsAtRisk
        : current.maxDollarsAtRisk,
    sessionTimeoutMs:
      override.sessionTimeoutMs !== undefined &&
      override.sessionTimeoutMs < current.sessionTimeoutMs
        ? override.sessionTimeoutMs
        : current.sessionTimeoutMs,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/role-config-merger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sessions/role-config-merger.ts packages/core/src/sessions/__tests__/role-config-merger.test.ts
git commit -m "feat(core): add role config merger with tighten-only override semantics"
```

---

## Task 7: Checkpoint Validator (packages/core)

**Files:**

- Create: `packages/core/src/sessions/checkpoint-validator.ts`
- Test: `packages/core/src/sessions/__tests__/checkpoint-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/sessions/__tests__/checkpoint-validator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateCheckpoint } from "../checkpoint-validator.js";
import { AgentCheckpointSchema } from "@switchboard/schemas";

describe("validateCheckpoint", () => {
  it("accepts valid checkpoint with all fields", () => {
    const result = validateCheckpoint({
      agentState: { step: 3, memory: "something" },
      lastToolResult: { success: true },
      pendingApprovalId: "abc-123",
      extensions: { campaignId: "camp-1" },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts valid checkpoint with only required fields", () => {
    const result = validateCheckpoint({
      agentState: {},
    });
    expect(result.valid).toBe(true);
  });

  it("rejects checkpoint missing agentState", () => {
    const result = validateCheckpoint({} as Record<string, unknown>);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects null checkpoint", () => {
    const result = validateCheckpoint(null as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
  });

  it("validates against optional role-specific schema", () => {
    const roleSchema = AgentCheckpointSchema.extend({
      extensions: z
        .object({
          campaignId: z.string().min(1),
        })
        .optional(),
    });

    // Valid with role schema
    const validResult = validateCheckpoint(
      { agentState: { step: 1 }, extensions: { campaignId: "camp-1" } },
      roleSchema,
    );
    expect(validResult.valid).toBe(true);

    // Invalid: campaignId is empty string (min 1)
    const invalidResult = validateCheckpoint(
      { agentState: { step: 1 }, extensions: { campaignId: "" } },
      roleSchema,
    );
    expect(invalidResult.valid).toBe(false);
  });

  it("enforces max checkpoint size (500KB)", () => {
    const result = validateCheckpoint({
      agentState: { data: "x".repeat(600_000) },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("size");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/checkpoint-validator.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `packages/core/src/sessions/checkpoint-validator.ts`:

```typescript
import { AgentCheckpointSchema } from "@switchboard/schemas";
import type { AgentCheckpoint } from "@switchboard/schemas";
import type { z } from "zod";

const MAX_CHECKPOINT_BYTES = 500 * 1024; // 500KB

type ValidationSuccess = { valid: true; checkpoint: AgentCheckpoint };
type ValidationFailure = { valid: false; errors: string[] };
type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate checkpoint structure against the base schema and optional size limit.
 * Switchboard never interprets checkpoint contents semantically — this is
 * purely structural validation.
 */
export function validateCheckpoint(
  value: unknown,
  roleSchema?: z.ZodType<AgentCheckpoint>,
): ValidationResult {
  if (value === null || value === undefined) {
    return { valid: false, errors: ["Checkpoint cannot be null or undefined"] };
  }

  // Size check first (cheap, avoids parsing huge payloads)
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_CHECKPOINT_BYTES) {
    return {
      valid: false,
      errors: [
        `Checkpoint size ${serialized.length} bytes exceeds maximum ${MAX_CHECKPOINT_BYTES} bytes`,
      ],
    };
  }

  // Structural validation against base schema
  const schema = roleSchema ?? AgentCheckpointSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return { valid: true, checkpoint: parsed.data };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/checkpoint-validator.test.ts`
Expected: PASS

- [ ] **Step 5: Add to barrel export**

Add `export * from "./checkpoint-validator.js";` to `packages/core/src/sessions/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sessions/checkpoint-validator.ts packages/core/src/sessions/__tests__/checkpoint-validator.test.ts packages/core/src/sessions/index.ts
git commit -m "feat(core): add checkpoint structural validator"
```

---

## Task 8: Resume Payload Builder (packages/core)

**Files:**

- Create: `packages/core/src/sessions/resume-payload-builder.ts`
- Test: `packages/core/src/sessions/__tests__/resume-payload-builder.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/sessions/__tests__/resume-payload-builder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildResumePayload } from "../resume-payload-builder.js";
import type { AgentSession, AgentPause, ToolEvent } from "@switchboard/schemas";

describe("buildResumePayload", () => {
  const baseSession: AgentSession = {
    id: "sess-1",
    organizationId: "org-1",
    roleId: "ad-operator",
    principalId: "principal-1",
    status: "paused",
    safetyEnvelope: {
      maxToolCalls: 200,
      maxMutations: 50,
      maxDollarsAtRisk: 10_000,
      sessionTimeoutMs: 30 * 60 * 1000,
    },
    toolCallCount: 5,
    mutationCount: 2,
    dollarsAtRisk: 1_000,
    currentStep: 5,
    toolHistory: [],
    checkpoint: null,
    traceId: "trace-1",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: null,
  };

  const basePause: AgentPause = {
    id: "pause-1",
    sessionId: "sess-1",
    runId: "run-1",
    pauseIndex: 0,
    approvalId: "appr-1",
    resumeStatus: "consumed",
    resumeToken: "token-1",
    checkpoint: {
      agentState: { step: 5, memory: "context" },
      pendingApprovalId: "appr-1",
    },
    approvalOutcome: {
      action: "approve",
      respondedBy: "owner-1",
    },
    createdAt: new Date("2026-01-01T00:05:00Z"),
    resumedAt: null,
  };

  it("builds complete resume payload", () => {
    const payload = buildResumePayload({
      session: baseSession,
      pause: basePause,
      toolHistory: [],
      runId: "run-2",
      instruction: "Continue managing ad campaigns.",
    });

    expect(payload.sessionId).toBe("sess-1");
    expect(payload.runId).toBe("run-2");
    expect(payload.roleId).toBe("ad-operator");
    expect(payload.checkpoint).toEqual(basePause.checkpoint);
    expect(payload.approvalOutcome).toEqual(basePause.approvalOutcome);
    expect(payload.instruction).toBe("Continue managing ad campaigns.");
  });

  it("calculates remaining safety budget correctly", () => {
    const payload = buildResumePayload({
      session: baseSession,
      pause: basePause,
      toolHistory: [],
      runId: "run-2",
      instruction: "Continue.",
    });

    expect(payload.safetyBudgetRemaining.toolCalls).toBe(195); // 200 - 5
    expect(payload.safetyBudgetRemaining.mutations).toBe(48); // 50 - 2
    expect(payload.safetyBudgetRemaining.dollarsAtRisk).toBe(9_000); // 10000 - 1000
  });

  it("includes tool history passed as parameter", () => {
    const toolEvent: ToolEvent = {
      id: "evt-1",
      sessionId: "sess-1",
      runId: "run-1",
      stepIndex: 0,
      toolName: "get_campaign_metrics",
      parameters: { campaignId: "c1" },
      result: { impressions: 1000 },
      isMutation: false,
      dollarsAtRisk: 0,
      durationMs: 150,
      envelopeId: null,
      timestamp: new Date(),
    };

    const payload = buildResumePayload({
      session: baseSession,
      pause: basePause,
      toolHistory: [toolEvent],
      runId: "run-2",
      instruction: "Continue.",
    });

    expect(payload.toolHistory).toHaveLength(1);
    expect(payload.toolHistory[0].toolName).toBe("get_campaign_metrics");
  });

  it("clamps remaining budget to zero (no negative values)", () => {
    const exhaustedSession = {
      ...baseSession,
      toolCallCount: 250, // over limit
      mutationCount: 60,
      dollarsAtRisk: 15_000,
    };

    const payload = buildResumePayload({
      session: exhaustedSession,
      pause: basePause,
      toolHistory: [],
      runId: "run-2",
      instruction: "Continue.",
    });

    expect(payload.safetyBudgetRemaining.toolCalls).toBe(0);
    expect(payload.safetyBudgetRemaining.mutations).toBe(0);
    expect(payload.safetyBudgetRemaining.dollarsAtRisk).toBe(0);
  });

  it("calculates time remaining from session start", () => {
    const payload = buildResumePayload({
      session: baseSession,
      pause: basePause,
      toolHistory: [],
      runId: "run-2",
      instruction: "Continue.",
      now: new Date("2026-01-01T00:10:00Z"), // 10 minutes after start
    });

    // 30 min timeout - 10 min elapsed = 20 min remaining
    expect(payload.safetyBudgetRemaining.timeRemainingMs).toBe(20 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/resume-payload-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `packages/core/src/sessions/resume-payload-builder.ts`:

```typescript
import type { AgentSession, AgentPause, ToolEvent, ResumePayload } from "@switchboard/schemas";

/**
 * Build the payload sent to the Gateway when resuming a paused session.
 * toolHistory is passed in (loaded from ToolEventStore) rather than read
 * from the session row, to avoid denormalizing a growing array.
 */
export function buildResumePayload(input: {
  session: AgentSession;
  pause: AgentPause;
  toolHistory: ToolEvent[];
  runId: string;
  instruction: string;
  now?: Date;
}): ResumePayload {
  const { session, pause, toolHistory, runId, instruction, now = new Date() } = input;
  const env = session.safetyEnvelope;

  const elapsedMs = now.getTime() - session.startedAt.getTime();
  const timeRemainingMs = Math.max(0, env.sessionTimeoutMs - elapsedMs);

  return {
    sessionId: session.id,
    runId,
    roleId: session.roleId,
    checkpoint: pause.checkpoint,
    approvalOutcome: pause.approvalOutcome ?? {},
    toolHistory,
    instruction,
    safetyBudgetRemaining: {
      toolCalls: Math.max(0, env.maxToolCalls - session.toolCallCount),
      mutations: Math.max(0, env.maxMutations - session.mutationCount),
      dollarsAtRisk: Math.max(0, env.maxDollarsAtRisk - session.dollarsAtRisk),
      timeRemainingMs,
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/resume-payload-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Add to barrel export**

Add `export * from "./resume-payload-builder.js";` to `packages/core/src/sessions/index.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sessions/resume-payload-builder.ts packages/core/src/sessions/__tests__/resume-payload-builder.test.ts packages/core/src/sessions/index.ts
git commit -m "feat(core): add resume payload builder"
```

---

## Task 9: SessionManager (packages/core)

**Files:**

- Create: `packages/core/src/sessions/session-manager.ts`
- Create: `packages/core/src/sessions/__tests__/test-stores.ts`
- Test: `packages/core/src/sessions/__tests__/session-manager.test.ts`
- Modify: `packages/core/src/sessions/index.ts`
- Modify: `packages/core/src/index.ts`

**Depends on:** Tasks 1-3, 6-8

This is the keystone module. It owns ALL session state transitions. No route, worker, or hook directly mutates session stores.

- [ ] **Step 1: Create shared in-memory test stores**

Create `packages/core/src/sessions/__tests__/test-stores.ts`:

```typescript
import type {
  AgentSession,
  AgentRun,
  AgentPause,
  ToolEvent,
  AgentRoleOverride,
  SessionStatus,
  ResumeStatus,
} from "@switchboard/schemas";
import type {
  SessionStore,
  RunStore,
  PauseStore,
  ToolEventStore,
  RoleOverrideStore,
} from "../store-interfaces.js";

export class InMemorySessionStore implements SessionStore {
  readonly sessions: AgentSession[] = [];

  async create(session: AgentSession): Promise<void> {
    this.sessions.push({ ...session });
  }

  async getById(id: string): Promise<AgentSession | null> {
    return this.sessions.find((s) => s.id === id) ?? null;
  }

  async update(id: string, updates: Partial<AgentSession>): Promise<void> {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Session ${id} not found`);
    this.sessions[idx] = { ...this.sessions[idx], ...updates };
  }

  async list(filter: {
    organizationId?: string;
    roleId?: string;
    status?: SessionStatus;
    principalId?: string;
    limit?: number;
  }): Promise<AgentSession[]> {
    let result = [...this.sessions];
    if (filter.organizationId)
      result = result.filter((s) => s.organizationId === filter.organizationId);
    if (filter.roleId) result = result.filter((s) => s.roleId === filter.roleId);
    if (filter.status) result = result.filter((s) => s.status === filter.status);
    if (filter.principalId) result = result.filter((s) => s.principalId === filter.principalId);
    return result.slice(0, filter.limit ?? 100);
  }

  async countActive(filter: { organizationId: string; roleId?: string }): Promise<number> {
    return this.sessions.filter(
      (s) =>
        s.organizationId === filter.organizationId &&
        (filter.roleId ? s.roleId === filter.roleId : true) &&
        (s.status === "running" || s.status === "paused"),
    ).length;
  }
}

export class InMemoryRunStore implements RunStore {
  readonly runs: AgentRun[] = [];

  async save(run: AgentRun): Promise<void> {
    this.runs.push({ ...run });
  }

  async getById(id: string): Promise<AgentRun | null> {
    return this.runs.find((r) => r.id === id) ?? null;
  }

  async update(id: string, updates: Partial<AgentRun>): Promise<void> {
    const idx = this.runs.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`Run ${id} not found`);
    this.runs[idx] = { ...this.runs[idx], ...updates };
  }

  async listBySession(sessionId: string): Promise<AgentRun[]> {
    return this.runs
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.runIndex - b.runIndex);
  }
}

export class InMemoryPauseStore implements PauseStore {
  readonly pauses: AgentPause[] = [];

  async save(pause: AgentPause): Promise<void> {
    this.pauses.push({ ...pause });
  }

  async getById(id: string): Promise<AgentPause | null> {
    return this.pauses.find((p) => p.id === id) ?? null;
  }

  async getByApprovalId(approvalId: string): Promise<AgentPause | null> {
    return this.pauses.find((p) => p.approvalId === approvalId) ?? null;
  }

  async update(id: string, updates: Partial<AgentPause>): Promise<void> {
    const idx = this.pauses.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Pause ${id} not found`);
    this.pauses[idx] = { ...this.pauses[idx], ...updates };
  }

  async listBySession(sessionId: string): Promise<AgentPause[]> {
    return this.pauses
      .filter((p) => p.sessionId === sessionId)
      .sort((a, b) => a.pauseIndex - b.pauseIndex);
  }

  async compareAndSwapResumeStatus(
    id: string,
    expectedStatus: ResumeStatus,
    newStatus: ResumeStatus,
    updates?: Partial<AgentPause>,
  ): Promise<boolean> {
    const idx = this.pauses.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    if (this.pauses[idx].resumeStatus !== expectedStatus) return false;
    this.pauses[idx] = {
      ...this.pauses[idx],
      resumeStatus: newStatus,
      ...(updates ?? {}),
    };
    return true;
  }
}

export class InMemoryToolEventStore implements ToolEventStore {
  readonly events: ToolEvent[] = [];

  async record(event: ToolEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async listBySession(sessionId: string): Promise<ToolEvent[]> {
    return this.events
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => a.stepIndex - b.stepIndex);
  }

  async listByRun(runId: string): Promise<ToolEvent[]> {
    return this.events.filter((e) => e.runId === runId).sort((a, b) => a.stepIndex - b.stepIndex);
  }

  async countBySession(sessionId: string): Promise<{
    totalCalls: number;
    mutations: number;
    dollarsAtRisk: number;
  }> {
    const events = this.events.filter((e) => e.sessionId === sessionId);
    return {
      totalCalls: events.length,
      mutations: events.filter((e) => e.isMutation).length,
      dollarsAtRisk: events.reduce((sum, e) => sum + e.dollarsAtRisk, 0),
    };
  }
}

export class InMemoryRoleOverrideStore implements RoleOverrideStore {
  readonly overrides: AgentRoleOverride[] = [];

  async save(override: AgentRoleOverride): Promise<void> {
    this.overrides.push({ ...override });
  }

  async getByOrgAndRole(organizationId: string, roleId: string): Promise<AgentRoleOverride | null> {
    return (
      this.overrides.find((o) => o.organizationId === organizationId && o.roleId === roleId) ?? null
    );
  }

  async update(id: string, updates: Partial<AgentRoleOverride>): Promise<void> {
    const idx = this.overrides.findIndex((o) => o.id === id);
    if (idx === -1) throw new Error(`Override ${id} not found`);
    this.overrides[idx] = { ...this.overrides[idx], ...updates };
  }
}

/**
 * Create a fresh set of in-memory stores for testing.
 */
export function createTestStores() {
  return {
    sessions: new InMemorySessionStore(),
    runs: new InMemoryRunStore(),
    pauses: new InMemoryPauseStore(),
    toolEvents: new InMemoryToolEventStore(),
    roleOverrides: new InMemoryRoleOverrideStore(),
  };
}
```

- [ ] **Step 2: Write failing tests**

Create `packages/core/src/sessions/__tests__/session-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { SessionManagerImpl } from "../session-manager.js";
import { SessionTransitionError } from "../state-machine.js";
import { createTestStores } from "./test-stores.js";

describe("SessionManager", () => {
  let stores: ReturnType<typeof createTestStores>;
  let manager: SessionManagerImpl;

  const defaultManifest = {
    safetyEnvelope: {
      maxToolCalls: 200,
      maxMutations: 50,
      maxDollarsAtRisk: 10_000,
      sessionTimeoutMs: 30 * 60 * 1000,
    },
    toolPack: ["digital-ads"],
    governanceProfile: "guarded",
  };

  beforeEach(() => {
    stores = createTestStores();
    manager = new SessionManagerImpl({
      sessions: stores.sessions,
      runs: stores.runs,
      pauses: stores.pauses,
      toolEvents: stores.toolEvents,
      roleOverrides: stores.roleOverrides,
      maxConcurrentSessions: 5,
    });
  });

  describe("createSession", () => {
    it("creates session with status running and initial run", async () => {
      const result = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      expect(result.session.status).toBe("running");
      expect(result.session.organizationId).toBe("org-1");
      expect(result.session.toolCallCount).toBe(0);
      expect(result.run.runIndex).toBe(0);
      expect(result.run.triggerType).toBe("initial");
    });

    it("rejects when concurrent session limit exceeded", async () => {
      // Create 5 sessions to hit the limit
      for (let i = 0; i < 5; i++) {
        await manager.createSession({
          organizationId: "org-1",
          roleId: "ad-operator",
          principalId: "principal-1",
          manifestDefaults: defaultManifest,
        });
      }

      await expect(
        manager.createSession({
          organizationId: "org-1",
          roleId: "ad-operator",
          principalId: "principal-1",
          manifestDefaults: defaultManifest,
        }),
      ).rejects.toThrow("concurrent session limit");
    });
  });

  describe("recordToolCall", () => {
    it("records tool event and updates session counters", async () => {
      const { session } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.recordToolCall(session.id, {
        runId: "run-1",
        toolName: "get_campaign_metrics",
        parameters: { campaignId: "c1" },
        result: { impressions: 1000 },
        isMutation: false,
        dollarsAtRisk: 0,
        durationMs: 150,
        envelopeId: null,
      });

      const updated = await stores.sessions.getById(session.id);
      expect(updated!.toolCallCount).toBe(1);
      expect(updated!.currentStep).toBe(1);
      expect(updated!.mutationCount).toBe(0);

      // Tool history is in ToolEventStore, not denormalized on session
      const events = await stores.toolEvents.listBySession(session.id);
      expect(events).toHaveLength(1);
      expect(events[0].toolName).toBe("get_campaign_metrics");
    });

    it("increments mutation count for side-effect tools", async () => {
      const { session } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.recordToolCall(session.id, {
        runId: "run-1",
        toolName: "update_budget",
        parameters: { newBudget: 500 },
        result: { success: true },
        isMutation: true,
        dollarsAtRisk: 500,
        durationMs: 200,
        envelopeId: "env-1",
      });

      const updated = await stores.sessions.getById(session.id);
      expect(updated!.mutationCount).toBe(1);
      expect(updated!.dollarsAtRisk).toBe(500);
    });

    it("rejects when safety envelope budget exceeded", async () => {
      const { session } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: {
          ...defaultManifest,
          safetyEnvelope: { ...defaultManifest.safetyEnvelope, maxToolCalls: 1 },
        },
      });

      // First call succeeds
      await manager.recordToolCall(session.id, {
        runId: "run-1",
        toolName: "tool1",
        parameters: {},
        result: null,
        isMutation: false,
        dollarsAtRisk: 0,
        durationMs: 100,
        envelopeId: null,
      });

      // Second call exceeds limit
      await expect(
        manager.recordToolCall(session.id, {
          runId: "run-1",
          toolName: "tool2",
          parameters: {},
          result: null,
          isMutation: false,
          dollarsAtRisk: 0,
          durationMs: 100,
          envelopeId: null,
        }),
      ).rejects.toThrow("safety envelope");
    });
  });

  describe("pauseSession", () => {
    it("transitions to paused, creates AgentPause, updates run", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      const pause = await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: { step: 3 } },
      });

      expect(pause.resumeStatus).toBe("pending");
      expect(pause.approvalId).toBe("appr-1");
      expect(pause.pauseIndex).toBe(0);

      const updated = await stores.sessions.getById(session.id);
      expect(updated!.status).toBe("paused");
      expect(updated!.checkpoint).toEqual({ agentState: { step: 3 } });

      const updatedRun = await stores.runs.getById(run.id);
      expect(updatedRun!.outcome).toBe("paused_for_approval");
    });

    it("rejects from terminal state", async () => {
      const { session } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.completeSession(session.id, { runId: "run-1" });

      await expect(
        manager.pauseSession(session.id, {
          runId: "run-1",
          approvalId: "appr-1",
          checkpoint: { agentState: {} },
        }),
      ).rejects.toThrow(SessionTransitionError);
    });
  });

  describe("resumeAfterApproval", () => {
    it("marks resumable, transitions paused → running, creates new run", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      const pause = await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: { step: 3 } },
      });

      const result = await manager.resumeAfterApproval("appr-1", {
        action: "approve",
        respondedBy: "owner-1",
      });

      expect(result).not.toBeNull();
      expect(result!.session.status).toBe("running");
      expect(result!.run.triggerType).toBe("resume_approval");
      expect(result!.run.runIndex).toBe(1);
      expect(result!.resumeToken).toBe(pause.resumeToken);
    });

    it("returns null when no linked pause found", async () => {
      const result = await manager.resumeAfterApproval("nonexistent-approval", {
        action: "approve",
        respondedBy: "owner-1",
      });

      expect(result).toBeNull();
    });

    it("rejects on concurrent resume (CAS fails)", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: { step: 3 } },
      });

      // First resume succeeds
      await manager.resumeAfterApproval("appr-1", {
        action: "approve",
        respondedBy: "owner-1",
      });

      // Second resume fails (status already consumed)
      await expect(
        manager.resumeAfterApproval("appr-1", {
          action: "approve",
          respondedBy: "owner-2",
        }),
      ).rejects.toThrow("concurrent");
    });

    it("rejects when session is not paused", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      // Complete the session (not paused)
      await manager.completeSession(session.id, { runId: run.id });

      // Manually insert a pause record pointing at a completed session
      await stores.pauses.save({
        id: "pause-fake",
        sessionId: session.id,
        runId: run.id,
        pauseIndex: 0,
        approvalId: "appr-fake",
        resumeStatus: "pending",
        resumeToken: "token-fake",
        checkpoint: { agentState: {} },
        approvalOutcome: null,
        createdAt: new Date(),
        resumedAt: null,
      });

      await expect(
        manager.resumeAfterApproval("appr-fake", {
          action: "approve",
          respondedBy: "owner-1",
        }),
      ).rejects.toThrow();
    });
  });

  describe("completeSession", () => {
    it("transitions to completed", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.completeSession(session.id, { runId: run.id });

      const updated = await stores.sessions.getById(session.id);
      expect(updated!.status).toBe("completed");
      expect(updated!.completedAt).toBeTruthy();
    });
  });

  describe("failSession", () => {
    it("transitions to failed from running", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.failSession(session.id, {
        runId: run.id,
        error: "Gateway timeout",
      });

      const updated = await stores.sessions.getById(session.id);
      expect(updated!.status).toBe("failed");
    });
  });

  describe("cancelSession", () => {
    it("cancels from running", async () => {
      const { session } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.cancelSession(session.id);

      const updated = await stores.sessions.getById(session.id);
      expect(updated!.status).toBe("cancelled");
    });

    it("cancels from paused", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: {} },
      });

      await manager.cancelSession(session.id);

      const updated = await stores.sessions.getById(session.id);
      expect(updated!.status).toBe("cancelled");
    });

    it("rejects cancel from terminal state", async () => {
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      await manager.completeSession(session.id, { runId: run.id });

      await expect(manager.cancelSession(session.id)).rejects.toThrow(SessionTransitionError);
    });
  });

  describe("lifecycle integration", () => {
    it("full lifecycle: create → tool calls → pause → resume → tool calls → complete", async () => {
      // Create
      const { session, run } = await manager.createSession({
        organizationId: "org-1",
        roleId: "ad-operator",
        principalId: "principal-1",
        manifestDefaults: defaultManifest,
      });

      // Record tool calls
      await manager.recordToolCall(session.id, {
        runId: run.id,
        toolName: "get_metrics",
        parameters: {},
        result: { data: true },
        isMutation: false,
        dollarsAtRisk: 0,
        durationMs: 100,
        envelopeId: null,
      });
      await manager.recordToolCall(session.id, {
        runId: run.id,
        toolName: "update_budget",
        parameters: { amount: 500 },
        result: null,
        isMutation: true,
        dollarsAtRisk: 500,
        durationMs: 200,
        envelopeId: "env-1",
      });

      // Pause for approval
      const pause = await manager.pauseSession(session.id, {
        runId: run.id,
        approvalId: "appr-1",
        checkpoint: { agentState: { step: 2 }, pendingApprovalId: "appr-1" },
      });

      // Verify paused state
      let current = await stores.sessions.getById(session.id);
      expect(current!.status).toBe("paused");
      expect(current!.toolCallCount).toBe(2);
      expect(current!.mutationCount).toBe(1);

      // Resume after approval
      const resumeResult = await manager.resumeAfterApproval("appr-1", {
        action: "approve",
        respondedBy: "owner-1",
      });
      expect(resumeResult).not.toBeNull();
      expect(resumeResult!.run.runIndex).toBe(1);

      // Record more tool calls in new run
      await manager.recordToolCall(session.id, {
        runId: resumeResult!.run.id,
        toolName: "get_results",
        parameters: {},
        result: { success: true },
        isMutation: false,
        dollarsAtRisk: 0,
        durationMs: 80,
        envelopeId: null,
      });

      // Complete
      await manager.completeSession(session.id, {
        runId: resumeResult!.run.id,
      });

      current = await stores.sessions.getById(session.id);
      expect(current!.status).toBe("completed");
      expect(current!.toolCallCount).toBe(3);
      expect(current!.completedAt).toBeTruthy();

      // Verify all runs
      const runs = await stores.runs.listBySession(session.id);
      expect(runs).toHaveLength(2);
      expect(runs[0].outcome).toBe("paused_for_approval");
      expect(runs[1].outcome).toBe("completed");

      // Verify tool events
      const events = await stores.toolEvents.listBySession(session.id);
      expect(events).toHaveLength(3);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/session-manager.test.ts`
Expected: FAIL

- [ ] **Step 4: Write SessionManager implementation**

Create `packages/core/src/sessions/session-manager.ts`:

```typescript
import crypto from "node:crypto";
import type {
  AgentSession,
  AgentRun,
  AgentPause,
  ToolEvent,
  AgentCheckpoint,
} from "@switchboard/schemas";
import type {
  SessionStore,
  RunStore,
  PauseStore,
  ToolEventStore,
  RoleOverrideStore,
} from "./store-interfaces.js";
import { canTransition, SessionTransitionError } from "./state-machine.js";
import { validateCheckpoint } from "./checkpoint-validator.js";
import type { ManifestDefaults } from "./role-config-merger.js";
import { mergeRoleConfig } from "./role-config-merger.js";

export interface SessionManagerDeps {
  sessions: SessionStore;
  runs: RunStore;
  pauses: PauseStore;
  toolEvents: ToolEventStore;
  roleOverrides: RoleOverrideStore;
  maxConcurrentSessions: number;
}

export interface CreateSessionInput {
  organizationId: string;
  roleId: string;
  principalId: string;
  manifestDefaults: ManifestDefaults;
  safetyEnvelopeOverride?: Partial<AgentSession["safetyEnvelope"]>;
}

export interface RecordToolCallInput {
  runId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown> | null;
  isMutation: boolean;
  dollarsAtRisk: number;
  durationMs: number | null;
  envelopeId: string | null;
}

export interface PauseSessionInput {
  runId: string;
  approvalId: string;
  checkpoint: AgentCheckpoint;
}

export interface ResumeResult {
  session: AgentSession;
  run: AgentRun;
  resumeToken: string;
}

export class SafetyEnvelopeExceededError extends Error {
  constructor(message: string) {
    super(`Session safety envelope exceeded: ${message}`);
    this.name = "SafetyEnvelopeExceededError";
  }
}

export class ConcurrentResumeError extends Error {
  constructor(pauseId: string) {
    super(`Concurrent resume detected for pause ${pauseId}: resumeStatus is no longer pending`);
    this.name = "ConcurrentResumeError";
  }
}

/**
 * SessionManager owns ALL session state transitions.
 *
 * Architectural rule: no route, worker, or hook directly mutates session stores.
 * Everything flows through this class.
 */
export class SessionManagerImpl {
  private readonly deps: SessionManagerDeps;

  constructor(deps: SessionManagerDeps) {
    this.deps = deps;
  }

  /**
   * Create a new session with initial run.
   * Returns both session and run since callers always need the run ID for job enqueue.
   */
  async createSession(
    input: CreateSessionInput,
  ): Promise<{ session: AgentSession; run: AgentRun }> {
    // Check concurrent session limit
    const activeCount = await this.deps.sessions.countActive({
      organizationId: input.organizationId,
      roleId: input.roleId,
    });
    if (activeCount >= this.deps.maxConcurrentSessions) {
      throw new Error(
        `Cannot create session: concurrent session limit (${this.deps.maxConcurrentSessions}) reached ` +
          `for org ${input.organizationId} role ${input.roleId}`,
      );
    }

    // Merge config with overrides (tighten only)
    const orgOverride = await this.deps.roleOverrides.getByOrgAndRole(
      input.organizationId,
      input.roleId,
    );
    const merged = mergeRoleConfig({
      manifestDefaults: input.manifestDefaults,
      orgOverride,
      requestOverride: input.safetyEnvelopeOverride,
    });

    const sessionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const traceId = crypto.randomUUID();
    const now = new Date();

    const session: AgentSession = {
      id: sessionId,
      organizationId: input.organizationId,
      roleId: input.roleId,
      principalId: input.principalId,
      status: "running",
      safetyEnvelope: merged.safetyEnvelope,
      toolCallCount: 0,
      mutationCount: 0,
      dollarsAtRisk: 0,
      currentStep: 0,
      toolHistory: [],
      checkpoint: null,
      traceId,
      startedAt: now,
      completedAt: null,
    };

    const run: AgentRun = {
      id: runId,
      sessionId,
      runIndex: 0,
      triggerType: "initial",
      resumeContext: null,
      outcome: null,
      stepRange: null,
      startedAt: now,
      completedAt: null,
    };

    await this.deps.sessions.create(session);
    await this.deps.runs.save(run);

    return { session, run };
  }

  /**
   * Record a tool call and update session counters.
   * Enforces safetyEnvelope limits BEFORE recording.
   */
  async recordToolCall(sessionId: string, input: RecordToolCallInput): Promise<ToolEvent> {
    const session = await this.requireSession(sessionId);
    this.assertNotTerminal(session);

    // Safety envelope check BEFORE recording
    const env = session.safetyEnvelope;
    if (session.toolCallCount + 1 > env.maxToolCalls) {
      throw new SafetyEnvelopeExceededError(
        `tool call limit (${env.maxToolCalls}) would be exceeded`,
      );
    }
    if (input.isMutation && session.mutationCount + 1 > env.maxMutations) {
      throw new SafetyEnvelopeExceededError(
        `mutation limit (${env.maxMutations}) would be exceeded`,
      );
    }
    if (
      input.dollarsAtRisk > 0 &&
      session.dollarsAtRisk + input.dollarsAtRisk > env.maxDollarsAtRisk
    ) {
      throw new SafetyEnvelopeExceededError(
        `dollar exposure ($${session.dollarsAtRisk + input.dollarsAtRisk}) would exceed limit ($${env.maxDollarsAtRisk})`,
      );
    }

    const event: ToolEvent = {
      id: crypto.randomUUID(),
      sessionId,
      runId: input.runId,
      stepIndex: session.currentStep,
      toolName: input.toolName,
      parameters: input.parameters,
      result: input.result,
      isMutation: input.isMutation,
      dollarsAtRisk: input.dollarsAtRisk,
      durationMs: input.durationMs,
      envelopeId: input.envelopeId,
      timestamp: new Date(),
    };

    // Record event and update session counters.
    // Note: toolHistory is NOT denormalized on the session row — it is loaded
    // from ToolEventStore on demand (via getToolHistory) to avoid write
    // amplification on a growing JSON column. Session.toolHistory in the
    // schema exists for the resume payload but is populated lazily.
    await this.deps.toolEvents.record(event);
    await this.deps.sessions.update(sessionId, {
      toolCallCount: session.toolCallCount + 1,
      mutationCount: session.mutationCount + (input.isMutation ? 1 : 0),
      dollarsAtRisk: session.dollarsAtRisk + input.dollarsAtRisk,
      currentStep: session.currentStep + 1,
    });

    return event;
  }

  /**
   * Pause a session for approval.
   * Validates checkpoint, creates AgentPause, transitions session status.
   */
  async pauseSession(sessionId: string, input: PauseSessionInput): Promise<AgentPause> {
    const session = await this.requireSession(sessionId);
    this.assertTransition(session.status, "paused");

    // Validate checkpoint structure
    const checkpointResult = validateCheckpoint(input.checkpoint);
    if (!checkpointResult.valid) {
      throw new Error(`Invalid checkpoint: ${checkpointResult.errors.join(", ")}`);
    }

    const pauses = await this.deps.pauses.listBySession(sessionId);
    const pauseIndex = pauses.length;

    const pause: AgentPause = {
      id: crypto.randomUUID(),
      sessionId,
      runId: input.runId,
      pauseIndex,
      approvalId: input.approvalId,
      resumeStatus: "pending",
      resumeToken: crypto.randomUUID(),
      checkpoint: input.checkpoint,
      approvalOutcome: null,
      createdAt: new Date(),
      resumedAt: null,
    };

    await this.deps.pauses.save(pause);
    await this.deps.sessions.update(sessionId, {
      status: "paused",
      checkpoint: input.checkpoint,
    });
    await this.deps.runs.update(input.runId, {
      outcome: "paused_for_approval",
      completedAt: new Date(),
    });

    return pause;
  }

  /**
   * Resume a session after approval.
   * Encapsulates: markResumable → transition paused → running → create new run.
   *
   * Returns null if no linked pause found (not a session-linked approval).
   * Throws ConcurrentResumeError if another resume already consumed the token.
   * Throws SessionTransitionError if session is not paused.
   */
  async resumeAfterApproval(
    approvalId: string,
    approvalOutcome: Record<string, unknown>,
  ): Promise<ResumeResult | null> {
    // Find linked pause
    const pause = await this.deps.pauses.getByApprovalId(approvalId);
    if (!pause || pause.resumeStatus !== "pending") {
      if (!pause) return null;
      throw new ConcurrentResumeError(pause.id);
    }

    // Atomic CAS on resume status
    const casSuccess = await this.deps.pauses.compareAndSwapResumeStatus(
      pause.id,
      "pending",
      "consumed",
      {
        approvalOutcome,
        resumedAt: new Date(),
      },
    );
    if (!casSuccess) {
      throw new ConcurrentResumeError(pause.id);
    }

    // Validate session is paused
    const session = await this.requireSession(pause.sessionId);
    this.assertTransition(session.status, "running");

    // Create new run
    const runs = await this.deps.runs.listBySession(session.id);
    const newRun: AgentRun = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      runIndex: runs.length,
      triggerType: "resume_approval",
      resumeContext: approvalOutcome,
      outcome: null,
      stepRange: null,
      startedAt: new Date(),
      completedAt: null,
    };

    await this.deps.runs.save(newRun);
    await this.deps.sessions.update(session.id, { status: "running" });

    const updatedSession = await this.requireSession(session.id);
    return {
      session: updatedSession,
      run: newRun,
      resumeToken: pause.resumeToken,
    };
  }

  /**
   * Mark session as completed (terminal).
   */
  async completeSession(sessionId: string, input: { runId: string }): Promise<void> {
    const session = await this.requireSession(sessionId);
    this.assertTransition(session.status, "completed");

    const now = new Date();
    await this.deps.sessions.update(sessionId, {
      status: "completed",
      completedAt: now,
    });
    await this.deps.runs.update(input.runId, {
      outcome: "completed",
      completedAt: now,
    });
  }

  /**
   * Mark session as failed (terminal).
   */
  async failSession(sessionId: string, input: { runId: string; error: string }): Promise<void> {
    const session = await this.requireSession(sessionId);
    this.assertTransition(session.status, "failed");

    const now = new Date();
    await this.deps.sessions.update(sessionId, {
      status: "failed",
      completedAt: now,
    });
    await this.deps.runs.update(input.runId, {
      outcome: "failed",
      completedAt: now,
    });
  }

  /**
   * Cancel a session (terminal). Can cancel from running or paused.
   */
  async cancelSession(sessionId: string): Promise<void> {
    const session = await this.requireSession(sessionId);
    this.assertTransition(session.status, "cancelled");

    await this.deps.sessions.update(sessionId, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  /**
   * Get a session by ID (read-only, does not mutate).
   */
  async getSession(sessionId: string): Promise<AgentSession | null> {
    return this.deps.sessions.getById(sessionId);
  }

  /**
   * Load tool history from ToolEventStore (not denormalized on session row).
   * Used for building resume payloads.
   */
  async getToolHistory(sessionId: string): Promise<ToolEvent[]> {
    return this.deps.toolEvents.listBySession(sessionId);
  }

  /**
   * Find a pause by its resume token (for the invocation worker).
   * Returns null if not found.
   */
  async getPauseByResumeToken(sessionId: string, resumeToken: string): Promise<AgentPause | null> {
    const pauses = await this.deps.pauses.listBySession(sessionId);
    return pauses.find((p) => p.resumeToken === resumeToken) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async requireSession(id: string): Promise<AgentSession> {
    const session = await this.deps.sessions.getById(id);
    if (!session) throw new Error(`Session ${id} not found`);
    return session;
  }

  private assertNotTerminal(session: AgentSession): void {
    if (
      session.status === "completed" ||
      session.status === "failed" ||
      session.status === "cancelled"
    ) {
      throw new Error(`Session ${session.id} is in terminal state '${session.status}'`);
    }
  }

  private assertTransition(from: AgentSession["status"], to: AgentSession["status"]): void {
    if (!canTransition(from, to)) {
      throw new SessionTransitionError(from, to);
    }
  }
}
```

- [ ] **Step 5: Create barrel export**

Create `packages/core/src/sessions/index.ts`:

```typescript
export * from "./state-machine.js";
export * from "./store-interfaces.js";
export * from "./session-manager.js";
export * from "./role-config-merger.js";
export * from "./checkpoint-validator.js";
export * from "./resume-payload-builder.js";
```

- [ ] **Step 6: Add to core barrel export**

Add to `packages/core/src/index.ts`:

```typescript
// Sessions
export * from "./sessions/index.js";
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run src/sessions/__tests__/session-manager.test.ts`
Expected: PASS

- [ ] **Step 8: Run full core typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/sessions/session-manager.ts packages/core/src/sessions/__tests__/session-manager.test.ts packages/core/src/sessions/__tests__/test-stores.ts packages/core/src/sessions/index.ts packages/core/src/index.ts
git commit -m "feat(core): implement SessionManager with full lifecycle

SessionManager owns ALL session state transitions: create, pause,
resume, complete, fail, cancel. Includes safety envelope enforcement,
concurrent resume protection via CAS, and lifecycle integration test."
```

---

## Task 10: Ad-Operator Role Manifest (agent-roles/)

**Files:**

- Create: `agent-roles/tsconfig.json`
- Create: `agent-roles/ad-operator/manifest.ts` (source of truth, TypeScript)
- Create: `agent-roles/ad-operator/manifest.json` (compiled output, loaded at runtime)
- Create: `agent-roles/ad-operator/defaults/guardrails.ts`
- Create: `agent-roles/ad-operator/defaults/instruction.md`
- Create: `agent-roles/ad-operator/defaults/checkpoint-schema.ts` (TypeScript source)
- Create: `agent-roles/ad-operator/defaults/checkpoint-schema.json` (JSON for runtime loading)

**Import strategy:** `agent-roles/` is a top-level directory, not a pnpm workspace package. The `manifest.ts` is the source of truth for type checking; `manifest.json` is the runtime artifact loaded by the manifest loader via `fs.readFile` + `JSON.parse` + Zod validation. No dynamic TypeScript `import()` needed. The `AgentRoleManifest` type lives in `@switchboard/schemas`.

- [ ] **Step 1: Create `agent-roles/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "esModuleInterop": true,
    "declaration": true
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: Create manifest**

Create `agent-roles/ad-operator/manifest.ts`:

```typescript
import type { AgentRoleManifest } from "@switchboard/schemas";

const manifest: AgentRoleManifest = {
  id: "ad-operator",
  name: "Ad Operator",
  description:
    "Manages digital advertising campaigns across Meta, Google, and TikTok. " +
    "Reads performance metrics, proposes budget changes, and pauses underperforming campaigns.",
  version: "1.0.0",
  toolPack: ["digital-ads"],
  governanceProfile: "guarded",
  safetyEnvelope: {
    maxToolCalls: 200,
    maxMutations: 50,
    maxDollarsAtRisk: 10_000,
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  },
  instructionPath: "./defaults/instruction.md",
  checkpointSchemaPath: "./defaults/checkpoint-schema.ts",
  maxConcurrentSessions: 3,
};

export default manifest;
```

- [ ] **Step 3: Create default guardrails**

Create `agent-roles/ad-operator/defaults/guardrails.ts`:

```typescript
/**
 * Default guardrail configuration for the ad-operator role.
 * These are applied when no org-level override exists.
 */
export const defaultGuardrails = {
  /** Maximum single budget change as a percentage of current */
  maxBudgetChangePct: 25,
  /** Maximum single budget change in absolute dollars */
  maxBudgetChangeAbsolute: 1_000,
  /** Minimum campaign age in days before allowing pause */
  minCampaignAgeDaysForPause: 3,
  /** Require approval for budget changes above this threshold */
  budgetApprovalThreshold: 500,
  /** Blocked action types (always require escalation) */
  blockedActions: ["delete_campaign", "delete_ad_account"],
};
```

- [ ] **Step 4: Create instruction template**

Create `agent-roles/ad-operator/defaults/instruction.md`:

```markdown
# Ad Operator — System Instruction

You are an advertising operations agent for {{businessName}}.

## Your Role

- Monitor campaign performance across platforms (Meta, Google, TikTok)
- Identify underperforming campaigns and propose optimizations
- Adjust budgets within approved limits
- Pause campaigns that are burning budget without results

## Operating Rules

1. **Always read before writing.** Check current metrics before proposing any change.
2. **Never exceed budget limits.** Maximum single change: {{maxBudgetChangePct}}% or ${{maxBudgetChangeAbsolute}}, whichever is lower.
3. **Pause with caution.** Only pause campaigns older than {{minCampaignAgeDaysForPause}} days with clear underperformance evidence.
4. **Explain your reasoning.** Every mutation must include a brief rationale in the action parameters.
5. **Escalate when uncertain.** If you're not confident in a decision, request human review.

## Available Tools

You have access to the `digital-ads` tool pack. Use read tools freely. Mutation tools go through governance review.
```

- [ ] **Step 5: Create checkpoint schema**

Create `agent-roles/ad-operator/defaults/checkpoint-schema.ts`:

```typescript
import { z } from "zod";
import { AgentCheckpointSchema } from "@switchboard/schemas";

/**
 * Ad-operator specific checkpoint extensions.
 * The base AgentCheckpointSchema is extended with domain-specific fields
 * that help the agent resume with full context.
 */
export const AdOperatorCheckpointSchema = AgentCheckpointSchema.extend({
  extensions: z
    .object({
      /** Campaign IDs being actively managed this session */
      activeCampaignIds: z.array(z.string()).optional(),
      /** Current optimization focus (budget, targeting, creative) */
      optimizationFocus: z.string().optional(),
      /** Platform being operated on (meta, google, tiktok) */
      currentPlatform: z.string().optional(),
    })
    .optional(),
});

export default AdOperatorCheckpointSchema;
```

- [ ] **Step 6: Create manifest.json (runtime artifact)**

Create `agent-roles/ad-operator/manifest.json` — this is the file loaded at runtime by the manifest loader:

```json
{
  "id": "ad-operator",
  "name": "Ad Operator",
  "description": "Manages digital advertising campaigns across Meta, Google, and TikTok. Reads performance metrics, proposes budget changes, and pauses underperforming campaigns.",
  "version": "1.0.0",
  "toolPack": ["digital-ads"],
  "governanceProfile": "guarded",
  "safetyEnvelope": {
    "maxToolCalls": 200,
    "maxMutations": 50,
    "maxDollarsAtRisk": 10000,
    "sessionTimeoutMs": 1800000
  },
  "instructionPath": "./defaults/instruction.md",
  "checkpointSchemaPath": "./defaults/checkpoint-schema.json",
  "maxConcurrentSessions": 3
}
```

- [ ] **Step 7: Create checkpoint-schema.json**

Create `agent-roles/ad-operator/defaults/checkpoint-schema.json`:

```json
{
  "type": "object",
  "properties": {
    "agentState": { "type": "object" },
    "lastToolResult": { "type": "object" },
    "pendingApprovalId": { "type": "string" },
    "extensions": {
      "type": "object",
      "properties": {
        "activeCampaignIds": { "type": "array", "items": { "type": "string" } },
        "optimizationFocus": { "type": "string" },
        "currentPlatform": { "type": "string" }
      }
    }
  },
  "required": ["agentState"]
}
```

- [ ] **Step 8: Commit**

```bash
git add agent-roles/
git commit -m "feat: add ad-operator role manifest with defaults

Includes manifest.ts (type source) and manifest.json (runtime artifact),
safety envelope (200 calls, 50 mutations, $10k limit, 30min timeout),
guardrail config, instruction template, and checkpoint schema."
```

---

## Task 11: Manifest Loader (apps/api)

**Files:**

- Create: `apps/api/src/bootstrap/role-manifests.ts`

**Depends on:** Task 10

- [ ] **Step 1: Write manifest loader**

Create `apps/api/src/bootstrap/role-manifests.ts`:

```typescript
import path from "node:path";
import fs from "node:fs/promises";
import type { AgentRoleManifest } from "@switchboard/schemas";
import { AgentRoleManifestSchema } from "@switchboard/schemas";

export interface LoadedManifest {
  manifest: AgentRoleManifest;
  instruction: string;
  checkpointSchema: unknown;
  manifestDir: string;
}

/**
 * Load all role manifests from the agent-roles directory.
 *
 * Manifest files are JSON (not TypeScript) — each role directory contains
 * a `manifest.json` and a `defaults/` directory with instruction.md and
 * checkpoint-schema.json. This avoids the need for a TypeScript loader
 * at runtime.
 *
 * For development, the `agent-roles/<role>/manifest.ts` is the source of
 * truth — a build step compiles it to `manifest.json`. In Phase 1 we
 * read manifest data from `.json` files directly.
 */
export async function loadRoleManifests(options?: {
  agentRolesDir?: string;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}): Promise<Map<string, LoadedManifest>> {
  const baseDir = options?.agentRolesDir ?? path.resolve(process.cwd(), "../../agent-roles");
  const logger = options?.logger ?? console;

  const manifests = new Map<string, LoadedManifest>();

  let entries: string[];
  try {
    entries = await fs.readdir(baseDir);
  } catch {
    logger.warn(`agent-roles directory not found at ${baseDir}, no manifests loaded`);
    return manifests;
  }

  for (const entry of entries) {
    const manifestPath = path.join(baseDir, entry, "manifest.json");
    try {
      await fs.access(manifestPath);
    } catch {
      continue; // Skip non-role directories (e.g., tsconfig.json)
    }

    try {
      // Load and validate manifest JSON
      const raw = await fs.readFile(manifestPath, "utf-8");
      const parsed = AgentRoleManifestSchema.parse(JSON.parse(raw));

      // Load instruction template
      const instructionPath = path.resolve(path.dirname(manifestPath), parsed.instructionPath);
      const instruction = await fs.readFile(instructionPath, "utf-8");

      // Load checkpoint schema (JSON schema, not Zod — runtime validation only)
      const checkpointSchemaPath = path.resolve(
        path.dirname(manifestPath),
        parsed.checkpointSchemaPath,
      );
      let checkpointSchema: unknown = null;
      try {
        const schemaRaw = await fs.readFile(checkpointSchemaPath, "utf-8");
        checkpointSchema = JSON.parse(schemaRaw);
      } catch {
        logger.warn(`Checkpoint schema not found at ${checkpointSchemaPath}, using base schema`);
      }

      manifests.set(parsed.id, {
        manifest: parsed,
        instruction,
        checkpointSchema,
        manifestDir: path.dirname(manifestPath),
      });

      logger.info(`Loaded role manifest: ${parsed.id} (v${parsed.version})`);
    } catch (err) {
      logger.warn(`Failed to load manifest from ${manifestPath}:`, err);
    }
  }

  return manifests;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bootstrap/role-manifests.ts
git commit -m "feat(api): add role manifest loader from agent-roles directory"
```

---

## Task 12: Session-Scoped Auth Tokens (apps/api)

**Files:**

- Create: `apps/api/src/auth/session-token.ts`
- Test: `apps/api/src/__tests__/session-token.test.ts`

- [ ] **Step 0: Install jose dependency**

Run: `pnpm --filter @switchboard/api add jose`

`jose` is an ESM-native JWT library (no CJS issues).

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/__tests__/session-token.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { issueSessionToken, validateSessionToken } from "../auth/session-token.js";

const TEST_SECRET = "test-secret-that-is-at-least-32-bytes-long-for-hs256";

describe("Session Tokens", () => {
  describe("issueSessionToken", () => {
    it("issues a JWT with session claims", async () => {
      const token = await issueSessionToken({
        sessionId: "sess-1",
        organizationId: "org-1",
        principalId: "principal-1",
        roleId: "ad-operator",
        secret: TEST_SECRET,
        expiresInMs: 30 * 60 * 1000,
      });

      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT format
    });
  });

  describe("validateSessionToken", () => {
    it("validates a token and returns claims", async () => {
      const token = await issueSessionToken({
        sessionId: "sess-1",
        organizationId: "org-1",
        principalId: "principal-1",
        roleId: "ad-operator",
        secret: TEST_SECRET,
        expiresInMs: 30 * 60 * 1000,
      });

      const claims = await validateSessionToken(token, TEST_SECRET);
      expect(claims.sessionId).toBe("sess-1");
      expect(claims.organizationId).toBe("org-1");
      expect(claims.principalId).toBe("principal-1");
      expect(claims.roleId).toBe("ad-operator");
    });

    it("rejects an expired token", async () => {
      const token = await issueSessionToken({
        sessionId: "sess-1",
        organizationId: "org-1",
        principalId: "principal-1",
        roleId: "ad-operator",
        secret: TEST_SECRET,
        expiresInMs: -1000, // Already expired
      });

      await expect(validateSessionToken(token, TEST_SECRET)).rejects.toThrow();
    });

    it("rejects a token signed with wrong secret", async () => {
      const token = await issueSessionToken({
        sessionId: "sess-1",
        organizationId: "org-1",
        principalId: "principal-1",
        roleId: "ad-operator",
        secret: TEST_SECRET,
        expiresInMs: 30 * 60 * 1000,
      });

      await expect(
        validateSessionToken(token, "wrong-secret-that-is-also-32-bytes-plus"),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test -- --run src/__tests__/session-token.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `apps/api/src/auth/session-token.ts`:

```typescript
import * as jose from "jose";

export interface SessionTokenClaims {
  sessionId: string;
  organizationId: string;
  principalId: string;
  roleId: string;
}

/**
 * Issue a session-scoped JWT.
 * This is a SEPARATE auth path from the existing API key / NextAuth flow.
 * Session tokens are short-lived and scoped to a single session.
 */
export async function issueSessionToken(input: {
  sessionId: string;
  organizationId: string;
  principalId: string;
  roleId: string;
  secret: string;
  expiresInMs: number;
}): Promise<string> {
  const secret = new TextEncoder().encode(input.secret);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.floor(input.expiresInMs / 1000);

  return new jose.SignJWT({
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    principalId: input.principalId,
    roleId: input.roleId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setSubject(input.principalId)
    .setIssuer("switchboard:session")
    .sign(secret);
}

/**
 * Validate a session-scoped JWT and return its claims.
 */
export async function validateSessionToken(
  token: string,
  secret: string,
): Promise<SessionTokenClaims> {
  const secretKey = new TextEncoder().encode(secret);

  const { payload } = await jose.jwtVerify(token, secretKey, {
    issuer: "switchboard:session",
  });

  return {
    sessionId: payload["sessionId"] as string,
    organizationId: payload["organizationId"] as string,
    principalId: payload["principalId"] as string,
    roleId: payload["roleId"] as string,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/api test -- --run src/__tests__/session-token.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/session-token.ts apps/api/src/__tests__/session-token.test.ts
git commit -m "feat(api): add session-scoped JWT auth tokens using jose"
```

---

## Task 13: Session API Routes (apps/api)

**Files:**

- Create: `apps/api/src/routes/sessions.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

**Depends on:** Tasks 9, 11, 12

- [ ] **Step 1: Augment FastifyInstance**

Add to the `declare module "fastify"` block in `apps/api/src/app.ts`:

```typescript
sessionManager: import("@switchboard/core").SessionManagerImpl | null;
sessionInvocationQueue: import("bullmq").Queue | null;
roleManifests: Map<string, import("./bootstrap/role-manifests.js").LoadedManifest>;
```

- [ ] **Step 2: Create session routes**

Create `apps/api/src/routes/sessions.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { CreateSessionRequestSchema } from "@switchboard/schemas";
import { assertOrgAccess } from "../utils/org-access.js";
import { issueSessionToken } from "../auth/session-token.js";

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/sessions — Create a new agent session
  app.post(
    "/",
    {
      schema: {
        description: "Create a new agent session.",
        tags: ["Sessions"],
      },
    },
    async (request, reply) => {
      if (!app.sessionManager) {
        return reply.code(503).send({ error: "Session runtime not enabled" });
      }

      const parsed = CreateSessionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.issues });
      }
      const body = parsed.data;

      if (!assertOrgAccess(request, body.organizationId, reply)) return;

      // Lookup role manifest
      const loaded = app.roleManifests.get(body.roleId);
      if (!loaded) {
        return reply.code(404).send({ error: `Role '${body.roleId}' not found` });
      }

      try {
        const { session, run } = await app.sessionManager.createSession({
          organizationId: body.organizationId,
          roleId: body.roleId,
          principalId: body.principalId,
          manifestDefaults: {
            safetyEnvelope: loaded.manifest.safetyEnvelope,
            toolPack: loaded.manifest.toolPack,
            governanceProfile: loaded.manifest.governanceProfile,
          },
          safetyEnvelopeOverride: body.safetyEnvelopeOverride,
        });

        // Issue session-scoped token
        const sessionTokenSecret = process.env["SESSION_TOKEN_SECRET"];
        let sessionToken: string | undefined;
        if (sessionTokenSecret) {
          sessionToken = await issueSessionToken({
            sessionId: session.id,
            organizationId: session.organizationId,
            principalId: session.principalId,
            roleId: session.roleId,
            secret: sessionTokenSecret,
            expiresInMs: session.safetyEnvelope.sessionTimeoutMs,
          });
        }

        // Enqueue initial invocation job
        if (app.sessionInvocationQueue) {
          await app.sessionInvocationQueue.add("invoke", {
            sessionId: session.id,
            runId: run.id,
            resumeToken: "",
            attempt: 0,
          });
        }

        return reply.code(201).send({
          session,
          runId: run.id,
          sessionToken,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes("concurrent session limit")) {
          return reply.code(429).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // GET /api/sessions/:id — Get session details
  app.get(
    "/:id",
    {
      schema: {
        description: "Get session details by ID.",
        tags: ["Sessions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      if (!app.sessionManager) {
        return reply.code(503).send({ error: "Session runtime not enabled" });
      }

      const { id } = request.params as { id: string };
      const session = await app.sessionManager.getSession(id);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      if (!assertOrgAccess(request, session.organizationId, reply)) return;

      return reply.code(200).send({ session });
    },
  );

  // POST /api/sessions/:id/cancel — Cancel a session
  app.post(
    "/:id/cancel",
    {
      schema: {
        description: "Cancel an active session.",
        tags: ["Sessions"],
        params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      },
    },
    async (request, reply) => {
      if (!app.sessionManager) {
        return reply.code(503).send({ error: "Session runtime not enabled" });
      }

      const { id } = request.params as { id: string };
      const session = await app.sessionManager.getSession(id);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }

      if (!assertOrgAccess(request, session.organizationId, reply)) return;

      try {
        await app.sessionManager.cancelSession(id);
        const updated = await app.sessionManager.getSession(id);
        return reply.code(200).send({ session: updated });
      } catch (err) {
        if (err instanceof Error && err.name === "SessionTransitionError") {
          return reply.code(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );
};
```

- [ ] **Step 3: Register route**

Add to `apps/api/src/bootstrap/routes.ts`:

```typescript
import { sessionRoutes } from "../routes/sessions.js";
```

And in the `registerRoutes` function:

```typescript
app.register(sessionRoutes, { prefix: "/api/sessions" });
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/sessions.ts apps/api/src/app.ts apps/api/src/bootstrap/routes.ts
git commit -m "feat(api): add session CRUD API routes with auth token issuance"
```

---

## Task 14: Session Invocation Worker (apps/api)

**Files:**

- Create: `apps/api/src/jobs/session-invocation.ts`
- Modify: `apps/api/src/bootstrap/jobs.ts`

**Depends on:** Task 9, 12

- [ ] **Step 1: Create session invocation job**

Create `apps/api/src/jobs/session-invocation.ts`:

```typescript
import { Worker, Queue } from "bullmq";
import type { ConnectionOptions, Job } from "bullmq";
import type { SessionManagerImpl } from "@switchboard/core";
import { buildResumePayload } from "@switchboard/core";
import { issueSessionToken } from "../auth/session-token.js";
import type { LoadedManifest } from "../bootstrap/role-manifests.js";
import type { GatewayInvokeRequest, GatewayInvokeResponse } from "@switchboard/schemas";
import { GatewayInvokeResponseSchema } from "@switchboard/schemas";

export interface SessionInvocationJobData {
  sessionId: string;
  runId: string;
  resumeToken: string;
  attempt: number;
}

export const SESSION_INVOCATION_QUEUE = "session-invocation";

export function createSessionInvocationQueue(connection: ConnectionOptions): Queue {
  return new Queue<SessionInvocationJobData>(SESSION_INVOCATION_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 500 },
      removeOnFail: false,
    },
  });
}

export function createSessionInvocationWorker(config: {
  connection: ConnectionOptions;
  sessionManager: SessionManagerImpl;
  roleManifests: Map<string, LoadedManifest>;
  openclawGatewayUrl: string;
  sessionTokenSecret: string;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}): Worker {
  return new Worker(
    SESSION_INVOCATION_QUEUE,
    async (job: Job<SessionInvocationJobData>) => {
      const { sessionId, runId, resumeToken, attempt } = job.data;
      const { sessionManager, roleManifests, logger } = config;

      // 1. Load session, verify running + active run
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        logger.warn({ sessionId }, "Session not found, skipping invocation");
        return;
      }
      if (session.status !== "running") {
        logger.warn(
          { sessionId, status: session.status },
          "Session not running, skipping invocation",
        );
        return;
      }

      // 2. Check session timeout
      const elapsed = Date.now() - session.startedAt.getTime();
      if (elapsed > session.safetyEnvelope.sessionTimeoutMs) {
        logger.warn({ sessionId }, "Session timed out, marking failed");
        await sessionManager.failSession(sessionId, {
          runId,
          error: "Session timed out",
        });
        return;
      }

      // 3. Load role manifest
      const loaded = roleManifests.get(session.roleId);
      if (!loaded) {
        logger.error({ roleId: session.roleId }, "Role manifest not found");
        await sessionManager.failSession(sessionId, {
          runId,
          error: `Role manifest '${session.roleId}' not found`,
        });
        return;
      }

      // 4. Issue session token
      const sessionToken = await issueSessionToken({
        sessionId: session.id,
        organizationId: session.organizationId,
        principalId: session.principalId,
        roleId: session.roleId,
        secret: config.sessionTokenSecret,
        expiresInMs: Math.max(0, session.safetyEnvelope.sessionTimeoutMs - elapsed),
      });

      // 5. Build invoke request
      let invokeRequest: GatewayInvokeRequest;

      if (resumeToken) {
        // Resume invocation — find pause via public SessionManager method
        // (Rule: no worker directly accesses session stores)
        const pause = await sessionManager.getPauseByResumeToken(sessionId, resumeToken);
        if (!pause) {
          logger.error({ sessionId, resumeToken }, "Pause not found for resume token");
          return;
        }

        // Load tool history via SessionManager (not from session row)
        const toolHistory = await sessionManager.getToolHistory(sessionId);

        const resumePayload = buildResumePayload({
          session,
          pause,
          toolHistory,
          runId,
          instruction: loaded.instruction,
        });

        invokeRequest = {
          sessionId,
          runId,
          roleId: session.roleId,
          sessionToken,
          resumePayload,
        };
      } else {
        // Initial invocation
        invokeRequest = {
          sessionId,
          runId,
          roleId: session.roleId,
          sessionToken,
          instruction: loaded.instruction,
          toolPack: loaded.manifest.toolPack,
          safetyLimits: session.safetyEnvelope,
        };
      }

      // 6. Call Gateway RPC (placeholder — will be replaced with real implementation)
      logger.info({ sessionId, runId, attempt }, "Invoking OpenClaw Gateway (placeholder)");

      try {
        const response = await invokeGateway(config.openclawGatewayUrl, invokeRequest);

        // 7. Handle response
        if (response.toolCalls) {
          for (const tc of response.toolCalls) {
            await sessionManager.recordToolCall(sessionId, {
              runId,
              toolName: tc.toolName,
              parameters: tc.parameters,
              result: tc.result,
              isMutation: tc.isMutation,
              dollarsAtRisk: tc.dollarsAtRisk,
              durationMs: tc.durationMs,
              envelopeId: tc.envelopeId,
            });
          }
        }

        switch (response.status) {
          case "completed":
            await sessionManager.completeSession(sessionId, { runId });
            logger.info({ sessionId, runId }, "Session completed");
            break;

          case "paused":
            if (response.checkpoint) {
              // The checkpoint should contain pendingApprovalId — the agent
              // created an approval via switchboard_execute and is waiting
              await sessionManager.pauseSession(sessionId, {
                runId,
                approvalId: response.checkpoint.pendingApprovalId ?? "unknown",
                checkpoint: response.checkpoint,
              });
              logger.info({ sessionId, runId }, "Session paused for approval");
            }
            break;

          case "failed":
            await sessionManager.failSession(sessionId, {
              runId,
              error: response.error?.message ?? "Gateway reported failure",
            });
            logger.error({ sessionId, runId, error: response.error }, "Session failed");
            break;
        }
      } catch (err) {
        // Transient failure — BullMQ will retry
        logger.error({ sessionId, runId, err }, "Gateway invocation failed");
        throw err;
      }
    },
    { connection: config.connection, concurrency: 3 },
  );
}

/**
 * Call the OpenClaw Gateway RPC endpoint.
 * This is a placeholder — Phase 2 will implement the real Gateway.
 */
async function invokeGateway(
  gatewayUrl: string,
  request: GatewayInvokeRequest,
): Promise<GatewayInvokeResponse> {
  const response = await fetch(`${gatewayUrl}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Gateway returned ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  return GatewayInvokeResponseSchema.parse(body);
}
```

- [ ] **Step 2: Register worker in bootstrap/jobs.ts**

Add import at the top of `apps/api/src/bootstrap/jobs.ts`:

```typescript
import {
  createSessionInvocationQueue,
  createSessionInvocationWorker,
} from "../jobs/session-invocation.js";
import type { SessionManagerImpl } from "@switchboard/core";
import type { LoadedManifest } from "./role-manifests.js";
```

Add `sessionManager`, `roleManifests` to the `JobDeps` interface:

```typescript
  sessionManager?: SessionManagerImpl | null;
  roleManifests?: Map<string, LoadedManifest>;
```

Inside the `if (prismaClient && redis)` block (after the existing background queue/worker setup), add:

```typescript
// Session invocation queue + worker
let sessionInvocationQueue: Queue | null = null;
let sessionInvocationWorker: Worker | null = null;
const gatewayUrl = process.env["OPENCLAW_GATEWAY_URL"];
const sessionTokenSecret = process.env["SESSION_TOKEN_SECRET"];

if (deps.sessionManager && gatewayUrl && sessionTokenSecret) {
  sessionInvocationQueue = createSessionInvocationQueue(connection);
  sessionInvocationWorker = createSessionInvocationWorker({
    connection,
    sessionManager: deps.sessionManager,
    roleManifests: deps.roleManifests ?? new Map(),
    openclawGatewayUrl: gatewayUrl,
    sessionTokenSecret,
    logger,
  });
}
```

Update the `stop` function and return value to include session worker cleanup.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/jobs/session-invocation.ts apps/api/src/bootstrap/jobs.ts
git commit -m "feat(api): add session invocation worker with Gateway RPC placeholder"
```

---

## Task 15: Approval Resume Hook (apps/api)

**Files:**

- Modify: `apps/api/src/routes/approvals.ts`

**Depends on:** Task 9

This is the only modification to existing code. The hook goes after `orchestrator.respondToApproval()` succeeds (line ~63) and before the response is returned. It is wrapped in try/catch — if resume fails, the approval response still succeeds.

- [ ] **Step 1: Read current approvals route**

Read `apps/api/src/routes/approvals.ts` to understand exact insertion point. The hook goes between the `respondToApproval` call and the `reply.code(200).send()`.

- [ ] **Step 2: Add the resume hook**

After the existing `respondToApproval` call, before the `return reply.code(200).send(...)`, add:

```typescript
// Session resume hook: check if this approval is linked to a paused agent session.
// All state transitions are encapsulated in SessionManager.resumeAfterApproval().
// Rule: No route directly mutates session stores.
if (app.sessionManager && body.action === "approve") {
  try {
    const result = await app.sessionManager.resumeAfterApproval(id, {
      approvalId: id,
      action: body.action,
      patchValue: body.patchValue,
      respondedBy: body.respondedBy,
      resolvedAt: new Date().toISOString(),
    });

    if (result && app.sessionInvocationQueue) {
      await app.sessionInvocationQueue.add("invoke", {
        sessionId: result.session.id,
        runId: result.run.id,
        resumeToken: result.resumeToken,
        attempt: 0,
      });
    }
  } catch (err) {
    // Log but don't fail the approval response — resume is best-effort
    // from the approval caller's perspective
    app.log.error({ err, approvalId: id }, "Failed to enqueue session resume");
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/approvals.ts
git commit -m "feat(api): add session resume hook to approval response flow

Calls SessionManager.resumeAfterApproval() after orchestrator.respondToApproval()
succeeds. Wrapped in try/catch — if resume fails, approval response still returns
200. Architectural rule: no route directly mutates session stores."
```

---

## Task 16: Wire Session Runtime into App Bootstrap (apps/api)

**Files:**

- Modify: `apps/api/src/app.ts`

**Depends on:** Tasks 5, 9, 11, 13, 14

This task wires everything together in the Fastify app bootstrap.

- [ ] **Step 1: Read current app.ts**

Read `apps/api/src/app.ts` to find the right insertion point for session runtime initialization. It should go after storage bootstrap and cartridge registration, before route registration.

- [ ] **Step 2: Add session runtime bootstrap**

Add imports and initialization code. After the existing storage bootstrap and before route registration, add:

```typescript
// Session runtime bootstrap (optional — requires DATABASE_URL + SESSION_TOKEN_SECRET)
let sessionManager: import("@switchboard/core").SessionManagerImpl | null = null;
let sessionInvocationQueue: import("bullmq").Queue | null = null;

if (prismaClient && process.env["SESSION_TOKEN_SECRET"]) {
  const { SessionManagerImpl } = await import("@switchboard/core");
  const {
    PrismaSessionStore,
    PrismaRunStore,
    PrismaPauseStore,
    PrismaToolEventStore,
    PrismaRoleOverrideStore,
  } = await import("@switchboard/db");

  const { loadRoleManifests } = await import("./bootstrap/role-manifests.js");
  const roleManifests = await loadRoleManifests({ logger: app.log });

  sessionManager = new SessionManagerImpl({
    sessions: new PrismaSessionStore(prismaClient),
    runs: new PrismaRunStore(prismaClient),
    pauses: new PrismaPauseStore(prismaClient),
    toolEvents: new PrismaToolEventStore(prismaClient),
    roleOverrides: new PrismaRoleOverrideStore(prismaClient),
    maxConcurrentSessions: 10,
  });

  app.decorate("sessionManager", sessionManager);
  app.decorate("roleManifests", roleManifests);
} else {
  app.decorate("sessionManager", null);
  app.decorate("roleManifests", new Map());
}

app.decorate("sessionInvocationQueue", null); // Set by jobs bootstrap if enabled
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app.ts
git commit -m "feat(api): wire session runtime into app bootstrap

Creates SessionManager with Prisma stores, loads role manifests,
and decorates Fastify instance. Optional — requires DATABASE_URL
and SESSION_TOKEN_SECRET."
```

---

## Task 17: Barrel Exports & Core Index Updates

**Files:**

- Verify: `packages/core/src/sessions/index.ts`
- Verify: `packages/core/src/index.ts`
- Verify: `packages/db/src/storage/index.ts`
- Verify: `packages/db/src/index.ts`
- Verify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Verify all barrel exports are consistent**

Read each barrel file and verify that all new modules are exported. Fix any missing exports.

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: PASS — all existing tests continue to pass, new session tests pass

- [ ] **Step 4: Commit (if any fixes needed)**

```bash
git add packages/core/src/sessions/index.ts packages/core/src/index.ts packages/db/src/storage/index.ts packages/db/src/index.ts packages/schemas/src/index.ts
git commit -m "chore: ensure barrel exports are consistent for session runtime modules"
```

---

## Task 18: Prisma Migration (packages/db)

**Files:**

- Auto-generated: `packages/db/prisma/migrations/...`

**Depends on:** Task 4 (schema changes already committed)

- [ ] **Step 1: Create migration**

Run: `pnpm db:migrate -- --name add_agent_sessions`
Expected: Migration created successfully

- [ ] **Step 2: Verify migration SQL**

Read the generated migration file and verify it creates the 5 tables with correct indexes and constraints.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/migrations/
git commit -m "feat(db): add migration for session runtime tables"
```

---

## Task 19: Full Test Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: ALL PASS, no regressions

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: ALL PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (no new lint errors)

- [ ] **Step 4: Verify coverage thresholds**

Run: `pnpm test -- --coverage`
Expected: Meets thresholds (core 65/65/70/65)

If coverage is below thresholds, add tests for uncovered branches in session-manager and state-machine.

---

## Summary

**19 tasks total.** Wave 1 (Tasks 1–4, 10) can run in parallel. Wave 2 (Tasks 5–9) is sequential but fast. Wave 3 (Tasks 11–19) is mostly sequential with the approval hook (Task 15) as the only touch to existing code.

**What this does NOT build (Phase 2):**

- Real OpenClaw Gateway integration (placeholder only)
- Mock Gateway for integration testing (separate follow-up)
- Dashboard UI for session monitoring
- ToolEvent archival / retention policy
- `get_session_state` read tool for MCP
- Audit entry recording on session transitions
