# Agent→Agent Governed Handoff (Delegation v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Alex's LLM skill a governed `delegate` tool that submits a child WorkUnit through `PlatformIngress` (never bypassing it), demonstrated by a safe, draft-only Alex→Mira `creative.concept.draft` handoff that surfaces on `/mira` with no ad spend.

**Architecture:** A reusable `delegate` skill-tool (core, Layer 3) depends on a narrow `ChildWorkSubmitter` port; `apps/api` (Layer 5) implements that port over the existing `submitChildWork` closure (which already calls `PlatformIngress.submit({trigger:"internal", actor, parentWorkUnitId})`). Lineage + a depth guard ride on the skill request context. The one allowlisted target is a draft-only workflow that creates a `CreativeJob` row without firing the creative pipeline.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), pnpm + Turbo monorepo, Vitest (mocked Prisma — CI has no Postgres), Zod schemas, Fastify (api), Anthropic tool-calling skill runtime.

**Conventions (load-bearing):** semi + double-quotes + 2-space + trailing-commas + 100-col (prettier); no `any`/`console.log`; unused vars prefixed `_`; co-located `*.test.ts`; conventional commits with **lowercase subject first word**; Anthropic tool `inputSchema` must NOT use `min*/max*` (strict-schema 400s); lint-staged reformats staged files on commit → re-`git add` if it does.

**Verify-as-you-go:** every code step lists exact files/lines confirmed against `ef65ceec`. If a signature differs when you open the file, fix the code to match the real signature (TDD red will catch drift) and keep going.

---

## File structure (decomposition)

**Core (`packages/core`, Layer 3) — reusable primitive:**

- `src/skill-runtime/delegation-port.ts` _(new)_ — port + config types (`ChildWorkSubmitter`, `DelegationRequest`, `DelegationResult`, `DelegationTarget`). Self-contained; no `platform` import.
- `src/skill-runtime/tools/delegate.ts` _(new)_ — `createDelegateToolFactory`.
- `src/skill-runtime/tools/delegate.test.ts` _(new)_.
- `src/skill-runtime/types.ts` _(edit)_ — add `workUnitId?`/`delegationDepth?` to `SkillRequestContext` (`:368`) and `SkillExecutionParams` (`:84`).
- `src/skill-runtime/skill-executor.ts` _(edit)_ — `buildRequestContext` (`:132`) carries the two fields.
- `src/skill-runtime/skill-request-context.ts` _(new)_ — exported pure `composeSkillRequestContext(params)` (extracted for testability) + `src/skill-runtime/skill-request-context.test.ts`.
- `src/skill-runtime/index.ts` _(edit)_ — barrel-export the new factory + port types + helper.
- `src/platform/modes/skill-mode.ts` _(edit)_ — `execute` (`:73`) passes `workUnitId`/`delegationDepth`.

**apps/api (Layer 5) — wiring + demonstrated target:**

- `src/services/workflows/creative-concept-draft-workflow.ts` _(new)_ + `__tests__/creative-concept-draft-workflow.test.ts` _(new)_.
- `src/bootstrap/delegation-targets.ts` _(new)_ — the creative `DelegationTarget` config + `__tests__/delegation-targets.test.ts`.
- `src/bootstrap/contained-workflows.ts` _(edit)_ — register the new handler + intent.
- `src/bootstrap/skill-mode.ts` _(edit)_ — accept a `submitChildWork` port, build the delegate factory, register it.
- `src/app.ts` _(edit)_ — share the `submitChildWork` closure with both bootstraps.

**Skill:**

- `skills/alex/SKILL.md` _(edit)_ — add `delegate` + "when to delegate" guidance.

---

## Task 1: Context plumbing — thread `workUnitId` + `delegationDepth` to the tool context

**Files:**

- Modify: `packages/core/src/skill-runtime/types.ts:84-98` (`SkillExecutionParams`) and `:368-375` (`SkillRequestContext`)
- Create: `packages/core/src/skill-runtime/skill-request-context.ts`
- Modify: `packages/core/src/skill-runtime/skill-executor.ts:132-138` (`buildRequestContext`)
- Modify: `packages/core/src/platform/modes/skill-mode.ts:73-82` (executor.execute call)
- Test: `packages/core/src/skill-runtime/skill-request-context.test.ts`

- [ ] **Step 1: Extend the two interfaces**

In `types.ts`, add to `SkillRequestContext` (after `surface?` on line 374):

```ts
  /** The parent WorkUnit this skill executes inside. Anchors delegation lineage. */
  workUnitId?: string;
  /** Delegation depth of the parent WorkUnit (0 for top-level). Guards recursion. */
  delegationDepth?: number;
```

And add to `SkillExecutionParams` (after `sessionId?` on line 97):

```ts
  /** Parent WorkUnit id, flowed into SkillRequestContext for delegation lineage. */
  workUnitId?: string;
  /** Delegation depth of the parent WorkUnit (default 0). */
  delegationDepth?: number;
```

- [ ] **Step 2: Write the failing test for the pure context composer**

Create `skill-request-context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { composeSkillRequestContext } from "./skill-request-context.js";
import type { SkillExecutionParams } from "./types.js";

const baseParams = (over: Partial<SkillExecutionParams> = {}): SkillExecutionParams => ({
  skill: { slug: "alex", tools: [] } as unknown as SkillExecutionParams["skill"],
  parameters: {},
  messages: [],
  deploymentId: "dep-1",
  orgId: "org-1",
  trustScore: 0,
  trustLevel: "guided",
  sessionId: "sess-1",
  ...over,
});

describe("composeSkillRequestContext", () => {
  it("carries workUnitId and delegationDepth into the context", () => {
    const ctx = composeSkillRequestContext(baseParams({ workUnitId: "wu-7", delegationDepth: 1 }));
    expect(ctx.workUnitId).toBe("wu-7");
    expect(ctx.delegationDepth).toBe(1);
    expect(ctx.orgId).toBe("org-1");
    expect(ctx.sessionId).toBe("sess-1");
  });

  it("defaults delegationDepth/workUnitId to undefined when absent", () => {
    const ctx = composeSkillRequestContext(baseParams());
    expect(ctx.workUnitId).toBeUndefined();
    expect(ctx.delegationDepth).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it; expect FAIL (module not found)**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/skill-request-context.test.ts`
Expected: FAIL — `Failed to resolve import "./skill-request-context.js"`.

- [ ] **Step 4: Implement the composer + use it in the executor**

Create `skill-request-context.ts`:

```ts
import type { SkillExecutionParams, SkillRequestContext } from "./types.js";

/**
 * Pure builder for the per-request tool context. Extracted from
 * SkillExecutorImpl.buildRequestContext so the delegation-lineage fields
 * (workUnitId, delegationDepth) are unit-testable without driving a full
 * executor run. Trust-bound ids come ONLY from params, never from LLM input.
 */
export function composeSkillRequestContext(params: SkillExecutionParams): SkillRequestContext {
  return {
    sessionId: params.sessionId ?? `${params.deploymentId}-${Date.now()}`,
    orgId: params.orgId,
    deploymentId: params.deploymentId,
    workUnitId: params.workUnitId,
    delegationDepth: params.delegationDepth,
  };
}
```

In `skill-executor.ts`, replace the body of `buildRequestContext` (`:132-138`) with a delegation:

```ts
  private buildRequestContext(params: SkillExecutionParams): SkillRequestContext {
    return composeSkillRequestContext(params);
  }
```

Add the import at the top of `skill-executor.ts` (next to the other `./` imports):

```ts
import { composeSkillRequestContext } from "./skill-request-context.js";
```

- [ ] **Step 5: Run the test; expect PASS**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/skill-request-context.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire SkillMode to populate the fields**

In `skill-mode.ts`, in the `this.config.executor.execute({...})` object (`:73-82`), add two properties after `sessionId: workUnit.traceId ?? workUnit.id,`:

```ts
        workUnitId: workUnit.id,
        delegationDepth:
          typeof workUnit.parameters.__delegationDepth === "number"
            ? workUnit.parameters.__delegationDepth
            : 0,
```

- [ ] **Step 7: Typecheck core + run the full skill-runtime suite (no regressions)**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime`
Expected: PASS (existing tests still green; new file green).
Run: `pnpm --filter @switchboard/core typecheck` (or `pnpm typecheck` scoped) — expect no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill-runtime/types.ts \
        packages/core/src/skill-runtime/skill-request-context.ts \
        packages/core/src/skill-runtime/skill-request-context.test.ts \
        packages/core/src/skill-runtime/skill-executor.ts \
        packages/core/src/platform/modes/skill-mode.ts
git commit -m "feat(core): thread workUnitId and delegationDepth into skill request context"
```

(Commit body trailer for every commit in this plan: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.)

---

## Task 2: Delegation port + `delegate` tool (core)

**Files:**

- Create: `packages/core/src/skill-runtime/delegation-port.ts`
- Create: `packages/core/src/skill-runtime/tools/delegate.ts`
- Test: `packages/core/src/skill-runtime/tools/delegate.test.ts`
- Modify: `packages/core/src/skill-runtime/index.ts:36` (barrel)

- [ ] **Step 1: Define the port + config types**

Create `delegation-port.ts`:

```ts
/**
 * Narrow port the delegate tool depends on. Implemented in apps/api over the
 * existing submitChildWork closure (which calls PlatformIngress.submit). Kept
 * self-contained — NO import from ../platform — so skill-runtime stays free of a
 * type cycle with the platform layer.
 */
export interface DelegationRequest {
  organizationId: string;
  actor: { id: string; type: "agent" };
  intent: string;
  parameters: Record<string, unknown>;
  parentWorkUnitId: string;
  idempotencyKey: string;
}

export interface DelegationResult {
  ok: boolean;
  /** Child execution outcome, e.g. "completed" | "pending_approval" | "failed". */
  outcome?: string;
  childWorkUnitId?: string;
  error?: string;
}

export interface ChildWorkSubmitter {
  submitChildWork(req: DelegationRequest): Promise<DelegationResult>;
}

/**
 * One delegatable target. The delegate tool exposes ONE operation per target —
 * so the set of reachable intents is fixed by construction (the allowlist).
 */
export interface DelegationTarget {
  /** Tool operation name; the LLM calls `delegate.<operation>`. No dots. */
  operation: string;
  /** Platform intent submitted for this target. */
  intent: string;
  /** Shown to the LLM as the operation description. */
  description: string;
  /** JSON schema for the brief the LLM supplies. MUST NOT use min*/max* keys. */
  inputSchema: Record<string, unknown>;
  /** Map the validated brief into the child WorkUnit parameters. */
  mapInput(input: unknown): Record<string, unknown>;
}
```

- [ ] **Step 2: Write the failing test**

Create `tools/delegate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createDelegateToolFactory } from "./delegate.js";
import type { ChildWorkSubmitter, DelegationTarget } from "../delegation-port.js";
import type { SkillRequestContext } from "../types.js";

const target: DelegationTarget = {
  operation: "creative_concept",
  intent: "creative.concept.draft",
  description: "draft a creative concept",
  inputSchema: { type: "object", properties: {}, required: [] },
  mapInput: (input) => ({ brief: input }),
};

const ctx = (over: Partial<SkillRequestContext> = {}): SkillRequestContext => ({
  sessionId: "s1",
  orgId: "org-1",
  deploymentId: "dep-alex",
  workUnitId: "wu-parent",
  delegationDepth: 0,
  ...over,
});

const okSubmitter = (): ChildWorkSubmitter => ({
  submitChildWork: vi
    .fn()
    .mockResolvedValue({ ok: true, outcome: "completed", childWorkUnitId: "wu-child" }),
});

describe("delegate tool", () => {
  it("submits a governed child with agent actor, parent lineage, deterministic key, incremented depth", async () => {
    const submitter = okSubmitter();
    const tool = createDelegateToolFactory({
      submitter,
      targets: [target],
      maxDepth: 1,
      hashParameters: () => "HASH",
    })(ctx());
    const res = await tool.operations["creative_concept"]!.execute({ productDescription: "botox" });

    expect(res.status).toBe("success");
    expect(res.data).toMatchObject({ childWorkUnitId: "wu-child", outcome: "completed" });
    expect(submitter.submitChildWork).toHaveBeenCalledWith({
      organizationId: "org-1",
      actor: { id: "dep-alex", type: "agent" },
      intent: "creative.concept.draft",
      parameters: { brief: { productDescription: "botox" }, __delegationDepth: 1 },
      parentWorkUnitId: "wu-parent",
      idempotencyKey: "delegate:wu-parent:creative.concept.draft:HASH",
    });
  });

  it("exposes only configured operations (allowlist by construction)", () => {
    const tool = createDelegateToolFactory({ submitter: okSubmitter(), targets: [target] })(ctx());
    expect(Object.keys(tool.operations)).toEqual(["creative_concept"]);
  });

  it("refuses when delegationDepth >= maxDepth and never calls the submitter", async () => {
    const submitter = okSubmitter();
    const tool = createDelegateToolFactory({ submitter, targets: [target], maxDepth: 1 })(
      ctx({ delegationDepth: 1 }),
    );
    const res = await tool.operations["creative_concept"]!.execute({});
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("DELEGATION_DEPTH_EXCEEDED");
    expect(submitter.submitChildWork).not.toHaveBeenCalled();
  });

  it("refuses when there is no parent workUnitId to anchor lineage", async () => {
    const submitter = okSubmitter();
    const tool = createDelegateToolFactory({ submitter, targets: [target] })(
      ctx({ workUnitId: undefined }),
    );
    const res = await tool.operations["creative_concept"]!.execute({});
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("NO_PARENT_WORK_UNIT");
    expect(submitter.submitChildWork).not.toHaveBeenCalled();
  });

  it("surfaces pending_approval without claiming success", async () => {
    const submitter: ChildWorkSubmitter = {
      submitChildWork: vi.fn().mockResolvedValue({ ok: true, outcome: "pending_approval" }),
    };
    const tool = createDelegateToolFactory({ submitter, targets: [target] })(ctx());
    const res = await tool.operations["creative_concept"]!.execute({});
    expect(res.status).toBe("pending_approval");
  });

  it("surfaces a failed child submit as an error", async () => {
    const submitter: ChildWorkSubmitter = {
      submitChildWork: vi.fn().mockResolvedValue({ ok: false, error: "trigger_not_allowed" }),
    };
    const tool = createDelegateToolFactory({ submitter, targets: [target] })(ctx());
    const res = await tool.operations["creative_concept"]!.execute({});
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("DELEGATION_FAILED");
  });

  it("declares effectCategory propose and is idempotent", () => {
    const tool = createDelegateToolFactory({ submitter: okSubmitter(), targets: [target] })(ctx());
    const op = tool.operations["creative_concept"]!;
    expect(op.effectCategory).toBe("propose");
    expect(op.idempotent).toBe(true);
  });
});
```

- [ ] **Step 3: Run it; expect FAIL (module not found)**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/tools/delegate.test.ts`
Expected: FAIL — cannot resolve `./delegate.js`.

- [ ] **Step 4: Implement the tool factory**

Create `tools/delegate.ts`:

```ts
import { createHash } from "node:crypto";
import type { SkillTool, SkillToolOperation } from "../types.js";
import type { SkillRequestContext } from "../types.js";
import type { ToolResult } from "../tool-result.js";
import { ok, fail, pendingApproval } from "../tool-result.js";
import type { ChildWorkSubmitter, DelegationTarget } from "../delegation-port.js";

export interface DelegateToolDeps {
  submitter: ChildWorkSubmitter;
  /** Allowlist of delegatable targets — one tool operation each. */
  targets: DelegationTarget[];
  /** Max delegation depth. Default 1 (a delegated child may not delegate again). */
  maxDepth?: number;
  /** Deterministic fingerprint of child params for the idempotency key. */
  hashParameters?: (params: Record<string, unknown>) => string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

function defaultHash(params: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(params)).digest("hex").slice(0, 16);
}

export type DelegateToolFactory = (ctx: SkillRequestContext) => SkillTool;

/**
 * Agent→agent governed delegation. Each configured target becomes one operation
 * (`delegate.<operation>`); the LLM cannot reach any other intent. Every call
 * routes through the injected ChildWorkSubmitter (PlatformIngress front door in
 * prod), so governance/idempotency/WorkTrace all run on the child. The tool
 * itself only PROPOSES — the real gate is the child submit.
 */
export function createDelegateToolFactory(deps: DelegateToolDeps): DelegateToolFactory {
  const maxDepth = deps.maxDepth ?? 1;
  const hash = deps.hashParameters ?? defaultHash;

  return (ctx: SkillRequestContext): SkillTool => {
    const operations: Record<string, SkillToolOperation> = {};
    for (const target of deps.targets) {
      operations[target.operation] = {
        description: target.description,
        effectCategory: "propose",
        idempotent: true,
        inputSchema: target.inputSchema,
        execute: async (params: unknown): Promise<ToolResult> => {
          const depth = ctx.delegationDepth ?? 0;
          if (depth >= maxDepth) {
            return fail("DELEGATION_DEPTH_EXCEEDED", "Delegated work cannot delegate again.", {
              modelRemediation:
                "Do not call delegate from delegated work; handle it directly or escalate.",
            });
          }
          if (!ctx.workUnitId) {
            return fail(
              "NO_PARENT_WORK_UNIT",
              "No parent work unit is available to anchor this delegation.",
              {
                modelRemediation:
                  "Delegation is unavailable here; handle the request directly or escalate.",
              },
            );
          }
          const childParameters: Record<string, unknown> = {
            ...target.mapInput(params),
            __delegationDepth: depth + 1,
          };
          const idempotencyKey = `delegate:${ctx.workUnitId}:${target.intent}:${hash(childParameters)}`;
          const result = await deps.submitter.submitChildWork({
            organizationId: ctx.orgId,
            actor: { id: ctx.actorId ?? ctx.deploymentId, type: "agent" },
            intent: target.intent,
            parameters: childParameters,
            parentWorkUnitId: ctx.workUnitId,
            idempotencyKey,
          });
          if (!result.ok) {
            return fail(
              "DELEGATION_FAILED",
              `Delegation to ${target.intent} failed: ${result.error ?? "unknown error"}.`,
              {
                modelRemediation:
                  "Tell the customer you'll have the team follow up; do not retry blindly.",
              },
            );
          }
          if (result.outcome === "pending_approval") {
            return pendingApproval(`Delegated ${target.intent}; awaiting team approval.`);
          }
          return ok({ childWorkUnitId: result.childWorkUnitId, outcome: result.outcome });
        },
      };
    }
    return { id: "delegate", operations };
  };
}
```

- [ ] **Step 5: Run the test; expect PASS**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/tools/delegate.test.ts`
Expected: PASS (7 tests). If `fail(code, message, opts)` overload mismatches, confirm against `tool-result.ts:45-51` (legacy 3-arg form is `fail(code, message, opts)`) and adjust.

- [ ] **Step 6: Barrel-export**

In `index.ts`, add to the export list near `createEscalateToolFactory` (`:36`):

```ts
  createDelegateToolFactory,
```

and export the port types (add a new export line, matching the file's style — value/type exports):

```ts
export type {
  ChildWorkSubmitter,
  DelegationRequest,
  DelegationResult,
  DelegationTarget,
} from "./delegation-port.js";
export { composeSkillRequestContext } from "./skill-request-context.js";
```

Confirm `createDelegateToolFactory` is re-exported through whatever aggregation `createEscalateToolFactory` uses (it appears in a `export { ... } from "./tools/..."` group or a tools barrel — match that exact mechanism; if `createEscalateToolFactory` comes from `./tools/escalate.js` via a tools index, add `createDelegateToolFactory` there too).

- [ ] **Step 7: Typecheck + core suite**

Run: `pnpm --filter @switchboard/core typecheck` — expect clean.
Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime` — expect green.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill-runtime/delegation-port.ts \
        packages/core/src/skill-runtime/tools/delegate.ts \
        packages/core/src/skill-runtime/tools/delegate.test.ts \
        packages/core/src/skill-runtime/index.ts
git commit -m "feat(core): add governed delegate tool with depth guard and allowlist"
```

---

## Task 3: `creative.concept.draft` draft-only workflow handler (apps/api)

**Files:**

- Create: `apps/api/src/services/workflows/creative-concept-draft-workflow.ts`
- Test: `apps/api/src/services/workflows/__tests__/creative-concept-draft-workflow.test.ts`

Handler takes **injected store deps** (not a raw prisma client) so it's unit-testable without mocking Prisma internals — mirrors the injected-deps style of `meta-lead-intake-workflow.ts`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/creative-concept-draft-workflow.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildCreativeConceptDraftWorkflow } from "../creative-concept-draft-workflow.js";
import type { WorkUnit } from "@switchboard/core/platform";

const brief = { productDescription: "Botox for first-timers", targetAudience: "women 30-45" };

const workUnit = (over: Record<string, unknown> = {}): WorkUnit =>
  ({
    id: "wu-child",
    organizationId: "org-1",
    intent: "creative.concept.draft",
    actor: { id: "dep-alex", type: "agent" },
    trigger: "internal",
    parameters: { brief },
    deployment: {
      deploymentId: "dep-creative",
      skillSlug: "creative",
      trustLevel: "guided",
      trustScore: 0,
    },
    requestedAt: new Date(),
    ...over,
  }) as unknown as WorkUnit;

const deps = (over: Record<string, unknown> = {}) => ({
  taskStore: { create: vi.fn().mockResolvedValue({ id: "task-1" }) },
  jobStore: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
  deploymentStore: { findById: vi.fn().mockResolvedValue({ listingId: "listing-1" }) },
  enablementStore: { list: vi.fn().mockResolvedValue([{ agentKey: "mira", status: "enabled" }]) },
  ...over,
});

const services = { submitChildWork: vi.fn() };

describe("creative.concept.draft workflow", () => {
  it("creates a draft job (task + creative job) and returns completed with jobId", async () => {
    const d = deps();
    const handler = buildCreativeConceptDraftWorkflow(d);
    const res = await handler.execute(workUnit(), services);

    expect(res.outcome).toBe("completed");
    expect(res.outputs).toMatchObject({ jobId: "job-1" });
    expect(d.taskStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dep-creative",
        organizationId: "org-1",
        listingId: "listing-1",
        category: "creative_strategy",
      }),
    );
    expect(d.jobStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        productDescription: "Botox for first-timers",
        targetAudience: "women 30-45",
      }),
    );
  });

  it("does NOT trigger any pipeline send (no spend) — handler has no inngest path", async () => {
    // The guarantee is structural: the handler imports nothing from
    // @switchboard/creative-pipeline. This test documents intent by asserting
    // only the two store writes happened and nothing else is wired in.
    const d = deps();
    await buildCreativeConceptDraftWorkflow(d).execute(workUnit(), services);
    expect(d.jobStore.create).toHaveBeenCalledTimes(1);
    expect(services.submitChildWork).not.toHaveBeenCalled();
  });

  it("skips gracefully (completed + skipped flag) when Mira is not enabled", async () => {
    const d = deps({ enablementStore: { list: vi.fn().mockResolvedValue([]) } });
    const res = await buildCreativeConceptDraftWorkflow(d).execute(workUnit(), services);
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toMatchObject({ skipped: true, reason: "mira_not_enabled" });
    expect(d.taskStore.create).not.toHaveBeenCalled();
  });

  it("fails closed when no creative deployment resolves (listingId unavailable)", async () => {
    const d = deps({ deploymentStore: { findById: vi.fn().mockResolvedValue(null) } });
    const res = await buildCreativeConceptDraftWorkflow(d).execute(workUnit(), services);
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("DEPLOYMENT_NOT_FOUND");
    expect(d.taskStore.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL (module not found)**

Run: `pnpm --filter @switchboard/api exec vitest run src/services/workflows/__tests__/creative-concept-draft-workflow.test.ts`
Expected: FAIL — cannot resolve `../creative-concept-draft-workflow.js`.

- [ ] **Step 3: Implement the handler**

Create `creative-concept-draft-workflow.ts`:

```ts
import type { WorkflowHandler } from "@switchboard/core/platform";

/** Minimal store surfaces this handler needs (real Prisma stores satisfy these). */
export interface CreativeConceptDraftDeps {
  taskStore: {
    create(input: {
      deploymentId: string;
      organizationId: string;
      listingId: string;
      category: string;
      input?: Record<string, unknown>;
    }): Promise<{ id: string }>;
  };
  jobStore: {
    create(input: {
      taskId: string;
      organizationId: string;
      deploymentId: string;
      productDescription: string;
      targetAudience: string;
      platforms: string[];
      brandVoice: string | null;
      productImages: string[];
      references: string[];
      pastPerformance: Record<string, unknown> | null;
      generateReferenceImages: boolean;
    }): Promise<{ id: string }>;
  };
  deploymentStore: { findById(id: string): Promise<{ listingId: string } | null> };
  enablementStore: { list(orgId: string): Promise<Array<{ agentKey: string; status: string }>> };
}

interface ConceptBrief {
  productDescription: string;
  targetAudience: string;
  platforms?: string[];
  brandVoice?: string | null;
  productImages?: string[];
  references?: string[];
  pastPerformance?: Record<string, unknown> | null;
  generateReferenceImages?: boolean;
}

/**
 * Draft-only Alex→Mira handoff. Creates a CreativeJob row (default currentStage
 * "trends" → Mira read-model status "in_progress"/"Drafting" on /mira) WITHOUT
 * firing the creative pipeline — the entire "no spend" guarantee is that this
 * module never imports @switchboard/creative-pipeline. Gated on Mira enablement.
 */
export function buildCreativeConceptDraftWorkflow(deps: CreativeConceptDraftDeps): WorkflowHandler {
  return {
    async execute(workUnit) {
      const orgId = workUnit.organizationId;

      // Mira is opt-in per org (no global flip). Canonical check mirrors
      // apps/api/src/lib/agent-home-access.ts isAgentHomeAccessible("mira", ...).
      const enablement = await deps.enablementStore.list(orgId);
      const miraEnabled = enablement.some((r) => r.agentKey === "mira" && r.status === "enabled");
      if (!miraEnabled) {
        return {
          outcome: "completed",
          summary: "Mira not enabled for this organization — concept draft skipped",
          outputs: { skipped: true, reason: "mira_not_enabled" },
        };
      }

      // The child WorkUnit's deployment was resolved for intent
      // "creative.concept.draft" (skillSlug "creative"). DeploymentContext drops
      // listingId, so resolve it from the deployment row. A literal "api-direct"
      // fallback (no active creative deployment) returns null here → fail closed.
      const deploymentId = workUnit.deployment?.deploymentId;
      if (!deploymentId) {
        return {
          outcome: "failed",
          summary: "No deployment on work unit",
          error: {
            code: "DEPLOYMENT_NOT_FOUND",
            message: "Child work unit has no deployment context.",
          },
        };
      }
      const deployment = await deps.deploymentStore.findById(deploymentId);
      if (!deployment) {
        return {
          outcome: "failed",
          summary: "No active creative deployment resolved for this organization",
          outputs: { deploymentId },
          error: {
            code: "DEPLOYMENT_NOT_FOUND",
            message: `No AgentDeployment for id=${deploymentId}; a creative deployment (skillSlug="creative", status="active") must exist.`,
          },
        };
      }

      const brief = (workUnit.parameters as { brief?: ConceptBrief }).brief;
      if (!brief?.productDescription || !brief?.targetAudience) {
        return {
          outcome: "failed",
          summary: "Concept brief missing required fields",
          error: {
            code: "INVALID_BRIEF",
            message: "brief.productDescription and brief.targetAudience are required.",
          },
        };
      }

      const task = await deps.taskStore.create({
        deploymentId,
        organizationId: orgId,
        listingId: deployment.listingId,
        category: "creative_strategy",
        input: brief as unknown as Record<string, unknown>,
      });

      const job = await deps.jobStore.create({
        taskId: task.id,
        organizationId: orgId,
        deploymentId,
        productDescription: brief.productDescription,
        targetAudience: brief.targetAudience,
        platforms: brief.platforms ?? ["instagram"],
        brandVoice: brief.brandVoice ?? null,
        productImages: brief.productImages ?? [],
        references: brief.references ?? [],
        pastPerformance: brief.pastPerformance ?? null,
        generateReferenceImages: brief.generateReferenceImages ?? false,
      });

      // NO inngestClient.send — draft-only, no spend.
      return {
        outcome: "completed",
        summary: "Creative concept draft created for Mira review",
        outputs: { jobId: job.id },
      };
    },
  };
}
```

- [ ] **Step 4: Run the test; expect PASS**

Run: `pnpm --filter @switchboard/api exec vitest run src/services/workflows/__tests__/creative-concept-draft-workflow.test.ts`
Expected: PASS (4 tests). If `WorkflowHandler.execute` arity complains, note it is `execute(workUnit, services)` (`workflow-mode.ts:30`) — the handler ignores `services`, which is fine.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/workflows/creative-concept-draft-workflow.ts \
        apps/api/src/services/workflows/__tests__/creative-concept-draft-workflow.test.ts
git commit -m "feat(api): add draft-only creative.concept.draft workflow handler"
```

---

## Task 4: Register the `creative.concept.draft` intent

**Files:**

- Modify: `apps/api/src/bootstrap/contained-workflows.ts:43-52` (import), `:117-125` (handlers map), `:135-185` (workflowIntents)

- [ ] **Step 1: Import the builder + construct real stores**

In `contained-workflows.ts`, add to the dynamic-import block (after line 44's `buildCreativeJobSubmitWorkflow` import):

```ts
const { buildCreativeConceptDraftWorkflow } =
  await import("../services/workflows/creative-concept-draft-workflow.js");
```

And in the `@switchboard/db` import block (near `PrismaLeadIntakeStore`), add the stores the handler needs:

```ts
const {
  PrismaAgentTaskStore,
  PrismaCreativeJobStore,
  PrismaDeploymentStore,
  PrismaOrgAgentEnablementStore,
} = await import("@switchboard/db");
```

Then build the deps (after `instantFormAdapter` is constructed, before the `handlers` map):

```ts
const prisma = prismaClient as ConstructorParameters<typeof PrismaAgentTaskStore>[0];
const creativeConceptDraftWorkflow = buildCreativeConceptDraftWorkflow({
  taskStore: new PrismaAgentTaskStore(prisma),
  jobStore: new PrismaCreativeJobStore(prisma),
  deploymentStore: new PrismaDeploymentStore(prisma),
  enablementStore: new PrismaOrgAgentEnablementStore(prisma),
});
```

- [ ] **Step 2: Register the handler + intent**

Add to the `handlers` Map (`:117-125`):

```ts
    ["creative.concept.draft", creativeConceptDraftWorkflow],
```

Add to the `workflowIntents` array (`:135-185`), e.g. after the `creative.job.stop` entry:

```ts
    {
      intent: "creative.concept.draft",
      workflowId: "creative.concept.draft",
      budgetClass: "cheap",
      approvalPolicy: "none",
      allowedTriggers: ["internal"],
    },
```

(Draft-only, no spend → `cheap`/`none`. `internal` because Alex delegates internally; do NOT add `api`.)

- [ ] **Step 3: Typecheck api**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: clean. If `PrismaCreativeJobStore.create`'s real input type rejects the handler's dep interface, widen the dep interface in Task 3 to match the actual `CreateCreativeJobInput` (confirmed superset at `packages/db/src/stores/prisma-creative-job-store.ts:20-32`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/contained-workflows.ts
git commit -m "feat(api): register creative.concept.draft internal workflow intent"
```

---

## Task 5: Delegation-target config (apps/api)

**Files:**

- Create: `apps/api/src/bootstrap/delegation-targets.ts`
- Test: `apps/api/src/bootstrap/__tests__/delegation-targets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/delegation-targets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CREATIVE_CONCEPT_TARGET } from "../delegation-targets.js";

describe("CREATIVE_CONCEPT_TARGET", () => {
  it("maps a brief into child params under `brief` with safe defaults", () => {
    const mapped = CREATIVE_CONCEPT_TARGET.mapInput({
      productDescription: "Botox",
      targetAudience: "women 30-45",
    });
    expect(mapped).toEqual({
      brief: {
        productDescription: "Botox",
        targetAudience: "women 30-45",
        platforms: ["instagram"],
        productImages: [],
        references: [],
        generateReferenceImages: false,
      },
    });
  });

  it("targets the creative.concept.draft intent and uses no min/max in its schema", () => {
    expect(CREATIVE_CONCEPT_TARGET.intent).toBe("creative.concept.draft");
    const json = JSON.stringify(CREATIVE_CONCEPT_TARGET.inputSchema);
    expect(json).not.toMatch(/min|max/i);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/__tests__/delegation-targets.test.ts`
Expected: FAIL — cannot resolve `../delegation-targets.js`.

- [ ] **Step 3: Implement**

Create `delegation-targets.ts`:

```ts
import type { DelegationTarget } from "@switchboard/core/skill-runtime";

/**
 * Alex→Mira: draft a creative concept for an interested, qualified lead.
 * Draft-only (no spend); parks nothing — it just records a concept for the team.
 */
export const CREATIVE_CONCEPT_TARGET: DelegationTarget = {
  operation: "creative_concept",
  intent: "creative.concept.draft",
  description:
    "Hand a creative concept to Mira (the creative agent) as a DRAFT for the team to review. " +
    "Use ONLY for a clearly interested, qualified lead who would benefit from a tailored offer/creative. " +
    "This creates an internal draft on the team's board — it does NOT send anything to the customer and " +
    "does NOT replace escalate. Provide the treatment/offer the lead wants and who it targets.",
  inputSchema: {
    type: "object",
    properties: {
      productDescription: {
        type: "string",
        description:
          "Treatment/offer the lead is interested in, e.g. 'Botox for first-time clients'",
      },
      targetAudience: {
        type: "string",
        description: "Who the concept targets, e.g. 'women 30-45, anti-aging curious'",
      },
    },
    required: ["productDescription", "targetAudience"],
  },
  mapInput: (input: unknown) => {
    const i = input as { productDescription: string; targetAudience: string };
    return {
      brief: {
        productDescription: i.productDescription,
        targetAudience: i.targetAudience,
        platforms: ["instagram"],
        productImages: [],
        references: [],
        generateReferenceImages: false,
      },
    };
  },
};

export const DELEGATION_TARGETS: DelegationTarget[] = [CREATIVE_CONCEPT_TARGET];
```

- [ ] **Step 4: Run; expect PASS**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/__tests__/delegation-targets.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/delegation-targets.ts \
        apps/api/src/bootstrap/__tests__/delegation-targets.test.ts
git commit -m "feat(api): define alex->mira creative concept delegation target"
```

---

## Task 6: Share `submitChildWork` and wire the delegate tool into SkillMode

**Files:**

- Modify: `apps/api/src/bootstrap/contained-workflows.ts` (export the closure builder)
- Modify: `apps/api/src/app.ts` (build the closure once, pass to both bootstraps)
- Modify: `apps/api/src/bootstrap/skill-mode.ts:29-53` (deps), `:250-298` (factory + map), `:308-313` (schema map)

This task has no new unit test of its own (it is composition); Task 2/3/5 cover behavior. The green gate (Task 8) + `pnpm build` validate the wiring.

- [ ] **Step 1: Extract a reusable `createSubmitChildWork` factory**

In `contained-workflows.ts`, lift the `submitChildWork` closure (`:93-113`) into an exported function so `app.ts` can build the same closure for SkillMode:

```ts
export function createSubmitChildWork(deps: {
  platformIngress: PlatformIngress;
  deploymentResolver: DeploymentResolver | null;
}): (request: ChildWorkRequest) => Promise<SubmitWorkResponse> {
  return async (request: ChildWorkRequest): Promise<SubmitWorkResponse> => {
    const deployment = await resolveDeploymentForIntent(
      deps.deploymentResolver,
      request.organizationId,
      request.intent,
    );
    return deps.platformIngress.submit({
      organizationId: request.organizationId,
      actor: request.actor,
      intent: request.intent,
      parameters: request.parameters,
      targetHint: deployment
        ? { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug }
        : undefined,
      trigger: "internal",
      surface: { surface: "api" },
      parentWorkUnitId: request.parentWorkUnitId,
      idempotencyKey: request.idempotencyKey,
      priority: request.priority as "low" | "normal" | "high" | undefined,
    });
  };
}
```

Then inside `bootstrapContainedWorkflows`, replace the inline `const submitChildWork = async (...) => {...}` with:

```ts
const submitChildWork = createSubmitChildWork({ platformIngress, deploymentResolver });
```

(Behavior identical — existing workflow tests stay green.)

- [ ] **Step 2: Add the submitter port to SkillMode bootstrap deps**

In `skill-mode.ts`, add to `SkillModeBootstrapDeps` (`:29-53`):

```ts
  /**
   * Optional agent→agent delegation. When provided, Alex gets a `delegate` tool
   * that submits governed child work via this port (PlatformIngress front door).
   * Omitted in tests/local → no delegate tool is registered.
   */
  childWorkSubmitter?: import("@switchboard/core/skill-runtime").ChildWorkSubmitter;
```

- [ ] **Step 3: Build + register the delegate factory (conditionally)**

In `skill-mode.ts`, add `createDelegateToolFactory` to the destructured `@switchboard/core/skill-runtime` import (`:60-86`). After `escalateFactory` is built (`:250-254`), add:

```ts
const { DELEGATION_TARGETS } = await import("./delegation-targets.js");
const delegateFactory = deps.childWorkSubmitter
  ? createDelegateToolFactory({
      submitter: deps.childWorkSubmitter,
      targets: DELEGATION_TARGETS,
      maxDepth: 1,
    })
  : undefined;
```

Then make the `toolFactories` map (`:294-298`) conditional:

```ts
const toolFactories = new Map<string, SkillToolFactory>([
  ["calendar-book", calendarBookFactory],
  ["crm-write", crmWriteFactory],
  ["escalate", escalateFactory],
]);
if (delegateFactory) toolFactories.set("delegate", delegateFactory);
```

And the schema-only `toolsMap` (`:308-313`):

```ts
if (delegateFactory) toolsMap.set("delegate", delegateFactory(SCHEMA_ONLY_CTX));
```

(`SCHEMA_ONLY_CTX` has no `workUnitId`, so a real call through the schema-only tool would refuse with `NO_PARENT_WORK_UNIT` — correct; real execution always dispatches against the runtime map materialized with the live context.)

- [ ] **Step 4: Pass the submitter from app.ts**

In `app.ts`, where `bootstrapContainedWorkflows` and `bootstrapSkillMode` are called: build the shared closure once and pass it. Find the `bootstrapSkillMode({...})` call and add `childWorkSubmitter`. Because the core port (`DelegationRequest`/`DelegationResult`) differs from `ChildWorkRequest`/`SubmitWorkResponse`, adapt inline:

```ts
import { createSubmitChildWork } from "./bootstrap/contained-workflows.js";
// ...after platformIngress + deploymentResolver exist:
const submitChildWork = createSubmitChildWork({ platformIngress, deploymentResolver });
const childWorkSubmitter = {
  async submitChildWork(req) {
    const resp = await submitChildWork({
      intent: req.intent,
      organizationId: req.organizationId,
      actor: req.actor,
      parameters: req.parameters,
      parentWorkUnitId: req.parentWorkUnitId,
      idempotencyKey: req.idempotencyKey,
    });
    if (!resp.ok) {
      const err = resp.error as { code?: string; message?: string };
      return { ok: false as const, error: err.code ?? err.message ?? "submit_failed" };
    }
    const approvalRequired = "approvalRequired" in resp && resp.approvalRequired === true;
    return {
      ok: true as const,
      outcome: approvalRequired ? "pending_approval" : resp.result.outcome,
      childWorkUnitId: resp.workUnit.id,
    };
  },
};
```

Pass `childWorkSubmitter` into the `bootstrapSkillMode({ ... })` call. Also pass the same `submitChildWork` into `bootstrapContainedWorkflows` if app.ts owns it now (or leave contained-workflows building its own via the exported factory — both call the same exported builder, so behavior is identical; pick one owner to avoid two closures). Recommended: app.ts builds it once; pass `submitChildWork` into `bootstrapContainedWorkflows` deps and have that bootstrap use the passed one if present.

- [ ] **Step 5: Typecheck api + run api workflow/bootstrap suites**

Run: `pnpm --filter @switchboard/api typecheck` — expect clean.
Run: `pnpm --filter @switchboard/api exec vitest run src/services/workflows src/bootstrap` — expect green (existing `meta-lead-intake-workflow.test.ts` still passes; the `submitChildWork` refactor is behavior-preserving).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bootstrap/contained-workflows.ts apps/api/src/app.ts apps/api/src/bootstrap/skill-mode.ts
git commit -m "feat(api): wire delegate tool into skill mode via shared submitChildWork"
```

---

## Task 7: Give Alex the `delegate` tool + guidance

**Files:**

- Modify: `skills/alex/SKILL.md` (frontmatter `tools:` list ~`:48-52`, plus a guidance section)

- [ ] **Step 1: Add the tool to frontmatter**

In the `tools:` list, add a line (keep existing entries):

```yaml
- delegate
```

- [ ] **Step 2: Add a tight "When to delegate" section to the body**

Add this section to the skill body (near the escalate guidance):

```markdown
## Handing off to Mira (delegate)

You can hand a **creative concept** to Mira, the creative agent, using `delegate.creative_concept`. This creates an internal **draft** for the team to review — it does **not** send anything to the customer.

Use it **only** when ALL of these hold:

- The lead is clearly interested in a specific treatment/offer, and
- You have already handled their immediate question, and
- A tailored creative/offer concept would genuinely help convert them.

Do **not**:

- Use it as a substitute for `escalate` (use escalate for human help / out-of-scope / frustration).
- Delegate more than one concept per conversation.
- Promise the customer a specific ad or timeline — say only that you'll have the team put together some ideas.

Provide `productDescription` (the treatment/offer) and `targetAudience` (who it's for), drawn from what the lead told you.
```

- [ ] **Step 3: Verify the skill loads (tool declared == tool registered)**

`ToolRegistry.validateSkillDependencies` (`tool-registry.ts:18`) throws if `delegate` is declared but not registered. Since SkillMode only registers `delegate` when `childWorkSubmitter` is provided, confirm the live bootstrap (app.ts) passes it. For tests/local without a submitter, the skill would declare `delegate` but the factory map omits it.
Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap` — expect green. If a skill-load test fails because `delegate` is unregistered in a no-submitter test path, gate the SKILL.md tool behind the submitter by having that test provide a stub submitter, OR (preferred) confirm `validateSkillDependencies` runs against the schema-only `toolsMap` which now includes `delegate` whenever the live bootstrap runs.

- [ ] **Step 4: Commit**

```bash
git add skills/alex/SKILL.md
git commit -m "feat(alex): add delegate tool and mira handoff guidance to skill"
```

---

## Task 8: Green gate (whole-repo verification) + live-prerequisite note

**Files:** none (verification only).

- [ ] **Step 1: Reset + full build (stale lower-layer dist causes false errors)**

Run: `pnpm build`
Expected: all packages build. If `@switchboard/core` / `@switchboard/schemas` export errors appear, run `pnpm reset` then `pnpm build`.

- [ ] **Step 2: Typecheck everything**

Run: `pnpm typecheck`
Expected: clean across schemas/core/db/api.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: green. (Known-flaky, NOT caused by this work: `pg_advisory_xact_lock` db-integrity tests, `api bootstrap-smoke` npm-warn, `gateway-bridge-attribution` under full-suite load — re-run in isolation if they flake.)

- [ ] **Step 4: Lint + format**

Run: `pnpm lint && pnpm format:check`
Expected: clean. If `format:check` flags files, run `pnpm format` and re-`git add`.

- [ ] **Step 5: Commit any formatting + write the live prerequisite note**

Append a short "Live verification" note to the spec (`docs/superpowers/specs/2026-05-29-agent-handoff-design.md`) documenting that, to see a draft actually land on `/mira`, the org must have (a) `OrgAgentEnablement(mira, enabled)` AND (b) an active `AgentDeployment` with `skillSlug="creative"` (so `listingId` resolves) — otherwise the handler fails closed with `DEPLOYMENT_NOT_FOUND` (safe, but no draft). Flag that `seedMiraPilotOrgs` seeds only the enablement row today; seeding a creative deployment/listing for the pilot org is the one live prerequisite and is intentionally out of this code-only PR.

```bash
git add -A && git commit -m "chore(handoff): green-gate formatting and live-prerequisite note"
```

- [ ] **Step 6: Hand off to code review**

Stop here for the requesting-code-review skill (whole-branch review against the spec). Do NOT merge to main — the user merges.

---

## Self-review

**Spec coverage:** §2.1 delegate tool → Task 2. §2.2 ChildWorkSubmitter port → Task 2 + Task 6. §2.3 lineage + depth → Task 1 + Task 2. §2.4 draft-only target → Task 3/4. §2.5 Alex skill → Task 7. Safety model (allowlist/depth/draft-only/governance-on-child) → Tasks 2,3,4. Testing strategy → tests in Tasks 1,2,3,5. Rollout (enablement-gated) → Task 3 + Task 8 note. Open question (listingId/seed) → Task 3 fail-closed + Task 8 note. **No gaps.**

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. The one "structural" assertion (no-inngest test) is explained, not hand-waved.

**Type consistency:** `composeSkillRequestContext` (T1) ↔ used T2. `ChildWorkSubmitter`/`DelegationRequest`/`DelegationResult`/`DelegationTarget` (T2 port) ↔ consumed T5 (`DelegationTarget`), T6 (`childWorkSubmitter` adapter returns `{ok, outcome, childWorkUnitId, error}` = `DelegationResult`). `createDelegateToolFactory` deps (`submitter`/`targets`/`maxDepth`/`hashParameters`) consistent T2↔T6. Handler `CreativeConceptDraftDeps` (T3) ↔ real stores wired T4. `creative.concept.draft` intent string identical across T3/T4/T5. `delegate.creative_concept` operation name identical T5↔T7.
