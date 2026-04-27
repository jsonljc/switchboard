# Switchboard-Native Runtime — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Scope:** Remove OpenClaw, redesign around domain agents with durable workflow execution, operator chat, and structured approvals

---

## 1. Problem Statement

Switchboard has 5 working domain agents (Lead Responder, Sales Closer, Nurture, Revenue Tracker, Ad Optimizer) that handle real business operations. PR 152–156 introduced an OpenClaw session runtime — an external AI reasoning engine that would replace these agents with a generic external brain.

This is the wrong direction. OpenClaw creates architectural duplication, sidelines the domain agents, and solves the wrong problem.

The real gap is not intelligence. It is **durable workflow execution**: memory across conversations, multi-step planning, pause/resume, approval-aware action execution, and operator control through natural language.

This spec removes OpenClaw entirely and extends the existing Switchboard runtime with the missing capabilities.

---

## 2. Design Principles

1. **Domain agents are the brains.** They contain the business logic. The runtime serves them, not the other way around.
2. **Three session types, not one.** ConversationThread, WorkflowExecution, and OperatorCommand are separate abstractions with different lifespans and concerns.
3. **Structured actions, not opaque execution.** Agents produce PendingActions with intent, risk, confidence, and human summaries. The runtime decides what to execute.
4. **Bounded planning.** Plans are 1–3 steps with controlled re-planning after each step. No unbounded autonomous execution.
5. **Operator chat is a control surface, not a second runtime.** It translates natural language into structured commands routed through existing domain agents.
6. **Scheduling is a first-class primitive.** Follow-ups, cadences, delayed approvals, and timed rechecks are central to business operations.

---

## 3. What Gets Removed (OpenClaw)

### Delete Entirely

| Path                                                                   | Reason                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/gateway/` (entire directory)                             | HTTP/resilient gateway clients, protocol, errors, health probe, inflight registry, circuit breaker, callback-to-response, mock client |
| `apps/api/src/sessions/cancel-session-gateway.ts`                      | Gateway cancel propagation                                                                                                            |
| `apps/api/src/bootstrap/role-manifests.ts`                             | Gateway-shaped manifest loading                                                                                                       |
| `apps/api/src/bootstrap/compile-role-checkpoint-validator.ts`          | Gateway-specific validator compiler                                                                                                   |
| `packages/core/src/sessions/apply-gateway-outcome.ts`                  | Gateway outcome → session state                                                                                                       |
| `packages/core/src/sessions/bullmq-attempts.ts`                        | Gateway retry tracking                                                                                                                |
| `packages/db/src/sessions/apply-gateway-outcome-locked.ts`             | Advisory-lock gateway outcome applier                                                                                                 |
| Gateway schemas in `packages/schemas/`                                 | `GatewayInvokeRequest`, `GatewayInvokeResponse`, `GatewayHealthResponse`, `GatewayCorrelationMeta`, `SessionRunCallbackBody`          |
| `.claude/skills/` (committed in PR 156)                                | Developer tooling, not product code                                                                                                   |
| `docs/full-capability-spec.md`                                         | Auto-generated, OpenClaw-era                                                                                                          |
| `docs/openclaw-gateway-contract.md`                                    | Gateway HTTP contract                                                                                                                 |
| `docs/superpowers/specs/2026-03-21-openclaw-session-runtime-design.md` | Superseded by this spec                                                                                                               |
| Gateway callback route in `apps/api/src/routes/sessions.ts`            | `POST /:sessionId/runs/:runId/callback`                                                                                               |

### Simplify

| Path                                         | Change                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/jobs/session-invocation.ts`    | Remove gateway invocation. Stub or delete — will be replaced by WorkflowEngine in Phase 3.                                                           |
| `apps/api/src/routes/sessions.ts`            | Remove callback route. Keep create/get/cancel (will evolve into workflow routes).                                                                    |
| `apps/api/src/app.ts`                        | Remove gateway decorations: `cancelSessionWithGateway`, `applyGatewayOutcomeForRun`, `sessionInvocationQueue` wiring, gateway client initialization. |
| `apps/api/src/auth/require-session-token.ts` | Keep — reusable for workflow-scoped auth.                                                                                                            |

### Preserve for Redesign in Phase 3

| Path                                                                 | Future                                 |
| -------------------------------------------------------------------- | -------------------------------------- |
| `packages/core/src/sessions/session-manager.ts`                      | Becomes `WorkflowEngine`               |
| `packages/core/src/sessions/state-machine.ts`                        | Expanded from 5 to 9 states            |
| `packages/core/src/sessions/checkpoint-validator.ts`                 | Becomes approval checkpoint validation |
| `packages/core/src/sessions/store-interfaces.ts`                     | Redesigned for workflow types          |
| `packages/core/src/sessions/resume-payload-builder.ts`               | Adapted for workflow resume            |
| `packages/core/src/sessions/role-config-merger.ts`                   | Adapted for workflow config            |
| Prisma models: `AgentSession`, `AgentRun`, `AgentPause`, `ToolEvent` | Renamed/reshaped in Phase 3 migration  |

---

## 4. Three Session Types

### 4.1 ConversationThread

Tracks a lead/customer dialogue across messages and days.

```
ConversationThread {
  id: string
  contactId: string
  organizationId: string
  stage: "new" | "responding" | "qualifying" | "qualified" | "closing" | "won" | "lost" | "nurturing"
  assignedAgent: string
  agentContext: {
    objectionsEncountered: string[]
    preferencesLearned: Record<string, string>
    offersMade: { description: string, date: Date }[]
    topicsDiscussed: string[]
    sentimentTrend: "positive" | "neutral" | "negative" | "unknown"
  }
  currentSummary: string           // LLM-generated, refreshed every N messages
  followUpSchedule: {
    nextFollowUpAt: Date | null
    reason: string | null
    cadenceId: string | null
  }
  lastOutcomeAt: Date | null
  messageCount: number
  createdAt: Date
  updatedAt: Date
}
```

**Lifespan:** Days to weeks (lifecycle of a lead).

**Owned by:** Lead Responder, Sales Closer, Nurture (handed off between them as stage progresses).

**Storage:** Prisma model. Raw message history stays in existing `ConversationMessage` table — the thread object stores derived state, not full history.

### 4.2 WorkflowExecution

A bounded multi-step task that may pause for approvals, events, or schedules.

```
WorkflowExecution {
  id: string
  organizationId: string
  triggerType: "event" | "schedule" | "operator_command" | "agent_initiated"
  triggerRef: string | null          // event ID, schedule ID, or operator command ID
  sourceAgent: string | null
  status: WorkflowStatus
  plan: WorkflowPlan
  currentStepIndex: number
  safetyEnvelope: {
    maxSteps: number
    maxDollarsAtRisk: number
    timeoutMs: number
    maxReplans: number
  }
  counters: {
    stepsCompleted: number
    dollarsAtRisk: number
    replansUsed: number
  }
  metadata: Record<string, unknown>  // domain-specific substates
  traceId: string
  error: string | null
  errorCode: string | null
  startedAt: Date
  completedAt: Date | null
}
```

**Lifespan:** Minutes to days, sometimes weeks for long-running business processes.

**Examples:** "Pause underperforming ad sets", "Follow up with 5 hot leads over the next 3 days", "If no payment by Friday, escalate."

### 4.3 OperatorCommand

A founder/admin instruction issued via chat (Telegram, WhatsApp, or dashboard).

```
OperatorRequest {
  id: string
  organizationId: string
  operatorId: string
  channel: "telegram" | "whatsapp" | "dashboard"
  rawInput: string
  receivedAt: Date
}

OperatorCommand {
  id: string
  requestId: string                  // links to OperatorRequest
  organizationId: string
  intent: string                     // e.g., "follow_up_leads", "pause_campaigns", "show_pipeline"
  entities: { type: string, id?: string, filter?: Record<string, unknown> }[]
  parameters: Record<string, unknown>
  parseConfidence: number
  guardrailResult: {
    canExecute: boolean
    requiresConfirmation: boolean
    requiresPreview: boolean
    warnings: string[]
    missingEntities: string[]
    riskLevel: "low" | "medium" | "high" | "critical"
    ambiguityFlags: string[]
  }
  status: "parsed" | "confirmed" | "executing" | "completed" | "failed" | "rejected"
  workflowIds: string[]             // WorkflowExecutions spawned by this command
  resultSummary: string | null       // formatted for operator's channel
  createdAt: Date
  completedAt: Date | null
}
```

**Active handling:** Seconds to minutes.

**Record retention:** Durable history for audit, replay, and "what did I ask yesterday?"

---

## 5. Workflow State Machine

```
                          ┌──► awaiting_approval ──► running (approved)
                          │                       └► cancelled (rejected)
                          │
pending ──► running ──────┼──► awaiting_event ─────► running (event received)
                          │                       └► failed (timeout)
                          │
                          ├──► scheduled ──────────► running (trigger fires)
                          │                       └► cancelled
                          │
                          ├──► blocked ────────────► running (unblocked)
                          │                       └► failed (timeout)
                          │
                          ├──► completed
                          ├──► failed
                          └──► cancelled
```

**Valid transitions:**

| From                | To                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `pending`           | `running`, `cancelled`                                                                            |
| `running`           | `awaiting_approval`, `awaiting_event`, `scheduled`, `blocked`, `completed`, `failed`, `cancelled` |
| `awaiting_approval` | `running`, `cancelled`                                                                            |
| `awaiting_event`    | `running`, `failed`                                                                               |
| `scheduled`         | `running`, `cancelled`                                                                            |
| `blocked`           | `running`, `failed`                                                                               |
| `completed`         | (terminal)                                                                                        |
| `failed`            | (terminal)                                                                                        |
| `cancelled`         | (terminal)                                                                                        |

Domain-specific substates (e.g., "waiting for lead reply", "waiting for Meta API") live in `WorkflowExecution.metadata`, not the state machine.

---

## 6. PendingAction

The atomic unit of agent output. Replaces raw action emission.

```
PendingAction {
  id: string
  idempotencyKey: string
  workflowId: string | null
  stepIndex: number | null
  status: "proposed" | "approved" | "executing" | "completed" | "failed" | "rejected" | "expired"

  // Intent
  intent: string                     // e.g., "pause_campaign", "send_follow_up", "update_deal_stage"
  targetEntities: { type: string, id: string }[]
  parameters: Record<string, unknown>
  humanSummary: string               // "Pause campaign 'Summer Sale' — ROAS dropped below 2.0"

  // Risk assessment
  confidence: number                 // 0.0–1.0
  riskLevel: "low" | "medium" | "high" | "critical"
  dollarsAtRisk: number
  requiredCapabilities: string[]     // e.g., ["ads.campaign.pause"]
  dryRunSupported: boolean

  // Approval routing
  approvalRequired: "auto" | "human_review" | "operator_approval"
  fallback: { action: string, reason: string } | null

  // Source
  sourceAgent: string
  sourceWorkflow: string | null
  organizationId: string

  // Lifecycle
  createdAt: Date
  expiresAt: Date | null
  resolvedAt: Date | null
  resolvedBy: string | null          // "policy_engine", "operator:<id>", "auto"
}
```

**Flow:** Agent emits PendingAction → PolicyEngine evaluates → auto-execute / request approval / reject → StepExecutor runs permitted action → ActionEvent recorded.

---

## 7. WorkflowPlan

Rolling plan with bounded re-planning.

```
WorkflowPlan {
  steps: WorkflowStep[]
  strategy: "sequential" | "parallel_where_possible"
  replannedCount: number
}

WorkflowStep {
  index: number
  action: PendingAction
  dependsOn: number[]               // indices of prerequisite steps
  status: "pending" | "executing" | "completed" | "failed" | "skipped"
  result: Record<string, unknown> | null
}
```

**Re-planning rules:**

- Initial plan: 1–3 next steps only
- After each step completes, agent re-evaluates context and may revise remaining steps
- Re-planning triggers: step failure, unexpected result, external event, approval with modifications
- Bounded: `safetyEnvelope.maxReplans` limits total re-plans per workflow
- Re-planning produces a new set of 1–3 next steps, not a full replacement

---

## 8. ApprovalCheckpoint

A pause point requiring human decision.

```
ApprovalCheckpoint {
  id: string
  workflowId: string
  stepIndex: number
  action: PendingAction
  reason: string                     // "Budget change exceeds $500 threshold"
  options: ("approve" | "reject" | "modify")[]
  modifiableFields: string[]         // e.g., ["parameters.budget", "parameters.schedule"]
  alternatives: { label: string, parameters: Record<string, unknown> }[]  // system-proposed options
  notifyChannels: ("telegram" | "whatsapp" | "dashboard")[]
  status: "pending" | "approved" | "rejected" | "modified" | "expired"
  resolution: {
    decidedBy: string
    decidedAt: Date
    selectedAlternative: number | null
    fieldEdits: Record<string, unknown> | null
  } | null
  createdAt: Date
  expiresAt: Date
}
```

**Modify semantics (constrained):**

- Structured field edits only, within declared `modifiableFields`
- Or select from system-proposed `alternatives`
- No free-form modification at launch

---

## 9. Operator Chat Module

First-class control surface, not an add-on.

### Flow

```
Operator message (Telegram/WhatsApp/Dashboard)
        │
        ▼
┌─ CommandInterpreter ──────────┐
│  LLM parses NL → structured  │
│  OperatorRequest → Command    │
└───────────┬───────────────────┘
            │
            ▼
┌─ CommandGuardrailEvaluator ───┐
│  Confidence, ambiguity, risk, │
│  missing entities, preview    │
│  required, policy scope       │
└───────────┬───────────────────┘
            │
            ▼
┌─ CommandRouter ───────────────┐
│  Routes to domain agent or    │
│  spawns WorkflowExecution     │
└───────────┬───────────────────┘
            │
            ▼
┌─ SummaryFormatter ────────────┐
│  Formats result for channel   │
│  (Telegram-compact or         │
│   dashboard-rich)             │
└───────────────────────────────┘
```

### Operator Identity

The operator is identified by their contact record (`role: "operator"` on `CrmContact` or a dedicated `OperatorProfile`). Same WhatsApp/Telegram identity, but the system routes to `OperatorHandler` instead of `LeadHandler`. Dashboard chat uses the authenticated session directly.

### Launch Commands

| Command Pattern                   | Intent               | Target Agent             |
| --------------------------------- | -------------------- | ------------------------ |
| "follow up with hot leads"        | `follow_up_leads`    | Lead Responder / Nurture |
| "pause low-performing ad sets"    | `pause_campaigns`    | Ad Optimizer             |
| "show me pipeline"                | `show_pipeline`      | CRM read-only            |
| "move these leads to nurture"     | `reassign_leads`     | Lead Responder → Nurture |
| "draft a campaign for product A"  | `draft_campaign`     | Ad Optimizer             |
| "what happened with [lead name]?" | `query_lead_history` | CRM read-only            |

---

## 10. Scheduler Service

First-class runtime primitive alongside EventLoop and WorkflowEngine.

```
SchedulerService {
  registerTrigger(trigger: ScheduledTrigger): Promise<string>
  cancelTrigger(triggerId: string): Promise<void>
  listPendingTriggers(filters: TriggerFilters): Promise<ScheduledTrigger[]>
}

ScheduledTrigger {
  id: string
  organizationId: string
  type: "timer" | "cron" | "event_match"
  // timer: fires once at fireAt
  fireAt: Date | null
  // cron: fires on schedule
  cronExpression: string | null
  // event_match: fires when matching event arrives
  eventPattern: { type: string, filters: Record<string, unknown> } | null
  // what to do when triggered
  action: {
    type: "spawn_workflow" | "resume_workflow" | "emit_event"
    payload: Record<string, unknown>
  }
  sourceWorkflowId: string | null
  status: "active" | "fired" | "cancelled" | "expired"
  createdAt: Date
  expiresAt: Date | null
}
```

**Implementation:** BullMQ delayed jobs for timer-based triggers (already in the stack). Cron via BullMQ repeatable jobs. Event-match triggers checked by EventLoop on event dispatch.

**Central to:** Follow-ups, nurture cadences, delayed approval expiry, "run tomorrow" commands, ad performance rechecks, "if no payment by Friday" conditions.

---

## 11. Module Structure

```
packages/core/src/
  workflows/
    workflow-engine.ts            — multi-step execution orchestrator
    workflow-plan.ts              — plan creation, step tracking, re-planning
    workflow-state-machine.ts     — 9-state transitions
    pending-action.ts             — structured action types + helpers
    approval-checkpoint.ts        — pause/notify/resume for approvals
    step-executor.ts              — executes one PendingAction through PolicyEngine
    store-interfaces.ts           — persistence contracts for workflows

  conversations/
    conversation-thread.ts        — per-contact state (not message storage)
    conversation-thread-store.ts  — persistence interface

  scheduler/
    scheduler-service.ts          — register/cancel/list triggers
    trigger-store.ts              — persistence interface
    trigger-types.ts              — timer, cron, event-match definitions

packages/schemas/src/
  workflow.ts                     — WorkflowExecution, WorkflowPlan, WorkflowStep, PendingAction
  conversation-thread.ts          — ConversationThread types
  operator-command.ts             — OperatorRequest, OperatorCommand, GuardrailResult

packages/agents/src/
  planning/
    agent-planner.ts              — LLM produces 1-3 step plans given context
    plan-context-builder.ts       — assembles context for planning (thread, history, tools)

  operator/
    command-interpreter.ts        — NL → OperatorCommand (LLM-powered)
    command-router.ts             — routes command to agent or workflow
    command-guardrail-evaluator.ts — confidence, ambiguity, risk, preview
    summary-formatter.ts          — formats results for Telegram/dashboard

apps/chat/src/
  handlers/
    lead-handler.ts               — keep (customer conversations)
    operator-handler.ts           — NEW: operator identity → command interpreter

apps/dashboard/src/
  components/
    operator-chat/                — embedded chat widget
    approval-queue/               — list/approve/reject pending actions
```

---

## 12. Responsibility Boundaries

| Concern                                           | Owner              | Does NOT                   |
| ------------------------------------------------- | ------------------ | -------------------------- |
| Receive events, dispatch to handlers              | EventLoop          | Manage workflow state      |
| Route conversational events to domain agents      | ConversationRouter | Execute actions            |
| Own execution state transitions, step progression | WorkflowEngine     | Listen for events directly |
| Evaluate and enforce action permissions           | PolicyEngine       | Execute actions            |
| Execute a single permitted PendingAction          | StepExecutor       | Decide whether to execute  |
| Register and fire time/event triggers             | SchedulerService   | Execute triggered actions  |
| Persist workflow/thread/command state             | Store layer        | Contain business logic     |

EventLoop dispatches. WorkflowEngine orchestrates. PolicyEngine gates. StepExecutor acts. These do not overlap.

---

## 13. Phased Migration

### Phase 1: OpenClaw Removal (Clean Slate)

**Risk:** Low | **Value:** Hygiene | **Size:** Small

Remove all OpenClaw gateway code. Preserve session manager core for Phase 3 redesign. Clean compile, all tests pass.

### Phase 2: ConversationThread + Agent Memory

**Risk:** Medium | **Value:** Very High | **Size:** Medium

Add persistent per-contact conversation state. Agents remember across messages: objections, preferences, offers, context. Wire thread loading into ConversationRouter. Biggest impact for customer #1.

**Customer #1 viable after this phase.**

### Phase 3: WorkflowEngine + PendingAction + Approvals

**Risk:** Medium-High | **Value:** High | **Size:** Large

Redesign session models into workflow types. Implement 9-state machine. Build WorkflowEngine, StepExecutor, PendingAction flow, ApprovalCheckpoint with constrained modify. Approval queue in dashboard. Can be split: 3a (PendingAction + policy integration), 3b (WorkflowEngine + state machine), 3c (approval UI).

### Phase 4: Scheduler Service

**Risk:** Low-Medium | **Value:** High | **Size:** Medium

BullMQ-backed trigger service. Follow-ups, cadences, delayed approvals, timed rechecks. Wire into WorkflowEngine for `awaiting_event` and `scheduled` states.

### Phase 5: Operator Chat + Command Layer

**Risk:** Medium | **Value:** High | **Size:** Large

CommandInterpreter, CommandGuardrailEvaluator, CommandRouter, SummaryFormatter. Operator identity detection in chat app. Dashboard chat widget. Durable command history.

---

## 14. Risks and Mitigations

| Risk                                                 | Mitigation                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 breaks session API consumers                 | Check current usage. If only tests, low risk. Stub endpoints if dashboard depends on them.                                                                           |
| ConversationThread adds complexity to agent handlers | Thread loading/saving lives in ConversationRouter. Agents receive thread as input, return updated context.                                                           |
| Phase 3 is the largest and has the most moving parts | Split into 3a/3b/3c. Each sub-phase is independently testable.                                                                                                       |
| Rolling re-planning could loop                       | Safety envelope `maxReplans` bounds total re-plans. Max 3 re-plans per workflow by default.                                                                          |
| Operator command parsing accuracy                    | Narrow launch vocabulary. Structured prompts with examples. Graceful fallback: "I didn't understand, did you mean X?"                                                |
| Scheduler reliability across restarts                | BullMQ delayed jobs persist in Redis. Reconciliation sweep on startup.                                                                                               |
| Prisma model rename migration (Phase 3)              | Use `@@map` where possible. Write proper migration with data transformation for schema changes.                                                                      |
| ConversationThread summary drift                     | Regenerate summary every N messages via LLM compression, not just append.                                                                                            |
| WorkflowEngine becomes a second EventLoop            | Hard boundary: EventLoop dispatches events, WorkflowEngine manages execution state. If WorkflowEngine subscribes to events directly, the boundary has been violated. |

---

## 15. What Success Looks Like

After this refactor, Switchboard supports:

- **Autonomous lead response** with memory across conversations
- **Sales follow-up and nurturing** with persistent context and scheduled cadences
- **CRM pipeline updates** through structured, approved actions
- **Bounded ad-ops actions** with safety envelopes and approval checkpoints
- **Founder/operator control through chat** (Telegram, WhatsApp, dashboard)
- **Human approvals where needed** with constrained modification options

All within one coherent Switchboard-native architecture. No external runtime. Domain agents are the brains. The runtime serves them.
