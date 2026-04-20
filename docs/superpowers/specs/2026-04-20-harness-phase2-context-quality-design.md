# Harness Architecture — Phase 2: Context Quality

**Date:** 2026-04-20
**Status:** Design approved
**Depends on:** Phase 1 (EffectCategory, ToolResult envelope, idempotency) — shipped in PR #217
**Parent spec:** `docs/superpowers/specs/2026-04-19-harness-architecture-design.md` (Section 9, Items 4-6)

---

## Problem

Phase 1 established correctness foundations: typed effect categories, structured tool results, and idempotent ingress. Phase 2 addresses the next failure class: **context quality degradation**.

Three gaps:

1. **Knowledge entries arrive in database order** — the model may see stale, low-priority entries instead of the most relevant ones, and there is no size cap on concatenated entries.
2. **Tool results are raw-injected into model context** — `JSON.stringify(result)` at the executor reinjection site. Large CRM records, verbose diagnostics, and oversized retrieval results degrade reasoning quality.
3. **Errors are ad-hoc strings** — tool failures use inconsistent codes and messages. The model cannot distinguish policy denial from runtime failure from budget exhaustion. Operators see the same undifferentiated noise.

Phase 2 story: **better inputs, safer reinjection, cleaner failure semantics.**

---

## Implementation Order

1. **Item 5: Knowledge entry prioritization** — small, bounded, improves context input quality immediately.
2. **Item 4: Reinjection filter** — prevents context pollution from tool outputs. Depends on ToolResult envelope (Phase 1, done).
3. **Item 6: Error taxonomy** — makes failures legible. Once reinjection behavior is stable, the error taxonomy can describe failures more cleanly.

---

## Item 5: Knowledge Entry Prioritization

### What Changes

`ContextResolverImpl.resolve()` currently concatenates knowledge entries in database order with no size limit. After this change:

1. Each knowledge group is sorted by `priority` descending, then `updatedAt` descending.
2. Concatenated content is truncated at `maxCharsPerRequirement` (default 4000).
3. If truncation occurs, an overflow marker is appended: `\n[... N more entries available, total M chars]`.

### Data Model

```typescript
interface ContextResolutionConfig {
  maxCharsPerRequirement: number; // default 4000
}
```

Passed into `ContextResolverImpl` constructor. No new database tables or migrations.

`ContextResolutionMeta` gains two fields:

```typescript
interface ContextResolutionMeta {
  // ... existing fields ...
  wasTruncated: boolean;
  originalChars: number;
}
```

### Behavior

- Sort is stable: entries with equal priority are ordered by `updatedAt` descending (most recent first).
- Truncation happens at entry boundaries — never mid-entry. If adding the next entry would exceed the cap, it is excluded along with all remaining entries.
- The overflow marker counts excluded entries and their total character count.
- If a required context requirement has zero matching entries, behavior is unchanged (throws `ContextResolutionError`).

### Files Touched

- `packages/core/src/skill-runtime/context-resolver.ts` — sort + truncate logic, config parameter
- Co-located test file

---

## Item 4: Reinjection Filter

### Design Approach

A pure module-level function in a dedicated file. Not a class, not a hook. Executor-owned control logic that sits between tool execution and conversation reinjection.

The function transforms a raw `ToolResult` into a bounded, classified payload safe for model context. Full results are preserved in the trace for operator inspection.

### Types

```typescript
type ResultClass = "scalar" | "structured" | "tabular" | "diagnostic" | "reference";

interface ReinjectionPolicy {
  maxToolResultChars: number; // default 2000
  maxRetrievalResults: number; // default 5
}

interface ReinjectionMeta {
  resultClass: ResultClass;
  originalSizeChars: number;
  injectedSizeChars: number;
  wasTruncated: boolean;
  wasCompacted: boolean;
  wasOmitted: boolean;
  traceId?: string;
}

type ReinjectionDecision =
  | { kind: "pass"; content: string; meta: ReinjectionMeta }
  | { kind: "compact"; content: string; meta: ReinjectionMeta }
  | { kind: "truncate"; content: string; meta: ReinjectionMeta }
  | { kind: "omit"; content: string; meta: ReinjectionMeta };
```

### The Function

```typescript
function filterForReinjection(
  result: ToolResult,
  operation: SkillToolOperation,
  policy: ReinjectionPolicy,
  traceId?: string,
): ReinjectionDecision;
```

### Result Classification

**Explicit declaration wins.** If `resultClass` is set on the operation, that value is used. Otherwise, inference:

- No `data` or `data` is empty object → `scalar`
- `data` contains array values with >1 element → `tabular`
- Otherwise → `structured`

`diagnostic` and `reference` are never inferred — always explicit on the operation.

The inference heuristic is best-effort for Phase 2. Explicit declaration is the recommended path for tool authors.

### Decision Flow

1. Classify the result (explicit or inferred).
2. If `scalar` → **pass** (status-only results are always small enough).
3. If `tabular` or `retrieval: true` — check array lengths against `maxRetrievalResults`. If over limit → **compact**: trim arrays to limit, append `{ truncated: true, totalAvailable: N, narrowingHint: "Too many results. Narrow by adding filters." }`.
4. Serialize result to JSON. Compute size.
5. If size ≤ `maxToolResultChars` → **pass**.
6. If size > 4× `maxToolResultChars` → **omit**: return metadata stub only: `[tool result omitted due to size ({originalSize} chars); full result available in trace {traceId}]`.
7. If `summarizeForModel: true` on the operation → **truncate** with field preservation: keep `status`, `error`, `entityState`, `nextActions` from the `ToolResult`; truncate `data` to fit within cap. This field list is frozen for Phase 2.
8. Otherwise → **truncate**: first N chars of serialized result + `[...truncated; full result available in trace {traceId}]`.

Key ordering: **omit** is checked before **truncate** because it is a stronger decision.

### retrieval vs tabular

These are distinct concepts:

- **`tabular`** is a shape classification — the result contains arrays of records. Drives compaction behavior (trim arrays to limit).
- **`retrieval: boolean`** is a semantic signal — the result is a user-queryable result set that benefits from narrowing hints ("47 more available, narrow your query"). Only retrieval results get narrowing hints.

A result can be `tabular` without being `retrieval` (e.g., line items from an invoice tool). Both flags can coexist.

### summarizeForModel

An operation-level opt-in for smart truncation:

```typescript
interface SkillToolOperation {
  // ... existing fields ...
  resultClass?: ResultClass;
  summarizeForModel?: boolean;
  retrieval?: boolean;
}
```

In Phase 2, `summarizeForModel: true` degrades gracefully to field-preserving truncation. It does not invoke an LLM. The flag exists as an architectural placeholder — the trigger for upgrading to real LLM summarization is when at least one of:

- Reinjection filtering becomes async
- More than one summarization strategy actually exists
- Different channels/executors need different reinjection behavior

### Failure Mode

If the filter function throws, fall back to a **safe omission stub** — not raw `JSON.stringify(result)`:

```
[tool result omitted due to reinjection filter error; full result available in trace {traceId}]
```

Raw stringify is the worst possible fallback because it defeats the safety purpose of the filter in exactly the moment the filter fails. The full result is always available in the trace via `ToolCallRecord`.

### Integration Point

`SkillExecutorImpl`, replacing line 257-261:

```typescript
// Before (raw injection):
content: JSON.stringify(result);

// After (filtered injection):
const decision = filterForReinjection(result, op, policy, traceId);
content: decision.content;
// Full result stays in toolCallRecords for trace persistence
```

`ReinjectionPolicy` defaults are used when no deployment-level config exists. The policy is resolved from deployment config or falls back to hardcoded defaults.

### Files Touched

- `packages/core/src/skill-runtime/reinjection-filter.ts` (new) — types, function, defaults
- `packages/core/src/skill-runtime/types.ts` — add `resultClass?`, `summarizeForModel?`, `retrieval?` to `SkillToolOperation`
- `packages/core/src/skill-runtime/skill-executor.ts` — wire the filter at the injection point
- `packages/core/src/skill-runtime/index.ts` — export types and function
- Co-located test file

---

## Item 6: Error Taxonomy

### What This Is

A closed set of error categories and codes that every `ToolResult` error must map to. Not a new runtime — a type definition, a mapping utility, default remediation text, and a validation test.

The purpose: a governed runtime needs failure states that are consistent, machine-readable, enforceable in tests, and understandable by both the model and the operator.

### The Taxonomy

```typescript
type ErrorCategory = "governance" | "execution" | "budget" | "approval" | "circuit";

interface StructuredError {
  category: ErrorCategory;
  code: string;
  message: string;
  modelRemediation: string;
  operatorRemediation: string;
  retryable: boolean;
  retryAfterMs?: number;
}
```

**Error codes per category (frozen for Phase 2):**

| Category     | Codes                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `governance` | `DENIED_BY_POLICY`, `TRUST_LEVEL_INSUFFICIENT`, `ACTION_TYPE_BLOCKED`, `COOLDOWN_ACTIVE`, `ENTITY_PROTECTED`              |
| `execution`  | `TOOL_NOT_FOUND`, `INVALID_INPUT`, `EXECUTION_TIMEOUT`, `EXTERNAL_SERVICE_ERROR`, `IDEMPOTENCY_DUPLICATE`, `STEP_FAILED`  |
| `budget`     | `TOKEN_BUDGET_EXCEEDED`, `TURN_LIMIT_EXCEEDED`, `RUNTIME_LIMIT_EXCEEDED`, `WRITE_LIMIT_EXCEEDED`, `BLAST_RADIUS_EXCEEDED` |
| `approval`   | `APPROVAL_REQUIRED`, `APPROVAL_EXPIRED`, `APPROVAL_REJECTED`, `BINDING_HASH_MISMATCH`                                     |
| `circuit`    | `CIRCUIT_BREAKER_TRIPPED`, `SAFETY_ENVELOPE_EXCEEDED`                                                                     |

### What Phase 2 Delivers

1. **Type definition** — `StructuredError`, `ErrorCategory`, code string constants.
2. **Builder helper** — `structuredError(category, code, message, opts)` that constructs a `StructuredError` with defaults for remediation text.
3. **Default remediation map** — a lookup from `(category, code)` → default `modelRemediation` + `operatorRemediation` strings. Tool authors can override, but every code has a sensible default.
4. **Migration of existing errors** — audit all existing `fail()` calls across tool factories and map their ad-hoc codes to taxonomy codes. "Closest match" is migration glue only — each mapping must be reviewed, and any genuinely novel error type that does not fit should be flagged as a gap for the next taxonomy revision, not silently crammed into a bad bucket.
5. **Validation test** — a test that imports all tool factories, inspects every operation's known error paths, and asserts they use taxonomy codes. This is the mechanical enforcement that prevents drift.

### What Phase 2 Does NOT Deliver

- User-facing error templates (Phase 4, per parent spec)
- ChannelGateway error routing (Phase 4)
- Success taxonomy types (current `ToolResult.status` values are sufficient)
- Intermediate/deferred outcome types (`awaiting_approval`, `retry_scheduled`) — deferred until a concrete use case needs them

### Relationship to ToolResult

`StructuredError` is a superset of the existing `ToolResult.error` shape. The `fail()` helper in `tool-result.ts` gets an overload that accepts `ErrorCategory` and a taxonomy code, populating remediation from the default map:

```typescript
// Existing (still works, but flagged by validation test):
fail("SOME_CODE", "Something failed", { modelRemediation: "..." });

// New preferred form (category is first arg, disambiguates the overload):
fail("execution", "INVALID_INPUT", "Missing required field 'email'", {
  operatorRemediation: "Check input schema for required fields",
});
// Signature: fail(category: ErrorCategory, code: string, message: string, opts?)
// vs existing: fail(code: string, message: string, opts?)
// Disambiguated by: first arg is a valid ErrorCategory literal
```

Existing `fail()` calls without a category continue to compile but are flagged by the validation test as needing migration.

### Files Touched

- `packages/core/src/skill-runtime/error-taxonomy.ts` (new) — types, constants, builder, default remediation map
- `packages/core/src/skill-runtime/tool-result.ts` — extend `fail()` with category/code overload
- Tool factories across `packages/core/src/skill-runtime/tools/` and `apps/api/src/tools/` — migrate `fail()` calls
- `packages/core/src/skill-runtime/index.ts` — export taxonomy types
- Co-located test file + validation test

---

## Cross-Cutting Concerns

### No New Dependencies

All three items are implemented with existing packages. No new npm dependencies.

### Doctrine Updates

After Phase 2 ships, `docs/DOCTRINE.md` should be updated with:

- Error taxonomy as a doctrine appendix (the 5-category structure and the code list)
- Reinjection filter invariant: "No unbounded tool result reinjection" as a stated architectural rule

### Definition of Done (from parent spec Appendix C)

- [ ] Reinjection filter exists between tool execution and conversation append in `SkillExecutorImpl`
- [ ] `ContextResolver` sorts knowledge entries by priority desc, truncates at char cap
- [ ] Error taxonomy covers all existing error codes with model and operator remediation
- [ ] Error taxonomy and success taxonomy are added as doctrine appendix
