# Harness Phase 1: Correctness Foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three correctness gaps identified in the Harness Architecture Spec: idempotency enforcement at ingress, structured ToolResult envelope for all tool operations, and EffectCategory enum replacing GovernanceTier.

**Architecture:** Idempotency is enforced at `PlatformIngress.submit()` by checking `WorkTraceStore` for existing traces with the same key before creating a work unit. ToolResult is a new structured envelope that replaces raw `unknown` returns across all 5 tool factories (11 operations). EffectCategory is a 7-value closed enum that replaces the 4-value `GovernanceTier`, updating the governance policy matrix and all consumers.

**Tech Stack:** TypeScript, Vitest, Prisma, Zod, pnpm + Turborepo

**Spec:** `docs/superpowers/specs/2026-04-19-harness-architecture-design.md` — Sections 2, 4, 6, 9, Appendix B, Appendix C.

---

## File Map

### Task 1: EffectCategory enum (replace GovernanceTier)

| Action | File                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modify | `packages/core/src/skill-runtime/governance.ts` — replace `GovernanceTier` type + `GOVERNANCE_POLICY` matrix                                                    |
| Modify | `packages/core/src/skill-runtime/types.ts` — update `SkillToolOperation.governanceTier` → `effectCategory`, `ToolCallContext.governanceTier` → `effectCategory` |
| Modify | `packages/core/src/skill-runtime/hooks/governance-hook.ts` — update field references                                                                            |
| Modify | `packages/core/src/skill-runtime/skill-executor.ts` — update write-count check and fallback tier                                                                |
| Modify | `packages/core/src/skill-runtime/tool-registry.ts` — update validation                                                                                          |
| Modify | `packages/core/src/skill-runtime/tools/crm-query.ts` — update field name                                                                                        |
| Modify | `packages/core/src/skill-runtime/tools/crm-write.ts` — update field name + values                                                                               |
| Modify | `packages/core/src/skill-runtime/tools/web-scanner.ts` — update field name                                                                                      |
| Modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` — update field name + values                                                                           |
| Modify | `packages/core/src/skill-runtime/tools/pipeline-handoff.ts` — update field name                                                                                 |
| Test   | All existing tool tests + governance tests (should still pass after rename)                                                                                     |

### Task 2: ToolResult envelope

| Action | File                                                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Create | `packages/core/src/skill-runtime/tool-result.ts` — `ToolResult` type + `ToolResultOutcome` type + helper constructors             |
| Modify | `packages/core/src/skill-runtime/types.ts` — update `SkillToolOperation.execute` return type, `ToolCallRecord.result` type        |
| Modify | `packages/core/src/skill-runtime/skill-executor.ts` — update governance-blocked result, unknown-tool result, result serialization |
| Modify | `packages/core/src/skill-runtime/tools/crm-query.ts` — wrap returns in `ToolResult`                                               |
| Modify | `packages/core/src/skill-runtime/tools/crm-write.ts` — wrap returns in `ToolResult`                                               |
| Modify | `packages/core/src/skill-runtime/tools/web-scanner.ts` — wrap returns in `ToolResult`                                             |
| Modify | `packages/core/src/skill-runtime/tools/calendar-book.ts` — wrap returns in `ToolResult`                                           |
| Modify | `packages/core/src/skill-runtime/tools/pipeline-handoff.ts` — wrap returns in `ToolResult`                                        |
| Test   | All existing tool tests (update assertions for new shape)                                                                         |

### Task 3: Idempotency enforcement at ingress

| Action | File                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Create | `packages/db/prisma/migrations/20260419000000_add_work_trace_idempotency_key/migration.sql`                                                |
| Modify | `packages/db/prisma/schema.prisma` — add `idempotencyKey` column to `WorkTrace`                                                            |
| Modify | `packages/core/src/platform/work-trace.ts` — add `idempotencyKey` to `WorkTrace` interface                                                 |
| Modify | `packages/core/src/platform/work-trace-recorder.ts` — add `getByIdempotencyKey()` to `WorkTraceStore`, pass key through `buildWorkTrace()` |
| Modify | `packages/db/src/stores/prisma-work-trace-store.ts` — implement `getByIdempotencyKey()`, persist key                                       |
| Modify | `packages/core/src/platform/platform-ingress.ts` — add dedup check before step 1                                                           |
| Test   | `packages/core/src/platform/__tests__/platform-ingress.test.ts` — add idempotency tests                                                    |

---

## Task 1: EffectCategory Enum

### Task 1.1: Define EffectCategory type and update governance policy matrix

**Files:**

- Modify: `packages/core/src/skill-runtime/governance.ts`

- [ ] **Step 1: Write the failing test**

Create a new test file for the updated governance types.

```typescript
// packages/core/src/skill-runtime/__tests__/effect-category.test.ts
import { describe, it, expect } from "vitest";
import {
  type EffectCategory,
  GOVERNANCE_POLICY,
  getToolGovernanceDecision,
} from "../governance.js";
import type { SkillToolOperation } from "../types.js";

describe("EffectCategory governance", () => {
  it("defines all 7 effect categories in GOVERNANCE_POLICY", () => {
    const categories: EffectCategory[] = [
      "read",
      "propose",
      "simulate",
      "write",
      "external_send",
      "external_mutation",
      "irreversible",
    ];
    for (const cat of categories) {
      expect(GOVERNANCE_POLICY[cat]).toBeDefined();
    }
  });

  it("read auto-approves at all trust levels", () => {
    expect(GOVERNANCE_POLICY.read.supervised).toBe("auto-approve");
    expect(GOVERNANCE_POLICY.read.guided).toBe("auto-approve");
    expect(GOVERNANCE_POLICY.read.autonomous).toBe("auto-approve");
  });

  it("propose auto-approves at all trust levels", () => {
    expect(GOVERNANCE_POLICY.propose.supervised).toBe("auto-approve");
    expect(GOVERNANCE_POLICY.propose.guided).toBe("auto-approve");
    expect(GOVERNANCE_POLICY.propose.autonomous).toBe("auto-approve");
  });

  it("simulate auto-approves at all trust levels", () => {
    expect(GOVERNANCE_POLICY.simulate.supervised).toBe("auto-approve");
    expect(GOVERNANCE_POLICY.simulate.guided).toBe("auto-approve");
    expect(GOVERNANCE_POLICY.simulate.autonomous).toBe("auto-approve");
  });

  it("write requires approval under supervised", () => {
    expect(GOVERNANCE_POLICY.write.supervised).toBe("require-approval");
    expect(GOVERNANCE_POLICY.write.guided).toBe("auto-approve");
    expect(GOVERNANCE_POLICY.write.autonomous).toBe("auto-approve");
  });

  it("external_send requires approval under supervised and guided", () => {
    expect(GOVERNANCE_POLICY.external_send.supervised).toBe("require-approval");
    expect(GOVERNANCE_POLICY.external_send.guided).toBe("require-approval");
    expect(GOVERNANCE_POLICY.external_send.autonomous).toBe("auto-approve");
  });

  it("external_mutation requires approval under supervised and guided", () => {
    expect(GOVERNANCE_POLICY.external_mutation.supervised).toBe("require-approval");
    expect(GOVERNANCE_POLICY.external_mutation.guided).toBe("require-approval");
    expect(GOVERNANCE_POLICY.external_mutation.autonomous).toBe("auto-approve");
  });

  it("irreversible denies under supervised, requires approval otherwise", () => {
    expect(GOVERNANCE_POLICY.irreversible.supervised).toBe("deny");
    expect(GOVERNANCE_POLICY.irreversible.guided).toBe("require-approval");
    expect(GOVERNANCE_POLICY.irreversible.autonomous).toBe("require-approval");
  });

  it("getToolGovernanceDecision uses effectCategory", () => {
    const op = {
      effectCategory: "write",
      governanceOverride: undefined,
    } as unknown as SkillToolOperation;
    expect(getToolGovernanceDecision(op, "supervised")).toBe("require-approval");
    expect(getToolGovernanceDecision(op, "guided")).toBe("auto-approve");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run effect-category`
Expected: FAIL — `EffectCategory` not exported, `GOVERNANCE_POLICY` doesn't have the new keys.

- [ ] **Step 3: Update governance.ts with EffectCategory**

Replace the contents of `packages/core/src/skill-runtime/governance.ts`:

```typescript
import type { SkillToolOperation } from "./types.js";

export type EffectCategory =
  | "read"
  | "propose"
  | "simulate"
  | "write"
  | "external_send"
  | "external_mutation"
  | "irreversible";

/** @deprecated Use EffectCategory instead. Alias kept for migration. */
export type GovernanceTier = EffectCategory;

export type TrustLevel = "supervised" | "guided" | "autonomous";
export type GovernanceDecision = "auto-approve" | "require-approval" | "deny";
export type GovernanceOutcome = "auto-approved" | "require-approval" | "denied";

export const GOVERNANCE_POLICY: Record<EffectCategory, Record<TrustLevel, GovernanceDecision>> = {
  read: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  propose: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  simulate: {
    supervised: "auto-approve",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  write: {
    supervised: "require-approval",
    guided: "auto-approve",
    autonomous: "auto-approve",
  },
  external_send: {
    supervised: "require-approval",
    guided: "require-approval",
    autonomous: "auto-approve",
  },
  external_mutation: {
    supervised: "require-approval",
    guided: "require-approval",
    autonomous: "auto-approve",
  },
  irreversible: {
    supervised: "deny",
    guided: "require-approval",
    autonomous: "require-approval",
  },
};

export function getToolGovernanceDecision(
  op: SkillToolOperation,
  trustLevel: TrustLevel,
): GovernanceDecision {
  if (op.governanceOverride?.[trustLevel]) {
    return op.governanceOverride[trustLevel]!;
  }
  return GOVERNANCE_POLICY[op.effectCategory][trustLevel];
}

export function mapDecisionToOutcome(decision: GovernanceDecision): GovernanceOutcome {
  switch (decision) {
    case "auto-approve":
      return "auto-approved";
    case "require-approval":
      return "require-approval";
    case "deny":
      return "denied";
  }
}

export interface GovernanceLogEntry {
  operationId: string;
  tier: EffectCategory;
  trustLevel: TrustLevel;
  decision: GovernanceDecision;
  overridden: boolean;
  timestamp: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --run effect-category`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/governance.ts packages/core/src/skill-runtime/__tests__/effect-category.test.ts && git commit -m "$(cat <<'EOF'
feat: introduce EffectCategory enum, replace GovernanceTier in governance policy

Adds 7-value closed EffectCategory enum (read, propose, simulate, write,
external_send, external_mutation, irreversible) replacing the 4-value
GovernanceTier. GovernanceTier kept as deprecated alias for migration.
EOF
)"
```

### Task 1.2: Update SkillToolOperation and ToolCallContext to use effectCategory

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts:140-191`

- [ ] **Step 1: Update types.ts**

In `packages/core/src/skill-runtime/types.ts`, change the imports and field names:

Replace:

```typescript
import type {
  GovernanceTier,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
  GovernanceLogEntry,
} from "./governance.js";
```

With:

```typescript
import type {
  EffectCategory,
  GovernanceTier,
  GovernanceOutcome,
  TrustLevel,
  GovernanceDecision,
  GovernanceLogEntry,
} from "./governance.js";
```

In `SkillToolOperation` (line 143), replace:

```typescript
governanceTier: GovernanceTier;
```

With:

```typescript
effectCategory: EffectCategory;
```

In `ToolCallContext` (line 189), replace:

```typescript
governanceTier: GovernanceTier;
```

With:

```typescript
effectCategory: EffectCategory;
```

- [ ] **Step 2: Update governance-hook.ts**

In `packages/core/src/skill-runtime/hooks/governance-hook.ts`, update the log entry (line 22-28):

Replace:

```typescript
      this.logs.push({
        operationId: `${ctx.toolId}.${ctx.operation}`,
        tier: op.governanceTier,
        trustLevel: ctx.trustLevel,
```

With:

```typescript
      this.logs.push({
        operationId: `${ctx.toolId}.${ctx.operation}`,
        tier: op.effectCategory,
        trustLevel: ctx.trustLevel,
```

- [ ] **Step 3: Update skill-executor.ts**

In `packages/core/src/skill-runtime/skill-executor.ts`:

Line 170-175 — replace the write-count check:

```typescript
            writeCount: toolCallRecords.filter((tc) => {
              const tool = this.tools.get(tc.toolId);
              const opDef = tool?.operations[tc.operation];
              return (
                opDef?.effectCategory === "write" ||
                opDef?.effectCategory === "external_send" ||
                opDef?.effectCategory === "external_mutation" ||
                opDef?.effectCategory === "irreversible"
              );
            }).length,
```

Line 210 — replace the fallback tier:

```typescript
        effectCategory: op?.effectCategory ?? ("read" as const),
```

- [ ] **Step 4: Update tool-registry.ts**

In `packages/core/src/skill-runtime/tool-registry.ts`, line 11:

Replace:

```typescript
if (!op.governanceTier) {
  throw new Error(`Operation ${tool.id}.${opName} missing governanceTier`);
}
```

With:

```typescript
if (!op.effectCategory) {
  throw new Error(`Operation ${tool.id}.${opName} missing effectCategory`);
}
```

- [ ] **Step 5: Update all 5 tool factory files**

In each tool file, replace all `governanceTier:` with `effectCategory:` and map old values to new:

| Old value          | New value             | Used by                                                             |
| ------------------ | --------------------- | ------------------------------------------------------------------- |
| `"read"`           | `"read"`              | crm-query, web-scanner, calendar-book slots.query, pipeline-handoff |
| `"internal_write"` | `"write"`             | crm-write (both operations)                                         |
| `"external_write"` | `"external_mutation"` | calendar-book booking.create                                        |

Files to update:

- `packages/core/src/skill-runtime/tools/crm-query.ts` — `governanceTier: "read"` → `effectCategory: "read"` (2 operations)
- `packages/core/src/skill-runtime/tools/crm-write.ts` — `governanceTier: "internal_write"` → `effectCategory: "write"` (2 operations)
- `packages/core/src/skill-runtime/tools/web-scanner.ts` — remove `const TIER: GovernanceTier = "read"`, use `effectCategory: "read"` directly (4 operations). Remove the `import type { GovernanceTier }` line.
- `packages/core/src/skill-runtime/tools/calendar-book.ts` — `governanceTier: "read"` → `effectCategory: "read"` for slots.query, `governanceTier: "external_write"` → `effectCategory: "external_mutation"` for booking.create
- `packages/core/src/skill-runtime/tools/pipeline-handoff.ts` — `governanceTier: "read"` → `effectCategory: "read"` (1 operation)

- [ ] **Step 6: Run all tests**

Run: `pnpm --filter @switchboard/core test -- --run`
Expected: PASS — all existing tests should pass since the behavior mapping is preserved (read→read, internal_write→write with same policy, external_write→external_mutation with same policy).

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
refactor: rename governanceTier to effectCategory across skill-runtime

Updates SkillToolOperation, ToolCallContext, GovernanceHook, SkillExecutorImpl,
ToolRegistry, and all 5 tool factories. Maps: read→read, internal_write→write,
external_write→external_mutation. Behavior preserved — same governance decisions.
EOF
)"
```

---

## Task 2: ToolResult Envelope

### Task 2.1: Define ToolResult type and helpers

**Files:**

- Create: `packages/core/src/skill-runtime/tool-result.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/core/src/skill-runtime/__tests__/tool-result.test.ts
import { describe, it, expect } from "vitest";
import { ok, fail, denied, pendingApproval } from "../tool-result.js";
import type { ToolResult } from "../tool-result.js";

describe("ToolResult helpers", () => {
  it("ok() creates a success result", () => {
    const result = ok({ name: "Alice" }, { nextActions: ["update_stage"] });
    expect(result.status).toBe("success");
    expect(result.data).toEqual({ name: "Alice" });
    expect(result.nextActions).toEqual(["update_stage"]);
    expect(result.error).toBeUndefined();
  });

  it("ok() with no data", () => {
    const result = ok();
    expect(result.status).toBe("success");
    expect(result.data).toBeUndefined();
  });

  it("fail() creates an error result", () => {
    const result = fail("INVALID_INPUT", "Missing contactId", {
      modelRemediation: "Include contactId in the request",
      retryable: false,
    });
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toBe("Missing contactId");
    expect(result.error?.modelRemediation).toBe("Include contactId in the request");
    expect(result.error?.retryable).toBe(false);
  });

  it("denied() creates a denied result", () => {
    const result = denied("Not permitted at supervised trust level");
    expect(result.status).toBe("denied");
    expect(result.error?.code).toBe("DENIED_BY_POLICY");
    expect(result.error?.message).toBe("Not permitted at supervised trust level");
  });

  it("pendingApproval() creates a pending result", () => {
    const result = pendingApproval("Requires human approval");
    expect(result.status).toBe("pending_approval");
    expect(result.error?.code).toBe("APPROVAL_REQUIRED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run tool-result`
Expected: FAIL — module not found.

- [ ] **Step 3: Create tool-result.ts**

```typescript
// packages/core/src/skill-runtime/tool-result.ts

export interface ToolResult {
  status: "success" | "error" | "denied" | "pending_approval";
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable: boolean;
  };
  entityState?: Record<string, unknown>;
  nextActions?: string[];
}

export function ok(
  data?: Record<string, unknown>,
  opts?: { entityState?: Record<string, unknown>; nextActions?: string[] },
): ToolResult {
  return {
    status: "success",
    data,
    entityState: opts?.entityState,
    nextActions: opts?.nextActions,
  };
}

export function fail(
  code: string,
  message: string,
  opts?: {
    modelRemediation?: string;
    operatorRemediation?: string;
    retryable?: boolean;
    data?: Record<string, unknown>;
  },
): ToolResult {
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

export function denied(message: string, modelRemediation?: string): ToolResult {
  return {
    status: "denied",
    error: {
      code: "DENIED_BY_POLICY",
      message,
      modelRemediation,
      retryable: false,
    },
  };
}

export function pendingApproval(message: string): ToolResult {
  return {
    status: "pending_approval",
    error: {
      code: "APPROVAL_REQUIRED",
      message,
      retryable: false,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core test -- --run tool-result`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tool-result.ts packages/core/src/skill-runtime/__tests__/tool-result.test.ts && git commit -m "$(cat <<'EOF'
feat: add ToolResult envelope type with ok/fail/denied/pendingApproval helpers
EOF
)"
```

### Task 2.2: Update SkillToolOperation and SkillExecutorImpl to use ToolResult

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts`
- Modify: `packages/core/src/skill-runtime/skill-executor.ts`

- [ ] **Step 1: Update SkillToolOperation.execute return type**

In `packages/core/src/skill-runtime/types.ts`, add the import:

```typescript
import type { ToolResult } from "./tool-result.js";
```

Change `SkillToolOperation.execute` (line 146):

```typescript
  execute(params: unknown): Promise<ToolResult>;
```

Change `ToolCallRecord.result` (line 88):

```typescript
result: ToolResult;
```

- [ ] **Step 2: Update SkillExecutorImpl governance-blocked and unknown-tool results**

In `packages/core/src/skill-runtime/skill-executor.ts`, add import:

```typescript
import { denied, pendingApproval, fail } from "./tool-result.js";
import type { ToolResult } from "./tool-result.js";
```

Replace lines 218-228 (the governance block + unknown tool handling):

```typescript
let result: ToolResult;
let governanceOutcome: string;

if (!toolHookResult.proceed) {
  const status = toolHookResult.decision === "pending_approval" ? "pending_approval" : "denied";
  result =
    status === "pending_approval"
      ? pendingApproval(toolHookResult.reason ?? "Requires approval")
      : denied(toolHookResult.reason ?? "Denied by policy");
  governanceOutcome = status === "pending_approval" ? "require-approval" : "denied";
} else if (op) {
  result = await op.execute(toolUse.input);
  governanceOutcome = "auto-approved";
} else {
  const availableTools = params.skill.tools
    .flatMap((tid) => {
      const t = this.tools.get(tid);
      return t ? Object.keys(t.operations).map((opN) => `${tid}.${opN}`) : [];
    })
    .join(", ");
  result = fail("TOOL_NOT_FOUND", `Unknown tool: ${toolUse.name}`, {
    modelRemediation: `Available tools: ${availableTools}`,
    retryable: false,
  });
  governanceOutcome = "auto-approved";
}
```

- [ ] **Step 3: Run all skill-runtime tests**

Run: `pnpm --filter @switchboard/core test -- --run`
Expected: Some tool tests may fail because they assert raw results (e.g., `expect(result).toEqual({ id: "c1", name: "Alice", phone: "+1234" })`). That's expected — we fix those in the next task.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts packages/core/src/skill-runtime/skill-executor.ts && git commit -m "$(cat <<'EOF'
feat: update SkillToolOperation.execute to return ToolResult envelope

SkillExecutorImpl now returns structured ToolResult for governance-blocked
and unknown-tool cases with remediation guidance. Tool implementations
will be updated in the next commit.
EOF
)"
```

### Task 2.3: Update all tool implementations to return ToolResult

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/crm-query.ts`
- Modify: `packages/core/src/skill-runtime/tools/crm-write.ts`
- Modify: `packages/core/src/skill-runtime/tools/web-scanner.ts`
- Modify: `packages/core/src/skill-runtime/tools/calendar-book.ts`
- Modify: `packages/core/src/skill-runtime/tools/pipeline-handoff.ts`
- Modify: All 5 corresponding test files

- [ ] **Step 1: Update crm-query.ts**

Add import at top:

```typescript
import { ok } from "../tool-result.js";
```

Wrap `contact.get` execute:

```typescript
        execute: async (params: unknown) => {
          const { contactId, orgId } = params as { contactId: string; orgId: string };
          const contact = await contactStore.findById(orgId, contactId);
          return ok(contact as Record<string, unknown>);
        },
```

Wrap `activity.list` execute:

```typescript
        execute: async (params: unknown) => {
          const { orgId, deploymentId, limit } = params as {
            orgId: string;
            deploymentId: string;
            limit?: number;
          };
          const activities = await activityStore.listByDeployment(orgId, deploymentId, {
            limit: limit ?? 20,
          });
          return ok({ activities } as Record<string, unknown>);
        },
```

- [ ] **Step 2: Update crm-query.test.ts assertions**

```typescript
it("contact.get delegates to contactStore.findById", async () => {
  const result = await tool.operations["contact.get"]!.execute({
    contactId: "c1",
    orgId: "org1",
  });
  expect(mockContactStore.findById).toHaveBeenCalledWith("org1", "c1");
  expect(result.status).toBe("success");
  expect(result.data).toEqual({ id: "c1", name: "Alice", phone: "+1234" });
});

it("activity.list delegates to activityStore.listByDeployment", async () => {
  const result = await tool.operations["activity.list"]!.execute({
    orgId: "org1",
    deploymentId: "d1",
    limit: 10,
  });
  expect(mockActivityStore.listByDeployment).toHaveBeenCalledWith("org1", "d1", { limit: 10 });
  expect(result.status).toBe("success");
  expect(result.data?.activities).toHaveLength(1);
});
```

- [ ] **Step 3: Update crm-write.ts**

Add import: `import { ok } from "../tool-result.js";`

Wrap `stage.update` execute:

```typescript
        execute: async (params: unknown) => {
          const { orgId, opportunityId, stage } = params as {
            orgId: string;
            opportunityId: string;
            stage: string;
          };
          const result = await opportunityStore.updateStage(orgId, opportunityId, stage);
          return ok(result as Record<string, unknown>, {
            entityState: { opportunityId, stage },
          });
        },
```

Wrap `activity.log` execute:

```typescript
        execute: async (params: unknown) => {
          const input = params as {
            organizationId: string;
            deploymentId: string;
            eventType: string;
            description: string;
          };
          await activityStore.write(input);
          return ok(undefined, {
            entityState: { eventType: input.eventType },
          });
        },
```

- [ ] **Step 4: Update crm-write.test.ts assertions**

Update assertions to check `result.status === "success"` and `result.data` / `result.entityState` instead of raw values.

- [ ] **Step 5: Update web-scanner.ts**

Add import: `import { ok, fail } from "../tool-result.js";`

Wrap each of the 4 operations. Example for `validate-url`:

```typescript
        execute: async (params: unknown) => {
          const { url } = params as { url: string };
          if (!url || typeof url !== "string") {
            return fail("INVALID_INPUT", "URL is empty", {
              modelRemediation: "Provide a non-empty URL string",
              retryable: false,
            });
          }
          try {
            const validatedUrl = validateScanUrl(url);
            const hostname = new URL(validatedUrl).hostname;
            await assertPublicHostname(hostname);
            return ok({ valid: true, validatedUrl });
          } catch (err) {
            return fail("VALIDATION_FAILED", (err as Error).message, {
              modelRemediation: "Check the URL format or try a different URL",
              retryable: false,
            });
          }
        },
```

Apply similar pattern to `fetch-pages`, `detect-platform`, `extract-business-info` — wrap successful returns in `ok()`.

- [ ] **Step 6: Update web-scanner.test.ts assertions**

Update all assertions to check `result.status` and `result.data` instead of raw properties.

- [ ] **Step 7: Update calendar-book.ts**

Add import: `import { ok } from "../tool-result.js";`

Wrap `slots.query`:

```typescript
        execute: async (params: unknown) => {
          const query = params as SlotQuery;
          const slots = await deps.calendarProvider.listAvailableSlots(query);
          return ok({ slots } as Record<string, unknown>);
        },
```

Wrap `booking.create` — the existing return `{ bookingId, calendarEventId, status, startsAt, endsAt }` becomes:

```typescript
return ok(
  { bookingId, calendarEventId, status: "confirmed", startsAt, endsAt },
  { entityState: { bookingId, status: "confirmed" } },
);
```

- [ ] **Step 8: Update calendar-book.test.ts assertions**

Update assertions to check `result.status` and `result.data`.

- [ ] **Step 9: Update pipeline-handoff.ts**

Add import: `import { ok } from "../tool-result.js";`

Wrap `determine`:

```typescript
        execute: async (params: unknown) => {
          const handoffResult = determine(params as HandoffInput);
          return ok(handoffResult as Record<string, unknown>);
        },
```

- [ ] **Step 10: Update pipeline-handoff.test.ts assertions**

Update assertions to check `result.status` and `result.data` instead of raw properties.

- [ ] **Step 11: Run all tests**

Run: `pnpm --filter @switchboard/core test -- --run`
Expected: PASS

- [ ] **Step 12: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: wrap all tool implementations in ToolResult envelope

All 5 tool factories (11 operations) now return structured ToolResult
with ok/fail helpers. Governance-blocked calls return denied/pendingApproval.
Unknown tools return fail with available tool list as remediation.
EOF
)"
```

---

## Task 3: Idempotency Enforcement at Ingress

### Task 3.1: Add idempotencyKey to WorkTrace schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260419000000_add_work_trace_idempotency_key/migration.sql`

- [ ] **Step 1: Add column to Prisma schema**

In `packages/db/prisma/schema.prisma`, add to the `WorkTrace` model after `trigger`:

```prisma
  idempotencyKey        String?   @unique
```

And update the indexes section to include:

```prisma
  @@index([organizationId, intent])
  @@index([traceId])
  @@index([requestedAt])
  @@index([approvalId])
```

The `@unique` on `idempotencyKey` already creates an index, so no additional `@@index` is needed for it. Prisma handles nullable unique constraints correctly — multiple `null` values are allowed.

- [ ] **Step 2: Generate migration**

Run: `pnpm db:generate && pnpm --filter @switchboard/db exec prisma migrate dev --name add_work_trace_idempotency_key --create-only`

This creates the migration SQL. Verify it contains:

```sql
ALTER TABLE "WorkTrace" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "WorkTrace_idempotencyKey_key" ON "WorkTrace"("idempotencyKey");
```

- [ ] **Step 3: Run the migration**

Run: `pnpm db:migrate`
Expected: Migration applies successfully.

- [ ] **Step 4: Regenerate Prisma client**

Run: `pnpm db:generate`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ && git commit -m "$(cat <<'EOF'
feat: add idempotencyKey column to WorkTrace schema

Nullable unique column for dedup at PlatformIngress. Multiple null values
allowed — only keyed submissions are deduplicated.
EOF
)"
```

### Task 3.2: Add getByIdempotencyKey to WorkTraceStore

**Files:**

- Modify: `packages/core/src/platform/work-trace.ts`
- Modify: `packages/core/src/platform/work-trace-recorder.ts`
- Modify: `packages/db/src/stores/prisma-work-trace-store.ts`

- [ ] **Step 1: Add idempotencyKey to WorkTrace interface**

In `packages/core/src/platform/work-trace.ts`, add after `trigger`:

```typescript
  idempotencyKey?: string;
```

- [ ] **Step 2: Update WorkTraceStore interface**

In `packages/core/src/platform/work-trace-recorder.ts`, add to the `WorkTraceStore` interface:

```typescript
  getByIdempotencyKey(key: string): Promise<WorkTrace | null>;
```

- [ ] **Step 3: Pass idempotencyKey through buildWorkTrace**

In `packages/core/src/platform/work-trace-recorder.ts`, in the `buildWorkTrace` function, add after `trigger: workUnit.trigger,`:

```typescript
    idempotencyKey: workUnit.idempotencyKey,
```

- [ ] **Step 4: Implement in PrismaWorkTraceStore**

In `packages/db/src/stores/prisma-work-trace-store.ts`:

Add `idempotencyKey` to the `persist()` create data:

```typescript
        idempotencyKey: trace.idempotencyKey ?? null,
```

Add `idempotencyKey` to the `getByWorkUnitId()` return mapping:

```typescript
      idempotencyKey: row.idempotencyKey ?? undefined,
```

Add the new method:

```typescript
  async getByIdempotencyKey(key: string): Promise<WorkTrace | null> {
    const row = await this.prisma.workTrace.findUnique({ where: { idempotencyKey: key } });
    if (!row) return null;
    // Reuse the same mapping as getByWorkUnitId
    return this.mapRowToTrace(row);
  }
```

Extract the row-to-trace mapping from `getByWorkUnitId` into a private `mapRowToTrace` method to avoid duplication. The body is the existing return block from `getByWorkUnitId` (lines 55-103), just moved into a private method.

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/platform/work-trace.ts packages/core/src/platform/work-trace-recorder.ts packages/db/src/stores/prisma-work-trace-store.ts && git commit -m "$(cat <<'EOF'
feat: add getByIdempotencyKey to WorkTraceStore

WorkTrace interface gains idempotencyKey field. buildWorkTrace passes
the key from WorkUnit. PrismaWorkTraceStore persists and queries by it.
EOF
)"
```

### Task 3.3: Enforce idempotency in PlatformIngress.submit()

**Files:**

- Modify: `packages/core/src/platform/platform-ingress.ts`
- Test: `packages/core/src/platform/__tests__/platform-ingress.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/platform/__tests__/platform-ingress.test.ts`:

```typescript
describe("idempotency enforcement", () => {
  it("returns existing result when idempotencyKey matches a prior trace", async () => {
    const existingTrace = {
      workUnitId: "existing-wu",
      outcome: "completed",
      durationMs: 100,
      traceId: "existing-trace",
      executionOutputs: { response: "Hello" },
      intent: "campaign.pause",
      mode: "skill" as const,
      organizationId: "org-1",
      actor: { id: "user-1", type: "user" as const },
      trigger: "chat" as const,
      governanceOutcome: "execute" as const,
      riskScore: 0.2,
      matchedPolicies: [],
      requestedAt: new Date().toISOString(),
      governanceCompletedAt: new Date().toISOString(),
      idempotencyKey: "dedup-key-1",
    };

    const traceStore: WorkTraceStore = {
      persist: vi.fn(),
      getByWorkUnitId: vi.fn(),
      update: vi.fn(),
      getByIdempotencyKey: vi.fn().mockResolvedValue(existingTrace),
    };

    const config = createConfig({ traceStore });
    const ingress = new PlatformIngress(config);

    const request: SubmitWorkRequest = {
      ...baseRequest,
      idempotencyKey: "dedup-key-1",
    };

    const response = await ingress.submit(request);

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.workUnitId).toBe("existing-wu");
      expect(response.result.outcome).toBe("completed");
    }
    expect(traceStore.getByIdempotencyKey).toHaveBeenCalledWith("dedup-key-1");
  });

  it("proceeds normally when idempotencyKey is not set", async () => {
    const governanceGate: GovernanceGateInterface = {
      evaluate: vi.fn().mockResolvedValue(buildExecuteDecision()),
    };

    const executionResult: ExecutionResult = {
      workUnitId: "new-wu",
      outcome: "completed",
      summary: "Done",
      outputs: {},
      mode: "skill",
      durationMs: 50,
      traceId: "new-trace",
    };

    const mode: ExecutionMode = {
      name: "skill",
      dispatch: vi.fn().mockResolvedValue(executionResult),
    };

    const traceStore: WorkTraceStore = {
      persist: vi.fn(),
      getByWorkUnitId: vi.fn(),
      update: vi.fn(),
      getByIdempotencyKey: vi.fn(),
    };

    const config = createConfig({ governanceGate, traceStore });
    config.modeRegistry.register(mode);
    const ingress = new PlatformIngress(config);

    const response = await ingress.submit(baseRequest);
    expect(response.ok).toBe(true);
    expect(traceStore.getByIdempotencyKey).not.toHaveBeenCalled();
  });

  it("proceeds normally when idempotencyKey has no prior trace", async () => {
    const governanceGate: GovernanceGateInterface = {
      evaluate: vi.fn().mockResolvedValue(buildExecuteDecision()),
    };

    const executionResult: ExecutionResult = {
      workUnitId: "new-wu",
      outcome: "completed",
      summary: "Done",
      outputs: {},
      mode: "skill",
      durationMs: 50,
      traceId: "new-trace",
    };

    const mode: ExecutionMode = {
      name: "skill",
      dispatch: vi.fn().mockResolvedValue(executionResult),
    };

    const traceStore: WorkTraceStore = {
      persist: vi.fn(),
      getByWorkUnitId: vi.fn(),
      update: vi.fn(),
      getByIdempotencyKey: vi.fn().mockResolvedValue(null),
    };

    const config = createConfig({ governanceGate, traceStore });
    config.modeRegistry.register(mode);
    const ingress = new PlatformIngress(config);

    const request: SubmitWorkRequest = {
      ...baseRequest,
      idempotencyKey: "new-key",
    };

    const response = await ingress.submit(request);
    expect(response.ok).toBe(true);
    expect(traceStore.getByIdempotencyKey).toHaveBeenCalledWith("new-key");
  });
});
```

Note: You'll need to update `createConfig` (or equivalent test helper) to include `getByIdempotencyKey: vi.fn()` in the mock `traceStore`. Check the existing test file for the helper function pattern and add the new mock method there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- --run platform-ingress`
Expected: FAIL — `getByIdempotencyKey` not on mock, no dedup logic in `submit()`.

- [ ] **Step 3: Add dedup check to PlatformIngress.submit()**

In `packages/core/src/platform/platform-ingress.ts`, add at the very start of the `submit()` method, before step 1 (intent lookup):

```typescript
// 0. Idempotency check — return existing result if key matches prior trace
if (request.idempotencyKey && this.config.traceStore) {
  const existingTrace = await this.config.traceStore.getByIdempotencyKey(request.idempotencyKey);
  if (existingTrace) {
    const result: ExecutionResult = {
      workUnitId: existingTrace.workUnitId,
      outcome: existingTrace.outcome,
      summary: existingTrace.executionSummary ?? "Duplicate request — returning prior result",
      outputs: existingTrace.executionOutputs ?? {},
      mode: existingTrace.mode,
      durationMs: existingTrace.durationMs,
      traceId: existingTrace.traceId,
      error: existingTrace.error,
    };
    return {
      ok: true,
      result,
      workUnit: {
        id: existingTrace.workUnitId,
        requestedAt: existingTrace.requestedAt,
        organizationId: existingTrace.organizationId,
        actor: existingTrace.actor,
        intent: existingTrace.intent,
        parameters: existingTrace.parameters ?? {},
        deployment: existingTrace.deploymentContext!,
        resolvedMode: existingTrace.mode,
        traceId: existingTrace.traceId,
        trigger: existingTrace.trigger,
        priority: "normal",
        idempotencyKey: existingTrace.idempotencyKey,
      },
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- --run platform-ingress`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm --filter @switchboard/core test -- --run`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat: enforce idempotency at PlatformIngress.submit()

When idempotencyKey is present on SubmitWorkRequest, checks WorkTraceStore
for an existing trace with the same key. If found, returns the prior result
without creating a new WorkUnit. Prevents duplicate business actions.
EOF
)"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
pnpm test
```

- [ ] **Run typecheck**

```bash
pnpm typecheck
```

- [ ] **Run lint**

```bash
pnpm lint
```

All three must pass before Phase 1 is complete.
