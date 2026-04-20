# SP3: Execution Traces + Lightweight Safety Gates

**Date:** 2026-04-15
**Status:** Draft
**Governing sentence:** SP3 makes every skill execution inspectable and safe, so Switchboard can prove business impact and contain failures before expanding to more agents.

---

## Problem

SP1 proved one skill works. SP2 makes migration mechanical. But neither answers: "Did this skill execution actually help the business?"

The current executor returns `SkillExecutionResult` with tool calls and token usage, then discards it. Nobody persists the trace. Nobody links it to a business outcome. Nobody tracks whether an agent is failing repeatedly. Nobody caps how many writes an agent can make in a window.

This means:

- **No revenue-loop closure** — you can't prove website-profiler improved qualification or that sales-pipeline improved booking rates
- **No production debugging** — when something goes wrong, you reconstruct from ActivityLog fragments and conversation threads
- **No safety containment** — a misbehaving agent fails silently until a human notices, and nothing prevents it from spamming CRM writes

## SP3 Goal

Make the skill runtime legible, measurable, and safe. Prove it by linking a sales-pipeline execution trace to an opportunity outcome.

**SP3 is not:**

- An analytics/dashboarding platform (the dashboard trace view is a read-only list, not charts)
- A batch/async execution model (that's SP4)
- A prompt regression testing framework (that's eval infrastructure, separate track)
- A replacement for ActivityLog (traces supplement, not replace existing activity logging)

### SP3 is complete when:

- Every skill execution persists a trace
- Traces are listable per deployment via API and dashboard
- At least one sales-pipeline execution can be linked to an opportunity outcome
- 5+ failures in a 1-hour window prevent further execution (circuit breaker)
- 50+ writes in a 1-hour window prevent further execution (blast radius)
- Trace persistence failure does not block end-user response

### Privacy boundary

SP3 avoids persisting raw prompt parameters or full assistant responses in trace storage to reduce PII duplication. Parameters are stored as a SHA-256 hash (for dedup detection). Responses are truncated to a 500-char summary. Full data lives in the conversation thread and session context, which are already persisted and access-controlled.

---

## What SP3 Delivers

### Must Have

| Deliverable                                             | Location                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| `SkillExecutionTrace` type                              | `packages/core/src/skill-runtime/types.ts`                  |
| `ExecutionTraceStore` interface + Prisma impl           | `packages/db/src/stores/prisma-execution-trace-store.ts`    |
| `ExecutionTrace` Prisma model                           | `packages/db/prisma/schema.prisma`                          |
| Executor emits trace after every execution              | Modify `packages/core/src/skill-runtime/skill-executor.ts`  |
| SkillHandler persists trace via store                   | Modify `packages/core/src/skill-runtime/skill-handler.ts`   |
| Outcome linking (trace → opportunity stage change)      | `packages/core/src/skill-runtime/outcome-linker.ts`         |
| Circuit breaker (repeated failures in window → disable) | `packages/core/src/skill-runtime/circuit-breaker.ts`        |
| Blast radius limiter (max writes per window)            | `packages/core/src/skill-runtime/blast-radius-limiter.ts`   |
| API routes for trace listing + detail                   | Modify `apps/api/src/routes/marketplace.ts`                 |
| Dashboard trace list page                               | `apps/dashboard/src/app/dashboard/deployments/[id]/traces/` |
| Safety gate fields on AgentDeployment                   | `packages/db/prisma/schema.prisma`                          |

### Explicitly NOT in SP3

- Real-time metrics dashboards or charts
- Automated alerting/paging
- Trace-based eval regression testing
- Custom trace retention policies
- Cross-skill trace correlation (tracing a lead across sales-pipeline → website-profiler → ad-optimizer)
- Business outcome attribution modeling (just link trace → outcome, no causal analysis)
- Batch execution traces (SP4 concern)

---

## Architecture

### 1. SkillExecutionTrace

The executor already builds `ToolCallRecord[]` and `tokenUsage`. SP3 wraps that in a persistent trace.

```typescript
interface SkillExecutionTrace {
  id: string; // cuid
  deploymentId: string;
  organizationId: string;
  skillSlug: string;
  skillVersion: string;

  // Trigger context
  trigger: "chat_message" | "batch_job"; // chat_message for SP3, batch_job reserved for SP4
  sessionId: string; // conversation/session that triggered this
  inputParametersHash: string; // SHA-256 of JSON.stringify(sortedParams) — for dedup, not storage

  // Execution details
  toolCalls: ToolCallRecord[]; // same shape as today
  governanceDecisions: GovernanceLogEntry[]; // from SP2
  tokenUsage: { input: number; output: number };
  durationMs: number;
  turnCount: number; // how many LLM turns in the loop

  // Outcome
  status: "success" | "error" | "budget_exceeded" | "denied";
  error?: string; // error message if status !== "success"
  responseSummary: string; // first 500 chars of LLM response (for list views)

  // Business outcome linking (populated async, not at execution time)
  linkedOutcomeId?: string; // opportunity ID, task ID, or campaign ID
  linkedOutcomeType?: "opportunity" | "task" | "campaign";
  linkedOutcomeResult?: string; // "stage_advanced" | "booking_created" | "qualified" | etc.

  // Safety
  writeCount: number; // count of internal_write + external_write tool calls

  createdAt: Date;
}
```

**Why `inputParametersHash` instead of storing full parameters?** Parameters can contain PII (lead profiles, contact info). Storing a hash lets you detect duplicate inputs without persisting sensitive data. The full parameters are available in the live execution and can be reconstructed from the session context if needed for debugging.

**Why `responseSummary` instead of full response?** Full responses go to the conversation thread (already persisted). The trace needs just enough to identify what happened in a list view. 500 chars is sufficient for "Qualified lead, moved to quoted stage" or "Invalid URL provided."

### 2. Prisma Model

```prisma
model ExecutionTrace {
  id                   String    @id @default(cuid())
  deploymentId         String
  organizationId       String
  skillSlug            String
  skillVersion         String

  trigger              String    @default("chat_message")
  sessionId            String
  inputParametersHash  String

  toolCalls            Json      @default("[]")     // ToolCallRecord[]
  governanceDecisions  Json      @default("[]")     // GovernanceLogEntry[]
  tokenUsage           Json      @default("{}")     // { input, output }
  durationMs           Int
  turnCount            Int

  status               String                       // success | error | budget_exceeded | denied
  error                String?
  responseSummary      String

  linkedOutcomeId      String?
  linkedOutcomeType    String?
  linkedOutcomeResult  String?

  writeCount           Int       @default(0)

  createdAt            DateTime  @default(now())

  @@index([deploymentId, createdAt])
  @@index([organizationId, createdAt])
  @@index([status])
  @@index([sessionId])
}
```

**Indexes:** Primary query patterns are "show traces for this deployment" (trace list page) and "find recent failures for this deployment" (circuit breaker). Session index provides the primary join key for current conversational traces — sufficient for SP3, but cross-channel session correlation may need additional identifiers in the future.

### 3. ExecutionTraceStore

```typescript
interface ExecutionTraceStore {
  /** Persist a trace after execution */
  create(trace: SkillExecutionTrace): Promise<void>;

  /** List traces for a deployment, newest first */
  listByDeployment(
    orgId: string,
    deploymentId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<{ traces: SkillExecutionTrace[]; nextCursor?: string }>;

  /** Get a single trace by ID */
  findById(orgId: string, traceId: string): Promise<SkillExecutionTrace | null>;

  /** Link a trace to a business outcome */
  linkOutcome(
    traceId: string,
    outcome: { id: string; type: "opportunity" | "task" | "campaign"; result: string },
  ): Promise<void>;

  /** Count recent failures for circuit breaker */
  countRecentFailures(deploymentId: string, windowMs: number): Promise<number>;

  /** Count writes in current window for blast radius */
  countWritesInWindow(deploymentId: string, windowMs: number): Promise<number>;
}
```

Six methods. The store is query-focused — no complex aggregation, no analytics. The circuit breaker and blast radius queries are simple WHERE clauses on the indexed columns.

### 4. Executor Changes

The executor currently returns `SkillExecutionResult`. SP3 adds trace emission without changing the return type — the handler is responsible for persisting.

```typescript
// SkillExecutionResult gets one new field:
interface SkillExecutionResult {
  response: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
  trace: SkillExecutionTraceData; // NEW — raw trace data, no ID yet
}

interface SkillExecutionTraceData {
  durationMs: number;
  turnCount: number;
  status: "success" | "error" | "budget_exceeded" | "denied";
  error?: string;
  responseSummary: string;
  writeCount: number;
  governanceDecisions: GovernanceLogEntry[];
}
```

The executor computes these values from data it already has:

- `durationMs` — `Date.now() - startTime` (already tracked)
- `turnCount` — already tracked
- `status` — derived from how execution ended (success, caught error, budget error)
- `writeCount` — count tool calls where `governanceTier` is `internal_write` or `external_write`
- `governanceDecisions` — built from existing governance checks (already computed, just not collected)

**No new dependencies** for the executor. It computes trace data from values it already has.

### 5. SkillHandler Changes

The handler owns trace assembly and persistence. The executor knows nothing about trace IDs — it computes raw trace data, the handler wraps it with business context (deployment, org, session) and persists.

**Why the handler, not the executor?** The handler has the full business context (deployment ID, org ID, session ID, parameter hash) that the executor doesn't and shouldn't have. The executor is a stateless execution engine. The handler is the orchestration boundary that bridges execution → persistence.

```typescript
async onMessage(ctx: AgentContext): Promise<void> {
  // Safety gates first (circuit breaker + blast radius — see sections 7-8)
  // ... existing builder flow ...

  const result = await this.executor.execute({ ... });

  // Handler owns trace ID — executor doesn't know about it
  const trace: SkillExecutionTrace = {
    id: createId(),            // cuid — generated here, not passed to executor
    deploymentId: this.config.deploymentId,
    organizationId: this.config.orgId,
    skillSlug: this.skill.slug,
    skillVersion: this.skill.version,
    trigger: "chat_message",
    sessionId: ctx.sessionId,
    inputParametersHash: hashParameters(parameters),
    toolCalls: result.toolCalls,
    governanceDecisions: result.trace.governanceDecisions,
    tokenUsage: result.tokenUsage,
    durationMs: result.trace.durationMs,
    turnCount: result.trace.turnCount,
    status: result.trace.status,
    error: result.trace.error,
    responseSummary: result.response.slice(0, 500),
    writeCount: result.trace.writeCount,
    createdAt: new Date(),
  };

  // Persist trace — await because outcome linker needs the record to exist
  try {
    await this.traceStore.create(trace);
    await this.outcomeLinker.linkFromToolCalls(trace.id, result.toolCalls);
  } catch (err) {
    // Tracing failures must not block the user
    console.error(`Trace persistence failed for ${trace.id}:`, err);
  }

  await ctx.chat.send(result.response);
}
```

**Error handling:** Trace persistence and outcome linking are wrapped in try/catch. If either fails, log the error and still send the response. Tracing is important but never blocks the user.

### 6. Outcome Linker

Links traces to business outcomes by inspecting tool calls after execution. The handler awaits trace persistence, then runs outcome linking with the trace ID it generated.

**Sequencing:** The handler must `await` trace creation before calling the outcome linker, because `linkOutcome` updates the trace record. Both are wrapped in try/catch — see Section 5.

**Trace ID ownership:** The handler generates the trace ID via `createId()`. The executor never sees it. No `traceId` field on `SkillExecutionParams`. The handler assembles the full trace after execution completes.

The `OutcomeLinker` inspects tool calls for business-state-changing operations. It uses `ToolCallRecord.toolId` (string, e.g. `"crm-write"`) and `ToolCallRecord.operation` (string, e.g. `"stage.update"`) — these are separate fields on the existing type, not a combined dotted string.

**One outcome per trace (MVP rule):** A single execution may produce multiple business-state changes (e.g., both an activity log and a stage advance). SP3 records only the most material linked outcome per trace — the first match wins, prioritized by the order of checks in `linkFromToolCalls`. Comprehensive multi-outcome linking is a future concern.

```typescript
class OutcomeLinker {
  constructor(private traceStore: ExecutionTraceStore) {}

  async linkFromToolCalls(traceId: string, toolCalls: ToolCallRecord[]): Promise<void> {
    for (const call of toolCalls) {
      // Stage update → link to opportunity
      if (call.toolId === "crm-write" && call.operation === "stage.update") {
        const params = call.params as { opportunityId?: string };
        const result = call.result as { stage?: string } | undefined;
        if (params.opportunityId && result?.stage) {
          await this.traceStore.linkOutcome(traceId, {
            id: params.opportunityId,
            type: "opportunity",
            result: `stage_${result.stage}`,
          });
          return; // One outcome per trace
        }
      }

      // Activity log opt-out → link as outcome
      if (call.toolId === "crm-write" && call.operation === "activity.log") {
        const params = call.params as { eventType?: string };
        if (params.eventType === "opt-out") {
          await this.traceStore.linkOutcome(traceId, {
            id: traceId, // self-referential — the trace IS the outcome record
            type: "task",
            result: "opt_out",
          });
          return;
        }
      }
    }
    // No business outcome detected — trace stays unlinked (normal for read-only interactions)
  }
}
```

**Extensibility:** When SP4 adds batch skills with new tool types (e.g., `ads-write.campaign.update`), new outcome-linking rules are added to the same class. The pattern is: inspect tool calls → match known outcome patterns → link. No plugin system — just a growing switch.

---

### 7. Circuit Breaker

Stops a deployment from executing if it's failing too much. Simple, stateless, query-based.

```typescript
interface CircuitBreakerConfig {
  maxFailuresInWindow: number; // default: 5
  windowMs: number; // default: 3600000 (1 hour)
}

class CircuitBreaker {
  constructor(
    private traceStore: ExecutionTraceStore,
    private config: CircuitBreakerConfig = {
      maxFailuresInWindow: 5,
      windowMs: 3_600_000,
    },
  ) {}

  /**
   * Check if a deployment should be allowed to execute.
   * Returns { allowed: true } or { allowed: false, reason: string }.
   */
  async check(deploymentId: string): Promise<{ allowed: boolean; reason?: string }> {
    const failureCount = await this.traceStore.countRecentFailures(
      deploymentId,
      this.config.windowMs,
    );

    if (failureCount >= this.config.maxFailuresInWindow) {
      return {
        allowed: false,
        reason: `Circuit breaker tripped: ${failureCount} failures in the last ${this.config.windowMs / 60_000} minutes. Routing to human escalation.`,
      };
    }

    return { allowed: true };
  }
}
```

**Where it runs:** In `SkillHandler.onMessage()`, before calling the builder or executor:

```typescript
async onMessage(ctx: AgentContext): Promise<void> {
  // Safety gates first
  const cbResult = await this.circuitBreaker.check(this.config.deploymentId);
  if (!cbResult.allowed) {
    await ctx.chat.send(
      "I'm having some trouble right now. Let me connect you with the team directly."
    );
    // Log the circuit breaker trip
    console.error(`Circuit breaker: ${cbResult.reason}`);
    return;
  }

  // ... existing flow ...
}
```

**No state management.** The circuit breaker queries the trace store every time. This is a single indexed COUNT query — fast enough for per-message checks. No in-memory state, no reset logic, no half-open states. If failures stop, the count naturally drops below threshold as old traces age out of the window.

**Why not a stateful circuit breaker?** Switchboard runs across multiple processes (API + chat). In-memory state would need shared storage anyway. Querying the trace store is simpler and correct by default.

### 8. Blast Radius Limiter

Caps write operations per deployment per time window.

```typescript
interface BlastRadiusConfig {
  maxWritesPerWindow: number; // default: 50
  windowMs: number; // default: 3600000 (1 hour)
}

class BlastRadiusLimiter {
  constructor(
    private traceStore: ExecutionTraceStore,
    private config: BlastRadiusConfig = {
      maxWritesPerWindow: 50,
      windowMs: 3_600_000,
    },
  ) {}

  async check(deploymentId: string): Promise<{ allowed: boolean; reason?: string }> {
    const writeCount = await this.traceStore.countWritesInWindow(
      deploymentId,
      this.config.windowMs,
    );

    if (writeCount >= this.config.maxWritesPerWindow) {
      return {
        allowed: false,
        reason: `Blast radius limit: ${writeCount} writes in the last ${this.config.windowMs / 60_000} minutes (max ${this.config.maxWritesPerWindow}).`,
      };
    }

    return { allowed: true };
  }
}
```

**Where it runs:** Same place as circuit breaker — in `SkillHandler.onMessage()`, before execution:

```typescript
const brResult = await this.blastRadiusLimiter.check(this.config.deploymentId);
if (!brResult.allowed) {
  await ctx.chat.send(
    "I've been quite active recently. Let me connect you with the team for this one.",
  );
  console.error(`Blast radius: ${brResult.reason}`);
  return;
}
```

**Pre-execution gating, not mid-execution interception.** The blast radius check runs before the skill executes. If a deployment is at 49 writes and the next execution performs 5 writes, the total exceeds the limit — but the execution completes. The check only prevents the _next_ execution from starting. This is coarse gating, not hard per-write enforcement. Fine-grained mid-execution write interception is a future concern if needed.

**Per-deployment config:** The defaults (50 writes/hour) are conservative. In the future, `AgentDeployment.governanceSettings` could override these per deployment. For SP3, defaults only.

### 9. AgentDeployment Safety Fields

Two new optional fields on `AgentDeployment`:

```prisma
model AgentDeployment {
  // ... existing fields ...
  circuitBreakerThreshold  Int?   // Override default (5). Null = use default.
  maxWritesPerHour          Int?   // Override default (50). Null = use default.
}
```

These are optional overrides — the circuit breaker and blast radius limiter use defaults when null. No migration complexity.

### 10. API Routes

Two new endpoints on the existing marketplace routes:

```
GET /api/marketplace/deployments/:deploymentId/traces
  Query: limit, cursor
  Response: { traces: SkillExecutionTrace[], nextCursor? }

GET /api/marketplace/traces/:traceId
  Response: SkillExecutionTrace (full detail)
```

Same auth pattern as existing marketplace routes (org-scoped, deployment ownership verified). Trace endpoints live on the marketplace routes because deployments are the marketplace surface — traces are scoped to deployments, and the deployment CRUD already lives here.

### 11. Dashboard Trace View

A single new page: `/dashboard/deployments/[id]/traces`

**Trace list:** Table with columns: timestamp, skill, status (success/error badge), duration, tool calls count, write count, linked outcome, response summary (truncated).

**Trace detail:** Click a row to expand inline (not a separate page). Shows: full tool call sequence with params/results, governance decisions, token usage, linked outcome details.

**No charts.** No analytics. Just a readable log. This is an inspection tool, not a dashboard.

---

## Changes to Existing Code

### Modified Files

| File                                                | Change                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/skill-runtime/types.ts`          | Add `SkillExecutionTrace`, `SkillExecutionTraceData` types. Add `trace` field to `SkillExecutionResult`. No changes to `SkillExecutionParams` (trace ID is handler-owned). |
| `packages/core/src/skill-runtime/skill-executor.ts` | Compute trace data (duration, turnCount, status, writeCount, governanceDecisions) and include in result. No trace ID awareness.                                            |
| `packages/core/src/skill-runtime/skill-handler.ts`  | Assemble full trace, persist via store, run circuit breaker + blast radius checks before execution, call outcome linker after.                                             |
| `packages/core/src/skill-runtime/index.ts`          | Export new modules.                                                                                                                                                        |
| `packages/core/src/channel-gateway/types.ts`        | Add `ExecutionTraceStore`, `CircuitBreaker`, `BlastRadiusLimiter`, `OutcomeLinker` to `SkillRuntimeDeps`.                                                                  |
| `packages/db/prisma/schema.prisma`                  | Add `ExecutionTrace` model. Add safety fields to `AgentDeployment`.                                                                                                        |
| `apps/api/src/routes/marketplace.ts`                | Add trace list + detail endpoints.                                                                                                                                         |

### New Files

| File                                                                | Purpose                                        |
| ------------------------------------------------------------------- | ---------------------------------------------- |
| `packages/db/src/stores/prisma-execution-trace-store.ts`            | Prisma implementation of `ExecutionTraceStore` |
| `packages/db/src/stores/prisma-execution-trace-store.test.ts`       | Store tests                                    |
| `packages/core/src/skill-runtime/circuit-breaker.ts`                | Circuit breaker implementation                 |
| `packages/core/src/skill-runtime/circuit-breaker.test.ts`           | Circuit breaker tests                          |
| `packages/core/src/skill-runtime/blast-radius-limiter.ts`           | Blast radius limiter implementation            |
| `packages/core/src/skill-runtime/blast-radius-limiter.test.ts`      | Blast radius limiter tests                     |
| `packages/core/src/skill-runtime/outcome-linker.ts`                 | Outcome linking logic                          |
| `packages/core/src/skill-runtime/outcome-linker.test.ts`            | Outcome linker tests                           |
| `apps/dashboard/src/app/dashboard/deployments/[id]/traces/page.tsx` | Trace list page                                |
| `apps/dashboard/src/hooks/use-traces.ts`                            | React Query hooks for trace API                |

---

## Risks

| Risk                                                              | Mitigation                                                                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trace persistence slows down response                             | Trace persistence is a single INSERT — fast. If it fails, catch and log, still send response.                                                                     |
| Trace store grows unbounded                                       | Add `createdAt` index. Retention cleanup is a future concern (not SP3). Conservative: 30 days of traces for a busy deployment is ~50K rows.                       |
| Circuit breaker false positive (transient error triggers it)      | Window-based: 5 failures in a 1-hour window (not consecutive). 5 failures in an hour is a real pattern, not a blip. Defaults are conservative.                    |
| Blast radius limiter blocks legitimate high-volume agent          | Defaults (50/hour) are generous. Per-deployment override available via `maxWritesPerHour`.                                                                        |
| Outcome linker misattributes                                      | One outcome per trace, linked by inspecting tool calls. Clear causal chain: this trace executed this tool call which changed this opportunity. Not probabilistic. |
| Two extra DB queries per message (circuit breaker + blast radius) | Both are indexed COUNT queries on `deploymentId + createdAt`. Sub-millisecond on reasonable data volumes.                                                         |

---

## What Comes After SP3

| Future Work                       | Depends On                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| **SP4: Batch skill execution**    | SP3 traces support `trigger: "batch_job"` — same trace model, different trigger     |
| **Trace-based eval regression**   | Compare trace patterns across skill versions to detect behavioral drift             |
| **Cross-skill trace correlation** | Link traces across skills for a single lead journey (profiler → qualifier → closer) |
| **Alerting**                      | Trigger notifications when circuit breaker trips or blast radius is hit             |
| **Retention policies**            | Auto-delete traces older than N days per deployment                                 |
| **Dashboard analytics**           | Charts: success rate over time, average duration, write volume trends               |
