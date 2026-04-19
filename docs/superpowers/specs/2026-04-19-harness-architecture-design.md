# Switchboard Harness Architecture Spec

> The model is what reasons; the environment determines whether that reasoning is useful, safe, and repeatable.
> Your moat is not the smartest agent. Your moat is the best-governed environment for revenue actions.

This spec defines the canonical governed harness architecture for Switchboard across 8 principles. Each section covers: where the concern lives, what is config vs code, what is enforced mechanically, the data model, the runtime flow, the failure/recovery path, the human handoff path, and a Current vs Target table grounding each principle in reality.

---

## 1. Progressive Disclosure

### Principle

The model's context window is working consciousness, not storage. Every token that isn't load-bearing degrades reasoning. Switchboard must give the minimum context needed to orient, then provide pointers for the model to retrieve more on demand.

### Where This Lives

| Layer                  | Component               | Role                                               |
| ---------------------- | ----------------------- | -------------------------------------------------- |
| `core/skill-runtime`   | `ContextResolver`       | Loads declared knowledge requirements per skill    |
| `core/skill-runtime`   | `TemplateEngine`        | Injects resolved context into skill body           |
| `core/agent-runtime`   | `SystemPromptAssembler` | Builds persona prompt from structured persona data |
| `core/channel-gateway` | `ChannelGateway`        | Caps conversation history at 30 messages           |
| `core/skill-runtime`   | `SkillExecutorImpl`     | Assembles system prompt + governance constraints   |

### Context Assembly Order (Target)

Context must be assembled in strict priority order. Earlier layers consume fewer tokens and provide more orientation. Later layers are optional and retrieved on demand.

```
Layer 1: Operating Context (always injected, <200 tokens)
  - Who am I? (persona name, business, tone)
  - What deployment context? (trust level, governance profile)
  - What governance constraints? (mandatory rules)

Layer 2: Task + Operational State (always injected, <500 tokens)
  - Current skill parameters
  - Current conversation turn (not full history)
  - Active workflow step (if mid-workflow)
  - Current entity/lead state
  - Approval/escalation state
  - Unresolved blockers or risk flags

Layer 3: Relevant Knowledge (injected if declared, bounded)
  - Context-resolved knowledge entries matching skill requirements
  - Capped at MAX_CONTEXT_CHARS per requirement
  - Sorted by priority, then recency

Layer 4: Conversation History (injected, bounded)
  - Recent history, summarized beyond a recency window
  - Raw messages for last N turns
  - Summary digest for older turns

Layer 5: On-Demand Retrieval (tool-accessed, never pre-injected)
  - CRM records, support logs, ad diagnostics
  - Retrieved via tool calls, not context injection
  - Tool results subject to output capping (see Section 3)
```

### What Is Config vs Code

| Concern                          | Config (per-org/deployment)                          | Code (invariant)                                 |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| History window size              | `maxHistoryMessages` on deployment config            | Default `30`, enforced minimum `5`               |
| Knowledge entry cap              | `maxContextCharsPerRequirement` on deployment config | Default `4000`, enforced maximum `8000`          |
| Summary trigger threshold        | `summarizeAfterTurns` on deployment config           | Default `10`, minimum `5`                        |
| Context priority order           | Not configurable                                     | Hardcoded Layer 1-5 order in `SkillExecutorImpl` |
| Which knowledge kinds are loaded | Skill definition `context[]` array                   | Resolver logic                                   |

### Mechanical Enforcement

- `ContextResolver` must enforce `maxContextCharsPerRequirement`: truncate concatenated entries to the cap, preferring higher-priority entries. Currently it concatenates without limit.
- `ChannelGateway` must produce a summary digest for messages older than the recency window instead of discarding them. Currently it hard-truncates at 30.
- Knowledge entries returned by the resolver must be sorted by `priority` descending, then `updatedAt` descending. Currently they arrive in database order.

### Data Model

No new tables. Changes to existing contracts:

```typescript
// Extension to ContextResolver behavior (not a new type)
interface ContextResolutionConfig {
  maxCharsPerRequirement: number; // default 4000
  priorityOrder: "priority_desc" | "recency_desc"; // default priority_desc
}
```

A durable conversation summary artifact must exist in the conversation state layer. Likely stored alongside conversation state; exact schema and location deferred to implementation plan.

### Runtime Flow

1. `ChannelGateway` receives message
2. Loads conversation history from store
3. If history exceeds recency window: loads or generates summary for older messages
4. Builds `SubmitWorkRequest` with `{ recentMessages, historySummary }` instead of raw history
5. `SkillExecutorImpl` assembles system prompt in Layer 1-2-3 order
6. Conversation context (Layer 4) appended as messages
7. Tool results (Layer 5) arrive during execution, subject to output caps

### Failure / Recovery

- If summary generation fails: fall back to current behavior (hard truncation at `maxHistoryMessages`). Log the failure. Do not block the conversation.
- If context resolution exceeds char cap: truncate with a trailing `[... N more entries available via retrieval tool]` marker so the model knows more exists.

### Human Handoff Path

Human handoff uses progressive disclosure at presentation time, not at storage time. Full history remains durable in the store, but the operator surface should default to:

- Compact summary of the conversation and current state
- Recent relevant turns
- Unresolved blocker or escalation reason
- Expandable full history on demand

Operators also suffer from overload. Progressive disclosure applies to human-facing surfaces, not just model-facing context.

### Current vs Target

| Aspect                   | Current                                        | Target                                             | Change Required                                                                                                                  |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Knowledge entry ordering | Database order                                 | Priority desc, recency desc                        | Modify `ContextResolver.resolve()`                                                                                               |
| Knowledge entry size cap | Unlimited concatenation                        | `maxCharsPerRequirement` (default 4000)            | Add truncation + overflow marker in `ContextResolver`                                                                            |
| Conversation history     | Hard truncate at 30 messages                   | Recency window + summary digest for older turns    | Add conversation summary to state layer, summary generation in gateway                                                           |
| Context assembly order   | Implicit (system prompt + governance appended) | Explicit Layer 1-5 priority in `SkillExecutorImpl` | Refactor `execute()` to enforce ordering                                                                                         |
| Retrieval vs injection   | All context pre-injected                       | Layer 5 knowledge accessed via tools only          | Enforce boundaries between pre-injected context and retrieval-only data; add checks against excessive skill context declarations |
| Operator handoff surface | Full raw history in handoff package            | Compact summary first, expandable detail second    | Apply progressive disclosure to handoff presentation                                                                             |

---

## 2. Tool / ACI Surface

### Principle

The interface between the model and the outside world is the real product surface. The model's effectiveness depends on the shape of what it can see and do. Switchboard must expose safe, typed, bounded tool surfaces — not raw system access. Every tool is a product decision: what the model can do, what it cannot, and what information it gets back.

### Where This Lives

| Layer                | Component            | Role                                                            |
| -------------------- | -------------------- | --------------------------------------------------------------- |
| `core/skill-runtime` | `ToolRegistry`       | Registers tools with unique IDs, validates tool-skill bindings  |
| `core/skill-runtime` | `SkillToolOperation` | Defines per-operation schema, governance tier, idempotency flag |
| `core/skill-runtime` | `SkillExecutorImpl`  | Exposes tools to Anthropic API as `{toolId}.{operationName}`    |
| `core/skill-runtime` | `GovernanceHook`     | Gates tool calls by trust level and governance tier             |
| `schemas`            | Zod schemas          | Shared type definitions for tool parameters                     |
| `sdk`                | `AgentContext`       | Typed provider interface for state, chat, files, etc.           |

### Tool Design Rules (Target)

Every tool exposed to skill execution must satisfy all of the following:

```
1. Typed input contract
   - Zod-validated input schema, not Record<string, unknown>
   - Required fields, enums, bounds explicitly declared
   - No passthrough of arbitrary objects

2. Typed output contract
   - Every operation must return a structured ToolResult envelope (standardized)
   - Operations that return domain payloads must define an explicit outputSchema for the payload portion
   - Status-only operations (e.g., "delete succeeded") need only the envelope
   - Results validated before reinjection into model context

3. Bounded arguments
   - Numeric parameters have min/max
   - String parameters have maxLength
   - Array parameters have maxItems
   - No unbounded queries (must require filters)

4. Safe defaults
   - Omitted optional parameters resolve to safe values
   - No operation defaults to destructive behavior
   - Read operations are the baseline; writes require explicit intent

5. Explicit side-effect categories (closed enum)
   - Every operation declares its effect category from a finite set:
     read | propose | simulate | write | external_send | external_mutation | irreversible
   - Effect category drives: governance gating, approval routing, audit depth, retry policy
   - The model never guesses whether an action has side effects
   - New categories require explicit doctrine amendment — this set does not grow casually

6. Structured results with split remediation
   - Success results include: outcome, entity state after action, next valid actions
   - Failure results include: reason code, split remediation (model-facing + operator-facing)
   - Model-facing remediation: what the agent should try next
   - Operator-facing remediation: what a human should know/do if escalated
   - No raw error strings, stack traces, or backend exceptions in model context

7. No raw backend exception leakage (hard invariant)
   - Tool calls must never return raw backend exceptions into model context
   - All errors must be normalized, classified, and wrapped in ToolResult
   - Unsafe details (internal IPs, stack traces, query strings) must be stripped
   - This is a safety invariant, not a style preference

8. Idempotency semantics
   - Every operation declares whether it is idempotent
   - Idempotent operations can be safely retried
   - Non-idempotent operations must explain why and what guard exists

9. Audit trail
   - Every tool call is recorded in ToolCallRecord with params, result, duration, governance decision
   - Records persist in WorkTrace for the work unit
```

### What Is Config vs Code

| Concern                             | Config (per-org/deployment)       | Code (invariant)                                  |
| ----------------------------------- | --------------------------------- | ------------------------------------------------- |
| Which tools a skill can access      | Skill definition `tools[]` array  | Tool-skill validation in `ToolRegistry`           |
| Governance tier per operation       | Not configurable per-org          | Declared per operation in tool definition         |
| Governance override per trust level | `governanceOverride` on operation | Override resolution logic in `GovernanceHook`     |
| Input/output schemas                | Not configurable                  | Declared per operation, validated at registration |
| Tool result size caps               | Configurable per deployment       | Default cap + enforcement in reinjection layer    |

### Mechanical Enforcement

- **Input validation**: `SkillToolOperation.inputSchema` must be a Zod schema (or JSON Schema with runtime validation), not `Record<string, unknown>`. Tool registration must validate inputs before execution. Currently `inputSchema` is typed as `Record<string, unknown>` and passed through without validation.
- **Output validation**: Every operation must return a `ToolResult` envelope. Operations returning domain payloads must also declare an `outputSchema` for the `data` field. Currently results are `unknown` and passed as `JSON.stringify(result)` directly.
- **No raw exception leakage**: Tool execution must catch all backend exceptions and wrap them in `ToolResult` with normalized error codes. Raw stack traces, internal IPs, and query strings must never reach model context. This is a safety invariant.
- **Governance gating**: Already enforced via `GovernanceHook` in the `beforeToolCall` hook. Read operations auto-approve; writes gate by trust level. This is working correctly.
- **Idempotency enforcement**: The `idempotent` flag exists on `SkillToolOperation` but is unused. It must drive retry behavior: idempotent operations can be retried on transient failure; non-idempotent operations must fail-stop and surface the failure to the model.
- **Unknown tool handling**: Currently returns `{ error: "Unknown tool: {name}" }` with no guidance. Must return available tool names and descriptions so the model can self-correct.

### Data Model

Changes to existing types:

```typescript
// EffectCategory — closed enum, new categories require doctrine amendment
type EffectCategory =
  | "read" // no side effects
  | "propose" // creates a proposal, no direct mutation
  | "simulate" // dry-run, no real side effects
  | "write" // internal state mutation
  | "external_send" // sends message to external party (WhatsApp, email, SMS)
  | "external_mutation" // mutates external system (CRM, ad platform, calendar)
  | "irreversible"; // cannot be undone (e.g., payment capture, contract send)

// SkillToolOperation — tighten existing interface
interface SkillToolOperation {
  description: string;
  inputSchema: ZodSchema | JsonSchema; // was: Record<string, unknown>
  outputSchema?: ZodSchema | JsonSchema; // required when operation returns domain payloads
  effectCategory: EffectCategory; // was: governanceTier (GovernanceTier)
  governanceOverride?: Partial<Record<TrustLevel, GovernanceDecision>>;
  idempotent: boolean; // was: optional, now required
  execute(params: ValidatedInput): Promise<ToolResult>; // was: unknown -> unknown
}

// ToolResult — structured result envelope (new)
interface ToolResult {
  status: "success" | "error" | "denied" | "pending_approval";
  data?: Record<string, unknown>; // operation-specific output (validated against outputSchema if present)
  error?: {
    code: string; // machine-readable error code
    message: string; // human-readable summary
    modelRemediation?: string; // what the agent should try next
    operatorRemediation?: string; // what a human should know/do if escalated
    retryable: boolean;
  };
  entityState?: Record<string, unknown>; // state of affected entity after action
  nextActions?: string[]; // valid follow-up operations
}
```

### Runtime Flow

1. Skill declares `tools: ["crm", "calendar"]` in its definition
2. `ToolRegistry` validates all declared tools exist and are registered
3. `SkillExecutorImpl.buildAnthropicTools()` exposes operations as `{toolId}.{opName}`
4. Model calls a tool → `beforeToolCall` hooks fire (governance check)
5. **New**: Input validated against `inputSchema` before `execute()`
6. `execute()` runs, returns `ToolResult`
7. **New**: Output validated against `outputSchema`
8. **New**: Result size checked against reinjection cap (see Section 3)
9. Result serialized and added to conversation as tool result
10. `ToolCallRecord` persisted with params, result, duration, governance decision

### Failure / Recovery

- **Input validation failure**: Return `ToolResult` with `status: "error"`, `code: "INVALID_INPUT"`, and `remediation` describing what was wrong and what valid input looks like. Do not execute the operation.
- **Output validation failure**: Log warning, return raw result with a `_unvalidated: true` flag. Do not block execution — output schemas are enforced progressively, not as a hard gate initially.
- **Unknown tool**: Return error with `remediation` listing available tools for this skill. Currently returns a bare error string.
- **Transient execution failure on idempotent operation**: Retry once automatically. If retry fails, return structured error with `retryable: true`.
- **Transient failure on non-idempotent operation**: Do not retry. Return structured error with `retryable: false` and clear explanation.

### Human Handoff Path

Tool call records are already part of the WorkTrace and visible in the audit trail. When a workflow escalates:

- The handoff package should include a summary of tool calls made (not raw params/results)
- Failed tool calls should be highlighted with their remediation guidance
- The human should see what the agent tried, what worked, and what didn't — not raw JSON

### Current vs Target

| Aspect               | Current                                                   | Target                                                                                   | Change Required                                                                  |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Input schema type    | `Record<string, unknown>`                                 | Zod or JSON Schema with runtime validation                                               | Tighten `SkillToolOperation.inputSchema` type, add validation before `execute()` |
| Output contract      | None                                                      | `ToolResult` envelope required; `outputSchema` required for domain payloads              | Add `ToolResult` type, `outputSchema` for payload-bearing operations             |
| Effect categories    | 4 tiers: `read/internal_write/external_write/destructive` | 7 categories: `read/propose/simulate/write/external_send/external_mutation/irreversible` | Replace `GovernanceTier` with `EffectCategory` enum                              |
| Exception leakage    | Raw errors can reach model context                        | All errors wrapped in `ToolResult`, unsafe details stripped                              | Add error normalization layer around `execute()`                                 |
| Remediation          | None                                                      | Split: `modelRemediation` + `operatorRemediation`                                        | Add to `ToolResult.error`, populate in all tool implementations                  |
| Tool result shape    | `unknown` (raw)                                           | Structured `ToolResult` envelope with status, error, remediation                         | Define `ToolResult` type, update all tool implementations                        |
| Idempotency flag     | Optional, unused                                          | Required, drives retry behavior                                                          | Make `idempotent` required, add retry logic for idempotent ops                   |
| Unknown tool error   | `{ error: "Unknown tool: {name}" }`                       | Structured error with available alternatives                                             | Update error handling in `SkillExecutorImpl`                                     |
| Governance gating    | Working via `GovernanceHook`                              | No change needed                                                                         | Already correct                                                                  |
| Tool call audit      | Working via `ToolCallRecord` + `WorkTrace`                | No change needed                                                                         | Already correct                                                                  |
| Handoff tool summary | Raw tool call records in trace                            | Summarized tool activity with failure highlights                                         | Add tool summary to handoff package                                              |

---

## 3. Context Pollution Control

### Principle

Context is not RAM. It is working consciousness. Every piece of noise injected into the model's context degrades reasoning quality across all subsequent decisions. Switchboard must treat context pollution as a design enemy: cap tool outputs, summarize noisy results, refuse oversized retrievals, and force narrowing when results are too broad. The system must never dump raw bulk data into model context and hope for the best.

### Where This Lives

| Layer                  | Component               | Role                                                                      |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------- |
| `core/skill-runtime`   | `SkillExecutorImpl`     | Reinjects tool results into conversation (currently raw `JSON.stringify`) |
| `core/skill-runtime`   | `BudgetEnforcementHook` | Caps turns, tokens, and runtime — but not individual result sizes         |
| `core/skill-runtime`   | `BlastRadiusLimiter`    | Caps writes per deployment/hour — blast radius, not context size          |
| `core/channel-gateway` | `ChannelGateway`        | Caps history at 30 messages — blunt truncation                            |
| `core/skill-runtime`   | `SkillRuntimePolicy`    | Defines budget limits (tokens, turns, time, writes)                       |

### Required Invariants

The following must always be true:

1. **No unbounded tool result reinjection.** Every tool result entering model context must pass through a size gate. Results exceeding the cap are summarized or truncated with a pointer to the full data.

2. **No unbounded retrieval results.** When a retrieval tool (knowledge lookup, CRM search, log query) returns more results than a threshold, the system must not inject them all. It must either rank and take the top N, or return a narrowing prompt: "Too many matches. Narrow by customer, campaign, timeframe, or channel."

3. **Summarization over truncation.** When context must be reduced, prefer lossy summarization that preserves decisions and state over blunt character truncation that may cut mid-sentence or mid-record.

4. **Tool results are not automatically context-worthy.** A tool result must pass through a reinjection filter. The filter checks size, relevance, and whether the result should be summarized before the model sees it.

5. **Budget enforcement covers context quality, not just cost.** Current budget enforcement (tokens, turns, time) protects against runaway cost. Context pollution control protects against degraded reasoning. Both are needed; they are complementary, not redundant.

### Where Context Pollution Happens Today

| Source               | Risk                                            | Current Control                                     | Gap                                                        |
| -------------------- | ----------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Tool results         | Large CRM records, ad diagnostics, support logs | None — raw `JSON.stringify(result)`                 | No size cap, no summarization                              |
| Knowledge entries    | Multiple entries concatenated without limit     | `ContextResolver` concatenates all matching entries | No per-requirement char cap (Section 1 addresses this)     |
| Conversation history | Long conversations                              | 30-message hard cap                                 | No summarization of older turns (Section 1 addresses this) |
| Error messages       | Raw backend exceptions, stack traces            | None — errors pass through as-is                    | No normalization (Section 2 addresses this)                |
| Skill parameters     | Large objects passed as parameters              | Template engine serializes as YAML                  | No size validation on parameter values                     |

### What Is Config vs Code

| Concern                      | Config (per-org/deployment)               | Code (invariant)                        |
| ---------------------------- | ----------------------------------------- | --------------------------------------- |
| Max tool result size (chars) | `maxToolResultChars` on deployment config | Default `2000`, enforced maximum `8000` |
| Max retrieval results        | `maxRetrievalResults` per tool            | Default `5`, enforced maximum `20`      |
| Summarization strategy       | Not configurable                          | Implemented in reinjection filter       |
| Narrowing response text      | Not configurable                          | Hardcoded in retrieval tools            |
| Per-parameter size limits    | Skill definition parameter constraints    | Validation in template engine           |

### Mechanical Enforcement

The reinjection filter is a new component that sits between tool execution and conversation reinjection in `SkillExecutorImpl`. It enforces:

- **Result classification**: Before checking size, the filter classifies results by shape:
  - `scalar` — status-only, boolean, single value (always inject as-is)
  - `structured` — small typed payload (inject if under size cap)
  - `tabular` — list/array of records (cap at `maxRetrievalResults`, summarize remainder)
  - `diagnostic` — log-like, verbose, human-debug output (always summarize for model)
  - `reference` — pointer to external resource (inject pointer, never inline content)
    Classification is declared on the tool operation or inferred from result shape. Different classes get different handling — a 1,500-char diagnostic blob is worse for context than a 1,500-char structured record.

- **Size gate**: If `JSON.stringify(result).length > maxToolResultChars`, the result is summarized. The summary preserves: what happened, what changed, and what the valid next actions are. The full result is logged to the trace but not injected into context.

- **No raw re-injection after summarization**: Once a result is summarized for model context, the raw oversized payload remains out-of-band and accessible only by reference (trace ID). It must not be reinserted later in the same workflow unless explicitly re-requested through a bounded retrieval path. This prevents systems that summarize first but accidentally reintroduce raw data later.

- **Retrieval narrowing**: Retrieval-class tools (declared via a `retrieval: true` flag on the operation or inferred from `effectCategory: "read"` with array results) must cap returned items at `maxRetrievalResults`. If more results exist, the tool result includes `{ truncated: true, totalAvailable: N, narrowingHint: "..." }`.

- **Compaction before reinvocation**: Before each LLM call, if accumulated context (system prompt + messages + tool results) exceeds a warning threshold, the runtime should compact older tool results into summaries. This extends `BudgetEnforcementHook` from cost-only to cost + quality.

- **Summarization invariant**: Every summarized reinjected result must preserve three things: (1) what happened, (2) what changed, (3) what the valid next actions are. Summaries must be action-oriented, not vague prose.

### Data Model

```typescript
// ResultClass — how the reinjection filter handles this result shape
type ResultClass = "scalar" | "structured" | "tabular" | "diagnostic" | "reference";

// ReinjectionPolicy — configurable per deployment
interface ReinjectionPolicy {
  maxToolResultChars: number; // default 2000
  maxRetrievalResults: number; // default 5
  compactionThresholdTokens: number; // trigger compaction when context exceeds this
  summarizationModel?: string; // model used for result summarization (default: cheapest available)
}

// Extension to SkillToolOperation
interface SkillToolOperation {
  // ... existing fields ...
  retrieval?: boolean; // if true, subject to retrieval result caps and narrowing
  resultClass?: ResultClass; // how the reinjection filter should treat results (inferred if omitted)
}

// ToolResultOutcome — distinguish empty-success from not-found from blocked
type ToolResultOutcome =
  | "success" // operation completed, data returned
  | "success_empty" // operation completed, no matching data
  | "not_found" // requested entity does not exist
  | "blocked" // policy/permission prevented execution
  | "unavailable" // external system temporarily unreachable
  | "refine_needed" // query too broad, narrowing required
  | "denied" // governance denied this action
  | "pending_approval"; // awaiting human approval

// ReinjectionResult — output of the reinjection filter
interface ReinjectionResult {
  injectedContent: string; // what goes into model context
  fullContent: string; // what goes into trace/log
  resultClass: ResultClass; // how this result was classified
  wasTruncated: boolean;
  wasSummarized: boolean;
  originalSizeChars: number;
  injectedSizeChars: number;
}
```

### Runtime Flow

Current flow (what changes are marked **new**):

1. Model calls a tool
2. `beforeToolCall` hooks fire (governance)
3. Input validated, `execute()` runs, returns `ToolResult`
4. `afterToolCall` hooks fire
5. **New**: Result passes through reinjection filter
   - Size check against `maxToolResultChars`
   - If oversized: summarize, log full result to trace
   - If retrieval with too many results: truncate to `maxRetrievalResults`, add narrowing hint
6. **New**: Filtered result (not raw result) serialized into conversation
7. `ToolCallRecord` persisted with full (unfiltered) result
8. Before next LLM call: **new** compaction check on total context size

### Failure / Recovery

- **Summarization fails**: Fall back to structured truncation — take first `maxToolResultChars` characters of `JSON.stringify(result)`, append `[...truncated, full result in trace {traceId}]`. Never block execution because summarization failed.
- **Compaction fails**: Log warning, proceed with full context. Budget enforcement (token cap) provides the hard backstop.
- **Tool returns empty or absent result**: The model must always see an explicit, distinguishable outcome. Empty results must use specific `ToolResultOutcome` values so the agent can behave differently for each:
  - `success_empty`: query succeeded, no matching data — agent may broaden search or proceed without
  - `not_found`: requested entity does not exist — agent should not retry with same parameters
  - `blocked`: policy/permissions prevented execution — agent may escalate or inform user
  - `unavailable`: external system temporarily down — agent may retry later or switch tool
  - `refine_needed`: query too broad — agent must narrow before retrying
    Never return raw `undefined`, `null`, or empty string.

### Human Handoff Path

Context pollution control is invisible to operators, but operators also benefit from bounded presentation:

- Operators have access to full trace data — no information is lost
- Operator surfaces default to compact summary with drill-down to full trace
- Full raw trace remains accessible for investigation and audit
- The split is: model gets filtered/summarized, operator gets summary-first with full trace access, audit/replay retains raw completeness

### Current vs Target

| Aspect                       | Current                                                    | Target                                                                                       | Change Required                                                          |
| ---------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Tool result reinjection      | Raw `JSON.stringify(result)` into context                  | Classified by result shape, size-gated, summarized, overflow to trace                        | Add reinjection filter with result classification in `SkillExecutorImpl` |
| Result classification        | None — all results treated identically                     | 5 result classes with different handling: scalar, structured, tabular, diagnostic, reference | Add `ResultClass` to tool operations, classification logic in filter     |
| Retrieval result caps        | No limit on returned items                                 | `maxRetrievalResults` (default 5) with narrowing hints                                       | Add retrieval flag to tool operations, cap logic in reinjection filter   |
| Context compaction           | None — budget enforcement stops execution, doesn't compact | Pre-LLM-call compaction of older tool results when context is large                          | Extend `BudgetEnforcementHook` or add new `ContextCompactionHook`        |
| Raw re-injection guard       | No protection against re-introducing summarized data       | Once summarized, raw data stays out-of-band (trace only)                                     | Add guard in reinjection filter to prevent raw re-injection              |
| Empty/absent result handling | Returns raw undefined/null                                 | Distinct outcomes: `success_empty`, `not_found`, `blocked`, `unavailable`, `refine_needed`   | Add `ToolResultOutcome` type, normalize in filter                        |
| Parameter size validation    | None                                                       | Per-parameter size limits in skill definitions                                               | Add validation in template engine                                        |
| Budget scope                 | Cost protection (tokens, turns, time)                      | Cost + quality protection (add context size awareness)                                       | Extend budget model to include context quality metrics                   |

---

## 4. Persistent Workflow State

### Principle

Agents fail when each new session has to rediscover project state or infer "what's done" from a messy world. Switchboard must maintain explicit, durable, structured operational state so that every workflow step begins with a known position — not a guess reconstructed from conversation history. The system must never rely on the model re-deriving reality.

### Where This Lives

Switchboard already has substantial persistent state infrastructure. **Workflow durability is mostly present.** The remaining gaps are boundary reliability gaps: deduplication at ingress, failed-delivery terminal handling, and durable conversation/session continuity across restarts. This section is not about inventing workflow persistence — it is about closing the last reliability holes that affect correctness.

| Layer                  | Component                      | Role                                                                                             | Status                                                                            |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `core/workflows`       | `WorkflowEngine`               | Multi-step workflow execution with safety envelopes, approval checkpoints, step state tracking   | **Exists** — full implementation with plan, step index, counters, safety envelope |
| `core/sessions`        | `SessionManager`               | Session lifecycle with runs, pauses, resume tokens, checkpoint validation, CAS-based concurrency | **Exists** — full implementation with safety envelope enforcement                 |
| `core/sessions`        | `CheckpointValidator`          | Validates checkpoint structure (base + role-specific), 500KB size cap                            | **Exists**                                                                        |
| `core/agent-runtime`   | `StateProvider`                | Per-deployment key-value state store                                                             | **Exists** — generic KV, no schema enforcement                                    |
| `core/platform`        | `WorkTraceRecorder`            | Persists governance + execution trace per work unit                                              | **Exists**                                                                        |
| `core/approval`        | Approval state machine         | `pending → approved/rejected/expired/patched` with optimistic concurrency                        | **Exists**                                                                        |
| `core/events`          | `OutboxPublisher`              | Transactional outbox for conversion events                                                       | **Exists** — but no dead-letter handling                                          |
| `core/channel-gateway` | `ConversationLifecycleTracker` | Detects conversation end via inactivity timeout                                                  | **Exists** — but in-memory only                                                   |

### Required Invariants

1. **Every workflow step ends in a known, persisted state.** No step may complete without recording its outcome. This is already true in `WorkflowEngine` (steps are `completed`, `failed`, `skipped`). Must remain true for all future execution paths.

2. **Partial failure is a first-class state, not an error.** When a multi-step workflow fails at step 3 of 5, the system must record exactly which steps completed, which failed, and which are pending. `WorkflowEngine` already does this via the plan's step statuses.

3. **Resume is position-based, not replay-based.** Resuming a paused workflow or session must use the persisted checkpoint/step index, not replay the conversation from scratch. `SessionManager.resumeAfterApproval()` and `WorkflowEngine.resumeAfterApproval()` already do this correctly.

4. **Resume must not re-run already committed side effects.** When a paused workflow or session resumes, execution continues from the persisted position. Side effects committed before the pause must not be replayed. This connects persistent state to idempotency and replay safety — it is the reason checkpoints and step indices exist.

5. **State must be structured, not freeform.** The `StateProvider` (generic KV store) is useful for deployment-scoped ad-hoc state. But workflow-critical state must live in typed, validated structures — `WorkflowExecution`, `AgentSession`, `AgentCheckpoint` — not in arbitrary key-value blobs.

6. **Idempotency is an architectural invariant at ingress.** Every externally triggered work submission that can cause side effects must be checked against an idempotency store before execution begins. The flow is: claim key → execute → record outcome. On duplicate submission, return the prior result. This is not a downstream best-effort; it is a core guard against duplicate business actions. `SubmitWorkRequest.idempotencyKey` exists but has no deduplication logic today.

7. **Dead-letter destinations must exist for every async path with preserved recoverability.** Failed outbox events, expired approvals, timed-out workflows, and undeliverable channel messages must land in a dead-letter store. A dead-letter item is not just "retries stopped" — it means: failure classified, enough context preserved for replay or human takeover, terminal status visible to operators, and clear next action available (replay, inspect, discard, escalate).

### What Exists Today (Strong Foundation)

The existing infrastructure is more complete than the initial audit suggested:

**WorkflowEngine** (`core/workflows/workflow-engine.ts`):

- Full plan-based execution with step states
- Safety envelope: `maxSteps`, `maxDollarsAtRisk`, `maxReplans`, `timeoutMs`
- Approval checkpoints with field edits on modified approvals
- States: `pending → running → awaiting_approval → scheduled → completed/failed/cancelled`

**SessionManager** (`core/sessions/session-manager.ts`):

- Multi-run sessions with pause/resume lifecycle
- CAS-based concurrency protection (`compareAndSwapResumeStatus`)
- Safety envelope enforcement per tool call: `maxToolCalls`, `maxMutations`, `maxDollarsAtRisk`
- Validated checkpoints with role-specific schema extensions
- Resume tokens for secure continuation

**Approval State Machine** (`core/approval/state-machine.ts`):

- Quorum-based approval with duplicate-approver rejection
- Optimistic concurrency via version field
- Expiry detection

### What Is Config vs Code

| Concern                | Config (per-org/deployment)                                      | Code (invariant)                                 |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Safety envelope limits | Per-role manifest + org overrides (merged by `RoleConfigMerger`) | Enforcement in `SessionManager.recordToolCall()` |
| Approval TTL           | `DEFAULT_APPROVAL_TTL_MS` (24h)                                  | Expiry logic in state machine                    |
| Workflow strategy      | Per-workflow: `sequential` or `parallel_where_possible`          | Plan execution logic in `WorkflowEngine`         |
| Checkpoint schema      | Per-role via `getRoleCheckpointValidator`                        | Base validation in `CheckpointValidator`         |
| Dead-letter retention  | Configurable per-org                                             | Dead-letter store implementation                 |
| Idempotency window     | Configurable per-org                                             | Deduplication logic at ingress                   |

### Mechanical Enforcement

- **Idempotency deduplication at ingress**: `PlatformIngress.submit()` must enforce idempotency as a structural gate, not a best-effort check. The flow: (1) receive request with `idempotencyKey`, (2) claim key atomically (insert-if-not-exists), (3) if already claimed, return the existing `ExecutionResult` without creating a new work unit, (4) if claim succeeds, proceed with normal ingress pipeline. This is the single highest-priority gap in persistent state because it directly prevents duplicate business actions.

- **Dead-letter store with recoverability**: A new `DeadLetterStore` must capture failed async operations with enough context for recovery, not just retry cessation:
  - Original event/message payload
  - Failure classification (error code + human-readable reason)
  - Retry count and last attempt time
  - Source (outbox, approval, channel, workflow, scheduler)
  - Enough context to resubmit or hand off to a human
  - Clear available actions: replay, inspect, discard, escalate
  - Operator-visible status in dashboard

- **Outbox retry cap with dead-letter routing**: `OutboxPublisher` must stop retrying after a configurable max attempts and move the event to dead-letter. Currently it increments `attempts` with no ceiling.

- **Conversation lifecycle durability**: `ConversationLifecycleTracker` is in-memory only. Conversation end detection must survive process restarts. Either persist the sessions map or reconstruct it from conversation store timestamps on startup.

### Data Model

```typescript
// Idempotency — enforced at PlatformIngress
// No new type needed. Add index on WorkUnit.idempotencyKey in trace store.
// Dedup check: "does a WorkTrace with this idempotencyKey already exist?"

// DeadLetterEntry — new, for all async failure paths
// Designed for recoverability, not just retry cessation
interface DeadLetterEntry {
  id: string;
  source: "outbox" | "approval" | "channel" | "workflow" | "scheduler";
  originalPayload: Record<string, unknown>;
  errorCode: string;
  errorMessage: string;
  failureClassification: "transient" | "permanent" | "policy" | "unknown";
  retryCount: number;
  lastAttemptAt: Date;
  createdAt: Date;
  resolvedAt: Date | null; // null = still unresolved
  resolution?: "replayed" | "discarded" | "escalated" | "manual";
  availableActions: ("replay" | "inspect" | "discard" | "escalate")[];
  organizationId: string;
  traceId?: string; // link to WorkTrace if applicable
  handoffContext?: Record<string, unknown>; // enough context for human takeover
}

// OutboxPublisher extension
interface OutboxConfig {
  maxRetries: number; // default 5
  retryBackoffMs: number; // default 1000, exponential
  deadLetterAfterMaxRetries: boolean; // default true
}
```

### Runtime Flow

**Normal workflow execution** (already working):

1. `WorkflowEngine.createWorkflow()` persists plan + actions
2. `startWorkflow()` runs steps sequentially, checking safety envelope before each
3. Each step result updates the plan via `advanceStep()`
4. Approval-required steps create `ApprovalCheckpoint`, workflow pauses
5. `resumeAfterApproval()` continues from persisted step index

**Idempotency enforcement** (new):

1. `PlatformIngress.submit()` receives `SubmitWorkRequest` with `idempotencyKey`
2. **New**: Check trace store for existing `WorkTrace` with matching key
3. If found: return existing `ExecutionResult` — no new work unit created
4. If not found: proceed normally, persist `idempotencyKey` on `WorkTrace`

**Dead-letter flow** (new):

1. `OutboxPublisher.publishBatch()` fails to publish an event
2. Increment attempts, apply backoff
3. If `attempts >= maxRetries`: move to `DeadLetterStore`, stop retrying
4. Dead-letter entries are visible in operator dashboard
5. Operator can: resubmit (re-enters the normal flow), discard, or investigate

### Failure / Recovery

- **Workflow step fails**: Already handled — step marked `failed` in plan, workflow status set to `failed`, error code and message persisted. Future: consider partial-continue strategy where independent steps can proceed.
- **Session crashes mid-execution**: Checkpoint preserves position. Resume creates a new `AgentRun` with `resumeContext`. Safety envelope counters are already persisted, not in-memory.
- **Outbox event permanently fails**: New: moved to dead-letter after max retries. Dead-letter visible to operators.
- **Approval expires**: Already handled — `isExpired()` check transitions to `expired` state.
- **Idempotency key collision**: Return existing result. Do not create duplicate work.

### Human Handoff Path

When a workflow pauses for approval or escalates:

- The approval checkpoint already includes the action, reason, and field-edit capability
- `HandoffPayload` carries `fromAgent`, `reason`, `conversationId`, and `context`
- The operator sees: what step the workflow is at, what's been done, what's pending, and why it stopped
- Dead-letter entries visible in operator dashboard with resubmit/discard options

### Current vs Target

| Aspect                            | Current                                               | Target                                                                  | Change Required                                                 |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Workflow state tracking           | Full: plan, steps, counters, safety envelope          | No change needed                                                        | Already correct                                                 |
| Session checkpoint/resume         | Full: CAS-based, validated checkpoints, resume tokens | No change needed                                                        | Already correct                                                 |
| Approval state machine            | Full: quorum, optimistic concurrency, expiry          | No change needed                                                        | Already correct                                                 |
| Idempotency enforcement           | Key carried on `SubmitWorkRequest` but never checked  | Dedup at `PlatformIngress` before work unit creation                    | Add index on `idempotencyKey`, dedup check in `submit()`        |
| Dead-letter handling              | None — failed outbox events retry forever             | `DeadLetterStore` for all async paths, max retry cap                    | Add `DeadLetterStore`, cap `OutboxPublisher` retries            |
| Outbox retry policy               | Unlimited retries, no backoff                         | Max retries (default 5) with exponential backoff                        | Add `OutboxConfig`, backoff logic, dead-letter routing          |
| Conversation lifecycle durability | In-memory `sessions` map                              | Durable: persisted or reconstructed on startup                          | Persist conversation session state or reconstruct from store    |
| StateProvider schema              | Generic KV (any key, any value)                       | Keep for ad-hoc state; ensure workflow-critical state uses typed models | No code change — architectural guidance                         |
| Resume safety                     | Implicit — checkpoint tracks position                 | Explicit invariant: resume must not re-run committed side effects       | Architectural guidance; verify in workflow/session resume paths |

---

## 5. Org-State as System of Record

### Principle

If it matters operationally, it must live in durable structured state — not in prompt folklore, not implied by past conversations, not scattered across docs. The system of record for business rules, permissions, policies, escalation thresholds, and channel behavior must be queryable config, not hidden context. Agents reason from state; they should not have to infer policy from prompt wording.

### Where This Lives

Switchboard already stores most operational state in structured form. The gap is not "nothing is in config" — it is that some governance rules are hardcoded strings in code rather than configurable per-org.

| Layer                      | Component                            | What It Stores                                                                          | Status                             |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------- |
| `core/governance`          | `GovernanceProfileStore`             | Org-level profiles (`observe/guarded/strict/locked`), action type allowlists/blocklists | **Config-driven** — per-org        |
| `core/engine`              | `PolicyEngine` + policy stores       | Org-specific policies: rules, conditions, spend limits                                  | **Config-driven** — per-org        |
| `core/identity`            | `IdentitySpec` + `RoleOverlay`       | Per-actor identity, risk tolerance, forbidden behaviors, delegation chains              | **Config-driven** — per-actor      |
| `db/stores`                | `AgentPersonaStore`                  | Business name, product, tone, qualification criteria, escalation rules, booking link    | **Config-driven** — per-deployment |
| `core/skill-runtime`       | `ContextResolver` + knowledge stores | Org-scoped knowledge entries (kind + scope taxonomy)                                    | **Config-driven** — per-org        |
| `db/stores`                | `TrustScoreStore`                    | Per-deployment trust scores, updated on approval/rejection events                       | **Config-driven** — per-deployment |
| `core/skill-runtime`       | `governance-injector.ts`             | Mandatory governance constraints (no financial promises, offer escalation, etc.)        | **Hardcoded** — same for all orgs  |
| `core/agent-runtime`       | `SystemPromptAssembler`              | Prompt template structure (role, style, qualification, escalation, booking)             | **Hardcoded** — fixed template     |
| `core/platform/governance` | `default-constraints.ts`             | Default execution constraints per budget class                                          | **Hardcoded** — same for all orgs  |

### Org-Configurable Truth vs Platform Invariants

Not everything is configurable. Some things are platform-level invariants that no org may override.

**Org-configurable** (can tighten within allowed bounds):

- Persona/tone variants
- Budget limits within allowed range
- Workflow preferences
- Escalation contacts and thresholds
- Additional governance constraints (additive only)
- Business policies and rules
- Knowledge entries

**Platform invariants** (no org may override):

- Mandatory governance defaults (no financial promises, offer escalation, etc.)
- Approval binding hash verification
- Idempotency enforcement at ingress
- Protected-entity checks
- Audit event emission on all governed actions
- Safety-critical write-action controls
- Self-approval prevention

**What "tighten only, not weaken" means concretely:**

An org-level override may:

- Add constraints
- Lower thresholds (fewer allowed actions, shorter windows)
- Reduce permissions
- Require more approvals
- Tighten budgets (fewer tokens, writes, dollars)

An org-level override may not:

- Remove mandatory constraints
- Broaden permissions beyond platform baseline
- Disable required audit events
- Disable binding checks
- Reduce required approval gates below platform minimum
- Extend budget limits beyond budget-class ceiling

### Config Resolution Order

When multiple config layers exist, resolution follows strict precedence. Lower layers may tighten but never weaken higher layers.

```
1. Platform invariants         — hardcoded, no override possible
2. Global defaults             — DEFAULT_GOVERNANCE_PROFILE, DEFAULT_SKILL_RUNTIME_POLICY, etc.
3. Org policy/config           — governance profile, policies, org-specific constraints
4. Deployment/channel overrides — per-deployment persona, budget, channel config
5. Runtime task-specific state  — resolved identity, risk input, execution constraints
```

At each layer: the stricter value wins when conflicts exist.

### Required Invariants

1. **Business rules live in stores, not prompts.** Customer policy, permissions, escalation thresholds, and channel behavior must be stored in structured config (database, deployment config, governance profile). Prompts may render these rules for the model, but the source of truth is the store. If you change a policy, you change config — not a prompt string.

2. **Governance constraints must be extensible per-org.** The mandatory governance rules in `governance-injector.ts` (never claim to be human, no financial promises, etc.) are correct as global defaults. But orgs must be able to add org-specific constraints (industry regulations, compliance requirements, channel-specific rules) without modifying code.

3. **Prompt assembly reads from config, never defines policy.** `SystemPromptAssembler` should assemble prompts from structured persona data, governance config, and knowledge entries. It must not contain business logic or policy decisions. The assembler is a renderer, not a rule engine. This must be mechanically enforceable: prompt assembly must source policy/governance text from resolved config/policy objects. Static defaults are allowed only as platform invariants. CI or test checks should fail if policy-bearing strings are embedded in the assembler outside approved invariant definitions.

4. **Execution constraints must be resolvable from org config.** Default execution constraints (token limits, model tiers, write caps) should be overridable per-org or per-deployment, not only hardcoded per budget class.

5. **No operational truth in conversation history.** The model must not need to search conversation history to determine current policy, permissions, or business rules. These must be injected from config at the start of each execution context.

### What Is Config vs Code

| Concern                                            | Must Be Config                                             | Must Be Code               |
| -------------------------------------------------- | ---------------------------------------------------------- | -------------------------- |
| Governance profile (observe/guarded/strict/locked) | Per-org in `GovernanceProfileStore`                        | Profile-to-posture mapping |
| Action type restrictions (allow/blocklist)         | Per-org in `GovernanceProfileConfig`                       | Restriction checking logic |
| Policies (rules, conditions, spend limits)         | Per-org in policy store                                    | Policy evaluation engine   |
| Identity + risk tolerance                          | Per-actor in identity store                                | Identity resolution logic  |
| Persona (business name, tone, qualification)       | Per-deployment in persona store                            | Prompt assembly logic      |
| Mandatory governance constraints                   | Global defaults in code, **extensible per-org via config** | Constraint injection logic |
| Execution budget limits                            | Per-budget-class defaults in code, **overridable per-org** | Budget enforcement logic   |
| Escalation thresholds                              | Per-deployment in persona + governance config              | Escalation routing logic   |
| Channel-specific behavior                          | Per-deployment in deployment config                        | Channel adapter logic      |
| Knowledge/context entries                          | Per-org in knowledge store                                 | Context resolution logic   |

### Mechanical Enforcement

- **Org-extensible governance constraints**: Extend `governance-injector.ts` to load org-specific constraints from a store (new `GovernanceConstraintStore` or extend `GovernanceProfileConfig`). The injector concatenates global defaults + org-specific additions. Org constraints cannot weaken global defaults — they can only add stricter rules.

- **Configurable execution constraints**: Extend `ConstraintResolver` to check for org-level or deployment-level overrides of default budget-class constraints. Override can tighten (lower limits) but not loosen beyond the budget-class default without explicit admin approval.

- **Prompt assembly validation**: Add a lint rule or test that `SystemPromptAssembler` does not contain hardcoded policy strings. All policy-bearing content must come from its inputs (persona, governance config), not from string literals in the assembler itself. The current assembler is mostly clean — the governance constraints injected separately by `governance-injector.ts` are the main concern.

- **Config change audit trail**: Changes to governance profiles, policies, personas, and identity specs must produce structured audit events that record:
  - What changed (field/path)
  - Previous value
  - New value
  - Who changed it (actor ID)
  - When (timestamp)
  - Why (reason, if supplied)
  - Effective scope (org, deployment, channel, workflow)
    This is not a generic log line — it is a structured operating-model change event. Config is the source of truth; changes to truth must be traceable.

### Data Model

```typescript
// Extension to GovernanceProfileConfig — org-specific constraint additions
interface GovernanceProfileConfig {
  profile: GovernanceProfile;
  allowedActionTypes?: string[];
  blockedActionTypes?: string[];
  additionalConstraints?: string[]; // new: org-specific mandatory rules (additive only)
  executionOverrides?: Partial<ExecutionConstraints>; // new: per-org budget overrides
}

// GovernanceConstraint — structured version of governance-injector rules
interface GovernanceConstraint {
  id: string;
  scope: "global" | "org" | "deployment";
  scopeId?: string; // orgId or deploymentId
  rule: string; // human-readable rule text
  category: "identity" | "financial" | "privacy" | "compliance" | "channel" | "custom";
  severity: "mandatory" | "advisory"; // mandatory cannot be overridden
  createdAt: Date;
  updatedAt: Date;
}

// ConfigChangeEvent — structured audit for operating-model changes
interface ConfigChangeEvent {
  id: string;
  configType:
    | "governance_profile"
    | "policy"
    | "persona"
    | "identity"
    | "constraint"
    | "execution_override";
  scope: "global" | "org" | "deployment";
  scopeId?: string;
  field: string; // what changed
  previousValue: unknown;
  newValue: unknown;
  actorId: string; // who changed it
  reason?: string; // why, if supplied
  timestamp: Date;
}
```

### Runtime Flow

1. `GovernanceGate.evaluate()` loads policies, identity, governance profile (already config-driven)
2. `SystemPromptAssembler` assembles persona from structured `AgentPersona` (already config-driven)
3. **New**: `governance-injector.ts` loads global defaults + org-specific constraints from store
4. **New**: `ConstraintResolver` checks for org/deployment-level execution constraint overrides
5. Context resolver loads knowledge entries from org-scoped store (already config-driven)
6. Result: the entire execution context is assembled from config, not from hardcoded values

### Failure / Recovery

- **Missing org config**: Fall back to global defaults. Every config layer has a default: `DEFAULT_GOVERNANCE_PROFILE` ("guarded"), `DEFAULT_SKILL_RUNTIME_POLICY`, `DEFAULT_RISK_INPUT`. Missing config never blocks execution — it reverts to safe defaults.
- **Config store unavailable**: Cache last-known-good config. If cache is also unavailable, use hardcoded defaults. Log the failure.
- **Conflicting org overrides**: Org constraints can only add rules, not remove global defaults. Execution overrides can only tighten, not loosen. Conflicts resolved by taking the stricter value.

### Human Handoff Path

When an operator needs to change business rules:

- Changes are made to structured config (governance profile, persona, policies, knowledge entries) through the dashboard or API
- Changes take effect on the next execution — no redeploy needed
- Config changes produce audit events visible in the operator dashboard
- The operator never needs to edit prompts, code, or deployment configs to change business policy

### Current vs Target

| Aspect                           | Current                                                | Target                                                                      | Change Required                                                                 |
| -------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Governance profiles              | Config-driven per-org                                  | No change needed                                                            | Already correct                                                                 |
| Policies                         | Config-driven per-org                                  | No change needed                                                            | Already correct                                                                 |
| Identity + risk tolerance        | Config-driven per-actor                                | No change needed                                                            | Already correct                                                                 |
| Persona                          | Config-driven per-deployment                           | No change needed                                                            | Already correct                                                                 |
| Mandatory governance constraints | Hardcoded string in `governance-injector.ts`           | Global defaults + org-specific additions from config                        | Extend injector to load from store, add `GovernanceConstraint` model            |
| Execution constraints            | Hardcoded per budget class in `default-constraints.ts` | Default per budget class + per-org/deployment overrides                     | Extend `ConstraintResolver` to check org overrides                              |
| Prompt assembly                  | Assembles from persona data (mostly clean)             | Mechanically enforced: CI/test fails if policy strings in assembler         | Add test that assembler contains no policy literals outside approved invariants |
| Config change audit              | Not tracked                                            | Structured `ConfigChangeEvent` with before/after/actor/reason/scope         | Add `ConfigChangeEvent` emission to all config stores                           |
| Config resolution order          | Implicit                                               | Explicit 5-layer precedence: platform → global → org → deployment → runtime | Document and enforce in `ConstraintResolver`                                    |
| Override direction               | Not enforced                                           | Tighten-only: lower layers cannot weaken higher-layer constraints           | Add validation in config resolution that rejects weakening overrides            |
| Knowledge entries                | Config-driven per-org                                  | No change needed                                                            | Already correct                                                                 |

---

## 6. Mechanical Enforcement

### Principle

The model should not "remember to be careful." The system should make unsafe behavior structurally hard or impossible. Every safety-critical invariant must be enforced by runtime code — policy gates, permission checks, budget caps, idempotency, cooldowns — not by prompt instructions or agent judgment. This is probably the single most important harness principle: if a constraint matters, it must be mechanical.

### Where This Lives

Mechanical enforcement is Switchboard's strongest area. The existing infrastructure is extensive and well-designed. This section catalogs what exists, identifies the remaining gaps, and defines the enforcement taxonomy.

| Layer                      | Component               | What It Enforces                                                                                                                                  | Status      |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `core/platform`            | `PlatformIngress`       | 7-step ingress pipeline: intent lookup, trigger validation, mode resolution, governance gate, deny handling, approval routing, execution dispatch | **Working** |
| `core/platform/governance` | `GovernanceGate`        | Full policy engine evaluation: identity, policies, risk scoring, guardrails, system risk posture → execute/require_approval/deny                  | **Working** |
| `core/skill-runtime`       | `GovernanceHook`        | Per-tool-call governance gating by trust level and effect category                                                                                | **Working** |
| `core/skill-runtime`       | `BudgetEnforcementHook` | Token, turn, and runtime limits before each LLM call                                                                                              | **Working** |
| `core/skill-runtime`       | `SkillExecutorImpl`     | Tool call cap, token budget, runtime timeout (Promise.race)                                                                                       | **Working** |
| `core/skill-runtime`       | `BlastRadiusLimiter`    | Caps writes per deployment per hour (50/hour default)                                                                                             | **Working** |
| `core/skill-runtime`       | `CircuitBreaker`        | Trips after N failures in time window, routes to human escalation                                                                                 | **Working** |
| `core/platform`            | `PlatformLifecycle`     | Self-approval prevention, binding hash verification (timing-safe), approval rate limiting, delegation chain authorization                         | **Working** |
| `core/approval`            | Approval state machine  | Optimistic concurrency (version field), `StaleVersionError`, quorum tracking, duplicate-approver rejection                                        | **Working** |
| `core/channel-gateway`     | Contact mutex           | Serializes concurrent operations per org+contact pair                                                                                             | **Working** |
| `core/channel-gateway`     | Loop detector           | Prevents duplicate message processing within time window                                                                                          | **Working** |
| `core/sessions`            | `SessionManager`        | Safety envelope enforcement per tool call: maxToolCalls, maxMutations, maxDollarsAtRisk. CAS-based concurrency on resume.                         | **Working** |
| `core/workflows`           | `WorkflowEngine`        | Safety envelope: maxSteps, maxDollarsAtRisk, maxReplans, timeoutMs. Checked before every step.                                                    | **Working** |
| `core/execution-guard`     | `GuardedCartridge`      | Token-based execution gating — direct `execute()` without bound token throws                                                                      | **Working** |
| `core/platform`            | `PlatformLifecycle`     | Patched proposal re-evaluation — modifying approval parameters re-runs full governance pipeline                                                   | **Working** |

### Enforcement Taxonomy

Every mechanical enforcement falls into one of these categories. The taxonomy is behavior-driving, not just descriptive — every enforcement mechanism must declare its category, enforcement point, failure mode, and configurability.

```
1. Gate — blocks action before it starts
   Enforcement point: pre-decision
   Failure mode: deny
   Examples: PlatformIngress pipeline, GovernanceGate, GovernanceHook, execution guard

2. Cap — limits quantity within a session/window
   Enforcement point: pre-execution (checked before cost is incurred)
   Failure mode: deny with budget-exceeded reason
   Examples: BudgetEnforcementHook (tokens, turns, time), BlastRadiusLimiter (writes/hour),
   SessionManager (toolCalls, mutations, dollarsAtRisk), WorkflowEngine (steps, dollars, replans)

3. Circuit — trips on repeated failure, routes to human
   Enforcement point: pre-execution
   Failure mode: escalate to human (never retry)
   Examples: CircuitBreaker (N failures in time window)

4. Mutex — serializes concurrent access
   Enforcement point: pre-execution
   Failure mode: wait (with timeout) or reject
   Examples: Contact mutex, CAS-based approval resume, createIfUnderLimit for sessions

5. Integrity — prevents tampering or replay
   Enforcement point: pre-decision
   Failure mode: deny
   Examples: Binding hash verification, self-approval prevention, approval rate limiting,
   duplicate-approver rejection, optimistic concurrency (version field)

6. Dedup — prevents duplicate effects
   Enforcement point: pre-decision (at ingress)
   Failure mode: return existing result (not deny)
   Examples: Loop detector, idempotency enforcement (gap — Section 4)
```

Every enforcement mechanism must declare:

- **Category**: which of the 6 types
- **Enforcement point**: pre-decision, pre-execution, or post-action
- **Failure mode**: deny / escalate / wait / return-existing
- **Configurability**: org-configurable or platform-invariant

### Canonical Enforcement Order

Enforcement mechanisms fire in a stable, declared order. Adding new mechanisms requires placing them at the correct point in this sequence.

```
Phase 1: Identity & Permission (pre-decision)
  1. Identity / permission resolution
  2. Protected entity check
  3. Idempotency dedup check

Phase 2: Policy & Governance (pre-decision)
  4. Cooldown check
  5. Governance / policy gate evaluation
  6. Approval binding / integrity checks

Phase 3: Execution Guards (pre-execution)
  7. Budget / cap enforcement (tokens, turns, time, writes, dollars)
  8. Blast radius limiter
  9. Circuit breaker check
  10. Mutex acquisition (contact, session)

Phase 4: Execution
  11. Side effect (tool call, external action)

Phase 5: Post-Action
  12. Audit / trace write
  13. Trust score update
  14. Cooldown window registration
```

### Required Invariants

1. **No governed action bypasses the ingress pipeline.** Already enforced by `ingress-boundary.test.ts`. Must remain true for all future routes, adapters, and integrations.

2. **No write action executes without governance evaluation.** Tool-level governance in `GovernanceHook` gates every write by trust level. The `GOVERNANCE_POLICY` matrix must cover all `EffectCategory` values (Section 2).

3. **No approval can be forged or replayed.** Binding hash comparison (timing-safe) ensures the approver sees exactly the parameters proposed. Self-approval is prevented. Rate limiting caps approval throughput. These are already working.

4. **Budget limits are checked before cost is incurred, not after.** `BudgetEnforcementHook` checks before each LLM call. `SessionManager` checks before recording a tool call. `WorkflowEngine` checks safety envelope before each step. This pattern must hold for all new enforcement points.

5. **Circuit breakers route to humans, not to retry loops.** When the circuit breaker trips, the system escalates to a human operator — it does not attempt increasingly desperate automated retries.

6. **Enforcement is not optional per skill or tool.** No skill definition, tool registration, or deployment config can disable core enforcement (ingress pipeline, governance gate, budget limits, audit trail). Enforcement is structural, not opt-in.

### Remaining Gaps

Despite the strength of existing enforcement, three gaps remain:

**Gap 1: Idempotency enforcement at ingress** (detailed in Section 4)
The `idempotencyKey` on `SubmitWorkRequest` is carried but never checked. This is the most critical gap because it directly allows duplicate business actions.

**Gap 2: Cooldown enforcement between repeated actions**
No mechanism prevents the same action type from being submitted against the same entity in rapid succession. For example, two "send_followup" actions against the same lead within 5 minutes. The loop detector catches exact duplicate messages, but not semantically duplicate business actions with different parameters.

Needed: a cooldown registry keyed on a precise identity tuple:

- **Action type**: the intent being submitted
- **Entity scope**: the target entity (lead, contact, account)
- **Channel** (optional): channel-specific cooldowns (e.g., WhatsApp has different cadence than email)
- **Actor** (optional): per-actor vs per-entity cooldowns
- **Cooldown window**: configurable per action type
- **Window extension policy**: whether repeated attempts extend the window or not (default: no extension)

The cooldown key is `(orgId, actionType, entityId, [channel], [actorId])`. This prevents fuzzy scope that leads to inconsistent enforcement.

**Gap 3: Protected entity enforcement**
No mechanism prevents actions against entities that should be temporarily or permanently protected. For example, a contact who has opted out, a lead in active human handoff, or an account under compliance review.

Needed: a protected entity registry where each protection record carries:

- **Protection reason**: why this entity is protected (human-readable)
- **Protection source**: who/what set the protection (`governance`, `operator`, `compliance`, `opt_out`, `active_handoff`)
- **Expiration**: when protection expires, or `null` for permanent
- **Allowed exceptions**: specific action types still permitted despite protection (e.g., "read contact info" allowed during opt-out, but "send message" blocked)
- **Escalation path**: if an override is requested, who can approve it and through what flow

Different protection sources represent different protection semantics:

- `opt_out`: contact explicitly requested no contact — strongest, fewest exceptions
- `compliance`: regulatory or legal hold — only compliance officer can clear
- `active_handoff`: entity is being handled by a human — clears when handoff completes
- `operator`: manual hold by business owner — owner can clear
- `governance`: automatic protection by policy rule — clears when condition changes

### What Is Config vs Code

| Concern                    | Config (per-org/deployment)             | Code (invariant)         |
| -------------------------- | --------------------------------------- | ------------------------ |
| Governance profile         | Per-org                                 | Gate evaluation logic    |
| Budget limits              | Per-budget-class + org overrides        | Budget enforcement hooks |
| Blast radius limits        | Configurable per deployment             | Limiter logic            |
| Circuit breaker thresholds | Configurable per deployment             | Breaker logic            |
| Approval rate limits       | Configurable per org                    | Rate limit logic         |
| Cooldown windows           | Per action type                         | Cooldown check logic     |
| Protected entity status    | Per entity (set by governance/operator) | Protection check logic   |
| Ingress pipeline steps     | Not configurable                        | Pipeline structure       |
| Binding hash verification  | Not configurable                        | Verification logic       |
| Self-approval prevention   | Configurable (`selfApprovalAllowed`)    | Prevention logic         |

### Data Model

```typescript
// CooldownEntry — tracks recent action submissions per entity
interface CooldownEntry {
  orgId: string;
  entityId: string;
  entityType: "contact" | "lead" | "account";
  actionType: string;
  channel?: string; // optional: channel-specific cooldown
  actorId?: string; // optional: per-actor cooldown
  lastSubmittedAt: Date;
  cooldownMs: number;
  extendsOnRepeat: boolean; // whether repeated attempts extend the window
}

// CooldownConfig — per action type, declared at intent registration
interface CooldownConfig {
  actionType: string;
  cooldownMs: number; // default varies by action type
  scope: "entity" | "entity_channel" | "entity_actor" | "org";
  extendsOnRepeat: boolean; // default: false
}

// ProtectedEntity — marks an entity as off-limits with full context
interface ProtectedEntity {
  id: string;
  entityId: string;
  entityType: "contact" | "lead" | "account" | "deployment";
  orgId: string;
  reason: string; // human-readable protection reason
  source: "governance" | "operator" | "compliance" | "opt_out" | "active_handoff";
  expiresAt: Date | null; // null = permanent until manually removed
  allowedExceptions: string[]; // action types still permitted despite protection
  escalationPath?: string; // who can approve an override
  createdAt: Date;
  clearedAt: Date | null;
  clearedBy?: string;
}
```

### Runtime Flow

**Existing enforcement flow** (already working):

1. Request arrives at `PlatformIngress.submit()`
2. Intent lookup → trigger validation → mode resolution
3. `GovernanceGate.evaluate()` → execute / require_approval / deny
4. If execute: dispatch to execution mode
5. During skill execution: `GovernanceHook` gates each tool call, `BudgetEnforcementHook` limits each LLM call
6. `BlastRadiusLimiter` caps writes. `CircuitBreaker` trips on failures.

**New enforcement additions** (insert into existing pipeline):

- After step 2, before step 3: **idempotency check** (Section 4)
- After step 2, before step 3: **cooldown check** — is this action type + entity within cooldown window?
- After step 2, before step 3: **protected entity check** — is the target entity protected?
- Both new checks return structured denials with `modelRemediation` and `operatorRemediation` (Section 2)

### Failure / Recovery

- **Enforcement component fails on side-effecting path**: Default to deny. If the governance gate, cooldown registry, or protected entity check throws an exception on any path that proposes or executes side effects, the action is denied with `GOVERNANCE_ERROR`. Never fail-open on enforcement for actions that can change state. Read-only queries may return `unavailable` or error states when enforcement checks fail, but must not silently escalate privileges or degrade into broader access.
- **Enforcement data stale**: Cooldown and protection entries use timestamps — stale entries are ignored (expired cooldowns allow action, expired protections are released). Clock skew tolerance is configurable.
- **False positive on protection**: Operator can remove protection through dashboard. The action can be resubmitted immediately after protection is cleared.

### Human Handoff Path

Enforcement decisions are visible to operators:

- Governance decisions (execute/require_approval/deny) are recorded in `WorkTrace`
- Cooldown blocks explain: "This action was recently performed on this entity. Cooldown expires at {time}."
- Protected entity blocks explain: "This entity is protected: {reason}. Contact {protectedBy} to clear."
- All enforcement decisions include both `modelRemediation` and `operatorRemediation`

### Current vs Target

| Aspect                | Current                                            | Target                                                                                                    | Change Required                                                 |
| --------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Ingress pipeline      | 7-step, enforced by test                           | No change needed                                                                                          | Already correct                                                 |
| Governance gate       | Full policy engine evaluation                      | No change needed                                                                                          | Already correct                                                 |
| Tool-level governance | GovernanceHook per tool call                       | Update to use `EffectCategory` (Section 2)                                                                | Align with new effect categories                                |
| Budget enforcement    | Tokens, turns, time, writes, dollars               | No change needed                                                                                          | Already correct                                                 |
| Blast radius          | Writes/hour per deployment                         | No change needed                                                                                          | Already correct                                                 |
| Circuit breaker       | Failures/hour per deployment                       | No change needed                                                                                          | Already correct                                                 |
| Approval integrity    | Binding hash, self-approval, rate limiting, quorum | No change needed                                                                                          | Already correct                                                 |
| Concurrency control   | Contact mutex, CAS-based resume, session limits    | No change needed                                                                                          | Already correct                                                 |
| Idempotency           | Key carried, not enforced                          | Dedup at ingress (Section 4)                                                                              | Add dedup check in `PlatformIngress.submit()`                   |
| Cooldown enforcement  | None                                               | Per-action-type cooldown with precise identity key: `(orgId, actionType, entityId, [channel], [actorId])` | Add `CooldownRegistry`, check in ingress pipeline (Phase 1)     |
| Protected entities    | None                                               | Protected entity registry with reason, source, exceptions, escalation path                                | Add `ProtectedEntityStore`, check in ingress pipeline (Phase 1) |
| Enforcement taxonomy  | Implicit                                           | Behavior-driving 6-category taxonomy with declared enforcement point, failure mode, configurability       | Document in spec (this section)                                 |
| Enforcement ordering  | Ad hoc                                             | Canonical 5-phase sequence: identity → policy → execution guards → execution → post-action                | Document and enforce in ingress/execution pipeline              |
| Fail-closed scope     | Not defined                                        | Fail-closed on all side-effecting paths; read-only returns error state without privilege escalation       | Add to enforcement invariants                                   |

---

## 7. Tight Feedback Loops

### Principle

Agents improve when consequences are visible quickly. Every action should return clear outcome feedback. Failures should be localized and interpretable. The next step should be obvious from the tool result. The model should see business consequences, not just API success codes. Bad feedback ("request failed") makes agents unpredictable. Good feedback ("WhatsApp send blocked: outside 24h window; template required") makes agents learnable and stable.

### Where This Lives

| Layer                  | Component              | Current Feedback Quality                                                                                                    | Gap                                                          |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `core/skill-runtime`   | `SkillExecutorImpl`    | Tool results returned as raw `JSON.stringify`                                                                               | No structured outcome, no remediation                        |
| `core/skill-runtime`   | `GovernanceHook`       | "This action is not permitted at your current trust level" / "This action requires human approval"                          | Good — clear reason, but no remediation guidance             |
| `core/skill-runtime`   | Budget errors          | `SkillExecutionBudgetError` with descriptive message                                                                        | Good — clear limit and current value                         |
| `core/platform`        | `IngressError`         | 3 typed error types: `intent_not_found`, `validation_failed`, `trigger_not_allowed`                                         | Typed but narrow — no remediation                            |
| `core/platform`        | `ExecutionResult`      | `outcome` + `summary` + optional `error: { code, message }`                                                                 | Exists but minimal — no business context                     |
| `core/approval`        | Approval state machine | Descriptive errors: "Cannot approve: current status is {status}", "Self-approval is not permitted", "Binding hash mismatch" | Good — specific, actionable                                  |
| `core/skill-runtime`   | `CircuitBreaker`       | "Circuit breaker tripped: {N} failures in the last {M} minutes. Routing to human escalation."                               | Good — includes counts and routing                           |
| `core/channel-gateway` | `ChannelGateway`       | User-facing fallback: "I'm having trouble right now. Let me connect you with the team."                                     | Bad — completely generic, no distinction between error types |

### Required Invariants

1. **Every tool result must carry business-level feedback, not just API status.** The model must see what happened in business terms, not just `{ success: true }`. For example: "Lead updated to qualified stage. 3 of 5 qualification criteria met. Missing: budget confirmation, timeline." This is what makes the system learnable.

2. **Every failure must be distinguishable and actionable.** The model must be able to determine from the failure alone whether to: retry, narrow the request, try a different approach, escalate, or inform the user. This requires the `ToolResultOutcome` taxonomy from Section 3.

3. **Feedback must be split across three message surfaces.** The same outcome must be phrased differently for each audience:
   - **User-facing**: short, safe, business-appropriate. No internal codes or technical detail.
   - **Model-facing**: precise, actionable, next-step oriented. Includes `modelRemediation` and `nextActions`.
   - **Operator-facing**: detailed, diagnostic, recovery-oriented. Includes full error context, trace links, policy references.

   Example for a WhatsApp messaging window violation:
   - User-facing: "I couldn't send that message because this customer is outside the allowed messaging window."
   - Model-facing: "Blocked by messaging_window policy. Use approved template path or wait for session reopen."
   - Operator-facing: "WhatsApp 24h window violation. Conversation last inbound at {time}. Template send path available. Policy: messaging_window_24h."

4. **User-facing error messages must distinguish error types.** The generic "I'm having trouble" fallback in `ChannelGateway` must be replaced with type-aware messages:
   - Governance denial → "I can't do that right now — let me check with the team."
   - Execution failure → "Something went wrong on my end. Let me try again or connect you with someone."
   - Budget exceeded → "I've reached my limit for this conversation. Let me connect you with the team."
   - Approval pending → "I need approval for that. I'll follow up when it's confirmed."

5. **Success results must include next valid actions.** The `ToolResult.nextActions` field (Section 2) is not optional for tool design — it is what makes the agent's reasoning path clear after each step.

6. **Feedback must be timely, not just structured.** Feedback must be emitted at the closest meaningful point to the event:
   - Validation failures before execution begins
   - Policy denials before action attempt
   - Side-effect outcomes immediately after completion
   - Retry/backoff states when scheduled, not only after exhaustion
     Tight feedback loops are about when feedback arrives, not just what it says.

7. **Every feedback event must preserve operational next-step clarity.** Every outcome — success, failure, or intermediate — must answer at minimum: what happened, what changed, what can happen next, and who should act next (if anyone).

### Error Taxonomy

All errors across Switchboard must map to a structured taxonomy:

```
Category: GOVERNANCE
  Codes: DENIED_BY_POLICY, TRUST_LEVEL_INSUFFICIENT, FORBIDDEN_BEHAVIOR,
         ACTION_TYPE_BLOCKED, COOLDOWN_ACTIVE, ENTITY_PROTECTED
  Model remediation: what to try instead, when to retry, how to escalate
  Operator remediation: which policy blocked, who can override

Category: EXECUTION
  Codes: TOOL_NOT_FOUND, INVALID_INPUT, EXECUTION_TIMEOUT, EXTERNAL_SERVICE_ERROR,
         IDEMPOTENCY_DUPLICATE, STEP_FAILED
  Model remediation: fix input, retry, try different tool, report to user
  Operator remediation: service status, retry count, trace link

Category: BUDGET
  Codes: TOKEN_BUDGET_EXCEEDED, TURN_LIMIT_EXCEEDED, RUNTIME_LIMIT_EXCEEDED,
         WRITE_LIMIT_EXCEEDED, BLAST_RADIUS_EXCEEDED, DOLLARS_AT_RISK_EXCEEDED
  Model remediation: summarize and complete, ask user to continue in new session
  Operator remediation: current usage vs limits, deployment config link

Category: APPROVAL
  Codes: APPROVAL_REQUIRED, APPROVAL_EXPIRED, APPROVAL_REJECTED, SELF_APPROVAL_BLOCKED,
         BINDING_HASH_MISMATCH, STALE_VERSION
  Model remediation: wait for approval, inform user of pending state
  Operator remediation: approval link, approver list, parameter summary

Category: CIRCUIT
  Codes: CIRCUIT_BREAKER_TRIPPED, SAFETY_ENVELOPE_EXCEEDED
  Model remediation: stop, escalate to human
  Operator remediation: failure count, time window, recommended investigation
```

### Success Taxonomy

Success is not one thing. Different success types imply different next steps for the agent:

```
read_success          — data retrieved, no state changed
                        Next: use the data, proceed with task
proposal_created      — proposal submitted, awaiting decision
                        Next: inform user, wait for outcome
approval_requested    — action requires approval, request sent
                        Next: inform user of pending state, pause
action_executed       — side effect completed successfully
                        Next: use nextActions, proceed with workflow
action_skipped        — action determined unnecessary (already done, idempotent duplicate)
                        Next: proceed without retry
no_change             — action evaluated but nothing needed to change
                        Next: proceed, do not retry
partial_success       — some parts succeeded, some failed
                        Next: report what succeeded, handle what failed individually
```

### Intermediate / Deferred Outcomes

Not every outcome is a clear success or failure. Switchboard must explicitly handle intermediate states rather than forcing them into bad buckets:

```
awaiting_approval     — action paused pending human decision
                        Agent: inform user, do not retry
retry_scheduled       — transient failure, retry queued with backoff
                        Agent: inform user of delay, do not duplicate
deferred_execution    — action accepted but will execute later (scheduled workflow step)
                        Agent: confirm scheduling, provide expected time
verification_pending  — action executed but outcome not yet confirmed (e.g., external API callback)
                        Agent: note pending state, check later or wait for notification
ambiguous_external    — external system returned unclear state
                        Agent: do not assume success, surface ambiguity, may need human verification
```

These must map to specific `ToolResultOutcome` values (Section 3) so the agent's next action is deterministic, not a guess.

### What Is Config vs Code

| Concern                             | Config (per-org/deployment)  | Code (invariant)                         |
| ----------------------------------- | ---------------------------- | ---------------------------------------- |
| User-facing error message templates | Configurable per org/channel | Default templates in code                |
| Error code taxonomy                 | Not configurable             | Fixed enum in code                       |
| Remediation text                    | Per-tool, per-error          | Default remediation in code              |
| `nextActions` per tool result       | Per-tool definition          | Validation that nextActions is populated |
| Business-context enrichment         | Per-tool, per-domain         | Enrichment logic per tool                |

### Mechanical Enforcement

- **ToolResult validation**: Every tool must return a `ToolResult` with populated `status`. Success results should include `nextActions`. Error results must include `error.code` from the taxonomy and at least `modelRemediation`. A lint or test should flag tool implementations that return bare objects instead of `ToolResult`.

- **User-facing error routing**: `ChannelGateway` must map `ExecutionResult.outcome` and `error.code` to type-specific user messages. The generic fallback should only fire when the error is truly unclassifiable.

- **Error code coverage**: Every `EffectCategory` × `ToolResultOutcome` combination should have a defined error code and remediation template. Missing coverage is a gap to track, not a runtime error.

### Data Model

```typescript
// Structured error taxonomy (extends ExecutionError)
interface StructuredError {
  category: "governance" | "execution" | "budget" | "approval" | "circuit";
  code: string; // from taxonomy above
  message: string; // human-readable summary
  modelRemediation: string; // what the agent should do next
  operatorRemediation: string; // what a human should know
  retryable: boolean;
  retryAfterMs?: number; // hint for when to retry
  traceId?: string; // link to full trace
}

// UserFacingErrorTemplate — configurable per org/channel
interface UserFacingErrorTemplate {
  errorCategory: string;
  channel?: string; // channel-specific message variants
  template: string; // message template with {variable} placeholders
  fallback: string; // if template rendering fails
}
```

### Runtime Flow

**Current flow** (error path):

1. Tool call fails → raw error returned → model sees unhelpful message
2. Execution fails → `ExecutionResult` with generic `error: { code, message }` → ChannelGateway sends "I'm having trouble"

**Target flow**:

1. Tool call fails → error caught and wrapped in `ToolResult` with `StructuredError`
2. `StructuredError` includes: category, code, model remediation, operator remediation, retryability
3. Model sees clear guidance: what failed, why, what to do next
4. If model escalates → `ChannelGateway` maps error category to type-specific user message
5. `WorkTrace` records full error with operator remediation for post-mortem

**Success path**:

1. Tool call succeeds → `ToolResult` with `status: "success"`, `data`, `entityState`, `nextActions`
2. Model sees: what happened in business terms, state of affected entity, what to do next
3. Each step builds on clear, action-oriented feedback from the previous step

### Failure / Recovery

- **Remediation text missing**: If a tool result has no `modelRemediation`, inject a default based on `ToolResultOutcome`: "No specific guidance available. Consider retrying, trying a different approach, or escalating to a human." Never leave remediation blank.
- **Error code not in taxonomy**: Log warning, use `UNKNOWN_ERROR` code with generic remediation. Track as coverage gap for the tool.
- **User-facing template missing for error category**: Fall back to generic message, but log that a template is missing for this category + channel combination.

### Human Handoff Path

When errors escalate to operators:

- The operator sees the `operatorRemediation`, not the `modelRemediation`
- The operator sees the full error context: what the agent tried, what failed, what the business impact is
- Error history is visible in the WorkTrace with category and code — not a wall of raw stack traces
- Operators can search/filter by error category and code across deployments

### Current vs Target

| Aspect                | Current                                                          | Target                                                                                                                                         | Change Required                                          |
| --------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Tool result feedback  | Raw `unknown` results, no business context                       | `ToolResult` with status, data, entityState, nextActions, structured error                                                                     | Implement `ToolResult` envelope across all tools         |
| Error taxonomy        | Ad hoc error strings and codes                                   | 5-category taxonomy with defined codes and remediation                                                                                         | Define taxonomy, map all existing errors                 |
| Model remediation     | None                                                             | `modelRemediation` on every error, `nextActions` on every success                                                                              | Add to `ToolResult`, populate in all tools               |
| Operator remediation  | None                                                             | `operatorRemediation` on every error                                                                                                           | Add to `ToolResult`, populate in all tools               |
| User-facing errors    | Generic "I'm having trouble" for all failures                    | Type-specific messages by error category                                                                                                       | Add error routing in `ChannelGateway`                    |
| Governance feedback   | "Not permitted" / "Requires approval" — clear but no remediation | Add `modelRemediation`: what to try instead, when to retry                                                                                     | Extend `GovernanceHook` result                           |
| Success feedback      | Varies by tool — some structured, some raw                       | Every success includes business outcome + next valid actions                                                                                   | Standardize across tools                                 |
| Success taxonomy      | All successes treated as generic "success"                       | 7 success types: `read_success`, `proposal_created`, `approval_requested`, `action_executed`, `action_skipped`, `no_change`, `partial_success` | Add success classification to `ToolResult`               |
| Intermediate outcomes | Forced into success or error buckets                             | Explicit: `awaiting_approval`, `retry_scheduled`, `deferred_execution`, `verification_pending`, `ambiguous_external`                           | Add intermediate outcome types                           |
| Message surfaces      | One message for all audiences                                    | Three surfaces: user-facing, model-facing, operator-facing                                                                                     | Add audience-specific message generation                 |
| Feedback timeliness   | Not defined                                                      | Feedback emitted at closest meaningful point to event                                                                                          | Architectural invariant — enforce in all new tools/flows |
| Error searchability   | Errors buried in traces                                          | Structured codes, filterable by category across deployments                                                                                    | Add error indexing to trace store                        |

---

## 8. Clean Handoff / Clean State

### Principle

Every workflow step must end in a known state. Every partial failure must be recorded cleanly. Every escalation must include structured handoff context. Every retryable failure must be marked explicitly. Every dead-letter event must preserve enough information to recover. The system must leave every interaction in a state that the next actor — human or agent — can pick up without re-deriving reality.

### Where This Lives

Switchboard already has a well-structured handoff system. Like Section 4 (Persistent Workflow State), the foundation is strong and the gaps are specific.

| Layer                  | Component                      | Role                                                                                              | Status                                   |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `core/handoff`         | `HandoffPackageAssembler`      | Builds context packages for human agents: lead snapshot, qualification, conversation summary, SLA | **Working**                              |
| `core/handoff`         | `HandoffNotifier`              | Notifies operators of pending handoffs                                                            | **Working**                              |
| `core/handoff`         | `SlaMonitor`                   | Tracks SLA deadlines for handoff acknowledgment                                                   | **Working**                              |
| `core/handoff`         | `HandoffStore`                 | Persists handoff packages with status lifecycle: `pending → assigned → active → released`         | **Working**                              |
| `core/approval`        | Approval state machine         | Clean state transitions with expiry, quorum, and optimistic concurrency                           | **Working**                              |
| `core/workflows`       | `WorkflowEngine`               | Step-level state tracking, safety envelope, approval checkpoints                                  | **Working**                              |
| `core/sessions`        | `SessionManager`               | Pause/resume with validated checkpoints and CAS concurrency                                       | **Working**                              |
| `core/platform`        | `PlatformLifecycle`            | Undo mechanism with expiry window and reverse action submission                                   | **Working**                              |
| `core/events`          | `OutboxPublisher`              | Transactional outbox for conversion events                                                        | **Gap** — no dead-letter, no max retries |
| `core/channel-gateway` | `ConversationLifecycleTracker` | Detects conversation end via inactivity timeout                                                   | **Gap** — in-memory only                 |
| `core/audit`           | `AuditLedger`                  | Append-only, hash-chained audit log with tamper detection                                         | **Working**                              |

### Required Invariants

1. **Every workflow step ends in a known, recorded state.** No step may complete without a persisted outcome. Already true in `WorkflowEngine` and `SessionManager`. Must remain true for all future execution paths.

2. **Every handoff includes structured context.** The `HandoffPackage` already carries lead snapshot, qualification snapshot, conversation summary, SLA deadline, and suggested opening. This must be extended to include:
   - What the agent tried (tool call summary, not raw records)
   - What failed and why (structured errors with operator remediation)
   - What's pending (unresolved blockers, pending approvals)
   - What the recommended next action is

3. **No orphaned async work.** Every async path (outbox events, scheduled workflow steps, approval requests, channel messages) must either complete, fail to a dead-letter, or expire with a recorded terminal state. No async work may silently disappear.

4. **Undo is durable and bounded.** The existing undo mechanism (`PlatformLifecycle.requestUndo`) creates a reverse action through PlatformIngress with expiry window validation. Undo availability must be recorded on the original WorkTrace so the operator knows whether recovery is possible.

5. **Clean state means verifiable state.** After any workflow completes, fails, or is cancelled, it must be possible to answer: what was the objective, what was done, what was not done, and why. This information must be derivable from durable state (WorkTrace, handoff package, session checkpoints), not from conversation history or in-memory state.

6. **Handoff is not a fallback — it is a first-class lifecycle event.** Human takeover, approval requests, escalations, and operator overrides are core operations with the same persistence, tracing, and governance guarantees as automated execution. They are not error handlers.

### Handoff Context Package (Target)

The existing `HandoffPackage` provides a strong foundation. The target is to enrich it with operational context from other harness components:

```typescript
// Enhanced HandoffPackage — extends existing type
interface HandoffPackage {
  // Existing fields (already working)
  id: string;
  sessionId: string;
  organizationId: string;
  reason: HandoffReason;
  status: HandoffStatus;
  leadSnapshot: LeadSnapshot;
  qualificationSnapshot: QualificationSnapshot;
  conversationSummary: ConversationSummary;
  slaDeadlineAt: Date;
  createdAt: Date;
  acknowledgedAt?: Date;

  // New: operational context from harness
  toolCallSummary?: ToolCallSummaryEntry[]; // what the agent tried (summarized)
  failedActions?: StructuredError[]; // what failed and why
  pendingItems?: PendingItem[]; // unresolved blockers, pending approvals
  recommendedNextAction?: string; // what the human should do first
  workflowPosition?: {
    // where in the workflow this handoff occurred
    workflowId?: string;
    stepIndex?: number;
    totalSteps?: number;
    completedSteps?: string[];
    pendingSteps?: string[];
  };
  protectionStatus?: ProtectedEntity[]; // any active protections on this entity
  traceIds?: string[]; // links to relevant WorkTraces
}

interface ToolCallSummaryEntry {
  toolId: string;
  operation: string;
  outcome: "success" | "failed" | "denied" | "pending";
  businessSummary: string; // what happened in business terms
  errorCode?: string; // if failed, the structured error code
}

interface PendingItem {
  type: "approval" | "retry" | "blocker" | "verification";
  description: string;
  expectedResolutionAt?: Date;
  actionRequired: string; // what the human needs to do
}
```

### What Is Config vs Code

| Concern                       | Config (per-org/deployment)                  | Code (invariant)             |
| ----------------------------- | -------------------------------------------- | ---------------------------- |
| SLA deadline duration         | Configurable per deployment (default 30 min) | SLA monitoring logic         |
| Handoff notification channels | Configurable per org                         | Notification dispatch logic  |
| Handoff reason taxonomy       | Not configurable                             | `HandoffReason` enum         |
| Auto-release timeout          | Configurable per org                         | Release logic in SLA monitor |
| Dead-letter retention period  | Configurable per org                         | Retention enforcement        |
| Undo expiry window            | Configurable per intent registration         | Expiry validation logic      |

### Mechanical Enforcement

- **Handoff completeness check**: `HandoffPackageAssembler` must validate that the package includes all required fields before persistence. Missing lead snapshot, empty conversation summary, or absent reason must produce a validation error. The assembler already builds this; the check is that nothing is silently omitted.

- **Dead-letter for all async paths** (Section 4): `OutboxPublisher` must cap retries and route to `DeadLetterStore`. This is the most critical gap for clean state.

- **Orphan detection**: A periodic sweep must identify async work items (outbox events, approval requests, scheduled steps) that are neither completed nor dead-lettered. These are state leaks and should be flagged for operator investigation.

- **Conversation lifecycle durability** (Section 4): `ConversationLifecycleTracker` must survive restarts. Conversation end detection must be durable.

- **Undo availability tracking**: When a work unit completes, its `WorkTrace` must record whether undo is available, the undo expiry time, and the reverse action type. This makes recovery options visible without requiring the operator to guess.

### Runtime Flow

**Handoff flow** (existing, with enhancements):

1. Agent decides to escalate (circuit breaker trip, human-requested, complex objection, etc.)
2. `HandoffPackageAssembler.assemble()` builds package from session state
3. **New**: Assembler enriches with tool call summary, failed actions, pending items from WorkTrace
4. **New**: Assembler adds workflow position if mid-workflow
5. Package persisted to `HandoffStore`
6. `HandoffNotifier` alerts operators
7. `SlaMonitor` begins tracking acknowledgment deadline
8. Operator acknowledges → status transitions to `assigned` → `active`
9. Operator completes → status transitions to `released`

**Clean state on workflow completion**:

1. All steps in plan marked terminal (completed/failed/skipped)
2. WorkTrace persisted with full governance + execution record
3. Undo availability recorded on trace
4. Any pending approvals expired/cancelled
5. Conversation lifecycle tracker notified of completion
6. State is fully verifiable from durable records

**Dead-letter recovery flow** (Section 4):

1. Operator sees dead-letter entries in dashboard
2. Each entry shows: what failed, why, available actions (replay/inspect/discard/escalate)
3. Operator chooses action → system processes accordingly
4. Dead-letter entry marked resolved with resolution type

### Failure / Recovery

- **Handoff assembly fails**: Log error, create minimal handoff with reason + session ID only. Never block escalation because assembly failed — a degraded handoff is better than no handoff.
- **SLA expires without acknowledgment**: Escalate to org admin. Re-notify with urgency flag. Do not silently release.
- **Orphan work detected**: Flag for operator investigation. Do not auto-resolve — orphans may represent state that needs manual attention.
- **Undo window expired**: Mark as no-longer-undoable on trace. Operator sees "Undo expired at {time}" instead of a misleading undo button.

### Human Handoff Path

This entire section is about the human handoff path. The key requirements are:

1. **Operators see a complete, structured package** — not raw conversation logs or JSON traces
2. **The package answers the operator's first questions**: What was the customer asking? What did the agent try? What went wrong? What should I do first?
3. **SLA tracking is automatic** — operators are notified, deadlines are visible, escalation is automatic on expiry
4. **Recovery options are explicit** — undo availability, retry options, and dead-letter actions are visible and actionable
5. **Progressive disclosure applies** — summary first, detailed context on drill-down, raw traces only on investigation

### Current vs Target

| Aspect                   | Current                                                        | Target                                                                                            | Change Required                            |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Handoff package          | Lead snapshot + qualification + conversation summary + SLA     | Add: tool call summary, failed actions, pending items, workflow position, recommended next action | Extend `HandoffPackageAssembler`           |
| Handoff reason taxonomy  | 7 reasons: human_requested, max_turns, complex_objection, etc. | No change needed                                                                                  | Already correct                            |
| Handoff status lifecycle | `pending → assigned → active → released`                       | No change needed                                                                                  | Already correct                            |
| SLA monitoring           | Working with deadline tracking                                 | No change needed                                                                                  | Already correct                            |
| Dead-letter handling     | None — async work can silently disappear                       | `DeadLetterStore` with recovery actions (Section 4)                                               | Add dead-letter store and orphan detection |
| Undo tracking            | Undo mechanism exists but availability not recorded on trace   | Record undo availability + expiry on `WorkTrace`                                                  | Extend `WorkTrace` with undo metadata      |
| Orphan detection         | None                                                           | Periodic sweep for non-terminal async work items                                                  | Add orphan detection sweep                 |
| Conversation lifecycle   | In-memory only                                                 | Durable (Section 4)                                                                               | Persist or reconstruct on startup          |
| Workflow handoff context | Not included in handoff package                                | Workflow position + completed/pending steps                                                       | Add workflow context to assembler          |
| Recovery visibility      | Undo exists but recovery options not surfaced to operators     | Explicit recovery options (undo, retry, dead-letter replay) on operator dashboard                 | Add recovery option surface                |

---

## 9. Implementation Order

### Current State Summary

Switchboard is already a governed system, not a collection of smart agents. The codebase has:

- **14 working enforcement mechanisms** (Section 6) — ingress pipeline, governance gate, budget enforcement, blast radius limiter, circuit breaker, approval integrity, concurrency control, and more
- **Full workflow state management** (Section 4) — WorkflowEngine, SessionManager, approval state machine with CAS concurrency, validated checkpoints, safety envelopes
- **Config-driven operational state** (Section 5) — governance profiles, policies, identity, personas, knowledge entries all in structured stores
- **Structured handoff system** (Section 8) — HandoffPackage with lead/qualification/conversation snapshots, SLA monitoring, status lifecycle

The foundation is strong. The remaining work is about closing specific gaps, not building from scratch.

### Gap Summary

| Gap                                       | Section | Impact                                                          | Effort                                             |
| ----------------------------------------- | ------- | --------------------------------------------------------------- | -------------------------------------------------- |
| **Idempotency enforcement**               | 4, 6    | Critical — prevents duplicate business actions                  | Small — add dedup check at ingress                 |
| **ToolResult envelope**                   | 2, 3, 7 | High — enables structured feedback, output capping, remediation | Medium — define type, update all tools             |
| **Tool output reinjection filter**        | 3       | High — prevents context pollution from large tool results       | Medium — new component in SkillExecutorImpl        |
| **Dead-letter store**                     | 4, 8    | High — prevents silent async failure                            | Small — new store + outbox retry cap               |
| **Error taxonomy + remediation**          | 7       | High — makes system learnable and operable                      | Medium — define taxonomy, map existing errors      |
| **EffectCategory enum**                   | 2, 6    | Medium — enriches governance gating and audit                   | Small — replace GovernanceTier with EffectCategory |
| **Knowledge entry prioritization**        | 1       | Medium — improves context quality                               | Small — add sorting in ContextResolver             |
| **Conversation summary**                  | 1       | Medium — replaces blunt history truncation                      | Medium — summary generation + storage              |
| **Org-extensible governance constraints** | 5       | Medium — unblocks per-org compliance rules                      | Medium — extend injector to load from store        |
| **User-facing error routing**             | 7       | Medium — replaces generic fallback                              | Small — add error mapping in ChannelGateway        |
| **Cooldown enforcement**                  | 6       | Medium — prevents rapid duplicate actions                       | Small — new registry + ingress check               |
| **Protected entity enforcement**          | 6       | Medium — prevents actions on off-limits entities                | Small — new store + ingress check                  |
| **Config change audit trail**             | 5       | Low — operational hygiene                                       | Small — emit events from config stores             |
| **Conversation lifecycle durability**     | 4       | Low — only matters on restart                                   | Small — persist or reconstruct                     |
| **Handoff package enrichment**            | 8       | Low — improves operator experience                              | Small — extend assembler                           |
| **Undo availability tracking**            | 8       | Low — improves recovery visibility                              | Small — extend WorkTrace                           |

### Recommended Build Order

**Phase 1: Correctness foundations** (build first — these affect whether actions are safe)

1. **Idempotency enforcement at ingress** — prevents duplicate business effects. Highest-priority gap.
2. **ToolResult envelope** — structural prerequisite for output capping, error taxonomy, and feedback loops.
3. **EffectCategory enum** — replaces `GovernanceTier`, drives governance, audit, and retry behavior.

**Phase 2: Context quality** (build second — these affect reasoning quality)

4. **Tool output reinjection filter** — prevents context pollution. Depends on ToolResult envelope.
5. **Knowledge entry prioritization** — improves context assembly. Independent.
6. **Error taxonomy + structured remediation** — makes the system learnable. Depends on ToolResult envelope.

**Phase 3: Reliability** (build third — these affect async durability)

7. **Dead-letter store + outbox retry cap** — prevents silent async failure.
8. **Cooldown enforcement** — prevents rapid duplicate actions.
9. **Protected entity enforcement** — prevents actions on off-limits entities.

**Phase 4: Operability** (build fourth — these improve operator experience)

10. **User-facing error routing** — replaces generic fallback messages.
11. **Org-extensible governance constraints** — unblocks per-org compliance.
12. **Conversation summary for history** — replaces blunt truncation.
13. **Config change audit trail** — operational hygiene.
14. **Handoff package enrichment** — richer operator context.
15. **Conversation lifecycle durability** — restart resilience.
16. **Undo availability tracking** — recovery visibility.

### Non-Goals

This spec deliberately does not cover:

- **Product decisions**: marketplace shape, pricing tiers, agent families, skill authoring conventions
- **Dashboard UX**: specific UI layouts, component libraries, design system
- **Deployment / infrastructure**: cloud topology, container orchestration, CI/CD pipeline details
- **External API versioning**: REST endpoint contracts, webhook schemas, SDK compatibility
- **Model selection strategy**: which LLMs to use, fine-tuning, prompt engineering techniques
- **Specific tool implementations**: how individual tools (CRM, calendar, ad platform) work internally
- **Performance optimization**: caching strategies, query optimization, scaling patterns

These belong in their own documents. This spec defines the harness architecture — the governed environment that makes safe, repeatable agent behavior structurally likely.

### Relationship to Existing Doctrine

This spec extends `docs/DOCTRINE.md`. The doctrine defines canonical vocabulary and non-negotiable invariants. This spec defines how 8 harness principles should be concretely realized in Switchboard's architecture.

After this spec is approved:

1. Distill the key invariants into new doctrine rules in `docs/DOCTRINE.md`
2. Add the enforcement taxonomy, config resolution order, and error taxonomy as doctrine appendices
3. Begin Phase 1 implementation with an implementation plan (via `writing-plans` skill)

---

## Appendix A: Cross-Section Invariants

These rules cut across all 8 sections. They are the harness laws — the shortest possible summary of what must always be true.

1. **No raw backend exceptions into model context.** All errors are normalized, classified, and wrapped in `ToolResult`. Unsafe details (stack traces, internal IPs, query strings) are stripped. _(Sections 2, 3, 7)_

2. **No unbounded data injection into model context.** Every tool result, knowledge entry, and conversation history is size-gated and relevance-ranked before injection. Oversized results are summarized with pointers to full data in trace. _(Sections 1, 3)_

3. **No side-effecting action without governance evaluation.** Every write, send, mutation, or irreversible action passes through the governance gate. No skill, tool, or deployment config can bypass this. _(Sections 2, 6)_

4. **No duplicate side effects without idempotency check.** Every externally triggered work submission with side effects is deduplicated at ingress via `idempotencyKey`. Duplicate submissions return the existing result. _(Sections 4, 6)_

5. **No hidden policy truth in prompts.** Business rules, permissions, escalation thresholds, and governance constraints live in structured config stores. Prompts render config — they do not define policy. _(Section 5)_

6. **Every outcome preserves next-step clarity.** Every result — success, failure, or intermediate — answers: what happened, what changed, what can happen next, and who should act next. _(Sections 2, 7)_

7. **Every workflow and handoff ends in a known, recorded state.** No step, session, or async operation may complete without a persisted terminal state. Orphaned work is detected and flagged. _(Sections 4, 8)_

8. **Fail-closed on all side-effecting paths.** If any enforcement mechanism fails (governance gate, protection check, cooldown registry), the action is denied. Never fail-open when safety checks are uncertain. Read-only paths may return error states but must not escalate privileges. _(Section 6)_

---

## Appendix B: Canonical Types

These are the load-bearing types introduced or tightened by this spec. They appear across multiple sections and must be implemented consistently. This is not a full schema — exact field types are deferred to implementation plans.

| Type                   | Introduced In | Used By          | Purpose                                                                                                                         |
| ---------------------- | ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `EffectCategory`       | Section 2     | Sections 2, 6, 7 | Closed 7-value enum replacing `GovernanceTier`. Drives governance gating, audit depth, retry policy.                            |
| `ToolResult`           | Section 2     | Sections 2, 3, 7 | Structured result envelope for all tool operations. Status, data, error with split remediation, entity state, next actions.     |
| `ToolResultOutcome`    | Section 3     | Sections 3, 7    | Distinguishes `success`, `success_empty`, `not_found`, `blocked`, `unavailable`, `refine_needed`, `denied`, `pending_approval`. |
| `ResultClass`          | Section 3     | Section 3        | Classifies tool results by shape for reinjection handling: `scalar`, `structured`, `tabular`, `diagnostic`, `reference`.        |
| `StructuredError`      | Section 7     | Sections 2, 7, 8 | 5-category error taxonomy with code, model remediation, operator remediation, retryability.                                     |
| `DeadLetterEntry`      | Section 4     | Sections 4, 8    | Failed async operation with failure classification, available recovery actions, handoff context.                                |
| `ProtectedEntity`      | Section 6     | Sections 6, 8    | Entity marked off-limits with reason, source, expiration, allowed exceptions, escalation path.                                  |
| `CooldownEntry`        | Section 6     | Section 6        | Recent action submission keyed on `(orgId, actionType, entityId, [channel], [actorId])`.                                        |
| `ConfigChangeEvent`    | Section 5     | Section 5        | Structured audit event for operating-model changes: before/after value, actor, reason, scope.                                   |
| `GovernanceConstraint` | Section 5     | Section 5        | Structured governance rule with scope, category, severity. Replaces hardcoded strings in `governance-injector.ts`.              |
| `ReinjectionPolicy`    | Section 3     | Section 3        | Per-deployment config for tool result size caps, retrieval limits, compaction threshold.                                        |
| `CooldownConfig`       | Section 6     | Section 6        | Per-action-type cooldown configuration with scope and window extension policy.                                                  |

---

## Appendix C: Definition of Done

The harness architecture is complete when:

**Phase 1 (Correctness) is done when:**

- [ ] `PlatformIngress.submit()` deduplicates on `idempotencyKey` before creating a work unit
- [ ] All tool operations return `ToolResult` envelope (not raw `unknown`)
- [ ] `GovernanceTier` is replaced by `EffectCategory` across all tool definitions
- [ ] Tests verify: duplicate submission returns existing result, not duplicate work

**Phase 2 (Context Quality) is done when:**

- [ ] Reinjection filter exists between tool execution and conversation append in `SkillExecutorImpl`
- [ ] Tool results exceeding `maxToolResultChars` are summarized, with full data in trace only
- [ ] `ContextResolver` sorts knowledge entries by priority desc, truncates at char cap
- [ ] Error taxonomy covers all existing error codes with model and operator remediation

**Phase 3 (Reliability) is done when:**

- [ ] `DeadLetterStore` exists and `OutboxPublisher` routes to it after max retries
- [ ] Cooldown registry blocks rapid duplicate actions with precise identity key
- [ ] Protected entity registry blocks actions on off-limits entities at ingress
- [ ] Orphan detection sweep identifies non-terminal async work

**Phase 4 (Operability) is done when:**

- [ ] `ChannelGateway` maps error categories to type-specific user messages
- [ ] `governance-injector.ts` loads org-specific constraints from config store
- [ ] Config changes emit structured `ConfigChangeEvent` with before/after/actor
- [ ] `HandoffPackage` includes tool call summary, failed actions, pending items

**Doctrine update is done when:**

- [ ] Cross-section invariants (Appendix A) are added to `docs/DOCTRINE.md`
- [ ] Enforcement taxonomy and canonical order are added as doctrine appendix
- [ ] Error taxonomy and success taxonomy are added as doctrine appendix
- [ ] Config resolution order is added as doctrine appendix
