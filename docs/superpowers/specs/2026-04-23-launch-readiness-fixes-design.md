# Launch Readiness Fixes — Design Spec

**Date:** 2026-04-23
**Status:** Final
**Scope:** 2 blockers + 3 degraded-experience fixes from launch readiness assessment

---

## Summary

Switchboard passes build, tests (3,895), and audit. Five issues remain between current state and a deployable, wedge-proving system. Two are deployment blockers (Dockerfile, escalate placeholders). Three are product-path issues that silently degrade the core funnel or onboarding experience (calendar, embeddings, simulation).

This spec addresses all five. The fixes range from one-line (Dockerfile) to medium-complexity (simulation endpoint). No new abstractions are introduced beyond what the existing interfaces require.

---

## Principles

1. **No shared tool instance carries tenant, session, actor, or trace identity.** Those are bound per request.
2. **When an intelligence capability is unavailable, fail transparently and specifically.** Never emulate with outputs that look real but aren't.
3. **Preserve substrate, remove theater.** Real booking state in DB is substrate. Google Calendar sync is an integration layer.

---

## Fix 1: Dockerfile — Copy `skills/` Directory

**Severity:** Blocker
**Complexity:** One line

### Problem

`skill-mode.ts:44` resolves skills via `new URL("../../../../skills", import.meta.url).pathname`. In the Docker `api` stage, this resolves to `/app/skills/`. The directory is never copied from the build stage.

### Change

Add to the `api` stage in `Dockerfile`, after the `apps/api/` copy block:

```dockerfile
COPY --from=build /app/skills/ skills/
```

The path must place `skills/` at `/app/skills/` so the runtime resolution from `apps/api/dist/bootstrap/skill-mode.js` (4 levels up) lands correctly.

### Verification

- `docker build --target api .` succeeds
- Container starts and loads Alex skill without error

---

## Fix 2: Escalate Tool — Per-Request Instantiation

**Severity:** Blocker
**Complexity:** Medium

### Problem

`createEscalateTool` is called once at boot in `skill-mode.ts:151-158` with hardcoded `sessionId: "bootstrap-placeholder"` and `orgId: "bootstrap-placeholder"`. All escalation records get wrong identity context.

### Design

**Request context contract:**

```typescript
interface SkillRequestContext {
  sessionId: string;
  orgId: string;
  deploymentId: string; // always available — platform resolver falls back to "platform-direct"
  actorId?: string;
  traceId?: string;
  surface?: "chat" | "simulation" | "api" | "system";
}
```

`surface` enables audit clarity and surface-specific behavior (e.g., escalation routing may differ by surface).

`deploymentId` is required because the platform deployment resolver always produces one (defaulting to `"platform-direct"` when no deployment is matched). It is never absent at runtime — making it optional would introduce a placeholder leak.

This is the single request-scoped object. It carries identity and trace metadata only — not conversation state. The executor owns conversation state separately via `SkillExecutionParams.messages`.

**Factory pattern:**

```typescript
type EscalateToolFactory = (ctx: SkillRequestContext) => SkillTool;
```

- At boot: wire stable tools (CRM query, CRM write, calendar-book) into a static `baseTools` map. Create the escalate factory but do not instantiate the tool.
- At request time: call `escalateFactory(requestContext)` to produce the request-scoped tool. Merge into `baseTools` to form the complete tool map for that execution.
- Remove placeholder values entirely — no fallback, no default.

**What changes:**

| File                                                | Change                                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/skill-runtime/tools/escalate.ts` | `EscalateToolDeps` takes `SkillRequestContext` instead of loose `sessionId`/`orgId`. `messages` removed from deps — executor provides conversation state. |
| `apps/api/src/bootstrap/skill-mode.ts`              | Export factory instead of instance. Remove lines 155-157.                                                                                                 |
| `SkillExecutor` call sites                          | Compose `baseTools + requestTools` before execution.                                                                                                      |

**Design rule:** `messages` is not passed into the tool constructor. The escalate tool receives conversation history via `SkillExecutionParams.messages` at execution time — the executor already threads this through to tool calls. The tool reads from the current execution's message array, not from a frozen snapshot captured at construction time.

---

## Fix 3: LocalCalendarProvider — First-Class Fallback

**Severity:** Degraded (product-path critical)
**Complexity:** Medium

### Problem

Without `GOOGLE_CALENDAR_CREDENTIALS`, `createGoogleCalendarProvider` throws. The booking funnel — the core revenue loop — breaks entirely.

### Design

**New file:** `packages/core/src/calendar/local-calendar-provider.ts`

Implements the existing `CalendarProvider` interface from `@switchboard/schemas`:

```typescript
interface CalendarProvider {
  listAvailableSlots(query: SlotQuery): Promise<TimeSlot[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  cancelBooking(bookingId: string, reason?: string): Promise<void>;
  rescheduleBooking(bookingId: string, newSlot: TimeSlot): Promise<Booking>;
  getBooking(bookingId: string): Promise<Booking | null>;
  healthCheck(): Promise<CalendarHealthCheck>;
}
```

**Runtime selection in factory (renamed to `calendar-provider-factory.ts`):**

```
if GOOGLE_CALENDAR_CREDENTIALS present → GoogleCalendarAdapter
else if BusinessHoursConfig present → LocalCalendarProvider
else → throw "Calendar unavailable: no credentials and no business hours configured"
```

The third branch is critical: if neither credentials nor hours config exist, the system fails explicitly with "availability not configured" rather than generating nonsense slots.

**What LocalCalendarProvider does:**

- `listAvailableSlots`: generates slots from `BusinessHoursConfig` (timezone, day ranges, open/close times, buffer, duration, increment). Queries DB for existing bookings in the range and excludes overlapping slots.
- `createBooking`: persists booking to DB with `provider: "local"` marker. Uses a DB transaction with an overlap check (`SELECT ... FOR UPDATE` or equivalent constraint) to prevent race-condition double-booking. Returns booking with `calendarEventId: "local-{uuid}"`.
- `cancelBooking`, `rescheduleBooking`, `getBooking`: standard DB operations.
- `healthCheck`: returns `{ status: "degraded", latencyMs: 0 }`. The `CalendarHealthCheckSchema` supports `"connected" | "disconnected" | "degraded"` — `"degraded"` accurately signals that the provider is functional but not synced to an external calendar. Avoids the misleading implication of `"connected"` for a local-only provider.

**Double-booking protection (two layers):**

1. **Slot generation time:** query existing bookings and exclude occupied slots before returning available list.
2. **Booking creation time:** atomic transaction with overlap check. If a concurrent booking landed between slot query and booking creation, the transaction fails with a clear "slot no longer available" error rather than creating a conflict.

**What it does NOT do (v1):**

- Calendar sync to external providers
- Attendee email invitations
- Rescheduling complexity beyond simple DB update
- Two-way reconciliation

**Visibility:**

- Bookings carry explicit `provider` field: `"local"` vs `"google_calendar"`. The `calendarEventId` prefix (`local-`) is supplementary tracing, not the source of truth.
- Dashboard shows provider mode indicator when operating in local calendar mode.
- Boot log emits which calendar provider was selected.

**Existing file changes:**

| File                                                | Change                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/api/src/bootstrap/google-calendar-factory.ts` | Rename to `calendar-provider-factory.ts`. Add local fallback branch. |
| `apps/api/src/bootstrap/skill-mode.ts`              | Update import.                                                       |

---

## Fix 4: Embeddings — Graceful Disable

**Severity:** Degraded
**Complexity:** Low-medium

### Problem

Without `VOYAGE_API_KEY`, `conversation-deps.ts:105-106` returns zero-vector embeddings. Semantic search returns random results silently. This is worse than no results — it creates false confidence.

### Design

**Capability discovery approach:**

Rather than throwing from `embed()`, express unavailability through the interface:

```typescript
interface EmbeddingAdapter {
  readonly dimensions: number;
  readonly available: boolean; // new
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

**New class:** `DisabledEmbeddingAdapter` in `packages/core/src/llm/disabled-embedding-adapter.ts`

```typescript
class DisabledEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions = 1024; // nominal — not proof of active capability
  readonly available = false;

  async embed(_text: string): Promise<number[]> {
    throw new EmbeddingsUnavailableError();
  }

  async embedBatch(_texts: string[]): Promise<number[][]> {
    throw new EmbeddingsUnavailableError();
  }
}
```

The `available` property lets callers check capability before calling. The error is the safety net for code paths that don't check first. Note: `dimensions = 1024` is nominal (matching the Voyage vector index schema) — it must not be used as evidence that a real embedding provider is configured. Code that checks dimensionality for index compatibility should check `available` first.

**Changes to `KnowledgeRetriever`:**

- Before calling `embed()`, check `adapter.available`.
- If unavailable, return `{ results: [], reason: "EMBEDDINGS_UNAVAILABLE" }`.
- Never query pgvector with zero vectors.

**Changes to `conversation-deps.ts`:**

- When no `VOYAGE_API_KEY`: instantiate `DisabledEmbeddingAdapter` instead of the zero-vector lambda.
- Emit boot warning: `"[boot] Embedding provider not configured — semantic search disabled"`.

**Dashboard:**

- Knowledge search UI shows "Semantic search not configured" when retriever returns `EMBEDDINGS_UNAVAILABLE`.
- Does not render random/low-confidence matches.

**Trace/audit:**

- Execution traces annotated with `retrieval_degraded: embeddings_unavailable` when knowledge retrieval was attempted but embeddings were unavailable.

---

## Fix 5: Simulation Endpoint — Real Executor, Dry-Run Mode

**Severity:** Degraded
**Complexity:** Medium-high (highest of the five)

### Problem

`/api/dashboard/simulate` has no backend. The onboarding TestCenter (`test-center.tsx`) calls it with `{ playbook, userMessage }` and gets nothing back. Onboarding step 3 is broken.

### Design

**Core principle:** TestCenter tests Alex, not an imitation of Alex. Same executor, same playbook, same model path, strict dry-run policy envelope.

**Simulation as a runtime mode, not a governance fork:**

The simulation mode uses the same `SkillExecutor` and the same `GovernanceHook`. It adds a `SimulationPolicyHook` (implementing the existing `SkillHook` interface) that intercepts tool calls based on `effectCategory`:

| `effectCategory`    | Simulation behavior             | Rationale                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read`              | Execute normally                | Pure data retrieval, no side effects                                                                                                                                                                                                                   |
| `propose`           | Execute normally                | Non-mutating in Switchboard — governance auto-approves at all trust levels, no state persisted. `proposedWrites` in batch results are a separate concept routed through governance individually; the `propose` effect category itself creates nothing. |
| `simulate`          | Execute normally                | Already a simulation-tier operation                                                                                                                                                                                                                    |
| `write`             | Block — return simulated result | Persists state                                                                                                                                                                                                                                         |
| `external_send`     | Block — return simulated result | Outbound communication                                                                                                                                                                                                                                 |
| `external_mutation` | Block — return simulated result | External system mutation                                                                                                                                                                                                                               |
| `irreversible`      | Block — return simulated result | Cannot be undone                                                                                                                                                                                                                                       |

Blocked tools return a structured `ToolResult`:

```typescript
{
  status: "ok",
  data: {
    simulated: true,
    action: "would_create_booking",
    blocked_reason: "simulation_mode",
    effect_category: "external_mutation"
  }
}
```

This is returned as `ok()` (not `fail()`) so the LLM can incorporate the simulated outcome into its response naturally.

**Implementation:**

`SimulationPolicyHook` implements `SkillHook.beforeToolCall`:

```typescript
async beforeToolCall(ctx: ToolCallContext): Promise<HookResult> {
  const blocked = ["write", "external_send", "external_mutation", "irreversible"];
  if (blocked.includes(ctx.effectCategory)) {
    return {
      proceed: false,
      reason: "simulation_mode",
      substituteResult: ok({
        simulated: true,
        action: `would_execute_${ctx.operation}`,
        blocked_reason: "simulation_mode",
        effect_category: ctx.effectCategory,
      }),
    };
  }
  return { proceed: true };
}
```

**Executor extension required:** The existing hook pipeline (`skill-executor.ts:230-236`) handles `proceed: false` by returning `denied()` or `pendingApproval()` — both signal failure to the LLM. Simulation needs `ok()` with structured simulated data so the LLM treats the outcome as successful and continues naturally.

The `HookResult` interface needs a small extension:

```typescript
interface HookResult {
  proceed: boolean;
  reason?: string;
  decision?: "denied" | "pending_approval";
  substituteResult?: ToolResult; // new — when set, executor returns this instead of denied/pendingApproval
}
```

**Invariant:** `substituteResult` is ONLY allowed when `proceed: false` AND `decision` is undefined. If both are set, the executor throws — behavior would be ambiguous. Assert at runtime:

```typescript
if (substituteResult && decision) {
  throw new Error("Hook invariant violated: substituteResult and decision are mutually exclusive");
}
```

When `proceed: false` and `substituteResult` is present (and `decision` is undefined), the executor uses it directly. When absent, existing denied/pendingApproval behavior is unchanged. This keeps the extension backward-compatible — no existing hooks are affected.

**LLM simulation prompt:** The simulation route injects a system-level instruction: "You are in simulation mode. Actions are not real. Always communicate that outcomes are simulated." Without this, the LLM will narrate simulated `ok()` results as if actions actually happened ("Your booking is confirmed"), creating false confidence.

**API endpoint:**

New Next.js route handler: `apps/dashboard/src/app/api/dashboard/simulate/route.ts`

This is a Next.js API route that proxies to the Fastify API server (`POST /api/simulate`). A corresponding route is added to `apps/api/src/routes/` that performs the actual execution. The endpoint:

1. Accepts `{ playbook: Playbook, userMessage: string }`
2. Builds a temporary skill execution context with the playbook
3. Runs through `SkillExecutor` with `SimulationPolicyHook` prepended to hooks
4. Returns:

```typescript
{
  alexMessage: string;
  annotations: string[];       // governance + policy annotations
  toolsAttempted?: Array<{     // nested, not top-level
    toolId: string;
    operation: string;
    simulated: boolean;
    effectCategory: EffectCategory;
  }>;
  blockedActions?: string[];   // nested
  metadata?: {                 // extensible bucket
    cacheHit?: boolean;
    degraded?: boolean;
    policyNotes?: string[];
  };
}
```

The response contract keeps `alexMessage` and `annotations` as the canonical top-level fields. Everything else is optional/nested to allow evolution without widening the API.

**Cost controls:**

- Rate limit: 20 simulations per org per hour
- Cache: identical `playbook + userMessage` pairs cached with 5-minute TTL
- Context cap: simulation uses `default` model tier, hard cap on context/output tokens
- UI: "last simulated at" timestamp prevents spam refresh

**What simulation validates:** playbook prompt wiring, response style, tool selection intent, governance annotations, failure handling copy.

**What simulation blocks:** CRM writes, real escalations, real bookings, outbound messages, any irreversible side effect.

---

## Sequencing

| Order | Fix                                | Dependency                                 |
| ----- | ---------------------------------- | ------------------------------------------ |
| 1     | Dockerfile `skills/` copy          | None                                       |
| 2     | Escalate per-request instantiation | None                                       |
| 3     | LocalCalendarProvider              | None (implements existing interface)       |
| 4     | Embeddings graceful disable        | None                                       |
| 5     | Simulation endpoint                | Depends on Fix 2 (request context pattern) |

Fixes 1-4 are independent and can be parallelized. Fix 5 depends on the request context pattern from Fix 2 (to properly scope the simulation execution).

---

## Out of Scope

- Approval listing legacy store migration (cosmetic, works)
- Session resume after approval (Phase 3, works without auto-resume)
- nginx DOMAIN placeholder (documented in setup script)
- Google Calendar credential provisioning (deployment config, not product code)
- Local embedding provider (future path, not current priority)
