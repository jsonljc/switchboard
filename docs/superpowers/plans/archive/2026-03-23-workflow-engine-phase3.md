# WorkflowEngine + PendingAction + Approvals — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-step workflow execution engine with structured PendingActions, a 9-state machine, safety envelopes, approval checkpoints, and API routes — enabling agents to propose, gate, and execute bounded multi-step business operations.

**Architecture:** Extends the existing session runtime (`packages/core/src/sessions/`) into a new `packages/core/src/workflows/` module. WorkflowEngine orchestrates multi-step plans; each step produces a PendingAction that flows through PolicyEngine for auto-execute/approval/reject. ApprovalCheckpoints pause workflows and notify operators. The existing `ActionExecutor` gains a new `executePendingAction` path. New Prisma models persist workflow state. API routes expose create/get/list/approve/reject/cancel operations.

**Tech Stack:** TypeScript (ESM), Zod, Prisma, Vitest, Fastify

---

## Scope Decisions

**Session runtime (`packages/core/src/sessions/`) is intentionally preserved.** The spec says the existing `SessionManager` "becomes `WorkflowEngine`," but the session runtime is still used by other code paths (session API routes, Prisma session models). Rather than a risky in-place rename/migration, Phase 3 creates new `workflows/` modules alongside `sessions/`. A future cleanup task can deprecate and remove the session runtime once all consumers migrate to workflows.

**Dashboard approval queue is a follow-up.** The existing approval UI (`apps/dashboard/src/app/approvals/`) uses the old `ApprovalRecord`/`ActionEnvelope` data model. Phase 3 creates the backend API for workflow checkpoints (`POST /api/workflows/checkpoints/:id/resolve`). Updating the dashboard pages to consume these new endpoints is a separate task that can proceed independently once the backend is stable.

**EventLoop → WorkflowEngine integration is deferred to Phase 4/5.** This plan builds WorkflowEngine as a standalone orchestrator callable via API routes and programmatic `createWorkflow()`. Wiring EventLoop events to automatically spawn workflows requires the SchedulerService (Phase 4) and OperatorCommand layer (Phase 5).

---

## File Structure

### New Files

| File                                                                   | Responsibility                                                                                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schemas/src/workflow.ts`                                     | Zod schemas: WorkflowStatus, PendingActionStatus, WorkflowExecution, WorkflowStep, PendingAction, WorkflowPlan, ApprovalCheckpoint, SafetyEnvelope (workflow variant) |
| `packages/core/src/workflows/workflow-state-machine.ts`                | 9-state transition table + validation                                                                                                                                 |
| `packages/core/src/workflows/pending-action.ts`                        | PendingAction factory, status transitions, helpers                                                                                                                    |
| `packages/core/src/workflows/store-interfaces.ts`                      | WorkflowStore, PendingActionStore persistence contracts                                                                                                               |
| `packages/core/src/workflows/step-executor.ts`                         | Execute one PendingAction through PolicyBridge + ActionExecutor                                                                                                       |
| `packages/core/src/workflows/approval-checkpoint.ts`                   | Checkpoint creation, resolution, expiry                                                                                                                               |
| `packages/core/src/workflows/workflow-plan.ts`                         | Plan creation, step tracking, re-plan validation                                                                                                                      |
| `packages/core/src/workflows/workflow-engine.ts`                       | Multi-step orchestrator: run plan, advance steps, handle pauses                                                                                                       |
| `packages/core/src/workflows/index.ts`                                 | Barrel exports                                                                                                                                                        |
| `packages/core/src/workflows/__tests__/workflow-state-machine.test.ts` | State machine tests                                                                                                                                                   |
| `packages/core/src/workflows/__tests__/pending-action.test.ts`         | PendingAction tests                                                                                                                                                   |
| `packages/core/src/workflows/__tests__/step-executor.test.ts`          | StepExecutor tests                                                                                                                                                    |
| `packages/core/src/workflows/__tests__/approval-checkpoint.test.ts`    | ApprovalCheckpoint tests                                                                                                                                              |
| `packages/core/src/workflows/__tests__/workflow-plan.test.ts`          | WorkflowPlan tests                                                                                                                                                    |
| `packages/core/src/workflows/__tests__/workflow-engine.test.ts`        | WorkflowEngine tests                                                                                                                                                  |
| `packages/core/src/workflows/__tests__/test-stores.ts`                 | In-memory store implementations for tests                                                                                                                             |
| `packages/db/src/stores/prisma-workflow-store.ts`                      | Prisma implementations of WorkflowStore + PendingActionStore                                                                                                          |
| `packages/db/src/stores/__tests__/prisma-workflow-store.test.ts`       | Prisma store tests (unit with mocked Prisma)                                                                                                                          |
| `apps/api/src/bootstrap/workflow-deps.ts`                              | WorkflowEngine dependency factory                                                                                                                                     |
| `apps/api/src/routes/workflows.ts`                                     | Workflow API routes                                                                                                                                                   |

### Modified Files

| File                                   | Change                                               |
| -------------------------------------- | ---------------------------------------------------- |
| `packages/schemas/src/index.ts`        | Add `export * from "./workflow.js"`                  |
| `packages/core/src/index.ts`           | Add `export * from "./workflows/index.js"`           |
| `packages/agents/src/policy-bridge.ts` | Extend `PolicyEvaluation` with `approvalLevel` field |
| `packages/agents/src/index.ts`         | Re-export updated PolicyEvaluation type              |
| `packages/db/prisma/schema.prisma`     | Add WorkflowExecution, PendingAction Prisma models   |
| `packages/db/src/index.ts`             | Export PrismaWorkflowStore                           |
| `apps/api/src/app.ts`                  | Register workflow routes                             |

---

## Sub-Phase Breakdown

The spec recommends splitting Phase 3 into 3a/3b/3c. This plan follows that structure:

- **3a (Tasks 1–6):** Schemas, state machine, PendingAction, store interfaces, StepExecutor, PolicyBridge enhancement
- **3b (Tasks 7–10):** ApprovalCheckpoint, WorkflowPlan, WorkflowEngine, in-memory test stores
- **3c (Tasks 11–14):** Prisma models + migration, PrismaWorkflowStore, API routes + bootstrap, barrel exports + wiring

---

## Task 1: Workflow Zod Schemas

**Files:**

- Create: `packages/schemas/src/workflow.ts`
- Modify: `packages/schemas/src/index.ts`

- [ ] **Step 1: Create workflow schema file with all types**

```typescript
// packages/schemas/src/workflow.ts
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const WorkflowStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "awaiting_event",
  "scheduled",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const TERMINAL_WORKFLOW_STATUSES: WorkflowStatus[] = ["completed", "failed", "cancelled"];

export const WorkflowTriggerTypeSchema = z.enum([
  "event",
  "schedule",
  "operator_command",
  "agent_initiated",
]);
export type WorkflowTriggerType = z.infer<typeof WorkflowTriggerTypeSchema>;

export const PendingActionStatusSchema = z.enum([
  "proposed",
  "approved",
  "executing",
  "completed",
  "failed",
  "rejected",
  "expired",
]);
export type PendingActionStatus = z.infer<typeof PendingActionStatusSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ApprovalTypeSchema = z.enum(["auto", "human_review", "operator_approval"]);
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

export const WorkflowStepStatusSchema = z.enum([
  "pending",
  "executing",
  "completed",
  "failed",
  "skipped",
]);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>;

export const ApprovalCheckpointStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "modified",
  "expired",
]);
export type ApprovalCheckpointStatus = z.infer<typeof ApprovalCheckpointStatusSchema>;

// ---------------------------------------------------------------------------
// Safety Envelope (workflow variant)
// ---------------------------------------------------------------------------

export const WorkflowSafetyEnvelopeSchema = z.object({
  maxSteps: z.number().int().positive(),
  maxDollarsAtRisk: z.number().nonnegative(),
  timeoutMs: z.number().int().positive(),
  maxReplans: z.number().int().nonnegative(),
});
export type WorkflowSafetyEnvelope = z.infer<typeof WorkflowSafetyEnvelopeSchema>;

// ---------------------------------------------------------------------------
// PendingAction
// ---------------------------------------------------------------------------

export const PendingActionSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  workflowId: z.string().uuid().nullable(),
  stepIndex: z.number().int().nonnegative().nullable(),
  status: PendingActionStatusSchema,

  // Intent
  intent: z.string().min(1),
  targetEntities: z.array(z.object({ type: z.string(), id: z.string() })),
  parameters: z.record(z.unknown()),
  humanSummary: z.string().min(1),

  // Risk assessment
  confidence: z.number().min(0).max(1),
  riskLevel: RiskLevelSchema,
  dollarsAtRisk: z.number().nonnegative(),
  requiredCapabilities: z.array(z.string()),
  dryRunSupported: z.boolean(),

  // Approval routing
  approvalRequired: ApprovalTypeSchema,
  fallback: z.object({ action: z.string(), reason: z.string() }).nullable(),

  // Source
  sourceAgent: z.string().min(1),
  sourceWorkflow: z.string().uuid().nullable(),
  organizationId: z.string().min(1),

  // Lifecycle
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  resolvedBy: z.string().nullable(),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

// ---------------------------------------------------------------------------
// WorkflowStep
// ---------------------------------------------------------------------------

export const WorkflowStepSchema = z.object({
  index: z.number().int().nonnegative(),
  actionId: z.string().uuid(),
  dependsOn: z.array(z.number().int().nonnegative()),
  status: WorkflowStepStatusSchema,
  result: z.record(z.unknown()).nullable(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

// ---------------------------------------------------------------------------
// WorkflowPlan
// ---------------------------------------------------------------------------

export const WorkflowPlanStrategySchema = z.enum(["sequential", "parallel_where_possible"]);

export const WorkflowPlanSchema = z.object({
  steps: z.array(WorkflowStepSchema),
  strategy: WorkflowPlanStrategySchema,
  replannedCount: z.number().int().nonnegative(),
});
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

// ---------------------------------------------------------------------------
// WorkflowExecution
// ---------------------------------------------------------------------------

export const WorkflowExecutionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  triggerType: WorkflowTriggerTypeSchema,
  triggerRef: z.string().nullable(),
  sourceAgent: z.string().nullable(),
  status: WorkflowStatusSchema,
  plan: WorkflowPlanSchema,
  currentStepIndex: z.number().int().nonnegative(),
  safetyEnvelope: WorkflowSafetyEnvelopeSchema,
  counters: z.object({
    stepsCompleted: z.number().int().nonnegative(),
    dollarsAtRisk: z.number().nonnegative(),
    replansUsed: z.number().int().nonnegative(),
  }),
  metadata: z.record(z.unknown()),
  traceId: z.string().min(1),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;

// ---------------------------------------------------------------------------
// ApprovalCheckpoint
// ---------------------------------------------------------------------------

export const ApprovalCheckpointSchema = z.object({
  id: z.string().uuid(),
  workflowId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  actionId: z.string().uuid(),
  reason: z.string().min(1),
  options: z.array(z.enum(["approve", "reject", "modify"])),
  modifiableFields: z.array(z.string()),
  alternatives: z.array(z.object({ label: z.string(), parameters: z.record(z.unknown()) })),
  notifyChannels: z.array(z.enum(["telegram", "whatsapp", "dashboard"])),
  status: ApprovalCheckpointStatusSchema,
  resolution: z
    .object({
      decidedBy: z.string(),
      decidedAt: z.coerce.date(),
      selectedAlternative: z.number().int().nonnegative().nullable(),
      fieldEdits: z.record(z.unknown()).nullable(),
    })
    .nullable(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});
export type ApprovalCheckpoint = z.infer<typeof ApprovalCheckpointSchema>;
```

- [ ] **Step 2: Export from schemas barrel**

Add to `packages/schemas/src/index.ts`:

```typescript
// Workflow runtime types (Phase 3)
export * from "./workflow.js";
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/schemas typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat(schemas): add workflow, PendingAction, and ApprovalCheckpoint Zod schemas
```

---

## Task 2: Workflow State Machine (9-state)

**Files:**

- Create: `packages/core/src/workflows/workflow-state-machine.ts`
- Create: `packages/core/src/workflows/__tests__/workflow-state-machine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/workflows/__tests__/workflow-state-machine.test.ts
import { describe, it, expect } from "vitest";
import {
  VALID_WORKFLOW_TRANSITIONS,
  canWorkflowTransition,
  validateWorkflowTransition,
  isTerminalStatus,
  WorkflowTransitionError,
} from "../workflow-state-machine.js";
import type { WorkflowStatus } from "@switchboard/schemas";

describe("WorkflowStateMachine", () => {
  describe("VALID_WORKFLOW_TRANSITIONS", () => {
    it("has entries for all 9 states", () => {
      const states: WorkflowStatus[] = [
        "pending",
        "running",
        "awaiting_approval",
        "awaiting_event",
        "scheduled",
        "blocked",
        "completed",
        "failed",
        "cancelled",
      ];
      for (const s of states) {
        expect(VALID_WORKFLOW_TRANSITIONS[s]).toBeDefined();
      }
    });

    it("terminal states have no outgoing transitions", () => {
      expect(VALID_WORKFLOW_TRANSITIONS.completed).toEqual([]);
      expect(VALID_WORKFLOW_TRANSITIONS.failed).toEqual([]);
      expect(VALID_WORKFLOW_TRANSITIONS.cancelled).toEqual([]);
    });
  });

  describe("canWorkflowTransition", () => {
    it("allows pending -> running", () => {
      expect(canWorkflowTransition("pending", "running")).toBe(true);
    });

    it("allows pending -> cancelled", () => {
      expect(canWorkflowTransition("pending", "cancelled")).toBe(true);
    });

    it("allows running -> awaiting_approval", () => {
      expect(canWorkflowTransition("running", "awaiting_approval")).toBe(true);
    });

    it("allows running -> awaiting_event", () => {
      expect(canWorkflowTransition("running", "awaiting_event")).toBe(true);
    });

    it("allows running -> scheduled", () => {
      expect(canWorkflowTransition("running", "scheduled")).toBe(true);
    });

    it("allows running -> blocked", () => {
      expect(canWorkflowTransition("running", "blocked")).toBe(true);
    });

    it("allows running -> completed", () => {
      expect(canWorkflowTransition("running", "completed")).toBe(true);
    });

    it("allows running -> failed", () => {
      expect(canWorkflowTransition("running", "failed")).toBe(true);
    });

    it("allows running -> cancelled", () => {
      expect(canWorkflowTransition("running", "cancelled")).toBe(true);
    });

    it("allows awaiting_approval -> running (approved)", () => {
      expect(canWorkflowTransition("awaiting_approval", "running")).toBe(true);
    });

    it("allows awaiting_approval -> cancelled (rejected)", () => {
      expect(canWorkflowTransition("awaiting_approval", "cancelled")).toBe(true);
    });

    it("allows awaiting_event -> running (event received)", () => {
      expect(canWorkflowTransition("awaiting_event", "running")).toBe(true);
    });

    it("allows awaiting_event -> failed (timeout)", () => {
      expect(canWorkflowTransition("awaiting_event", "failed")).toBe(true);
    });

    it("allows scheduled -> running (trigger fires)", () => {
      expect(canWorkflowTransition("scheduled", "running")).toBe(true);
    });

    it("allows scheduled -> cancelled", () => {
      expect(canWorkflowTransition("scheduled", "cancelled")).toBe(true);
    });

    it("allows blocked -> running (unblocked)", () => {
      expect(canWorkflowTransition("blocked", "running")).toBe(true);
    });

    it("allows blocked -> failed (timeout)", () => {
      expect(canWorkflowTransition("blocked", "failed")).toBe(true);
    });

    it("rejects completed -> running", () => {
      expect(canWorkflowTransition("completed", "running")).toBe(false);
    });

    it("rejects pending -> completed (must go through running)", () => {
      expect(canWorkflowTransition("pending", "completed")).toBe(false);
    });
  });

  describe("validateWorkflowTransition", () => {
    it("returns valid for allowed transition", () => {
      expect(validateWorkflowTransition("pending", "running")).toEqual({ valid: true });
    });

    it("returns reason for invalid transition", () => {
      const result = validateWorkflowTransition("completed", "running");
      expect(result).toHaveProperty("valid", false);
      expect(result).toHaveProperty("reason");
    });
  });

  describe("isTerminalStatus", () => {
    it("completed is terminal", () => {
      expect(isTerminalStatus("completed")).toBe(true);
    });

    it("failed is terminal", () => {
      expect(isTerminalStatus("failed")).toBe(true);
    });

    it("cancelled is terminal", () => {
      expect(isTerminalStatus("cancelled")).toBe(true);
    });

    it("running is not terminal", () => {
      expect(isTerminalStatus("running")).toBe(false);
    });

    it("pending is not terminal", () => {
      expect(isTerminalStatus("pending")).toBe(false);
    });
  });

  describe("WorkflowTransitionError", () => {
    it("includes from and to in message", () => {
      const err = new WorkflowTransitionError("pending", "completed");
      expect(err.message).toContain("pending");
      expect(err.message).toContain("completed");
      expect(err.from).toBe("pending");
      expect(err.to).toBe("completed");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- workflow-state-machine`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/workflows/workflow-state-machine.ts
import type { WorkflowStatus } from "@switchboard/schemas";
import { TERMINAL_WORKFLOW_STATUSES } from "@switchboard/schemas";

/**
 * 9-state workflow transition table.
 *
 * pending            → running, cancelled
 * running            → awaiting_approval, awaiting_event, scheduled, blocked, completed, failed, cancelled
 * awaiting_approval  → running (approved), cancelled (rejected)
 * awaiting_event     → running (event received), failed (timeout)
 * scheduled          → running (trigger fires), cancelled
 * blocked            → running (unblocked), failed (timeout)
 * completed          → (terminal)
 * failed             → (terminal)
 * cancelled          → (terminal)
 */
export const VALID_WORKFLOW_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  pending: ["running", "cancelled"],
  running: [
    "awaiting_approval",
    "awaiting_event",
    "scheduled",
    "blocked",
    "completed",
    "failed",
    "cancelled",
  ],
  awaiting_approval: ["running", "cancelled"],
  awaiting_event: ["running", "failed"],
  scheduled: ["running", "cancelled"],
  blocked: ["running", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class WorkflowTransitionError extends Error {
  constructor(
    public readonly from: WorkflowStatus,
    public readonly to: WorkflowStatus,
  ) {
    super(
      `Invalid workflow transition: cannot move from '${from}' to '${to}'. ` +
        `Valid transitions from '${from}': [${VALID_WORKFLOW_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
    );
    this.name = "WorkflowTransitionError";
  }
}

export function canWorkflowTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return VALID_WORKFLOW_TRANSITIONS[from].includes(to);
}

export function validateWorkflowTransition(
  from: WorkflowStatus,
  to: WorkflowStatus,
): { valid: true } | { valid: false; reason: string } {
  if (canWorkflowTransition(from, to)) {
    return { valid: true };
  }
  return {
    valid: false,
    reason:
      `Cannot transition from '${from}' to '${to}'. ` +
      `Valid transitions from '${from}': [${VALID_WORKFLOW_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
  };
}

export function isTerminalStatus(status: WorkflowStatus): boolean {
  return TERMINAL_WORKFLOW_STATUSES.includes(status);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- workflow-state-machine`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add 9-state workflow state machine
```

---

## Task 3: PendingAction Helpers

**Files:**

- Create: `packages/core/src/workflows/pending-action.ts`
- Create: `packages/core/src/workflows/__tests__/pending-action.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/workflows/__tests__/pending-action.test.ts
import { describe, it, expect } from "vitest";
import {
  createPendingAction,
  canActionTransition,
  VALID_ACTION_TRANSITIONS,
  PendingActionTransitionError,
} from "../pending-action.js";
import type { PendingActionStatus } from "@switchboard/schemas";

describe("PendingAction", () => {
  describe("createPendingAction", () => {
    it("creates action with proposed status", () => {
      const action = createPendingAction({
        intent: "pause_campaign",
        targetEntities: [{ type: "campaign", id: "camp-1" }],
        parameters: { reason: "low ROAS" },
        humanSummary: "Pause campaign 'Summer Sale' — ROAS dropped below 2.0",
        confidence: 0.85,
        riskLevel: "medium",
        dollarsAtRisk: 500,
        requiredCapabilities: ["ads.campaign.pause"],
        dryRunSupported: true,
        approvalRequired: "auto",
        sourceAgent: "ad-optimizer",
        organizationId: "org-1",
      });

      expect(action.status).toBe("proposed");
      expect(action.id).toBeTruthy();
      expect(action.idempotencyKey).toBeTruthy();
      expect(action.intent).toBe("pause_campaign");
      expect(action.workflowId).toBeNull();
      expect(action.stepIndex).toBeNull();
      expect(action.fallback).toBeNull();
      expect(action.sourceWorkflow).toBeNull();
      expect(action.resolvedAt).toBeNull();
      expect(action.resolvedBy).toBeNull();
      expect(action.expiresAt).toBeNull();
    });

    it("accepts optional workflowId and stepIndex", () => {
      const action = createPendingAction({
        intent: "send_follow_up",
        targetEntities: [],
        parameters: {},
        humanSummary: "Send follow-up to lead",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: [],
        dryRunSupported: false,
        approvalRequired: "auto",
        sourceAgent: "lead-responder",
        organizationId: "org-1",
        workflowId: "wf-123",
        stepIndex: 0,
      });

      expect(action.workflowId).toBe("wf-123");
      expect(action.stepIndex).toBe(0);
    });
  });

  describe("VALID_ACTION_TRANSITIONS", () => {
    it("proposed can transition to approved, rejected, expired", () => {
      expect(VALID_ACTION_TRANSITIONS.proposed).toContain("approved");
      expect(VALID_ACTION_TRANSITIONS.proposed).toContain("rejected");
      expect(VALID_ACTION_TRANSITIONS.proposed).toContain("expired");
    });

    it("approved can transition to executing", () => {
      expect(VALID_ACTION_TRANSITIONS.approved).toContain("executing");
    });

    it("executing can transition to completed or failed", () => {
      expect(VALID_ACTION_TRANSITIONS.executing).toContain("completed");
      expect(VALID_ACTION_TRANSITIONS.executing).toContain("failed");
    });

    it("completed is terminal", () => {
      expect(VALID_ACTION_TRANSITIONS.completed).toEqual([]);
    });
  });

  describe("canActionTransition", () => {
    it("allows proposed -> approved", () => {
      expect(canActionTransition("proposed", "approved")).toBe(true);
    });

    it("rejects proposed -> completed", () => {
      expect(canActionTransition("proposed", "completed")).toBe(false);
    });

    it("rejects completed -> proposed", () => {
      expect(canActionTransition("completed", "proposed")).toBe(false);
    });
  });

  describe("PendingActionTransitionError", () => {
    it("includes from and to in message", () => {
      const err = new PendingActionTransitionError("completed", "proposed");
      expect(err.message).toContain("completed");
      expect(err.message).toContain("proposed");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- pending-action`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/workflows/pending-action.ts
import { randomUUID } from "node:crypto";
import type {
  PendingAction,
  PendingActionStatus,
  RiskLevel,
  ApprovalType,
} from "@switchboard/schemas";

export interface CreatePendingActionInput {
  intent: string;
  targetEntities: Array<{ type: string; id: string }>;
  parameters: Record<string, unknown>;
  humanSummary: string;
  confidence: number;
  riskLevel: RiskLevel;
  dollarsAtRisk: number;
  requiredCapabilities: string[];
  dryRunSupported: boolean;
  approvalRequired: ApprovalType;
  sourceAgent: string;
  organizationId: string;
  workflowId?: string;
  stepIndex?: number;
  sourceWorkflow?: string;
  expiresAt?: Date;
  fallback?: { action: string; reason: string };
}

export function createPendingAction(input: CreatePendingActionInput): PendingAction {
  return {
    id: randomUUID(),
    idempotencyKey: `${input.sourceAgent}:${input.intent}:${randomUUID()}`,
    workflowId: input.workflowId ?? null,
    stepIndex: input.stepIndex ?? null,
    status: "proposed",
    intent: input.intent,
    targetEntities: input.targetEntities,
    parameters: input.parameters,
    humanSummary: input.humanSummary,
    confidence: input.confidence,
    riskLevel: input.riskLevel,
    dollarsAtRisk: input.dollarsAtRisk,
    requiredCapabilities: input.requiredCapabilities,
    dryRunSupported: input.dryRunSupported,
    approvalRequired: input.approvalRequired,
    fallback: input.fallback ?? null,
    sourceAgent: input.sourceAgent,
    sourceWorkflow: input.sourceWorkflow ?? null,
    organizationId: input.organizationId,
    createdAt: new Date(),
    expiresAt: input.expiresAt ?? null,
    resolvedAt: null,
    resolvedBy: null,
  };
}

export const VALID_ACTION_TRANSITIONS: Record<PendingActionStatus, PendingActionStatus[]> = {
  proposed: ["approved", "rejected", "expired"],
  approved: ["executing"],
  executing: ["completed", "failed"],
  completed: [],
  failed: [],
  rejected: [],
  expired: [],
};

export function canActionTransition(from: PendingActionStatus, to: PendingActionStatus): boolean {
  return VALID_ACTION_TRANSITIONS[from].includes(to);
}

export class PendingActionTransitionError extends Error {
  constructor(
    public readonly from: PendingActionStatus,
    public readonly to: PendingActionStatus,
  ) {
    super(
      `Invalid action transition: cannot move from '${from}' to '${to}'. ` +
        `Valid transitions from '${from}': [${VALID_ACTION_TRANSITIONS[from].join(", ") || "none (terminal)"}]`,
    );
    this.name = "PendingActionTransitionError";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- pending-action`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add PendingAction factory and status transitions
```

---

## Task 4: Store Interfaces + In-Memory Test Stores

**Files:**

- Create: `packages/core/src/workflows/store-interfaces.ts`
- Create: `packages/core/src/workflows/__tests__/test-stores.ts`

- [ ] **Step 1: Write store interfaces**

```typescript
// packages/core/src/workflows/store-interfaces.ts
import type {
  WorkflowExecution,
  WorkflowStatus,
  PendingAction,
  PendingActionStatus,
  ApprovalCheckpoint,
  ApprovalCheckpointStatus,
} from "@switchboard/schemas";

export interface WorkflowStore {
  create(workflow: WorkflowExecution): Promise<void>;
  getById(id: string): Promise<WorkflowExecution | null>;
  update(id: string, updates: Partial<WorkflowExecution>): Promise<void>;
  list(filter: {
    organizationId?: string;
    status?: WorkflowStatus;
    sourceAgent?: string;
    limit?: number;
  }): Promise<WorkflowExecution[]>;
}

export interface PendingActionStore {
  create(action: PendingAction): Promise<void>;
  getById(id: string): Promise<PendingAction | null>;
  update(id: string, updates: Partial<PendingAction>): Promise<void>;
  listByWorkflow(workflowId: string): Promise<PendingAction[]>;
  listByStatus(
    organizationId: string,
    status: PendingActionStatus,
    limit?: number,
  ): Promise<PendingAction[]>;
}

export interface ApprovalCheckpointStore {
  create(checkpoint: ApprovalCheckpoint): Promise<void>;
  getById(id: string): Promise<ApprovalCheckpoint | null>;
  getByWorkflowAndStep(workflowId: string, stepIndex: number): Promise<ApprovalCheckpoint | null>;
  update(id: string, updates: Partial<ApprovalCheckpoint>): Promise<void>;
  listPending(organizationId: string): Promise<ApprovalCheckpoint[]>;
}
```

- [ ] **Step 2: Write in-memory test stores**

```typescript
// packages/core/src/workflows/__tests__/test-stores.ts
import type {
  WorkflowExecution,
  WorkflowStatus,
  PendingAction,
  PendingActionStatus,
  ApprovalCheckpoint,
} from "@switchboard/schemas";
import type {
  WorkflowStore,
  PendingActionStore,
  ApprovalCheckpointStore,
} from "../store-interfaces.js";

export class InMemoryWorkflowStore implements WorkflowStore {
  readonly items = new Map<string, WorkflowExecution>();

  async create(workflow: WorkflowExecution): Promise<void> {
    this.items.set(workflow.id, { ...workflow });
  }

  async getById(id: string): Promise<WorkflowExecution | null> {
    const w = this.items.get(id);
    return w ? { ...w } : null;
  }

  async update(id: string, updates: Partial<WorkflowExecution>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Workflow ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async list(filter: {
    organizationId?: string;
    status?: WorkflowStatus;
    sourceAgent?: string;
    limit?: number;
  }): Promise<WorkflowExecution[]> {
    let results = [...this.items.values()];
    if (filter.organizationId)
      results = results.filter((w) => w.organizationId === filter.organizationId);
    if (filter.status) results = results.filter((w) => w.status === filter.status);
    if (filter.sourceAgent) results = results.filter((w) => w.sourceAgent === filter.sourceAgent);
    if (filter.limit) results = results.slice(0, filter.limit);
    return results;
  }
}

export class InMemoryPendingActionStore implements PendingActionStore {
  readonly items = new Map<string, PendingAction>();

  async create(action: PendingAction): Promise<void> {
    this.items.set(action.id, { ...action });
  }

  async getById(id: string): Promise<PendingAction | null> {
    const a = this.items.get(id);
    return a ? { ...a } : null;
  }

  async update(id: string, updates: Partial<PendingAction>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`PendingAction ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async listByWorkflow(workflowId: string): Promise<PendingAction[]> {
    return [...this.items.values()].filter((a) => a.workflowId === workflowId);
  }

  async listByStatus(
    organizationId: string,
    status: PendingActionStatus,
    limit?: number,
  ): Promise<PendingAction[]> {
    let results = [...this.items.values()].filter(
      (a) => a.organizationId === organizationId && a.status === status,
    );
    if (limit) results = results.slice(0, limit);
    return results;
  }
}

export class InMemoryApprovalCheckpointStore implements ApprovalCheckpointStore {
  readonly items = new Map<string, ApprovalCheckpoint>();

  async create(checkpoint: ApprovalCheckpoint): Promise<void> {
    this.items.set(checkpoint.id, { ...checkpoint });
  }

  async getById(id: string): Promise<ApprovalCheckpoint | null> {
    const c = this.items.get(id);
    return c ? { ...c } : null;
  }

  async getByWorkflowAndStep(
    workflowId: string,
    stepIndex: number,
  ): Promise<ApprovalCheckpoint | null> {
    const c = [...this.items.values()].find(
      (c) => c.workflowId === workflowId && c.stepIndex === stepIndex,
    );
    return c ? { ...c } : null;
  }

  async update(id: string, updates: Partial<ApprovalCheckpoint>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Checkpoint ${id} not found`);
    this.items.set(id, { ...existing, ...updates });
  }

  async listPending(organizationId: string): Promise<ApprovalCheckpoint[]> {
    return [...this.items.values()].filter((c) => {
      if (c.status !== "pending") return false;
      // Filter by org — look up the workflow to find its orgId
      // In tests, this store is used alongside InMemoryWorkflowStore which can be checked.
      // For simplicity, the in-memory store does not cross-reference workflow orgId.
      // The Prisma store uses a proper JOIN. This is acceptable for unit tests.
      return true;
    });
  }
}

export interface TestWorkflowStores {
  workflows: InMemoryWorkflowStore;
  actions: InMemoryPendingActionStore;
  checkpoints: InMemoryApprovalCheckpointStore;
}

export function createTestWorkflowStores(): TestWorkflowStores {
  return {
    workflows: new InMemoryWorkflowStore(),
    actions: new InMemoryPendingActionStore(),
    checkpoints: new InMemoryApprovalCheckpointStore(),
  };
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat(core): add workflow store interfaces and in-memory test stores
```

---

## Task 5: StepExecutor

**Files:**

- Create: `packages/core/src/workflows/step-executor.ts`
- Create: `packages/core/src/workflows/__tests__/step-executor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/workflows/__tests__/step-executor.test.ts
import { describe, it, expect, vi } from "vitest";
import { StepExecutor } from "../step-executor.js";
import type { PendingAction } from "@switchboard/schemas";
import { createPendingAction } from "../pending-action.js";
import { InMemoryPendingActionStore } from "./test-stores.js";

function makeAction(
  overrides: Partial<Parameters<typeof createPendingAction>[0]> = {},
): PendingAction {
  return createPendingAction({
    intent: "test_action",
    targetEntities: [],
    parameters: { key: "value" },
    humanSummary: "Test action",
    confidence: 0.9,
    riskLevel: "low",
    dollarsAtRisk: 0,
    requiredCapabilities: [],
    dryRunSupported: false,
    approvalRequired: "auto",
    sourceAgent: "test-agent",
    organizationId: "org-1",
    ...overrides,
  });
}

describe("StepExecutor", () => {
  it("auto-executes low-risk action when policy approves", async () => {
    const actionStore = new InMemoryPendingActionStore();
    const action = makeAction();
    await actionStore.create(action);

    const policyBridge = {
      evaluate: vi.fn().mockResolvedValue({ approved: true }),
    };
    const actionExecutor = {
      execute: vi.fn().mockResolvedValue({
        actionType: action.intent,
        success: true,
        blockedByPolicy: false,
        result: { ok: true },
      }),
    };

    const executor = new StepExecutor({ actionStore, policyBridge, actionExecutor });
    const result = await executor.execute(action, { organizationId: "org-1" });

    expect(result.outcome).toBe("completed");
    expect(result.result).toEqual({ ok: true });

    const updated = await actionStore.getById(action.id);
    expect(updated!.status).toBe("completed");
    expect(updated!.resolvedBy).toBe("auto");
  });

  it("returns requires_approval when policy says requiresApproval", async () => {
    const actionStore = new InMemoryPendingActionStore();
    const action = makeAction({ approvalRequired: "human_review", riskLevel: "high" });
    await actionStore.create(action);

    const policyBridge = {
      evaluate: vi.fn().mockResolvedValue({
        approved: false,
        requiresApproval: true,
        reason: "high risk action",
      }),
    };
    const actionExecutor = { execute: vi.fn() };

    const executor = new StepExecutor({ actionStore, policyBridge, actionExecutor });
    const result = await executor.execute(action, { organizationId: "org-1" });

    expect(result.outcome).toBe("requires_approval");
    expect(result.reason).toBe("high risk action");
    expect(actionExecutor.execute).not.toHaveBeenCalled();
  });

  it("returns rejected when policy denies", async () => {
    const actionStore = new InMemoryPendingActionStore();
    const action = makeAction();
    await actionStore.create(action);

    const policyBridge = {
      evaluate: vi.fn().mockResolvedValue({
        approved: false,
        reason: "forbidden behavior",
      }),
    };
    const actionExecutor = { execute: vi.fn() };

    const executor = new StepExecutor({ actionStore, policyBridge, actionExecutor });
    const result = await executor.execute(action, { organizationId: "org-1" });

    expect(result.outcome).toBe("rejected");

    const updated = await actionStore.getById(action.id);
    expect(updated!.status).toBe("rejected");
  });

  it("handles execution failure", async () => {
    const actionStore = new InMemoryPendingActionStore();
    const action = makeAction();
    await actionStore.create(action);

    const policyBridge = {
      evaluate: vi.fn().mockResolvedValue({ approved: true }),
    };
    const actionExecutor = {
      execute: vi.fn().mockResolvedValue({
        actionType: action.intent,
        success: false,
        blockedByPolicy: false,
        error: "API timeout",
      }),
    };

    const executor = new StepExecutor({ actionStore, policyBridge, actionExecutor });
    const result = await executor.execute(action, { organizationId: "org-1" });

    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("API timeout");

    const updated = await actionStore.getById(action.id);
    expect(updated!.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- step-executor`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/workflows/step-executor.ts
import type { PendingAction } from "@switchboard/schemas";
import type { PendingActionStore } from "./store-interfaces.js";

export interface StepExecutorPolicyBridge {
  evaluate(intent: {
    eventId: string;
    destinationType: string;
    destinationId: string;
    action: string;
    payload: unknown;
    criticality: string;
  }): Promise<{ approved: boolean; requiresApproval?: boolean; reason?: string }>;
}

/**
 * Matches AgentContext from packages/agents/src/ports.ts.
 * Structural typing — no cross-layer import from agents into core.
 */
export interface StepExecutorContext {
  organizationId: string;
  profile?: Record<string, unknown>;
  conversationHistory?: Array<{ role: string; content: string }>;
  contactData?: Record<string, unknown>;
}

export interface StepExecutorActionExecutor {
  execute(
    action: { actionType: string; parameters: Record<string, unknown> },
    context: StepExecutorContext,
    policyBridge: StepExecutorPolicyBridge,
  ): Promise<{
    actionType: string;
    success: boolean;
    blockedByPolicy: boolean;
    result?: unknown;
    error?: string;
  }>;
}

export interface StepExecutorDeps {
  actionStore: PendingActionStore;
  policyBridge: StepExecutorPolicyBridge;
  actionExecutor: StepExecutorActionExecutor;
}

export type StepExecutionOutcome = "completed" | "failed" | "rejected" | "requires_approval";

export interface StepExecutionResult {
  outcome: StepExecutionOutcome;
  result?: unknown;
  error?: string;
  reason?: string;
}

export class StepExecutor {
  private readonly deps: StepExecutorDeps;

  constructor(deps: StepExecutorDeps) {
    this.deps = deps;
  }

  async execute(action: PendingAction, context: StepExecutorContext): Promise<StepExecutionResult> {
    // 1. Policy check
    const evaluation = await this.deps.policyBridge.evaluate({
      eventId: `action-${action.id}`,
      destinationType: "system",
      destinationId: action.intent,
      action: action.intent,
      payload: action.parameters,
      criticality: "required",
    });

    if (!evaluation.approved) {
      if (evaluation.requiresApproval) {
        return { outcome: "requires_approval", reason: evaluation.reason };
      }

      // Hard reject
      await this.deps.actionStore.update(action.id, {
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: "policy_engine",
      });
      return { outcome: "rejected", reason: evaluation.reason };
    }

    // 2. Mark as executing
    await this.deps.actionStore.update(action.id, { status: "approved" });
    await this.deps.actionStore.update(action.id, { status: "executing" });

    // 3. Execute via ActionExecutor (bypasses policy — already checked)
    const execResult = await this.deps.actionExecutor.execute(
      { actionType: action.intent, parameters: action.parameters },
      context,
      // Pass a passthrough policy bridge since we already evaluated
      { evaluate: async () => ({ approved: true }) },
    );

    if (execResult.success) {
      await this.deps.actionStore.update(action.id, {
        status: "completed",
        resolvedAt: new Date(),
        resolvedBy: "auto",
      });
      return { outcome: "completed", result: execResult.result };
    }

    await this.deps.actionStore.update(action.id, {
      status: "failed",
      resolvedAt: new Date(),
      resolvedBy: "auto",
    });
    return { outcome: "failed", error: execResult.error };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- step-executor`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add StepExecutor for PendingAction execution through PolicyEngine
```

---

## Task 6: PolicyBridge Enhancement

**Files:**

- Modify: `packages/agents/src/policy-bridge.ts`

- [ ] **Step 1: Add approvalLevel to PolicyEvaluation**

In `packages/agents/src/policy-bridge.ts`, update the `PolicyEvaluation` interface:

```typescript
export interface PolicyEvaluation {
  approved: boolean;
  requiresApproval?: boolean;
  /** Granular approval level when requiresApproval is true */
  approvalLevel?: "standard" | "elevated" | "mandatory";
  reason?: string;
}
```

Update `evaluate()` method to propagate approval level from the engine result:

```typescript
async evaluate(intent: DeliveryIntent): Promise<PolicyEvaluation> {
  if (!this.engine) {
    return { approved: true };
  }

  let result: { effect: string; reason?: string; approvalLevel?: string };
  try {
    result = await this.engine.evaluate(intent);
  } catch {
    return { approved: false, reason: "policy_engine_error" };
  }

  if (result.effect === "allow") {
    return { approved: true };
  }

  if (result.effect === "require_approval") {
    return {
      approved: false,
      requiresApproval: true,
      approvalLevel: (result.approvalLevel as PolicyEvaluation["approvalLevel"]) ?? "standard",
      reason: result.reason,
    };
  }

  return { approved: false, reason: result.reason };
}
```

Also update the `PolicyEngine` interface to include the optional `approvalLevel` in the return type:

```typescript
export interface PolicyEngine {
  evaluate(intent: DeliveryIntent): Promise<{
    effect: string;
    reason?: string;
    approvalLevel?: string;
  }>;
}
```

- [ ] **Step 2: Run existing policy-bridge tests**

Run: `pnpm --filter @switchboard/agents test -- policy-bridge`
Expected: PASS (additive change, existing tests should pass)

- [ ] **Step 3: Run full agents typecheck**

Run: `pnpm --filter @switchboard/agents typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat(agents): extend PolicyEvaluation with approvalLevel field
```

---

## Task 7: ApprovalCheckpoint

**Files:**

- Create: `packages/core/src/workflows/approval-checkpoint.ts`
- Create: `packages/core/src/workflows/__tests__/approval-checkpoint.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/workflows/__tests__/approval-checkpoint.test.ts
import { describe, it, expect } from "vitest";
import {
  createApprovalCheckpoint,
  resolveCheckpoint,
  isCheckpointExpired,
} from "../approval-checkpoint.js";
import type { PendingAction } from "@switchboard/schemas";
import { createPendingAction } from "../pending-action.js";
import { InMemoryApprovalCheckpointStore } from "./test-stores.js";

function makeAction(): PendingAction {
  return createPendingAction({
    intent: "pause_campaign",
    targetEntities: [{ type: "campaign", id: "camp-1" }],
    parameters: {},
    humanSummary: "Pause campaign",
    confidence: 0.8,
    riskLevel: "high",
    dollarsAtRisk: 1000,
    requiredCapabilities: ["ads.campaign.pause"],
    dryRunSupported: false,
    approvalRequired: "operator_approval",
    sourceAgent: "ad-optimizer",
    organizationId: "org-1",
    workflowId: "wf-1",
    stepIndex: 0,
  });
}

describe("ApprovalCheckpoint", () => {
  describe("createApprovalCheckpoint", () => {
    it("creates a pending checkpoint", () => {
      const action = makeAction();
      const checkpoint = createApprovalCheckpoint({
        workflowId: "wf-1",
        stepIndex: 0,
        action,
        reason: "Budget change exceeds $500",
        ttlMs: 3600_000,
      });

      expect(checkpoint.status).toBe("pending");
      expect(checkpoint.workflowId).toBe("wf-1");
      expect(checkpoint.stepIndex).toBe(0);
      expect(checkpoint.actionId).toBe(action.id);
      expect(checkpoint.reason).toBe("Budget change exceeds $500");
      expect(checkpoint.options).toEqual(["approve", "reject"]);
      expect(checkpoint.resolution).toBeNull();
      expect(checkpoint.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("includes modify option when modifiableFields provided", () => {
      const action = makeAction();
      const checkpoint = createApprovalCheckpoint({
        workflowId: "wf-1",
        stepIndex: 0,
        action,
        reason: "Review budget",
        ttlMs: 3600_000,
        modifiableFields: ["parameters.budget"],
      });

      expect(checkpoint.options).toContain("modify");
      expect(checkpoint.modifiableFields).toEqual(["parameters.budget"]);
    });
  });

  describe("resolveCheckpoint", () => {
    it("approves a pending checkpoint", async () => {
      const store = new InMemoryApprovalCheckpointStore();
      const action = makeAction();
      const checkpoint = createApprovalCheckpoint({
        workflowId: "wf-1",
        stepIndex: 0,
        action,
        reason: "test",
        ttlMs: 3600_000,
      });
      await store.create(checkpoint);

      await resolveCheckpoint(store, checkpoint.id, {
        decidedBy: "operator:user-1",
        action: "approve",
      });

      const updated = await store.getById(checkpoint.id);
      expect(updated!.status).toBe("approved");
      expect(updated!.resolution!.decidedBy).toBe("operator:user-1");
    });

    it("rejects a pending checkpoint", async () => {
      const store = new InMemoryApprovalCheckpointStore();
      const action = makeAction();
      const checkpoint = createApprovalCheckpoint({
        workflowId: "wf-1",
        stepIndex: 0,
        action,
        reason: "test",
        ttlMs: 3600_000,
      });
      await store.create(checkpoint);

      await resolveCheckpoint(store, checkpoint.id, {
        decidedBy: "operator:user-1",
        action: "reject",
      });

      const updated = await store.getById(checkpoint.id);
      expect(updated!.status).toBe("rejected");
    });

    it("throws on already-resolved checkpoint", async () => {
      const store = new InMemoryApprovalCheckpointStore();
      const action = makeAction();
      const checkpoint = createApprovalCheckpoint({
        workflowId: "wf-1",
        stepIndex: 0,
        action,
        reason: "test",
        ttlMs: 3600_000,
      });
      await store.create(checkpoint);

      await resolveCheckpoint(store, checkpoint.id, {
        decidedBy: "op:1",
        action: "approve",
      });

      await expect(
        resolveCheckpoint(store, checkpoint.id, {
          decidedBy: "op:2",
          action: "reject",
        }),
      ).rejects.toThrow("already resolved");
    });
  });

  describe("isCheckpointExpired", () => {
    it("returns false when not expired", () => {
      const action = makeAction();
      const checkpoint = createApprovalCheckpoint({
        workflowId: "wf-1",
        stepIndex: 0,
        action,
        reason: "test",
        ttlMs: 3600_000,
      });
      expect(isCheckpointExpired(checkpoint)).toBe(false);
    });

    it("returns true when expired", () => {
      const action = makeAction();
      const checkpoint = createApprovalCheckpoint({
        workflowId: "wf-1",
        stepIndex: 0,
        action,
        reason: "test",
        ttlMs: -1000, // already expired
      });
      expect(isCheckpointExpired(checkpoint)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- approval-checkpoint`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/workflows/approval-checkpoint.ts
import { randomUUID } from "node:crypto";
import type { ApprovalCheckpoint, PendingAction } from "@switchboard/schemas";
import type { ApprovalCheckpointStore } from "./store-interfaces.js";

export interface CreateCheckpointInput {
  workflowId: string;
  stepIndex: number;
  action: PendingAction;
  reason: string;
  ttlMs: number;
  modifiableFields?: string[];
  alternatives?: Array<{ label: string; parameters: Record<string, unknown> }>;
  notifyChannels?: Array<"telegram" | "whatsapp" | "dashboard">;
}

export function createApprovalCheckpoint(input: CreateCheckpointInput): ApprovalCheckpoint {
  const now = new Date();
  const options: Array<"approve" | "reject" | "modify"> = ["approve", "reject"];
  if (input.modifiableFields && input.modifiableFields.length > 0) {
    options.push("modify");
  }

  return {
    id: randomUUID(),
    workflowId: input.workflowId,
    stepIndex: input.stepIndex,
    actionId: input.action.id,
    reason: input.reason,
    options,
    modifiableFields: input.modifiableFields ?? [],
    alternatives: input.alternatives ?? [],
    notifyChannels: input.notifyChannels ?? ["dashboard"],
    status: "pending",
    resolution: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + input.ttlMs),
  };
}

export interface ResolveInput {
  decidedBy: string;
  action: "approve" | "reject" | "modify";
  selectedAlternative?: number;
  fieldEdits?: Record<string, unknown>;
}

export async function resolveCheckpoint(
  store: ApprovalCheckpointStore,
  checkpointId: string,
  input: ResolveInput,
): Promise<void> {
  const checkpoint = await store.getById(checkpointId);
  if (!checkpoint) {
    throw new Error(`Checkpoint ${checkpointId} not found`);
  }
  if (checkpoint.status !== "pending") {
    throw new Error(
      `Checkpoint ${checkpointId} is already resolved (status: ${checkpoint.status})`,
    );
  }

  const statusMap: Record<string, ApprovalCheckpoint["status"]> = {
    approve: "approved",
    reject: "rejected",
    modify: "modified",
  };

  await store.update(checkpointId, {
    status: statusMap[input.action],
    resolution: {
      decidedBy: input.decidedBy,
      decidedAt: new Date(),
      selectedAlternative: input.selectedAlternative ?? null,
      fieldEdits: input.fieldEdits ?? null,
    },
  });
}

export function isCheckpointExpired(checkpoint: ApprovalCheckpoint, now?: Date): boolean {
  return (now ?? new Date()).getTime() >= checkpoint.expiresAt.getTime();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- approval-checkpoint`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add ApprovalCheckpoint creation, resolution, and expiry
```

---

## Task 8: WorkflowPlan

**Files:**

- Create: `packages/core/src/workflows/workflow-plan.ts`
- Create: `packages/core/src/workflows/__tests__/workflow-plan.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/workflows/__tests__/workflow-plan.test.ts
import { describe, it, expect } from "vitest";
import { createWorkflowPlan, advanceStep, canReplan } from "../workflow-plan.js";
import { createPendingAction } from "../pending-action.js";

describe("WorkflowPlan", () => {
  describe("createWorkflowPlan", () => {
    it("creates a sequential plan with pending steps", () => {
      const actions = [
        createPendingAction({
          intent: "step1",
          targetEntities: [],
          parameters: {},
          humanSummary: "Step 1",
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          dryRunSupported: false,
          approvalRequired: "auto",
          sourceAgent: "test",
          organizationId: "org-1",
        }),
        createPendingAction({
          intent: "step2",
          targetEntities: [],
          parameters: {},
          humanSummary: "Step 2",
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          dryRunSupported: false,
          approvalRequired: "auto",
          sourceAgent: "test",
          organizationId: "org-1",
        }),
      ];

      const plan = createWorkflowPlan(actions, "sequential");

      expect(plan.steps).toHaveLength(2);
      expect(plan.strategy).toBe("sequential");
      expect(plan.replannedCount).toBe(0);
      expect(plan.steps[0].index).toBe(0);
      expect(plan.steps[0].status).toBe("pending");
      expect(plan.steps[0].dependsOn).toEqual([]);
      expect(plan.steps[1].index).toBe(1);
      expect(plan.steps[1].dependsOn).toEqual([0]);
    });

    it("creates parallel plan with no dependencies", () => {
      const actions = [
        createPendingAction({
          intent: "a",
          targetEntities: [],
          parameters: {},
          humanSummary: "A",
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          dryRunSupported: false,
          approvalRequired: "auto",
          sourceAgent: "test",
          organizationId: "org-1",
        }),
      ];

      const plan = createWorkflowPlan(actions, "parallel_where_possible");
      expect(plan.steps[0].dependsOn).toEqual([]);
    });

    it("enforces max 3 steps", () => {
      const actions = Array.from({ length: 5 }, (_, i) =>
        createPendingAction({
          intent: `step${i}`,
          targetEntities: [],
          parameters: {},
          humanSummary: `Step ${i}`,
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          dryRunSupported: false,
          approvalRequired: "auto",
          sourceAgent: "test",
          organizationId: "org-1",
        }),
      );

      expect(() => createWorkflowPlan(actions, "sequential")).toThrow("1-3 steps");
    });
  });

  describe("advanceStep", () => {
    it("marks step as completed", () => {
      const actions = [
        createPendingAction({
          intent: "step1",
          targetEntities: [],
          parameters: {},
          humanSummary: "Step 1",
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          dryRunSupported: false,
          approvalRequired: "auto",
          sourceAgent: "test",
          organizationId: "org-1",
        }),
      ];
      const plan = createWorkflowPlan(actions, "sequential");
      const updated = advanceStep(plan, 0, "completed", { data: "result" });

      expect(updated.steps[0].status).toBe("completed");
      expect(updated.steps[0].result).toEqual({ data: "result" });
    });

    it("marks step as failed", () => {
      const actions = [
        createPendingAction({
          intent: "step1",
          targetEntities: [],
          parameters: {},
          humanSummary: "Step 1",
          confidence: 0.9,
          riskLevel: "low",
          dollarsAtRisk: 0,
          requiredCapabilities: [],
          dryRunSupported: false,
          approvalRequired: "auto",
          sourceAgent: "test",
          organizationId: "org-1",
        }),
      ];
      const plan = createWorkflowPlan(actions, "sequential");
      const updated = advanceStep(plan, 0, "failed", { error: "timeout" });

      expect(updated.steps[0].status).toBe("failed");
    });
  });

  describe("canReplan", () => {
    it("returns true when under maxReplans", () => {
      expect(canReplan(0, 3)).toBe(true);
    });

    it("returns false when at maxReplans", () => {
      expect(canReplan(3, 3)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- workflow-plan`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/workflows/workflow-plan.ts
import type {
  WorkflowPlan,
  WorkflowStep,
  WorkflowStepStatus,
  PendingAction,
} from "@switchboard/schemas";

const MAX_PLAN_STEPS = 3;

export function createWorkflowPlan(
  actions: PendingAction[],
  strategy: "sequential" | "parallel_where_possible",
): WorkflowPlan {
  if (actions.length === 0 || actions.length > MAX_PLAN_STEPS) {
    throw new Error(`WorkflowPlan must have 1-3 steps, got ${actions.length}`);
  }

  const steps: WorkflowStep[] = actions.map((action, i) => ({
    index: i,
    actionId: action.id,
    dependsOn: strategy === "sequential" && i > 0 ? [i - 1] : [],
    status: "pending" as const,
    result: null,
  }));

  return { steps, strategy, replannedCount: 0 };
}

export function advanceStep(
  plan: WorkflowPlan,
  stepIndex: number,
  status: WorkflowStepStatus,
  result: Record<string, unknown> | null,
): WorkflowPlan {
  const updatedSteps = plan.steps.map((step) =>
    step.index === stepIndex ? { ...step, status, result } : { ...step },
  );
  return { ...plan, steps: updatedSteps };
}

export function canReplan(replansUsed: number, maxReplans: number): boolean {
  return replansUsed < maxReplans;
}

export function getNextPendingStep(plan: WorkflowPlan): WorkflowStep | null {
  return (
    plan.steps.find((step) => {
      if (step.status !== "pending") return false;
      // Check all dependencies are completed
      return step.dependsOn.every((depIdx) => {
        const dep = plan.steps.find((s) => s.index === depIdx);
        return dep?.status === "completed";
      });
    }) ?? null
  );
}

export function areAllStepsTerminal(plan: WorkflowPlan): boolean {
  return plan.steps.every(
    (s) => s.status === "completed" || s.status === "failed" || s.status === "skipped",
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- workflow-plan`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add WorkflowPlan creation, step advancement, and re-plan logic
```

---

## Task 9: WorkflowEngine

**Files:**

- Create: `packages/core/src/workflows/workflow-engine.ts`
- Create: `packages/core/src/workflows/__tests__/workflow-engine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/workflows/__tests__/workflow-engine.test.ts
import { describe, it, expect, vi } from "vitest";
import { WorkflowEngine } from "../workflow-engine.js";
import { createPendingAction } from "../pending-action.js";
import { createTestWorkflowStores } from "./test-stores.js";

function makeDeps(overrides: Record<string, unknown> = {}) {
  const stores = createTestWorkflowStores();
  const stepExecutor = {
    execute: vi.fn().mockResolvedValue({ outcome: "completed", result: { ok: true } }),
  };
  return {
    workflows: stores.workflows,
    actions: stores.actions,
    checkpoints: stores.checkpoints,
    stepExecutor,
    ...overrides,
  };
}

function makeActionInput(intent: string) {
  return {
    intent,
    targetEntities: [],
    parameters: {},
    humanSummary: `Do ${intent}`,
    confidence: 0.9,
    riskLevel: "low" as const,
    dollarsAtRisk: 0,
    requiredCapabilities: [],
    dryRunSupported: false,
    approvalRequired: "auto" as const,
    sourceAgent: "test-agent",
    organizationId: "org-1",
  };
}

describe("WorkflowEngine", () => {
  describe("createWorkflow", () => {
    it("creates a workflow in pending status", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const actions = [createPendingAction(makeActionInput("step1"))];
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions,
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: 10,
          maxDollarsAtRisk: 5000,
          timeoutMs: 300_000,
          maxReplans: 3,
        },
      });

      expect(workflow.status).toBe("pending");
      expect(workflow.plan.steps).toHaveLength(1);

      // Actions should be persisted
      const storedAction = await deps.actions.getById(actions[0].id);
      expect(storedAction).not.toBeNull();
    });
  });

  describe("startWorkflow", () => {
    it("transitions from pending to running and executes first step", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const actions = [createPendingAction(makeActionInput("step1"))];
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions,
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: 10,
          maxDollarsAtRisk: 5000,
          timeoutMs: 300_000,
          maxReplans: 3,
        },
      });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("completed");
      expect(deps.stepExecutor.execute).toHaveBeenCalledOnce();
    });
  });

  describe("startWorkflow with approval", () => {
    it("pauses on requires_approval and creates checkpoint", async () => {
      const stepExecutor = {
        execute: vi.fn().mockResolvedValue({
          outcome: "requires_approval",
          reason: "high risk",
        }),
      };
      const deps = makeDeps({ stepExecutor });
      const engine = new WorkflowEngine(deps);

      const actions = [
        createPendingAction({
          ...makeActionInput("risky_step"),
          riskLevel: "high",
          approvalRequired: "operator_approval",
        }),
      ];
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions,
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: 10,
          maxDollarsAtRisk: 5000,
          timeoutMs: 300_000,
          maxReplans: 3,
        },
      });

      const result = await engine.startWorkflow(workflow.id);

      expect(result.status).toBe("awaiting_approval");
      // Checkpoint should exist
      const checkpoint = await deps.checkpoints.getByWorkflowAndStep(workflow.id, 0);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.status).toBe("pending");
    });
  });

  describe("cancelWorkflow", () => {
    it("cancels a pending workflow", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const actions = [createPendingAction(makeActionInput("step1"))];
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions,
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: 10,
          maxDollarsAtRisk: 5000,
          timeoutMs: 300_000,
          maxReplans: 3,
        },
      });

      await engine.cancelWorkflow(workflow.id);

      const updated = await deps.workflows.getById(workflow.id);
      expect(updated!.status).toBe("cancelled");
    });
  });

  describe("safety envelope enforcement", () => {
    it("fails workflow when maxSteps exceeded", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const actions = [createPendingAction(makeActionInput("step1"))];
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions,
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: 0, // already at limit
          maxDollarsAtRisk: 5000,
          timeoutMs: 300_000,
          maxReplans: 3,
        },
      });

      const result = await engine.startWorkflow(workflow.id);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("maxSteps");
    });

    it("fails workflow when timeoutMs exceeded", async () => {
      const deps = makeDeps();
      const engine = new WorkflowEngine(deps);

      const actions = [createPendingAction(makeActionInput("step1"))];
      const workflow = await engine.createWorkflow({
        organizationId: "org-1",
        triggerType: "agent_initiated",
        sourceAgent: "test-agent",
        actions,
        strategy: "sequential",
        safetyEnvelope: {
          maxSteps: 10,
          maxDollarsAtRisk: 5000,
          timeoutMs: 1, // 1ms — will be exceeded by the time we start
          maxReplans: 3,
        },
      });

      // Small delay to ensure timeout
      await new Promise((r) => setTimeout(r, 5));

      const result = await engine.startWorkflow(workflow.id);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("timeoutMs");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- workflow-engine`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/workflows/workflow-engine.ts
import { randomUUID } from "node:crypto";
import type {
  WorkflowExecution,
  WorkflowSafetyEnvelope,
  PendingAction,
  WorkflowTriggerType,
} from "@switchboard/schemas";
import type {
  WorkflowStore,
  PendingActionStore,
  ApprovalCheckpointStore,
} from "./store-interfaces.js";
import { canWorkflowTransition, WorkflowTransitionError } from "./workflow-state-machine.js";
import {
  createWorkflowPlan,
  advanceStep,
  getNextPendingStep,
  areAllStepsTerminal,
} from "./workflow-plan.js";
import { createApprovalCheckpoint } from "./approval-checkpoint.js";
import type { StepExecutionResult } from "./step-executor.js";

const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface WorkflowStepExecutor {
  execute(
    action: PendingAction,
    context: { organizationId: string; profile?: Record<string, unknown> },
  ): Promise<StepExecutionResult>;
}

export interface WorkflowEngineDeps {
  workflows: WorkflowStore;
  actions: PendingActionStore;
  checkpoints: ApprovalCheckpointStore;
  stepExecutor: WorkflowStepExecutor;
}

export interface CreateWorkflowInput {
  organizationId: string;
  triggerType: WorkflowTriggerType;
  triggerRef?: string;
  sourceAgent: string;
  actions: PendingAction[];
  strategy: "sequential" | "parallel_where_possible";
  safetyEnvelope: WorkflowSafetyEnvelope;
  metadata?: Record<string, unknown>;
}

export class WorkflowEngine {
  private readonly deps: WorkflowEngineDeps;

  constructor(deps: WorkflowEngineDeps) {
    this.deps = deps;
  }

  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowExecution> {
    const plan = createWorkflowPlan(input.actions, input.strategy);

    // Persist all actions
    for (const action of input.actions) {
      await this.deps.actions.create(action);
    }

    const workflow: WorkflowExecution = {
      id: randomUUID(),
      organizationId: input.organizationId,
      triggerType: input.triggerType,
      triggerRef: input.triggerRef ?? null,
      sourceAgent: input.sourceAgent,
      status: "pending",
      plan,
      currentStepIndex: 0,
      safetyEnvelope: input.safetyEnvelope,
      counters: { stepsCompleted: 0, dollarsAtRisk: 0, replansUsed: 0 },
      metadata: input.metadata ?? {},
      traceId: randomUUID(),
      error: null,
      errorCode: null,
      startedAt: new Date(),
      completedAt: null,
    };

    await this.deps.workflows.create(workflow);
    return workflow;
  }

  async startWorkflow(workflowId: string): Promise<WorkflowExecution> {
    const workflow = await this.requireWorkflow(workflowId);
    this.assertTransition(workflow.status, "running");

    await this.deps.workflows.update(workflowId, { status: "running" });

    return this.runSteps(workflowId);
  }

  async resumeAfterApproval(workflowId: string, _checkpointId: string): Promise<WorkflowExecution> {
    const workflow = await this.requireWorkflow(workflowId);
    this.assertTransition(workflow.status, "running");

    await this.deps.workflows.update(workflowId, { status: "running" });

    // Re-execute the step that was paused (now approved)
    const step = workflow.plan.steps[workflow.currentStepIndex];
    const action = await this.deps.actions.getById(step.actionId);
    if (!action) throw new Error(`Action ${step.actionId} not found`);

    // Mark action as approved
    await this.deps.actions.update(action.id, { status: "approved" });

    return this.runSteps(workflowId);
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.requireWorkflow(workflowId);
    this.assertTransition(workflow.status, "cancelled");

    await this.deps.workflows.update(workflowId, {
      status: "cancelled",
      completedAt: new Date(),
    });
  }

  async getWorkflow(workflowId: string): Promise<WorkflowExecution | null> {
    return this.deps.workflows.getById(workflowId);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async runSteps(workflowId: string): Promise<WorkflowExecution> {
    let workflow = await this.requireWorkflow(workflowId);

    while (true) {
      // Safety envelope check
      const envelopeError = this.checkSafetyEnvelope(workflow);
      if (envelopeError) {
        await this.deps.workflows.update(workflowId, {
          status: "failed",
          error: envelopeError,
          errorCode: "SAFETY_ENVELOPE_EXCEEDED",
          completedAt: new Date(),
        });
        return this.requireWorkflow(workflowId);
      }

      const nextStep = getNextPendingStep(workflow.plan);
      if (!nextStep) {
        // All steps done
        if (areAllStepsTerminal(workflow.plan)) {
          const hasFailure = workflow.plan.steps.some((s) => s.status === "failed");
          const finalStatus = hasFailure ? "failed" : "completed";
          await this.deps.workflows.update(workflowId, {
            status: finalStatus,
            completedAt: new Date(),
            error: hasFailure ? "One or more steps failed" : null,
          });
        }
        return this.requireWorkflow(workflowId);
      }

      // Get the action for this step
      const action = await this.deps.actions.getById(nextStep.actionId);
      if (!action) {
        await this.deps.workflows.update(workflowId, {
          status: "failed",
          error: `Action ${nextStep.actionId} not found`,
          errorCode: "ACTION_NOT_FOUND",
          completedAt: new Date(),
        });
        return this.requireWorkflow(workflowId);
      }

      // Execute the step
      const result = await this.deps.stepExecutor.execute(action, {
        organizationId: workflow.organizationId,
      });

      if (result.outcome === "completed") {
        const updatedPlan = advanceStep(workflow.plan, nextStep.index, "completed", {
          result: result.result ?? null,
        });
        await this.deps.workflows.update(workflowId, {
          plan: updatedPlan,
          currentStepIndex: nextStep.index + 1,
          counters: {
            ...workflow.counters,
            stepsCompleted: workflow.counters.stepsCompleted + 1,
            dollarsAtRisk: workflow.counters.dollarsAtRisk + action.dollarsAtRisk,
          },
        });
        workflow = await this.requireWorkflow(workflowId);
        continue;
      }

      if (result.outcome === "requires_approval") {
        const checkpoint = createApprovalCheckpoint({
          workflowId,
          stepIndex: nextStep.index,
          action,
          reason: result.reason ?? "Approval required by policy",
          ttlMs: DEFAULT_APPROVAL_TTL_MS,
        });
        await this.deps.checkpoints.create(checkpoint);

        await this.deps.workflows.update(workflowId, {
          status: "awaiting_approval",
        });
        return this.requireWorkflow(workflowId);
      }

      if (result.outcome === "rejected" || result.outcome === "failed") {
        const updatedPlan = advanceStep(workflow.plan, nextStep.index, "failed", {
          error: result.error ?? result.reason ?? "Step failed",
        });
        await this.deps.workflows.update(workflowId, {
          plan: updatedPlan,
          status: "failed",
          error: result.error ?? result.reason ?? "Step execution failed",
          errorCode: result.outcome === "rejected" ? "ACTION_REJECTED" : "STEP_FAILED",
          completedAt: new Date(),
        });
        return this.requireWorkflow(workflowId);
      }

      break;
    }

    return this.requireWorkflow(workflowId);
  }

  private checkSafetyEnvelope(workflow: WorkflowExecution): string | null {
    const { safetyEnvelope, counters } = workflow;
    if (counters.stepsCompleted >= safetyEnvelope.maxSteps) {
      return `Safety envelope exceeded: maxSteps (${counters.stepsCompleted}/${safetyEnvelope.maxSteps})`;
    }
    if (counters.dollarsAtRisk >= safetyEnvelope.maxDollarsAtRisk) {
      return `Safety envelope exceeded: maxDollarsAtRisk (${counters.dollarsAtRisk}/${safetyEnvelope.maxDollarsAtRisk})`;
    }
    const elapsedMs = Date.now() - workflow.startedAt.getTime();
    if (elapsedMs >= safetyEnvelope.timeoutMs) {
      return `Safety envelope exceeded: timeoutMs (${elapsedMs}ms/${safetyEnvelope.timeoutMs}ms)`;
    }
    return null;
  }

  private assertTransition(
    from: WorkflowExecution["status"],
    to: WorkflowExecution["status"],
  ): void {
    if (!canWorkflowTransition(from, to)) {
      throw new WorkflowTransitionError(from, to);
    }
  }

  private async requireWorkflow(id: string): Promise<WorkflowExecution> {
    const workflow = await this.deps.workflows.getById(id);
    if (!workflow) throw new Error(`Workflow ${id} not found`);
    return workflow;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- workflow-engine`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): add WorkflowEngine multi-step orchestrator with safety envelopes
```

---

## Task 10: Barrel Exports for Workflows

**Files:**

- Create: `packages/core/src/workflows/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create barrel file**

```typescript
// packages/core/src/workflows/index.ts
export {
  VALID_WORKFLOW_TRANSITIONS,
  canWorkflowTransition,
  validateWorkflowTransition,
  isTerminalStatus,
  WorkflowTransitionError,
} from "./workflow-state-machine.js";

export {
  createPendingAction,
  canActionTransition,
  VALID_ACTION_TRANSITIONS,
  PendingActionTransitionError,
  type CreatePendingActionInput,
} from "./pending-action.js";

export type {
  WorkflowStore,
  PendingActionStore,
  ApprovalCheckpointStore,
} from "./store-interfaces.js";

export {
  StepExecutor,
  type StepExecutorDeps,
  type StepExecutorContext,
  type StepExecutorPolicyBridge,
  type StepExecutorActionExecutor,
  type StepExecutionResult,
  type StepExecutionOutcome,
} from "./step-executor.js";

export {
  createApprovalCheckpoint,
  resolveCheckpoint,
  isCheckpointExpired,
  type CreateCheckpointInput,
  type ResolveInput,
} from "./approval-checkpoint.js";

export {
  createWorkflowPlan,
  advanceStep,
  canReplan,
  getNextPendingStep,
  areAllStepsTerminal,
} from "./workflow-plan.js";

export {
  WorkflowEngine,
  type WorkflowEngineDeps,
  type WorkflowStepExecutor,
  type CreateWorkflowInput,
} from "./workflow-engine.js";
```

- [ ] **Step 2: Add to core barrel**

Add to `packages/core/src/index.ts`:

```typescript
// Workflows (multi-step execution engine)
export * from "./workflows/index.js";
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @switchboard/core typecheck`
Expected: PASS

- [ ] **Step 4: Run all core tests**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```
chore(core): add workflow barrel exports
```

---

## Task 11: Prisma Models + Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add WorkflowExecution and PendingAction models to schema.prisma**

Add after the existing `AgentRoleOverride` model (around line 1000):

```prisma
model WorkflowExecution {
  id               String    @id @default(uuid())
  organizationId   String
  triggerType      String    // event, schedule, operator_command, agent_initiated
  triggerRef       String?
  sourceAgent      String?
  status           String    // pending, running, awaiting_approval, awaiting_event, scheduled, blocked, completed, failed, cancelled
  plan             Json      // WorkflowPlan
  currentStepIndex Int       @default(0)
  safetyEnvelope   Json      // WorkflowSafetyEnvelope
  counters         Json      // { stepsCompleted, dollarsAtRisk, replansUsed }
  metadata         Json      @default("{}")
  traceId          String
  error            String?
  errorCode        String?
  startedAt        DateTime  @default(now())
  completedAt      DateTime?

  pendingActions        PendingActionRecord[]
  approvalCheckpoints   ApprovalCheckpointRecord[]

  @@index([organizationId, status])
  @@index([traceId])
  @@index([sourceAgent])
}

model PendingActionRecord {
  id                   String    @id @default(uuid())
  idempotencyKey       String    @unique
  workflowId           String?
  stepIndex            Int?
  status               String    // proposed, approved, executing, completed, failed, rejected, expired
  intent               String
  targetEntities       Json      // Array<{ type, id }>
  parameters           Json
  humanSummary         String
  confidence           Float
  riskLevel            String    // low, medium, high, critical
  dollarsAtRisk        Float     @default(0)
  requiredCapabilities String[]
  dryRunSupported      Boolean   @default(false)
  approvalRequired     String    // auto, human_review, operator_approval
  fallback             Json?
  sourceAgent          String
  sourceWorkflow       String?
  organizationId       String
  createdAt            DateTime  @default(now())
  expiresAt            DateTime?
  resolvedAt           DateTime?
  resolvedBy           String?

  workflow   WorkflowExecution? @relation(fields: [workflowId], references: [id])

  @@index([organizationId, status])
  @@index([workflowId])
  @@index([sourceAgent])
}

model ApprovalCheckpointRecord {
  id               String   @id @default(uuid())
  workflowId       String
  stepIndex        Int
  actionId         String
  reason           String
  options          String[] // approve, reject, modify
  modifiableFields String[]
  alternatives     Json     @default("[]")
  notifyChannels   String[]
  status           String   // pending, approved, rejected, modified, expired
  resolution       Json?
  createdAt        DateTime @default(now())
  expiresAt        DateTime

  workflow   WorkflowExecution @relation(fields: [workflowId], references: [id])

  @@unique([workflowId, stepIndex])
  @@index([status])
}
```

- [ ] **Step 2: Generate Prisma client**

Run: `pnpm db:generate`
Expected: PASS — Prisma client regenerated

- [ ] **Step 3: Create migration**

Run: `cd packages/db && npx prisma migrate dev --name add_workflow_models`
Expected: Migration created successfully

- [ ] **Step 4: Commit**

```
feat(db): add WorkflowExecution, PendingAction, ApprovalCheckpoint Prisma models
```

---

## Task 12: PrismaWorkflowStore

**Files:**

- Create: `packages/db/src/stores/prisma-workflow-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-workflow-store.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write failing tests (unit tests with mocked Prisma)**

```typescript
// packages/db/src/stores/__tests__/prisma-workflow-store.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaWorkflowStore } from "../prisma-workflow-store.js";

function mockPrismaClient() {
  return {
    workflowExecution: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    pendingActionRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    approvalCheckpointRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("PrismaWorkflowStore", () => {
  let prisma: ReturnType<typeof mockPrismaClient>;
  let store: PrismaWorkflowStore;

  beforeEach(() => {
    prisma = mockPrismaClient();
    store = new PrismaWorkflowStore(prisma as never);
  });

  describe("workflows", () => {
    it("creates a workflow", async () => {
      await store.workflows.create({
        id: "wf-1",
        organizationId: "org-1",
        triggerType: "agent_initiated",
        triggerRef: null,
        sourceAgent: "test",
        status: "pending",
        plan: { steps: [], strategy: "sequential", replannedCount: 0 },
        currentStepIndex: 0,
        safetyEnvelope: { maxSteps: 10, maxDollarsAtRisk: 5000, timeoutMs: 300000, maxReplans: 3 },
        counters: { stepsCompleted: 0, dollarsAtRisk: 0, replansUsed: 0 },
        metadata: {},
        traceId: "trace-1",
        error: null,
        errorCode: null,
        startedAt: new Date(),
        completedAt: null,
      });

      expect(prisma.workflowExecution.create).toHaveBeenCalledOnce();
    });

    it("getById returns null when not found", async () => {
      prisma.workflowExecution.findUnique.mockResolvedValue(null);
      const result = await store.workflows.getById("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("actions", () => {
    it("creates a pending action", async () => {
      await store.actions.create({
        id: "act-1",
        idempotencyKey: "key-1",
        workflowId: null,
        stepIndex: null,
        status: "proposed",
        intent: "test",
        targetEntities: [],
        parameters: {},
        humanSummary: "Test",
        confidence: 0.9,
        riskLevel: "low",
        dollarsAtRisk: 0,
        requiredCapabilities: [],
        dryRunSupported: false,
        approvalRequired: "auto",
        fallback: null,
        sourceAgent: "test",
        sourceWorkflow: null,
        organizationId: "org-1",
        createdAt: new Date(),
        expiresAt: null,
        resolvedAt: null,
        resolvedBy: null,
      });

      expect(prisma.pendingActionRecord.create).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- prisma-workflow-store`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Follow the pattern from `prisma-thread-store.ts` — use local type aliases (structural typing, no cross-layer imports).

```typescript
// packages/db/src/stores/prisma-workflow-store.ts
import type { PrismaClient } from "@prisma/client";

// Local type aliases — structural typing, no cross-layer imports

type WorkflowStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_event"
  | "scheduled"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

type PendingActionStatus =
  | "proposed"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "rejected"
  | "expired";

type ApprovalCheckpointStatus = "pending" | "approved" | "rejected" | "modified" | "expired";

interface WorkflowExecution {
  id: string;
  organizationId: string;
  triggerType: string;
  triggerRef: string | null;
  sourceAgent: string | null;
  status: WorkflowStatus;
  plan: unknown;
  currentStepIndex: number;
  safetyEnvelope: unknown;
  counters: unknown;
  metadata: Record<string, unknown>;
  traceId: string;
  error: string | null;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

interface PendingAction {
  id: string;
  idempotencyKey: string;
  workflowId: string | null;
  stepIndex: number | null;
  status: PendingActionStatus;
  intent: string;
  targetEntities: unknown;
  parameters: Record<string, unknown>;
  humanSummary: string;
  confidence: number;
  riskLevel: string;
  dollarsAtRisk: number;
  requiredCapabilities: string[];
  dryRunSupported: boolean;
  approvalRequired: string;
  fallback: unknown;
  sourceAgent: string;
  sourceWorkflow: string | null;
  organizationId: string;
  createdAt: Date;
  expiresAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

interface ApprovalCheckpoint {
  id: string;
  workflowId: string;
  stepIndex: number;
  actionId: string;
  reason: string;
  options: string[];
  modifiableFields: string[];
  alternatives: unknown;
  notifyChannels: string[];
  status: ApprovalCheckpointStatus;
  resolution: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export class PrismaWorkflowStore {
  constructor(private prisma: PrismaClient) {}

  // Note: row-to-domain mapping is intentionally inline per method for clarity.
  // If the store grows beyond ~300 lines, extract private toDomainWorkflow(),
  // toDomainAction(), toDomainCheckpoint() helpers to reduce duplication.

  readonly workflows = {
    create: async (workflow: WorkflowExecution): Promise<void> => {
      await this.prisma.workflowExecution.create({
        data: {
          id: workflow.id,
          organizationId: workflow.organizationId,
          triggerType: workflow.triggerType,
          triggerRef: workflow.triggerRef,
          sourceAgent: workflow.sourceAgent,
          status: workflow.status,
          plan: workflow.plan as object,
          currentStepIndex: workflow.currentStepIndex,
          safetyEnvelope: workflow.safetyEnvelope as object,
          counters: workflow.counters as object,
          metadata: workflow.metadata as object,
          traceId: workflow.traceId,
          error: workflow.error,
          errorCode: workflow.errorCode,
          startedAt: workflow.startedAt,
          completedAt: workflow.completedAt,
        },
      });
    },

    getById: async (id: string): Promise<WorkflowExecution | null> => {
      const row = await this.prisma.workflowExecution.findUnique({ where: { id } });
      if (!row) return null;
      return {
        id: row.id,
        organizationId: row.organizationId,
        triggerType: row.triggerType,
        triggerRef: row.triggerRef,
        sourceAgent: row.sourceAgent,
        status: row.status as WorkflowStatus,
        plan: row.plan,
        currentStepIndex: row.currentStepIndex,
        safetyEnvelope: row.safetyEnvelope,
        counters: row.counters,
        metadata: row.metadata as Record<string, unknown>,
        traceId: row.traceId,
        error: row.error,
        errorCode: row.errorCode,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
      };
    },

    update: async (id: string, updates: Partial<WorkflowExecution>): Promise<void> => {
      const data: Record<string, unknown> = {};
      if (updates.status !== undefined) data.status = updates.status;
      if (updates.plan !== undefined) data.plan = updates.plan as object;
      if (updates.currentStepIndex !== undefined) data.currentStepIndex = updates.currentStepIndex;
      if (updates.counters !== undefined) data.counters = updates.counters as object;
      if (updates.metadata !== undefined) data.metadata = updates.metadata as object;
      if (updates.error !== undefined) data.error = updates.error;
      if (updates.errorCode !== undefined) data.errorCode = updates.errorCode;
      if (updates.completedAt !== undefined) data.completedAt = updates.completedAt;
      await this.prisma.workflowExecution.update({ where: { id }, data });
    },

    list: async (filter: {
      organizationId?: string;
      status?: WorkflowStatus;
      sourceAgent?: string;
      limit?: number;
    }): Promise<WorkflowExecution[]> => {
      const where: Record<string, unknown> = {};
      if (filter.organizationId) where.organizationId = filter.organizationId;
      if (filter.status) where.status = filter.status;
      if (filter.sourceAgent) where.sourceAgent = filter.sourceAgent;
      const rows = await this.prisma.workflowExecution.findMany({
        where,
        take: filter.limit,
        orderBy: { startedAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        triggerType: row.triggerType,
        triggerRef: row.triggerRef,
        sourceAgent: row.sourceAgent,
        status: row.status as WorkflowStatus,
        plan: row.plan,
        currentStepIndex: row.currentStepIndex,
        safetyEnvelope: row.safetyEnvelope,
        counters: row.counters,
        metadata: row.metadata as Record<string, unknown>,
        traceId: row.traceId,
        error: row.error,
        errorCode: row.errorCode,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
      }));
    },
  };

  readonly actions = {
    create: async (action: PendingAction): Promise<void> => {
      await this.prisma.pendingActionRecord.create({
        data: {
          id: action.id,
          idempotencyKey: action.idempotencyKey,
          workflowId: action.workflowId,
          stepIndex: action.stepIndex,
          status: action.status,
          intent: action.intent,
          targetEntities: action.targetEntities as object,
          parameters: action.parameters as object,
          humanSummary: action.humanSummary,
          confidence: action.confidence,
          riskLevel: action.riskLevel,
          dollarsAtRisk: action.dollarsAtRisk,
          requiredCapabilities: action.requiredCapabilities,
          dryRunSupported: action.dryRunSupported,
          approvalRequired: action.approvalRequired,
          fallback: (action.fallback as object) ?? undefined,
          sourceAgent: action.sourceAgent,
          sourceWorkflow: action.sourceWorkflow,
          organizationId: action.organizationId,
          expiresAt: action.expiresAt,
          resolvedAt: action.resolvedAt,
          resolvedBy: action.resolvedBy,
        },
      });
    },

    getById: async (id: string): Promise<PendingAction | null> => {
      const row = await this.prisma.pendingActionRecord.findUnique({ where: { id } });
      if (!row) return null;
      return {
        id: row.id,
        idempotencyKey: row.idempotencyKey,
        workflowId: row.workflowId,
        stepIndex: row.stepIndex,
        status: row.status as PendingActionStatus,
        intent: row.intent,
        targetEntities: row.targetEntities,
        parameters: row.parameters as Record<string, unknown>,
        humanSummary: row.humanSummary,
        confidence: row.confidence,
        riskLevel: row.riskLevel,
        dollarsAtRisk: row.dollarsAtRisk,
        requiredCapabilities: row.requiredCapabilities,
        dryRunSupported: row.dryRunSupported,
        approvalRequired: row.approvalRequired,
        fallback: row.fallback,
        sourceAgent: row.sourceAgent,
        sourceWorkflow: row.sourceWorkflow,
        organizationId: row.organizationId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolvedBy,
      };
    },

    update: async (id: string, updates: Partial<PendingAction>): Promise<void> => {
      const data: Record<string, unknown> = {};
      if (updates.status !== undefined) data.status = updates.status;
      if (updates.resolvedAt !== undefined) data.resolvedAt = updates.resolvedAt;
      if (updates.resolvedBy !== undefined) data.resolvedBy = updates.resolvedBy;
      if (updates.parameters !== undefined) data.parameters = updates.parameters as object;
      await this.prisma.pendingActionRecord.update({ where: { id }, data });
    },

    listByWorkflow: async (workflowId: string): Promise<PendingAction[]> => {
      const rows = await this.prisma.pendingActionRecord.findMany({
        where: { workflowId },
      });
      return rows.map((row) => ({
        id: row.id,
        idempotencyKey: row.idempotencyKey,
        workflowId: row.workflowId,
        stepIndex: row.stepIndex,
        status: row.status as PendingActionStatus,
        intent: row.intent,
        targetEntities: row.targetEntities,
        parameters: row.parameters as Record<string, unknown>,
        humanSummary: row.humanSummary,
        confidence: row.confidence,
        riskLevel: row.riskLevel,
        dollarsAtRisk: row.dollarsAtRisk,
        requiredCapabilities: row.requiredCapabilities,
        dryRunSupported: row.dryRunSupported,
        approvalRequired: row.approvalRequired,
        fallback: row.fallback,
        sourceAgent: row.sourceAgent,
        sourceWorkflow: row.sourceWorkflow,
        organizationId: row.organizationId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolvedBy,
      }));
    },

    listByStatus: async (
      organizationId: string,
      status: PendingActionStatus,
      limit?: number,
    ): Promise<PendingAction[]> => {
      const rows = await this.prisma.pendingActionRecord.findMany({
        where: { organizationId, status },
        take: limit,
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => ({
        id: row.id,
        idempotencyKey: row.idempotencyKey,
        workflowId: row.workflowId,
        stepIndex: row.stepIndex,
        status: row.status as PendingActionStatus,
        intent: row.intent,
        targetEntities: row.targetEntities,
        parameters: row.parameters as Record<string, unknown>,
        humanSummary: row.humanSummary,
        confidence: row.confidence,
        riskLevel: row.riskLevel,
        dollarsAtRisk: row.dollarsAtRisk,
        requiredCapabilities: row.requiredCapabilities,
        dryRunSupported: row.dryRunSupported,
        approvalRequired: row.approvalRequired,
        fallback: row.fallback,
        sourceAgent: row.sourceAgent,
        sourceWorkflow: row.sourceWorkflow,
        organizationId: row.organizationId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolvedBy,
      }));
    },
  };

  readonly checkpoints = {
    create: async (checkpoint: ApprovalCheckpoint): Promise<void> => {
      await this.prisma.approvalCheckpointRecord.create({
        data: {
          id: checkpoint.id,
          workflowId: checkpoint.workflowId,
          stepIndex: checkpoint.stepIndex,
          actionId: checkpoint.actionId,
          reason: checkpoint.reason,
          options: checkpoint.options,
          modifiableFields: checkpoint.modifiableFields,
          alternatives: checkpoint.alternatives as object,
          notifyChannels: checkpoint.notifyChannels,
          status: checkpoint.status,
          resolution: (checkpoint.resolution as object) ?? undefined,
          expiresAt: checkpoint.expiresAt,
        },
      });
    },

    getById: async (id: string): Promise<ApprovalCheckpoint | null> => {
      const row = await this.prisma.approvalCheckpointRecord.findUnique({ where: { id } });
      if (!row) return null;
      return {
        id: row.id,
        workflowId: row.workflowId,
        stepIndex: row.stepIndex,
        actionId: row.actionId,
        reason: row.reason,
        options: row.options as ApprovalCheckpoint["options"],
        modifiableFields: row.modifiableFields,
        alternatives: row.alternatives as ApprovalCheckpoint["alternatives"],
        notifyChannels: row.notifyChannels as ApprovalCheckpoint["notifyChannels"],
        status: row.status as ApprovalCheckpointStatus,
        resolution: row.resolution as ApprovalCheckpoint["resolution"],
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      };
    },

    getByWorkflowAndStep: async (
      workflowId: string,
      stepIndex: number,
    ): Promise<ApprovalCheckpoint | null> => {
      const row = await this.prisma.approvalCheckpointRecord.findFirst({
        where: { workflowId, stepIndex },
      });
      if (!row) return null;
      return {
        id: row.id,
        workflowId: row.workflowId,
        stepIndex: row.stepIndex,
        actionId: row.actionId,
        reason: row.reason,
        options: row.options as ApprovalCheckpoint["options"],
        modifiableFields: row.modifiableFields,
        alternatives: row.alternatives as ApprovalCheckpoint["alternatives"],
        notifyChannels: row.notifyChannels as ApprovalCheckpoint["notifyChannels"],
        status: row.status as ApprovalCheckpointStatus,
        resolution: row.resolution as ApprovalCheckpoint["resolution"],
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      };
    },

    update: async (id: string, updates: Partial<ApprovalCheckpoint>): Promise<void> => {
      const data: Record<string, unknown> = {};
      if (updates.status !== undefined) data.status = updates.status;
      if (updates.resolution !== undefined) data.resolution = updates.resolution as object;
      await this.prisma.approvalCheckpointRecord.update({ where: { id }, data });
    },

    listPending: async (organizationId: string): Promise<ApprovalCheckpoint[]> => {
      const rows = await this.prisma.approvalCheckpointRecord.findMany({
        where: {
          status: "pending",
          workflow: { organizationId },
        },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((row) => ({
        id: row.id,
        workflowId: row.workflowId,
        stepIndex: row.stepIndex,
        actionId: row.actionId,
        reason: row.reason,
        options: row.options as ApprovalCheckpoint["options"],
        modifiableFields: row.modifiableFields,
        alternatives: row.alternatives as ApprovalCheckpoint["alternatives"],
        notifyChannels: row.notifyChannels as ApprovalCheckpoint["notifyChannels"],
        status: row.status as ApprovalCheckpointStatus,
        resolution: row.resolution as ApprovalCheckpoint["resolution"],
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      }));
    },
  };
}
```

- [ ] **Step 4: Export from db barrel**

Add to `packages/db/src/index.ts`:

```typescript
export { PrismaWorkflowStore } from "./stores/prisma-workflow-store.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/db test -- prisma-workflow-store`
Expected: PASS

- [ ] **Step 6: Commit**

```
feat(db): add PrismaWorkflowStore for workflow, action, and checkpoint persistence
```

---

## Task 13: API Routes + Bootstrap Wiring

**Files:**

- Create: `apps/api/src/bootstrap/workflow-deps.ts`
- Create: `apps/api/src/routes/workflows.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Create workflow dependency factory**

```typescript
// apps/api/src/bootstrap/workflow-deps.ts
import type { PrismaClient } from "@prisma/client";
import { PrismaWorkflowStore } from "@switchboard/db";
import { WorkflowEngine, StepExecutor } from "@switchboard/core";
import type { ActionExecutor, PolicyBridge } from "@switchboard/agents";

export interface WorkflowDeps {
  workflowEngine: WorkflowEngine;
  store: PrismaWorkflowStore;
}

export function buildWorkflowDeps(
  prisma: PrismaClient,
  actionExecutor: ActionExecutor,
  policyBridge: PolicyBridge,
): WorkflowDeps | null {
  try {
    const store = new PrismaWorkflowStore(prisma);

    const stepExecutor = new StepExecutor({
      actionStore: store.actions,
      policyBridge,
      actionExecutor,
    });

    const workflowEngine = new WorkflowEngine({
      workflows: store.workflows,
      actions: store.actions,
      checkpoints: store.checkpoints,
      stepExecutor,
    });

    return { workflowEngine, store };
  } catch (err) {
    console.error("[workflow-deps] Failed to build workflow dependencies:", err);
    return null;
  }
}
```

- [ ] **Step 2: Create workflow API routes**

```typescript
// apps/api/src/routes/workflows.ts
import type { FastifyInstance } from "fastify";
import type { WorkflowDeps } from "../bootstrap/workflow-deps.js";
import { resolveCheckpoint } from "@switchboard/core";

export async function workflowRoutes(
  fastify: FastifyInstance,
  opts: { workflowDeps: WorkflowDeps },
): Promise<void> {
  const { workflowEngine, store } = opts.workflowDeps;

  // GET /api/workflows/:id
  fastify.get<{ Params: { id: string } }>("/api/workflows/:id", async (request, reply) => {
    const workflow = await workflowEngine.getWorkflow(request.params.id);
    if (!workflow) {
      return reply.status(404).send({ error: "Workflow not found" });
    }
    return reply.send(workflow);
  });

  // GET /api/workflows?organizationId=&status=&limit=
  fastify.get<{
    Querystring: { organizationId?: string; status?: string; limit?: string };
  }>("/api/workflows", async (request, reply) => {
    const { organizationId, status, limit } = request.query;
    const workflows = await store.workflows.list({
      organizationId,
      status: status as never,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return reply.send(workflows);
  });

  // POST /api/workflows/:id/cancel
  fastify.post<{ Params: { id: string } }>("/api/workflows/:id/cancel", async (request, reply) => {
    try {
      await workflowEngine.cancelWorkflow(request.params.id);
      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // GET /api/workflows/actions/pending?organizationId=
  fastify.get<{
    Querystring: { organizationId: string; limit?: string };
  }>("/api/workflows/actions/pending", async (request, reply) => {
    const { organizationId, limit } = request.query;
    if (!organizationId) {
      return reply.status(400).send({ error: "organizationId required" });
    }
    const actions = await store.actions.listByStatus(
      organizationId,
      "proposed",
      limit ? parseInt(limit, 10) : undefined,
    );
    return reply.send(actions);
  });

  // POST /api/workflows/checkpoints/:id/resolve
  fastify.post<{
    Params: { id: string };
    Body: {
      decidedBy: string;
      action: "approve" | "reject" | "modify";
      fieldEdits?: Record<string, unknown>;
    };
  }>("/api/workflows/checkpoints/:id/resolve", async (request, reply) => {
    try {
      const { decidedBy, action, fieldEdits } = request.body;
      await resolveCheckpoint(store.checkpoints, request.params.id, {
        decidedBy,
        action,
        fieldEdits,
      });

      // If approved, resume the workflow
      if (action === "approve" || action === "modify") {
        const checkpoint = await store.checkpoints.getById(request.params.id);
        if (checkpoint) {
          await workflowEngine.resumeAfterApproval(checkpoint.workflowId, checkpoint.id);
        }
      }

      return reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });
}
```

- [ ] **Step 3: Wire into app.ts**

In `apps/api/src/app.ts`, add the workflow route registration. Find where other routes are registered (e.g., near conversation routes) and add:

```typescript
import { buildWorkflowDeps } from "./bootstrap/workflow-deps.js";
import { workflowRoutes } from "./routes/workflows.js";

// Inside the app setup function, after actionExecutor and policyBridge are available:
const workflowDeps = buildWorkflowDeps(prisma, actionExecutor, policyBridge);
if (workflowDeps) {
  await app.register(workflowRoutes, { workflowDeps });
}
```

The exact insertion point depends on how `app.ts` is structured — look for where `conversationRoutes` is registered and add the workflow routes nearby.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(api): add workflow API routes and bootstrap wiring
```

---

## Task 14: Final Integration Verification

- [ ] **Step 1: Run all tests across the monorepo**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 2: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 4: Verify no circular dependencies**

Run: `pnpm --filter @switchboard/core test` (dependency-cruiser runs as part of CI)
Expected: No circular dependency errors

- [ ] **Step 5: Commit any fixes**

```
chore: fix lint and typecheck issues from Phase 3 integration
```

---

## Summary

| Sub-Phase | Tasks | What's Built                                                                |
| --------- | ----- | --------------------------------------------------------------------------- |
| 3a        | 1–6   | Schemas, state machine, PendingAction, stores, StepExecutor, PolicyBridge   |
| 3b        | 7–9   | ApprovalCheckpoint, WorkflowPlan, WorkflowEngine                            |
| 3c        | 10–14 | Barrel exports, Prisma models, PrismaWorkflowStore, API routes, integration |

**Total new files:** 20
**Total modified files:** 7
**Estimated commits:** 14
