# Phase 2: Context Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve context quality by prioritizing knowledge entries, filtering tool result reinjection, and establishing a structured error taxonomy.

**Architecture:** Three independent items in sequence. Item 5 modifies `ContextResolverImpl` (sort + truncate). Item 4 adds a new pure-function module `reinjection-filter.ts` wired into `SkillExecutorImpl`. Item 6 adds `error-taxonomy.ts` and extends `fail()` with a category-aware overload. All changes live in `packages/core/src/skill-runtime/`.

**Tech Stack:** TypeScript, Vitest, existing `ToolResult` type system.

**Spec:** `docs/superpowers/specs/2026-04-20-harness-phase2-context-quality-design.md`

---

## File Map

| Action | File                                                                   | Responsibility                                                                 |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Modify | `packages/core/src/skill-runtime/context-resolver.ts`                  | Sort entries by priority/recency, truncate at char cap                         |
| Modify | `packages/core/src/skill-runtime/__tests__/context-resolver.test.ts`   | New tests for sort order, truncation, metadata                                 |
| Create | `packages/core/src/skill-runtime/reinjection-filter.ts`                | Types + `filterForReinjection()` pure function                                 |
| Create | `packages/core/src/skill-runtime/__tests__/reinjection-filter.test.ts` | Full coverage of classification, compaction, truncation, omission              |
| Modify | `packages/core/src/skill-runtime/types.ts`                             | Add `resultClass?`, `summarizeForModel?`, `retrieval?` to `SkillToolOperation` |
| Modify | `packages/core/src/skill-runtime/skill-executor.ts`                    | Wire reinjection filter at tool result injection point                         |
| Create | `packages/core/src/skill-runtime/error-taxonomy.ts`                    | Types, constants, builder, default remediation map                             |
| Create | `packages/core/src/skill-runtime/__tests__/error-taxonomy.test.ts`     | Taxonomy builder tests + validation test                                       |
| Modify | `packages/core/src/skill-runtime/tool-result.ts`                       | Extend `fail()` with category-aware overload                                   |
| Modify | `packages/core/src/skill-runtime/tools/web-scanner.ts`                 | Migrate `fail()` calls to taxonomy codes                                       |
| Modify | `packages/core/src/skill-runtime/index.ts`                             | Export new types and functions                                                 |

---

## Task 1: Knowledge Entry Prioritization — Tests

**Files:**

- Modify: `packages/core/src/skill-runtime/__tests__/context-resolver.test.ts`

- [ ] **Step 1: Add test for sort by priority descending**

```typescript
it("sorts entries by priority descending within a group", async () => {
  const store = mockStore([
    {
      kind: "playbook" as KnowledgeKind,
      scope: "objection-handling",
      content: "Low priority",
      priority: 1,
      updatedAt: new Date("2026-04-01"),
    },
    {
      kind: "playbook" as KnowledgeKind,
      scope: "objection-handling",
      content: "High priority",
      priority: 10,
      updatedAt: new Date("2026-04-01"),
    },
  ]);
  const resolver = new ContextResolverImpl(store);

  const result = await resolver.resolve("org_test", [
    { kind: "playbook", scope: "objection-handling", injectAs: "CTX", required: true },
  ]);

  expect(result.variables.CTX).toBe("High priority\n---\nLow priority");
});
```

- [ ] **Step 2: Add test for recency tiebreaker**

```typescript
it("breaks priority ties by updatedAt descending", async () => {
  const store = mockStore([
    {
      kind: "playbook" as KnowledgeKind,
      scope: "objection-handling",
      content: "Older entry",
      priority: 5,
      updatedAt: new Date("2026-03-01"),
    },
    {
      kind: "playbook" as KnowledgeKind,
      scope: "objection-handling",
      content: "Newer entry",
      priority: 5,
      updatedAt: new Date("2026-04-15"),
    },
  ]);
  const resolver = new ContextResolverImpl(store);

  const result = await resolver.resolve("org_test", [
    { kind: "playbook", scope: "objection-handling", injectAs: "CTX", required: true },
  ]);

  expect(result.variables.CTX).toBe("Newer entry\n---\nOlder entry");
});
```

- [ ] **Step 3: Add test for truncation at entry boundaries**

```typescript
it("truncates at entry boundaries when exceeding maxCharsPerRequirement", async () => {
  const store = mockStore([
    {
      kind: "playbook" as KnowledgeKind,
      scope: "s",
      content: "A".repeat(3000),
      priority: 10,
      updatedAt: new Date(),
    },
    {
      kind: "playbook" as KnowledgeKind,
      scope: "s",
      content: "B".repeat(2000),
      priority: 5,
      updatedAt: new Date(),
    },
  ]);
  const resolver = new ContextResolverImpl(store, { maxCharsPerRequirement: 4000 });

  const result = await resolver.resolve("org_test", [
    { kind: "playbook", scope: "s", injectAs: "CTX", required: true },
  ]);

  expect(result.variables.CTX).toContain("A".repeat(3000));
  expect(result.variables.CTX).not.toContain("B".repeat(2000));
  expect(result.variables.CTX).toContain("[... truncated; 1 additional entries omitted;");
  expect(result.metadata[0]!.wasTruncated).toBe(true);
  expect(result.metadata[0]!.originalChars).toBeGreaterThan(4000);
});
```

- [ ] **Step 4: Add test for no truncation when under cap**

```typescript
it("does not truncate when total chars are under the cap", async () => {
  const store = mockStore([
    {
      kind: "playbook" as KnowledgeKind,
      scope: "s",
      content: "Short content",
      priority: 5,
      updatedAt: new Date(),
    },
  ]);
  const resolver = new ContextResolverImpl(store, { maxCharsPerRequirement: 4000 });

  const result = await resolver.resolve("org_test", [
    { kind: "playbook", scope: "s", injectAs: "CTX", required: true },
  ]);

  expect(result.variables.CTX).toBe("Short content");
  expect(result.metadata[0]!.wasTruncated).toBe(false);
  expect(result.metadata[0]!.originalChars).toBe(13);
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- --run -t "sorts entries|breaks priority|truncates at entry|does not truncate"`

Expected: FAIL — `ContextResolverImpl` constructor does not accept config, no `wasTruncated`/`originalChars` on metadata.

---

## Task 2: Knowledge Entry Prioritization — Implementation

**Files:**

- Modify: `packages/core/src/skill-runtime/context-resolver.ts`

- [ ] **Step 1: Add `ContextResolutionConfig` interface and update constructor**

```typescript
export interface ContextResolutionConfig {
  maxCharsPerRequirement: number;
}

const DEFAULT_CONTEXT_CONFIG: ContextResolutionConfig = {
  maxCharsPerRequirement: 4000,
};

export class ContextResolverImpl {
  private config: ContextResolutionConfig;

  constructor(
    private store: KnowledgeEntryStoreForResolver,
    config?: Partial<ContextResolutionConfig>,
  ) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
  }
```

- [ ] **Step 2: Add `wasTruncated` and `originalChars` to `ContextResolutionMeta`**

```typescript
export interface ContextResolutionMeta {
  injectAs: string;
  kind: KnowledgeKind;
  scope: string;
  entriesFound: number;
  totalChars: number;
  wasTruncated: boolean;
  originalChars: number;
}
```

- [ ] **Step 3: Add sort and truncation logic in `resolve()`**

Replace the existing group processing loop (the `for (const req of requirements)` block) with:

```typescript
for (const req of requirements) {
  const key = `${req.kind}::${req.scope}`;
  const group = grouped.get(key) ?? [];

  if (group.length === 0 && req.required) {
    throw new ContextResolutionError(req.kind, req.scope);
  }

  // Sort: priority desc, then updatedAt desc
  group.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  // Truncate at entry boundaries
  const separator = "\n---\n";
  const included: string[] = [];
  let charCount = 0;
  let omittedCount = 0;
  let omittedChars = 0;

  for (const entry of group) {
    const addition =
      included.length > 0 ? separator.length + entry.content.length : entry.content.length;
    if (charCount + addition > this.config.maxCharsPerRequirement && included.length > 0) {
      omittedCount++;
      omittedChars += entry.content.length;
      continue;
    }
    included.push(entry.content);
    charCount += addition;
  }

  // Count remaining omitted entries
  const remainingOmitted = group.length - included.length - omittedCount;
  omittedCount += remainingOmitted;

  let concatenated = included.join(separator);
  const originalChars = group.reduce(
    (sum, e, i) => sum + e.content.length + (i > 0 ? separator.length : 0),
    0,
  );
  const wasTruncated = omittedCount > 0;

  if (wasTruncated) {
    const totalOmittedChars =
      omittedChars +
      group.slice(included.length + omittedCount).reduce((s, e) => s + e.content.length, 0);
    concatenated += `\n[... truncated; ${omittedCount} additional entries omitted; original length ${originalChars} chars]`;
  }

  if (group.length > 0) {
    variables[req.injectAs] = concatenated;
  }

  metadata.push({
    injectAs: req.injectAs,
    kind: req.kind,
    scope: req.scope,
    entriesFound: group.length,
    totalChars: concatenated.length,
    wasTruncated,
    originalChars,
  });
}
```

Note: The truncation loop above has a bug in the `omittedCount` tracking — once we skip an entry via `continue`, all subsequent entries are also skipped. Let me simplify:

```typescript
for (const req of requirements) {
  const key = `${req.kind}::${req.scope}`;
  const group = grouped.get(key) ?? [];

  if (group.length === 0 && req.required) {
    throw new ContextResolutionError(req.kind, req.scope);
  }

  group.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  const separator = "\n---\n";
  const included: string[] = [];
  let charCount = 0;

  for (const entry of group) {
    const addition =
      included.length > 0 ? separator.length + entry.content.length : entry.content.length;
    if (charCount + addition > this.config.maxCharsPerRequirement && included.length > 0) {
      break;
    }
    included.push(entry.content);
    charCount += addition;
  }

  const omittedCount = group.length - included.length;
  const originalChars = group.reduce(
    (sum, e, i) => sum + e.content.length + (i > 0 ? separator.length : 0),
    0,
  );
  const wasTruncated = omittedCount > 0;

  let concatenated = included.join(separator);
  if (wasTruncated) {
    concatenated += `\n[... truncated; ${omittedCount} additional entries omitted; original length ${originalChars} chars]`;
  }

  if (group.length > 0) {
    variables[req.injectAs] = concatenated;
  }

  metadata.push({
    injectAs: req.injectAs,
    kind: req.kind,
    scope: req.scope,
    entriesFound: group.length,
    totalChars: concatenated.length,
    wasTruncated,
    originalChars,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- --run -t "context-resolver|ContextResolver"`

Expected: All context-resolver tests PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/context-resolver.ts packages/core/src/skill-runtime/__tests__/context-resolver.test.ts
git commit -m "feat: add knowledge entry prioritization and truncation to ContextResolver"
```

---

## Task 3: Reinjection Filter — Types and Tests

**Files:**

- Create: `packages/core/src/skill-runtime/reinjection-filter.ts`
- Create: `packages/core/src/skill-runtime/__tests__/reinjection-filter.test.ts`

- [ ] **Step 1: Create `reinjection-filter.ts` with types and default policy**

```typescript
import type { ToolResult } from "./tool-result.js";
import type { SkillToolOperation } from "./types.js";

export type ResultClass = "scalar" | "structured" | "tabular" | "diagnostic" | "reference";

export interface ReinjectionPolicy {
  maxToolResultChars: number;
  maxRetrievalResults: number;
}

export const DEFAULT_REINJECTION_POLICY: ReinjectionPolicy = {
  maxToolResultChars: 2000,
  maxRetrievalResults: 5,
};

export interface ReinjectionMeta {
  resultClass: ResultClass;
  originalSizeChars: number;
  injectedSizeChars: number;
  wasTruncated: boolean;
  wasCompacted: boolean;
  wasOmitted: boolean;
  traceId?: string;
}

export type ReinjectionDecision =
  | { kind: "pass"; content: string; meta: ReinjectionMeta }
  | { kind: "compact"; content: string; meta: ReinjectionMeta }
  | { kind: "truncate"; content: string; meta: ReinjectionMeta }
  | { kind: "omit"; content: string; meta: ReinjectionMeta };
```

- [ ] **Step 2: Write tests for classification logic**

```typescript
import { describe, it, expect } from "vitest";
import { filterForReinjection, DEFAULT_REINJECTION_POLICY } from "../reinjection-filter.js";
import type { SkillToolOperation } from "../types.js";
import { ok, fail } from "../tool-result.js";
import type { ToolResult } from "../tool-result.js";

function stubOp(overrides: Partial<SkillToolOperation> = {}): SkillToolOperation {
  return {
    description: "test op",
    inputSchema: {},
    effectCategory: "read",
    execute: async () => ok(),
    ...overrides,
  };
}

describe("filterForReinjection", () => {
  describe("classification", () => {
    it("classifies result with no data as scalar", () => {
      const result = ok();
      const decision = filterForReinjection(result, stubOp(), DEFAULT_REINJECTION_POLICY);
      expect(decision.kind).toBe("pass");
      expect(decision.meta.resultClass).toBe("scalar");
    });

    it("classifies result with empty data as scalar", () => {
      const result = ok({});
      const decision = filterForReinjection(result, stubOp(), DEFAULT_REINJECTION_POLICY);
      expect(decision.meta.resultClass).toBe("scalar");
    });

    it("classifies result with array values as tabular", () => {
      const result = ok({ items: [{ id: 1 }, { id: 2 }] });
      const decision = filterForReinjection(result, stubOp(), DEFAULT_REINJECTION_POLICY);
      expect(decision.meta.resultClass).toBe("tabular");
    });

    it("classifies result with non-array values as structured", () => {
      const result = ok({ name: "Alice", email: "alice@example.com" });
      const decision = filterForReinjection(result, stubOp(), DEFAULT_REINJECTION_POLICY);
      expect(decision.meta.resultClass).toBe("structured");
    });

    it("uses explicit resultClass over inference", () => {
      const result = ok({ items: [{ id: 1 }, { id: 2 }] });
      const decision = filterForReinjection(
        result,
        stubOp({ resultClass: "diagnostic" }),
        DEFAULT_REINJECTION_POLICY,
      );
      expect(decision.meta.resultClass).toBe("diagnostic");
    });
  });
});
```

- [ ] **Step 3: Write tests for pass-through behavior**

```typescript
describe("pass-through", () => {
  it("passes small structured results unchanged", () => {
    const result = ok({ name: "Alice" });
    const decision = filterForReinjection(result, stubOp(), DEFAULT_REINJECTION_POLICY);
    expect(decision.kind).toBe("pass");
    expect(decision.meta.wasTruncated).toBe(false);
    expect(decision.meta.wasCompacted).toBe(false);
    expect(decision.meta.wasOmitted).toBe(false);
    const parsed = JSON.parse(decision.content);
    expect(parsed.data.name).toBe("Alice");
  });

  it("always passes scalar results regardless of policy", () => {
    const result = ok();
    const tinyPolicy = { maxToolResultChars: 1, maxRetrievalResults: 1 };
    const decision = filterForReinjection(result, stubOp(), tinyPolicy);
    expect(decision.kind).toBe("pass");
  });
});
```

- [ ] **Step 4: Write tests for compaction**

```typescript
describe("compaction", () => {
  it("compacts tabular results exceeding maxRetrievalResults", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `item_${i}` }));
    const result = ok({ items });
    const policy = { maxToolResultChars: 50_000, maxRetrievalResults: 3 };
    const decision = filterForReinjection(result, stubOp(), policy);

    expect(decision.kind).toBe("compact");
    expect(decision.meta.wasCompacted).toBe(true);
    const parsed = JSON.parse(decision.content);
    expect(parsed.data.items).toHaveLength(3);
    expect(parsed.data._compaction).toEqual({
      truncated: true,
      totalAvailable: 10,
      narrowingHint: "Too many results. Narrow by adding filters.",
    });
  });

  it("does not compact tabular results under the limit", () => {
    const result = ok({ items: [{ id: 1 }, { id: 2 }] });
    const policy = { maxToolResultChars: 50_000, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp(), policy);
    expect(decision.kind).toBe("pass");
    expect(decision.meta.wasCompacted).toBe(false);
  });
});
```

- [ ] **Step 5: Write tests for truncation and omission**

```typescript
describe("truncation", () => {
  it("truncates results exceeding maxToolResultChars", () => {
    const bigData = { payload: "X".repeat(3000) };
    const result = ok(bigData);
    const policy = { maxToolResultChars: 500, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp(), policy);

    expect(decision.kind).toBe("truncate");
    expect(decision.meta.wasTruncated).toBe(true);
    expect(decision.content.length).toBeLessThanOrEqual(600);
    expect(decision.content).toContain("[...truncated;");
  });

  it("uses field preservation when summarizeForModel is true", () => {
    const result: ToolResult = {
      status: "success",
      data: { payload: "X".repeat(3000) },
      entityState: { stage: "qualified" },
      nextActions: ["update_stage"],
    };
    const policy = { maxToolResultChars: 500, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp({ summarizeForModel: true }), policy);

    expect(decision.kind).toBe("truncate");
    const parsed = JSON.parse(decision.content);
    expect(parsed.status).toBe("success");
    expect(parsed.entityState).toEqual({ stage: "qualified" });
    expect(parsed.nextActions).toEqual(["update_stage"]);
  });
});

describe("omission", () => {
  it("omits results exceeding 4x maxToolResultChars", () => {
    const hugeData = { payload: "X".repeat(10_000) };
    const result = ok(hugeData);
    const policy = { maxToolResultChars: 500, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp(), policy);

    expect(decision.kind).toBe("omit");
    expect(decision.meta.wasOmitted).toBe(true);
    expect(decision.content).toContain("tool result omitted due to size");
  });

  it("includes traceId in omission stub when provided", () => {
    const result = ok({ payload: "X".repeat(10_000) });
    const policy = { maxToolResultChars: 500, maxRetrievalResults: 5 };
    const decision = filterForReinjection(result, stubOp(), policy, "trace_abc123");

    expect(decision.content).toContain("trace_abc123");
  });
});
```

- [ ] **Step 6: Write test for failure fallback**

```typescript
describe("failure fallback", () => {
  it("returns safe omission stub if classification throws", () => {
    const badResult = { status: "success" } as ToolResult;
    Object.defineProperty(badResult, "data", {
      get() {
        throw new Error("boom");
      },
    });
    const decision = filterForReinjection(
      badResult,
      stubOp(),
      DEFAULT_REINJECTION_POLICY,
      "trace_x",
    );

    expect(decision.kind).toBe("omit");
    expect(decision.content).toContain("reinjection filter error");
    expect(decision.content).toContain("trace_x");
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- --run -t "filterForReinjection"`

Expected: FAIL — `filterForReinjection` is not yet implemented (only types exist).

---

## Task 4: Reinjection Filter — Implementation

**Files:**

- Modify: `packages/core/src/skill-runtime/reinjection-filter.ts`
- Modify: `packages/core/src/skill-runtime/types.ts`

- [ ] **Step 1: Add new optional fields to `SkillToolOperation`**

In `packages/core/src/skill-runtime/types.ts`, add to the `SkillToolOperation` interface:

```typescript
export interface SkillToolOperation {
  description: string;
  inputSchema: Record<string, unknown>;
  effectCategory: EffectCategory;
  governanceOverride?: Partial<Record<TrustLevel, GovernanceDecision>>;
  idempotent?: boolean;
  resultClass?: import("./reinjection-filter.js").ResultClass;
  summarizeForModel?: boolean;
  retrieval?: boolean;
  execute(params: unknown): Promise<ToolResult>;
}
```

- [ ] **Step 2: Implement `filterForReinjection` in `reinjection-filter.ts`**

```typescript
function classifyResult(result: ToolResult, operation: SkillToolOperation): ResultClass {
  if (operation.resultClass) return operation.resultClass;
  if (!result.data || Object.keys(result.data).length === 0) return "scalar";
  const hasArrayWithMultiple = Object.values(result.data).some(
    (v) => Array.isArray(v) && v.length > 1,
  );
  if (hasArrayWithMultiple) return "tabular";
  return "structured";
}

function buildMeta(
  resultClass: ResultClass,
  originalSize: number,
  injectedSize: number,
  traceId?: string,
  overrides?: Partial<ReinjectionMeta>,
): ReinjectionMeta {
  return {
    resultClass,
    originalSizeChars: originalSize,
    injectedSizeChars: injectedSize,
    wasTruncated: false,
    wasCompacted: false,
    wasOmitted: false,
    traceId,
    ...overrides,
  };
}

function compactArrays(
  data: Record<string, unknown>,
  maxResults: number,
): { compacted: Record<string, unknown>; didCompact: boolean } {
  let didCompact = false;
  const compacted = { ...data };
  for (const [key, value] of Object.entries(compacted)) {
    if (Array.isArray(value) && value.length > maxResults) {
      const totalAvailable = value.length;
      compacted[key] = value.slice(0, maxResults);
      compacted["_compaction"] = {
        truncated: true,
        totalAvailable,
        narrowingHint: "Too many results. Narrow by adding filters.",
      };
      didCompact = true;
    }
  }
  return { compacted, didCompact };
}

export function filterForReinjection(
  result: ToolResult,
  operation: SkillToolOperation,
  policy: ReinjectionPolicy,
  traceId?: string,
): ReinjectionDecision {
  try {
    const resultClass = classifyResult(result, operation);

    // 1. Scalar — always pass
    if (resultClass === "scalar") {
      const content = JSON.stringify(result);
      return {
        kind: "pass",
        content,
        meta: buildMeta(resultClass, content.length, content.length, traceId),
      };
    }

    // 2. Compact tabular/retrieval arrays
    let workingResult = result;
    let wasCompacted = false;
    if ((resultClass === "tabular" || operation.retrieval) && workingResult.data) {
      const { compacted, didCompact } = compactArrays(
        workingResult.data,
        policy.maxRetrievalResults,
      );
      if (didCompact) {
        workingResult = { ...workingResult, data: compacted };
        wasCompacted = true;
      }
    }

    // 3. Serialize and measure (post-compaction)
    const serialized = JSON.stringify(workingResult);
    const originalSize = JSON.stringify(result).length;

    // 4. Pass if under cap
    if (serialized.length <= policy.maxToolResultChars) {
      return {
        kind: wasCompacted ? "compact" : "pass",
        content: serialized,
        meta: buildMeta(resultClass, originalSize, serialized.length, traceId, {
          wasCompacted,
        }),
      };
    }

    // 5. Omit if over 4x cap
    if (serialized.length > policy.maxToolResultChars * 4) {
      const stub = `[tool result omitted due to size (${originalSize} chars); full result available in trace ${traceId ?? "unknown"}]`;
      return {
        kind: "omit",
        content: stub,
        meta: buildMeta(resultClass, originalSize, stub.length, traceId, {
          wasOmitted: true,
        }),
      };
    }

    // 6. Smart truncation (field preservation) for summarizeForModel
    if (operation.summarizeForModel) {
      const preserved: Record<string, unknown> = { status: workingResult.status };
      if (workingResult.error) preserved.error = workingResult.error;
      if (workingResult.entityState) preserved.entityState = workingResult.entityState;
      if (workingResult.nextActions) preserved.nextActions = workingResult.nextActions;
      if (workingResult.data) {
        const dataStr = JSON.stringify(workingResult.data);
        const overhead = JSON.stringify(preserved).length + 20;
        const budget = policy.maxToolResultChars - overhead;
        if (budget > 0) {
          preserved.data = JSON.parse(dataStr.slice(0, budget));
        }
      }
      const content = JSON.stringify(preserved);
      return {
        kind: "truncate",
        content,
        meta: buildMeta(resultClass, originalSize, content.length, traceId, {
          wasTruncated: true,
        }),
      };
    }

    // 7. Basic truncation
    const truncated =
      serialized.slice(0, policy.maxToolResultChars) +
      `[...truncated; full result available in trace ${traceId ?? "unknown"}]`;
    return {
      kind: "truncate",
      content: truncated,
      meta: buildMeta(resultClass, originalSize, truncated.length, traceId, {
        wasTruncated: true,
      }),
    };
  } catch {
    const stub = `[tool result omitted due to reinjection filter error; full result available in trace ${traceId ?? "unknown"}]`;
    return {
      kind: "omit",
      content: stub,
      meta: {
        resultClass: "structured",
        originalSizeChars: 0,
        injectedSizeChars: stub.length,
        wasTruncated: false,
        wasCompacted: false,
        wasOmitted: true,
        traceId,
      },
    };
  }
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- --run -t "filterForReinjection"`

Expected: All reinjection filter tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/reinjection-filter.ts packages/core/src/skill-runtime/__tests__/reinjection-filter.test.ts packages/core/src/skill-runtime/types.ts
git commit -m "feat: add reinjection filter with classification, compaction, and truncation"
```

---

## Task 5: Wire Reinjection Filter into SkillExecutorImpl

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Modify: `packages/core/src/skill-runtime/index.ts`

- [ ] **Step 1: Import and wire the filter in `skill-executor.ts`**

Add import at the top of `skill-executor.ts`:

```typescript
import { filterForReinjection, DEFAULT_REINJECTION_POLICY } from "./reinjection-filter.js";
import type { ReinjectionPolicy } from "./reinjection-filter.js";
```

- [ ] **Step 2: Replace raw JSON.stringify at the tool result injection point**

In `skill-executor.ts`, replace lines 257-261:

```typescript
toolResults.push({
  type: "tool_result",
  tool_use_id: toolUse.id,
  content: JSON.stringify(result),
});
```

with:

```typescript
const reinjectionPolicy = DEFAULT_REINJECTION_POLICY;
const decision = filterForReinjection(result, op ?? stubReadOp, reinjectionPolicy);
toolResults.push({
  type: "tool_result",
  tool_use_id: toolUse.id,
  content: decision.content,
});
```

Also add a fallback stub operation constant near the top of the class (used when `op` is undefined — the tool-not-found path):

```typescript
const stubReadOp: SkillToolOperation = {
  description: "",
  inputSchema: {},
  effectCategory: "read",
  execute: async () => ok(),
};
```

This `stubReadOp` import requires adding `ok` to the imports from `tool-result.js` (already imported) and `SkillToolOperation` to the imports from `types.js` (already imported).

- [ ] **Step 3: Add exports to `index.ts`**

```typescript
export { filterForReinjection, DEFAULT_REINJECTION_POLICY } from "./reinjection-filter.js";
export type {
  ResultClass,
  ReinjectionPolicy,
  ReinjectionMeta,
  ReinjectionDecision,
} from "./reinjection-filter.js";
```

- [ ] **Step 4: Run full core test suite**

Run: `pnpm --filter @switchboard/core test -- --run`

Expected: All tests PASS. The executor tests should still pass because the filter is transparent for small results (passes them through unchanged).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`

Expected: 18/18 packages pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/index.ts
git commit -m "feat: wire reinjection filter into SkillExecutorImpl tool result injection"
```

---

## Task 6: Error Taxonomy — Types and Tests

**Files:**

- Create: `packages/core/src/skill-runtime/error-taxonomy.ts`
- Create: `packages/core/src/skill-runtime/__tests__/error-taxonomy.test.ts`

- [ ] **Step 1: Create `error-taxonomy.ts` with types and constants**

```typescript
export type ErrorCategory = "governance" | "execution" | "budget" | "approval" | "circuit";

export const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  "governance",
  "execution",
  "budget",
  "approval",
  "circuit",
] as const;

export interface StructuredError {
  category: ErrorCategory;
  code: string;
  message: string;
  modelRemediation: string;
  operatorRemediation: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export const TAXONOMY_CODES: Record<ErrorCategory, readonly string[]> = {
  governance: [
    "DENIED_BY_POLICY",
    "TRUST_LEVEL_INSUFFICIENT",
    "ACTION_TYPE_BLOCKED",
    "COOLDOWN_ACTIVE",
    "ENTITY_PROTECTED",
  ],
  execution: [
    "TOOL_NOT_FOUND",
    "INVALID_INPUT",
    "EXECUTION_TIMEOUT",
    "EXTERNAL_SERVICE_ERROR",
    "IDEMPOTENCY_DUPLICATE",
    "STEP_FAILED",
  ],
  budget: [
    "TOKEN_BUDGET_EXCEEDED",
    "TURN_LIMIT_EXCEEDED",
    "RUNTIME_LIMIT_EXCEEDED",
    "WRITE_LIMIT_EXCEEDED",
    "BLAST_RADIUS_EXCEEDED",
  ],
  approval: ["APPROVAL_REQUIRED", "APPROVAL_EXPIRED", "APPROVAL_REJECTED", "BINDING_HASH_MISMATCH"],
  circuit: ["CIRCUIT_BREAKER_TRIPPED", "SAFETY_ENVELOPE_EXCEEDED"],
} as const;

const ALL_CODES = new Set(Object.values(TAXONOMY_CODES).flat());

export function isValidTaxonomyCode(code: string): boolean {
  return ALL_CODES.has(code);
}

export function getCategoryForCode(code: string): ErrorCategory | undefined {
  for (const [category, codes] of Object.entries(TAXONOMY_CODES)) {
    if ((codes as readonly string[]).includes(code)) {
      return category as ErrorCategory;
    }
  }
  return undefined;
}
```

- [ ] **Step 2: Add default remediation map**

```typescript
interface DefaultRemediation {
  modelRemediation: string;
  operatorRemediation: string;
  retryable: boolean;
}

export const DEFAULT_REMEDIATIONS: Record<string, DefaultRemediation> = {
  DENIED_BY_POLICY: {
    modelRemediation:
      "This action is not permitted. Try a different approach or escalate to a human.",
    operatorRemediation:
      "Policy denied the action. Check governance rules for this effect category.",
    retryable: false,
  },
  TRUST_LEVEL_INSUFFICIENT: {
    modelRemediation:
      "Current trust level does not allow this action. Request approval or try a lower-impact alternative.",
    operatorRemediation:
      "Trust level too low for this effect category. Review trust score and deployment config.",
    retryable: false,
  },
  ACTION_TYPE_BLOCKED: {
    modelRemediation: "This type of action is blocked. Try a different operation.",
    operatorRemediation: "Action type is blocked by deployment configuration.",
    retryable: false,
  },
  COOLDOWN_ACTIVE: {
    modelRemediation: "Action is in cooldown. Wait before retrying.",
    operatorRemediation: "Cooldown period active. Check cooldown configuration.",
    retryable: true,
  },
  ENTITY_PROTECTED: {
    modelRemediation: "This entity is protected and cannot be modified. Try a different target.",
    operatorRemediation: "Entity has protection flag. Check protection rules.",
    retryable: false,
  },
  TOOL_NOT_FOUND: {
    modelRemediation: "Tool not found. Check available tools for this skill.",
    operatorRemediation: "Tool ID does not match any registered tool.",
    retryable: false,
  },
  INVALID_INPUT: {
    modelRemediation: "Input is invalid. Check required fields and types.",
    operatorRemediation: "Input validation failed. Check input schema.",
    retryable: false,
  },
  EXECUTION_TIMEOUT: {
    modelRemediation: "Operation timed out. Try again or simplify the request.",
    operatorRemediation: "Execution exceeded timeout. Check external service latency.",
    retryable: true,
  },
  EXTERNAL_SERVICE_ERROR: {
    modelRemediation: "External service error. Try again shortly.",
    operatorRemediation: "External service returned an error. Check service status.",
    retryable: true,
  },
  IDEMPOTENCY_DUPLICATE: {
    modelRemediation: "This action was already performed. No need to retry.",
    operatorRemediation: "Duplicate idempotency key. Previous result was returned.",
    retryable: false,
  },
  STEP_FAILED: {
    modelRemediation: "A workflow step failed. Check the error details and try again.",
    operatorRemediation: "Workflow step execution failed. Check trace for details.",
    retryable: true,
  },
  TOKEN_BUDGET_EXCEEDED: {
    modelRemediation: "Token budget exceeded. Summarize and complete the current task.",
    operatorRemediation: "Token usage exceeded deployment limit. Check maxTotalTokens config.",
    retryable: false,
  },
  TURN_LIMIT_EXCEEDED: {
    modelRemediation: "Turn limit reached. Complete the task with available information.",
    operatorRemediation: "LLM turn limit exceeded. Check maxLlmTurns config.",
    retryable: false,
  },
  RUNTIME_LIMIT_EXCEEDED: {
    modelRemediation: "Runtime limit reached. Complete the task with available information.",
    operatorRemediation: "Execution runtime exceeded limit. Check maxRuntimeMs config.",
    retryable: false,
  },
  WRITE_LIMIT_EXCEEDED: {
    modelRemediation: "Write limit reached. No more write operations allowed in this execution.",
    operatorRemediation: "Write count exceeded limit. Check maxWritesPerExecution config.",
    retryable: false,
  },
  BLAST_RADIUS_EXCEEDED: {
    modelRemediation: "Action scope too large. Narrow the target set.",
    operatorRemediation: "Blast radius limiter triggered. Check affected entity count.",
    retryable: false,
  },
  APPROVAL_REQUIRED: {
    modelRemediation: "This action requires approval. Inform the user and wait.",
    operatorRemediation: "Action queued for approval. Check approval queue.",
    retryable: false,
  },
  APPROVAL_EXPIRED: {
    modelRemediation: "Approval expired. Re-request approval if still needed.",
    operatorRemediation: "Approval timed out. User may need to re-approve.",
    retryable: false,
  },
  APPROVAL_REJECTED: {
    modelRemediation: "Approval was rejected. Try a different approach or inform the user.",
    operatorRemediation: "Approver rejected the action. Check rejection reason.",
    retryable: false,
  },
  BINDING_HASH_MISMATCH: {
    modelRemediation: "Parameters changed since approval was requested. Re-request approval.",
    operatorRemediation: "Approval binding hash does not match current parameters.",
    retryable: false,
  },
  CIRCUIT_BREAKER_TRIPPED: {
    modelRemediation: "Too many recent failures. Stop and escalate to a human.",
    operatorRemediation: "Circuit breaker tripped. Check failure count and time window.",
    retryable: false,
  },
  SAFETY_ENVELOPE_EXCEEDED: {
    modelRemediation: "Safety limit exceeded. Stop and escalate to a human.",
    operatorRemediation: "Safety envelope exceeded. Investigate immediately.",
    retryable: false,
  },
};
```

- [ ] **Step 3: Add `structuredError` builder**

```typescript
export function structuredError(
  category: ErrorCategory,
  code: string,
  message: string,
  opts?: Partial<
    Pick<StructuredError, "modelRemediation" | "operatorRemediation" | "retryable" | "retryAfterMs">
  >,
): StructuredError {
  const defaults = DEFAULT_REMEDIATIONS[code];
  return {
    category,
    code,
    message,
    modelRemediation:
      opts?.modelRemediation ??
      defaults?.modelRemediation ??
      "An error occurred. Try a different approach.",
    operatorRemediation:
      opts?.operatorRemediation ??
      defaults?.operatorRemediation ??
      "Unexpected error. Check trace for details.",
    retryable: opts?.retryable ?? defaults?.retryable ?? false,
    retryAfterMs: opts?.retryAfterMs,
  };
}
```

- [ ] **Step 4: Write tests for taxonomy**

```typescript
import { describe, it, expect } from "vitest";
import {
  isValidTaxonomyCode,
  getCategoryForCode,
  structuredError,
  TAXONOMY_CODES,
  DEFAULT_REMEDIATIONS,
} from "../error-taxonomy.js";

describe("error-taxonomy", () => {
  it("validates known taxonomy codes", () => {
    expect(isValidTaxonomyCode("DENIED_BY_POLICY")).toBe(true);
    expect(isValidTaxonomyCode("TOOL_NOT_FOUND")).toBe(true);
    expect(isValidTaxonomyCode("CIRCUIT_BREAKER_TRIPPED")).toBe(true);
  });

  it("rejects unknown codes", () => {
    expect(isValidTaxonomyCode("RANDOM_ERROR")).toBe(false);
    expect(isValidTaxonomyCode("")).toBe(false);
  });

  it("resolves category for known codes", () => {
    expect(getCategoryForCode("DENIED_BY_POLICY")).toBe("governance");
    expect(getCategoryForCode("TOOL_NOT_FOUND")).toBe("execution");
    expect(getCategoryForCode("TOKEN_BUDGET_EXCEEDED")).toBe("budget");
    expect(getCategoryForCode("APPROVAL_REQUIRED")).toBe("approval");
    expect(getCategoryForCode("CIRCUIT_BREAKER_TRIPPED")).toBe("circuit");
  });

  it("returns undefined for unknown codes", () => {
    expect(getCategoryForCode("UNKNOWN")).toBeUndefined();
  });

  it("every taxonomy code has a default remediation", () => {
    for (const codes of Object.values(TAXONOMY_CODES)) {
      for (const code of codes) {
        expect(DEFAULT_REMEDIATIONS[code]).toBeDefined();
        expect(DEFAULT_REMEDIATIONS[code]!.modelRemediation).toBeTruthy();
        expect(DEFAULT_REMEDIATIONS[code]!.operatorRemediation).toBeTruthy();
      }
    }
  });

  describe("structuredError builder", () => {
    it("builds error with default remediations", () => {
      const err = structuredError("execution", "INVALID_INPUT", "Missing email");
      expect(err.category).toBe("execution");
      expect(err.code).toBe("INVALID_INPUT");
      expect(err.message).toBe("Missing email");
      expect(err.modelRemediation).toBeTruthy();
      expect(err.operatorRemediation).toBeTruthy();
      expect(err.retryable).toBe(false);
    });

    it("allows overriding default remediations", () => {
      const err = structuredError("execution", "INVALID_INPUT", "Bad input", {
        modelRemediation: "Custom model guidance",
        operatorRemediation: "Custom operator note",
        retryable: true,
      });
      expect(err.modelRemediation).toBe("Custom model guidance");
      expect(err.operatorRemediation).toBe("Custom operator note");
      expect(err.retryable).toBe(true);
    });

    it("provides fallback remediations for unknown codes", () => {
      const err = structuredError("execution", "UNKNOWN_CODE", "Something");
      expect(err.modelRemediation).toBeTruthy();
      expect(err.operatorRemediation).toBeTruthy();
    });
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run -t "error-taxonomy"`

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/error-taxonomy.ts packages/core/src/skill-runtime/__tests__/error-taxonomy.test.ts
git commit -m "feat: add error taxonomy types, constants, builder, and default remediations"
```

---

## Task 7: Extend `fail()` with Category-Aware Overload

**Files:**

- Modify: `packages/core/src/skill-runtime/tool-result.ts`
- Modify: `packages/core/src/skill-runtime/__tests__/tool-result.test.ts`

- [ ] **Step 1: Add test for the new overload**

In `tool-result.test.ts`, add:

```typescript
it("fail() with category uses taxonomy defaults", () => {
  const result = fail("execution", "INVALID_INPUT", "Missing field");
  expect(result.status).toBe("error");
  expect(result.error?.code).toBe("INVALID_INPUT");
  expect(result.error?.message).toBe("Missing field");
  expect(result.error?.modelRemediation).toBeTruthy();
  expect(result.error?.operatorRemediation).toBeTruthy();
});

it("fail() with category allows custom overrides", () => {
  const result = fail("governance", "DENIED_BY_POLICY", "Blocked", {
    operatorRemediation: "Custom operator note",
  });
  expect(result.error?.code).toBe("DENIED_BY_POLICY");
  expect(result.error?.operatorRemediation).toBe("Custom operator note");
});

it("fail() without category still works (backward compat)", () => {
  const result = fail("SOME_CODE", "Some message");
  expect(result.error?.code).toBe("SOME_CODE");
  expect(result.error?.message).toBe("Some message");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run -t "fail\\(\\) with category"`

Expected: FAIL — overload does not exist yet.

- [ ] **Step 3: Implement the overload in `tool-result.ts`**

Replace the existing `fail` function with an overloaded version:

```typescript
import { ERROR_CATEGORIES, DEFAULT_REMEDIATIONS } from "./error-taxonomy.js";
import type { ErrorCategory } from "./error-taxonomy.js";

export function fail(
  code: string,
  message: string,
  opts?: {
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable?: boolean;
    data?: Record<string, unknown>;
  },
): ToolResult;
export function fail(
  category: ErrorCategory,
  code: string,
  message: string,
  opts?: {
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable?: boolean;
    data?: Record<string, unknown>;
  },
): ToolResult;
export function fail(
  codeOrCategory: string,
  messageOrCode: string,
  optsOrMessage?:
    | string
    | {
        modelRemediation?: string;
        operatorRemediation?: string;
        retryable?: boolean;
        data?: Record<string, unknown>;
      },
  maybeOpts?: {
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable?: boolean;
    data?: Record<string, unknown>;
  },
): ToolResult {
  const isCategory = (ERROR_CATEGORIES as readonly string[]).includes(codeOrCategory);

  if (isCategory && typeof optsOrMessage === "string") {
    const code = messageOrCode;
    const message = optsOrMessage;
    const opts = maybeOpts;
    const defaults = DEFAULT_REMEDIATIONS[code];
    return {
      status: "error",
      data: opts?.data,
      error: {
        code,
        message,
        modelRemediation: opts?.modelRemediation ?? defaults?.modelRemediation,
        operatorRemediation: opts?.operatorRemediation ?? defaults?.operatorRemediation,
        retryable: opts?.retryable ?? defaults?.retryable ?? false,
      },
    };
  }

  const code = codeOrCategory;
  const message = messageOrCode;
  const opts = optsOrMessage as
    | {
        modelRemediation?: string;
        operatorRemediation?: string;
        retryable?: boolean;
        data?: Record<string, unknown>;
      }
    | undefined;
  return {
    status: "error",
    data: opts?.data,
    error: {
      code,
      message,
      modelRemediation: opts?.modelRemediation,
      operatorRemediation: opts?.operatorRemediation,
      retryable: opts?.retryable ?? false,
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run -t "ToolResult"`

Expected: All PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tool-result.ts packages/core/src/skill-runtime/__tests__/tool-result.test.ts
git commit -m "feat: extend fail() with category-aware overload using taxonomy defaults"
```

---

## Task 8: Migrate Existing `fail()` Calls to Taxonomy Codes

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Modify: `packages/core/src/skill-runtime/tools/web-scanner.ts`

- [ ] **Step 1: Migrate `skill-executor.ts` fail call**

In `skill-executor.ts` line 239, change:

```typescript
result = fail("TOOL_NOT_FOUND", `Unknown tool: ${toolUse.name}`, {
  modelRemediation: `Available tools for this skill: ${availableTools}`,
  retryable: false,
});
```

to:

```typescript
result = fail("execution", "TOOL_NOT_FOUND", `Unknown tool: ${toolUse.name}`, {
  modelRemediation: `Available tools for this skill: ${availableTools}`,
});
```

- [ ] **Step 2: Migrate `web-scanner.ts` fail calls**

In `web-scanner.ts` line 29, change:

```typescript
return fail("INVALID_INPUT", "URL is empty", {
  modelRemediation: "Provide a non-empty URL string",
  retryable: false,
});
```

to:

```typescript
return fail("execution", "INVALID_INPUT", "URL is empty", {
  modelRemediation: "Provide a non-empty URL string",
});
```

In `web-scanner.ts` line 40, change:

```typescript
return fail("VALIDATION_FAILED", (err as Error).message, {
  modelRemediation: "Check the URL format or try a different URL",
  retryable: false,
});
```

to:

```typescript
return fail("execution", "INVALID_INPUT", (err as Error).message, {
  modelRemediation: "Check the URL format or try a different URL",
});
```

Note: `VALIDATION_FAILED` is not in the taxonomy. The closest match is `INVALID_INPUT` — URL validation failure is an input validation issue.

- [ ] **Step 3: Add taxonomy exports to `index.ts`**

```typescript
export {
  structuredError,
  isValidTaxonomyCode,
  getCategoryForCode,
  TAXONOMY_CODES,
  ERROR_CATEGORIES,
  DEFAULT_REMEDIATIONS,
} from "./error-taxonomy.js";
export type { ErrorCategory, StructuredError } from "./error-taxonomy.js";
```

- [ ] **Step 4: Run full test suite and typecheck**

Run: `pnpm --filter @switchboard/core test -- --run`

Expected: All tests PASS.

Run: `pnpm typecheck`

Expected: 18/18 packages pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/tools/web-scanner.ts packages/core/src/skill-runtime/index.ts
git commit -m "refactor: migrate existing fail() calls to error taxonomy codes"
```

---

## Task 9: Validation Test + Final Verification

**Files:**

- Modify: `packages/core/src/skill-runtime/__tests__/error-taxonomy.test.ts`

- [ ] **Step 1: Add validation test for taxonomy code coverage**

Append to `error-taxonomy.test.ts`:

```typescript
describe("taxonomy code validation", () => {
  it("denied() uses a valid taxonomy code", () => {
    const result = denied("test");
    expect(isValidTaxonomyCode(result.error!.code)).toBe(true);
  });

  it("pendingApproval() uses a valid taxonomy code", () => {
    const result = pendingApproval("test");
    expect(isValidTaxonomyCode(result.error!.code)).toBe(true);
  });
});
```

Add imports at the top:

```typescript
import { denied, pendingApproval } from "../tool-result.js";
```

- [ ] **Step 2: Run the full core test suite**

Run: `pnpm --filter @switchboard/core test -- --run`

Expected: All tests PASS.

- [ ] **Step 3: Run full monorepo typecheck**

Run: `pnpm typecheck`

Expected: 18/18 packages pass.

- [ ] **Step 4: Run linter**

Run: `pnpm lint`

Expected: No new lint errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/__tests__/error-taxonomy.test.ts
git commit -m "test: add taxonomy code validation for ToolResult helpers"
```

---

## Definition of Done

From the spec:

- [ ] Reinjection filter exists between tool execution and conversation append in `SkillExecutorImpl`
- [ ] `ContextResolver` sorts knowledge entries by priority desc, truncates at char cap
- [ ] Error taxonomy covers all existing error codes with model and operator remediation
- [ ] Error taxonomy is added as doctrine appendix (success taxonomy deferred)

The doctrine update (last item) should be done after all code is merged — it is a documentation task, not a code task.
