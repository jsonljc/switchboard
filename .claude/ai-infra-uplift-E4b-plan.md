# E4b — WorkTrace/ExecutionTrace -> OTel GenAI-span projection (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. TDD: RED proof is a hard done-condition per implementation step.

**Goal:** A pure, read-only, one-directional core function that projects a work unit's recorded trajectory (WorkTrace + ordered ExecutionTrace.toolCalls) into an OpenTelemetry GenAI span tree (work-unit parent -> execution children -> tool grandchildren), using the existing core Tracer. WorkTrace stays canonical; OTel is a read-only side-channel, never a second source of truth.

**Architecture:** Core owns a pure `projectWorkUnitSpans(input, tracer)` (no db, no I/O, returns void). The flat `Tracer` gains an optional `parent?: Span` so a real tree is expressible; the OTel adapter honors it via a WeakMap + an injected context bridge (degrades to flat if absent). The db read (`findByWorkUnitId`), optional WorkTrace enrichment (`getByWorkUnitId`), the `unknown[] -> ToolCallRecord[]` narrowing, and the flag gate all live in a thin apps/api exporter (Layer 5).

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Vitest, `@opentelemetry/api` (apps-only, dynamic-required), existing `@switchboard/core` telemetry.

## Global Constraints (verbatim, every task)

- ESM only, `.js` extensions in relative imports. Double quotes, semis, 2-space indent, trailing commas, 100-char width (prettier). No `console.log`. **No `any`** — use proper types or `unknown`. Unused vars prefixed `_`.
- Co-located `*.test.ts` for core modules; api tests under a `__tests__` dir (confirm the api vitest include glob in Task 4).
- Layers: core (Layer 3) must NOT import `@switchboard/db` or any app. apps/api (Layer 5) may import anything. NO circular deps.
- **One-directional / read-only:** the core projection takes no store/db/network param; the Tracer is the only sink and it is write-only-to-telemetry. WorkTrace is NEVER written. No governance-text edit.
- **No new env var:** reuse `OTEL_EXPORTER_OTLP_ENDPOINT` (already in `scripts/env-allowlist.local-readiness.json`). A new env var would trip the env-allowlist merge-stop glob -> SURFACE.
- **Privacy:** raw tool `params` VALUES must never be written to a span (external OTLP collector). Record presence only.
- Numeric attributes guarded with `Number.isFinite` before `setAttribute`. Malformed records fail SOFT (a marker attribute, never a throw) — a telemetry projection must never break its caller.
- Determinism: all tests use an in-memory recording tracer / fakes. No live OTLP endpoint, no DB, no API key in any test.

## Ground-truth types (already verified on main @ 41fc94bac — do not re-derive)

- `ToolCallRecord` (`packages/core/src/skill-runtime/types.ts:133-140`): `{ toolId: string; operation: string; params: unknown; result: ToolResult; durationMs: number; governanceDecision: GovernanceOutcome }`. Exported from `@switchboard/core`.
- `ToolResult` (`packages/core/src/skill-runtime/tool-result.ts:5`): `{ status: "success" | "error" | "denied" | "pending_approval"; data?; error?: { code: string; message: string; retryable: boolean; ... }; ... }`.
- `GovernanceOutcome` (`packages/core/src/skill-runtime/governance-types.ts:15`): `"auto-approved" | "require-approval" | "denied"` (executor may also force-cast `"simulated"`; treat as an opaque string).
- `findByWorkUnitId(orgId, workUnitId): Promise<ExecutionTraceInput[]>` (`packages/db/src/stores/prisma-execution-trace-store.ts:103`), ordered createdAt asc. Row shape (`ExecutionTraceInput`, store-local, lines 6-36): `{ id, deploymentId, organizationId, skillSlug, skillVersion, trigger, sessionId, workUnitId?, inputParametersHash, toolCalls: unknown[], governanceDecisions: unknown[], tokenUsage: { input: number; output: number; cacheRead?; cacheCreation?; costUsd?; model? }, durationMs: number, turnCount: number, status: string, error?, responseSummary, linkedOutcome*, writeCount, createdAt: Date }`.
- `WorkTraceStore.getByWorkUnitId(workUnitId): Promise<WorkTraceReadResult | null>` (`packages/core/src/platform/work-trace-recorder.ts:~60`). **`WorkTraceReadResult = { trace: WorkTrace; integrity: IntegrityVerdict }`** (`work-trace-recorder.ts:29-32`) — the WorkTrace fields (`organizationId, intent, governanceOutcome ("execute"|"require_approval"|"deny"), outcome, riskScore, durationMs`) live UNDER `.trace`, NOT flat. The exporter MUST read `wt.trace.*` and tenant-guard on `wt.trace.organizationId` (plan-grade CRITICAL, both reviewers; fixed in Task 4).
- Existing `Tracer`/`Span` + `createOTelTracer` (`packages/core/src/telemetry/tracing.ts`); only 2 callers of `startSpan` (`orchestrator/execution-manager.ts:92`, `orchestrator/propose-pipeline.ts:81`), both 2-arg. Barrel: `packages/core/src/telemetry/index.ts`; root `packages/core/src/index.ts:34` re-exports `./telemetry/index.js`.

---

### Task 1: Tracer parenting extension + OTel adapter + otel-init bridge

**Files:**

- Modify: `packages/core/src/telemetry/tracing.ts`
- Create: `packages/core/src/telemetry/tracing.test.ts`
- Modify: `apps/api/src/telemetry/otel-init.ts:63-65`

**Interfaces:**

- Produces: `Tracer.startSpan(name: string, attributes?: Record<string, string | number | boolean>, parent?: Span): Span`; `createOTelTracer(otelTracer, contextBridge?: OTelContextBridge): Tracer`; `export interface OTelContextBridge { active(): unknown; with(context: unknown, span: unknown): unknown }`.

- [ ] **Step 1: Write the failing test** — `packages/core/src/telemetry/tracing.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { NoopTracer, createOTelTracer } from "./tracing.js";

describe("Tracer parenting extension", () => {
  it("NoopTracer accepts an optional parent and stays a no-op (back-compat)", () => {
    const tracer = new NoopTracer();
    const parent = tracer.startSpan("p", { a: "1" });
    // 3-arg form must compile + not throw; existing 2-arg callers unaffected.
    const child = tracer.startSpan("c", { b: "2" }, parent);
    expect(() => child.end()).not.toThrow();
  });

  it("OTel adapter parents a child under the parent span's derived context", () => {
    // Fake raw OTel span factory: each span records the context it was started with.
    const started: Array<{ name: string; context: unknown }> = [];
    const rawSpan = () => ({
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    });
    const fakeOtelTracer = {
      startSpan: vi.fn((name: string, _options?: unknown, context?: unknown) => {
        started.push({ name, context });
        return rawSpan();
      }),
    };
    const PARENT_CTX = { __ctx: "parent-derived" };
    const ACTIVE_CTX = { __ctx: "active" };
    const bridge = {
      active: vi.fn(() => ACTIVE_CTX),
      // emulate trace.setSpan(context, span): returns a new context carrying the span
      with: vi.fn((_ctx: unknown, _span: unknown) => PARENT_CTX),
    };
    const tracer = createOTelTracer(fakeOtelTracer, bridge);

    const parent = tracer.startSpan("invoke_agent");
    const child = tracer.startSpan("execute_tool x", undefined, parent);

    // parent started with NO derived parent context (undefined)
    expect(started[0]).toEqual({ name: "invoke_agent", context: undefined });
    // child started under the context derived from the parent's raw span
    expect(bridge.with).toHaveBeenCalledTimes(1);
    expect(started[1]).toEqual({ name: "execute_tool x", context: PARENT_CTX });
    expect(child).toBeDefined();
  });

  it("OTel adapter without a context bridge degrades to flat (no throw)", () => {
    const fakeOtelTracer = {
      startSpan: vi.fn(() => ({ setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() })),
    };
    const tracer = createOTelTracer(fakeOtelTracer); // no bridge
    const parent = tracer.startSpan("p");
    expect(() => tracer.startSpan("c", undefined, parent).end()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @switchboard/core test -- tracing.test.ts`
      Expected: FAIL — `createOTelTracer` rejects the 2nd arg / 3-arg `startSpan` not in the type / context not threaded.

- [ ] **Step 3: Write minimal implementation** — edit `tracing.ts`
  - Add `parent?: Span` to `Tracer.startSpan` and to `NoopTracer.startSpan(_name, _attributes?, _parent?)` (ignores it).
  - Replace `createOTelTracer` with a WeakMap-backed implementation:

```ts
export interface OTelContextBridge {
  active(): unknown;
  with(context: unknown, span: unknown): unknown;
}

interface RawOtelSpan {
  setAttribute(key: string, value: unknown): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

export function createOTelTracer(
  otelTracer: { startSpan: (name: string, options?: unknown, context?: unknown) => RawOtelSpan },
  contextBridge?: OTelContextBridge,
): Tracer {
  const rawByWrapper = new WeakMap<Span, RawOtelSpan>();

  function wrap(raw: RawOtelSpan): Span {
    const span: Span = {
      setAttribute(key, value) {
        raw.setAttribute(key, value);
      },
      setStatus(code, message) {
        raw.setStatus({ code: code === "OK" ? 1 : 2, message });
      },
      end() {
        raw.end();
      },
    };
    rawByWrapper.set(span, raw);
    return span;
  }

  return {
    startSpan(name, attributes?, parent?) {
      const parentRaw = parent ? rawByWrapper.get(parent) : undefined;
      const context =
        parentRaw && contextBridge
          ? contextBridge.with(contextBridge.active(), parentRaw)
          : undefined;
      const raw = otelTracer.startSpan(name, undefined, context);
      if (attributes) {
        for (const [k, v] of Object.entries(attributes)) raw.setAttribute(k, v);
      }
      return wrap(raw);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @switchboard/core test -- tracing.test.ts` -> PASS.

- [ ] **Step 5: Wire the bridge in otel-init** — `apps/api/src/telemetry/otel-init.ts`, replace the `setTracer(createOTelTracer(otelTracer));` line (≈65) with:

```ts
const contextBridge = {
  active: () => otelApi.context.active(),
  with: (ctx: unknown, span: unknown) => otelApi.trace.setSpan(ctx, span),
};
setTracer(createOTelTracer(otelTracer, contextBridge));
```

- [ ] **Step 6: Typecheck core + api** — `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/api typecheck` -> clean. (Confirms the 2 existing `startSpan` callers still compile and otel-init matches the new signature.)

- [ ] **Step 7: Commit** — `git add packages/core/src/telemetry/tracing.ts packages/core/src/telemetry/tracing.test.ts apps/api/src/telemetry/otel-init.ts && git commit -m "feat(core): add optional parent span to Tracer + honor it in the OTel adapter"`

---

### Task 2: Core projection — parented 3-level tree + barrel export

**Files:**

- Create: `packages/core/src/telemetry/work-unit-spans.ts`
- Create: `packages/core/src/telemetry/work-unit-spans.test.ts`
- Modify: `packages/core/src/telemetry/index.ts`

**Interfaces:**

- Consumes: `Tracer`, `Span` (Task 1); `ToolCallRecord` (`../skill-runtime/types.js`).
- Produces:
  - `export interface WorkUnitSpanInput { workUnit: WorkUnitSpanParent; executions: ReadonlyArray<WorkUnitExecution> }`
  - `export interface WorkUnitSpanParent { workUnitId: string; organizationId?: string; deploymentId?: string; intent?: string; governanceOutcome?: string; outcome?: string; riskScore?: number; durationMs?: number }`
  - `export interface WorkUnitExecution { skillSlug?: string; skillVersion?: string; sessionId?: string; status?: string; durationMs?: number; turnCount?: number; model?: string; inputTokens?: number; outputTokens?: number; toolCalls: ReadonlyArray<ToolCallRecord> }`
  - `export function projectWorkUnitSpans(input: WorkUnitSpanInput, tracer: Tracer): void`

- [ ] **Step 1: Write the failing test** — `work-unit-spans.test.ts` (RecordingTracer + tree shape)

```ts
import { describe, it, expect } from "vitest";
import type { Span, Tracer } from "./tracing.js";
import { projectWorkUnitSpans, type WorkUnitSpanInput } from "./work-unit-spans.js";

interface RecordedSpan {
  id: number;
  name: string;
  attributes: Record<string, string | number | boolean>;
  parentId: number | null;
  status?: { code: "OK" | "ERROR"; message?: string };
  ended: boolean;
}

class RecordingTracer implements Tracer {
  readonly spans: RecordedSpan[] = [];
  private byWrapper = new WeakMap<Span, RecordedSpan>();
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
  ): Span {
    const rec: RecordedSpan = {
      id: this.spans.length,
      name,
      attributes: { ...(attributes ?? {}) },
      parentId: parent ? (this.byWrapper.get(parent)?.id ?? null) : null,
      ended: false,
    };
    this.spans.push(rec);
    const span: Span = {
      setAttribute: (k, v) => {
        rec.attributes[k] = v;
      },
      setStatus: (code, message) => {
        rec.status = { code, message };
      },
      end: () => {
        rec.ended = true;
      },
    };
    this.byWrapper.set(span, rec);
    return span;
  }
}

function sampleInput(): WorkUnitSpanInput {
  const tool = (toolId: string) => ({
    toolId,
    operation: "create",
    params: {},
    result: { status: "success" as const },
    durationMs: 5,
    governanceDecision: "auto-approved" as const,
  });
  return {
    workUnit: { workUnitId: "wu_1", organizationId: "org_1", deploymentId: "dep_1" },
    executions: [
      {
        skillSlug: "alex",
        status: "success",
        durationMs: 10,
        turnCount: 2,
        toolCalls: [tool("book"), tool("notify")],
      },
      {
        skillSlug: "alex",
        status: "success",
        durationMs: 8,
        turnCount: 1,
        toolCalls: [tool("log")],
      },
    ],
  };
}

describe("projectWorkUnitSpans — tree structure", () => {
  it("emits a parented work-unit -> execution -> tool tree, all ended", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(sampleInput(), tracer);

    const root = tracer.spans.filter((s) => s.parentId === null);
    expect(root).toHaveLength(1);
    expect(root[0]!.attributes["switchboard.work_unit.id"]).toBe("wu_1");

    const executions = tracer.spans.filter((s) => s.parentId === root[0]!.id);
    expect(executions).toHaveLength(2);

    const toolsOfFirst = tracer.spans.filter((s) => s.parentId === executions[0]!.id);
    expect(toolsOfFirst).toHaveLength(2);
    const toolsOfSecond = tracer.spans.filter((s) => s.parentId === executions[1]!.id);
    expect(toolsOfSecond).toHaveLength(1);

    expect(tracer.spans).toHaveLength(1 + 2 + 3);
    expect(tracer.spans.every((s) => s.ended)).toBe(true);
  });

  it("emits only the work-unit span when there are no executions", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans({ workUnit: { workUnitId: "wu_empty" }, executions: [] }, tracer);
    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0]!.parentId).toBeNull();
    expect(tracer.spans[0]!.ended).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts`
      Expected: FAIL — module `./work-unit-spans.js` not found / `projectWorkUnitSpans` undefined.

- [ ] **Step 3: Write minimal implementation** — `work-unit-spans.ts` (structure first; attributes/guards land in Task 3, but include the parent id attribute + span names + parenting + `end()` now)

```ts
import type { Span, Tracer } from "./tracing.js";
import type { ToolCallRecord } from "../skill-runtime/types.js";

export interface WorkUnitSpanParent {
  workUnitId: string;
  organizationId?: string;
  deploymentId?: string;
  intent?: string;
  governanceOutcome?: string;
  outcome?: string;
  riskScore?: number;
  durationMs?: number;
}

export interface WorkUnitExecution {
  skillSlug?: string;
  skillVersion?: string;
  sessionId?: string;
  status?: string;
  durationMs?: number;
  turnCount?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls: ReadonlyArray<ToolCallRecord>;
}

export interface WorkUnitSpanInput {
  workUnit: WorkUnitSpanParent;
  executions: ReadonlyArray<WorkUnitExecution>;
}

export function projectWorkUnitSpans(input: WorkUnitSpanInput, tracer: Tracer): void {
  const root = tracer.startSpan("invoke_agent", {
    "switchboard.work_unit.id": input.workUnit.workUnitId,
  });
  // Task 3 adds the full attribute set + status here.
  for (const execution of input.executions) {
    const execSpan = tracer.startSpan(`chat ${execution.skillSlug ?? "skill"}`, undefined, root);
    for (const call of execution.toolCalls) {
      const toolSpan = tracer.startSpan(`execute_tool ${readToolId(call)}`, undefined, execSpan);
      toolSpan.end();
    }
    execSpan.end();
  }
  root.end();
}

function readToolId(call: unknown): string {
  if (
    call &&
    typeof call === "object" &&
    typeof (call as { toolId?: unknown }).toolId === "string"
  ) {
    return (call as { toolId: string }).toolId;
  }
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts` -> PASS.

- [ ] **Step 5: Export from the telemetry barrel** — add to `packages/core/src/telemetry/index.ts`:

```ts
export * from "./work-unit-spans.js";
```

- [ ] **Step 6: Verify the public import** — `pnpm --filter @switchboard/core typecheck` -> clean (proves `projectWorkUnitSpans` + types are reachable from `@switchboard/core` via the root barrel).

- [ ] **Step 7: Commit** — `git add packages/core/src/telemetry/work-unit-spans.ts packages/core/src/telemetry/work-unit-spans.test.ts packages/core/src/telemetry/index.ts && git commit -m "feat(core): project a work unit's trajectory into a parented OTel span tree"`

---

### Task 3: GenAI attributes + status mapping + defensive guards + param-scrubbing + one-directionality

**Files:**

- Modify: `packages/core/src/telemetry/work-unit-spans.ts`
- Modify: `packages/core/src/telemetry/work-unit-spans.test.ts`

**Interfaces:** unchanged signature; enriches span attributes + status. Adds internal pure helpers (not exported): `setIfFinite`, `setIfString`, `toolSpanStatus`, etc.

- [ ] **Step 1: Write the failing tests** — append to `work-unit-spans.test.ts`

```ts
describe("projectWorkUnitSpans — GenAI attributes, status, guards, privacy", () => {
  it("maps GenAI + switchboard attributes on each span level", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: {
          workUnitId: "wu_1",
          organizationId: "org_1",
          deploymentId: "dep_1",
          intent: "book_appointment",
          governanceOutcome: "require_approval",
          outcome: "succeeded",
          riskScore: 0.4,
          durationMs: 120,
        },
        executions: [
          {
            skillSlug: "alex",
            skillVersion: "3",
            sessionId: "sess_9",
            status: "success",
            durationMs: 100,
            turnCount: 3,
            model: "claude-opus-4-6",
            inputTokens: 1200,
            outputTokens: 340,
            toolCalls: [
              {
                toolId: "book_appointment",
                operation: "create",
                params: { customerPhone: "+6591234567", depositRef: "DEP-SECRET-XYZ" },
                result: { status: "success" },
                durationMs: 12,
                governanceDecision: "auto-approved",
              },
            ],
          },
        ],
      },
      tracer,
    );

    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    expect(root.attributes["gen_ai.system"]).toBe("switchboard");
    expect(root.attributes["switchboard.intent"]).toBe("book_appointment");
    expect(root.attributes["switchboard.governance.outcome"]).toBe("require_approval");
    expect(root.attributes["switchboard.work.outcome"]).toBe("succeeded");
    expect(root.attributes["switchboard.risk_score"]).toBe(0.4);
    expect(root.attributes["switchboard.duration_ms"]).toBe(120);

    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(exec.attributes["gen_ai.request.model"]).toBe("claude-opus-4-6");
    expect(exec.attributes["gen_ai.usage.input_tokens"]).toBe(1200);
    expect(exec.attributes["gen_ai.usage.output_tokens"]).toBe(340);
    expect(exec.attributes["switchboard.skill.slug"]).toBe("alex");
    expect(exec.attributes["switchboard.turn_count"]).toBe(3);
    expect(exec.status?.code).toBe("OK");

    const tool = tracer.spans.find((s) => s.name.startsWith("execute_tool"))!;
    expect(tool.attributes["gen_ai.operation.name"]).toBe("execute_tool");
    expect(tool.attributes["gen_ai.tool.name"]).toBe("book_appointment");
    expect(tool.attributes["switchboard.tool.operation"]).toBe("create");
    expect(tool.attributes["switchboard.governance.decision"]).toBe("auto-approved");
    expect(tool.attributes["switchboard.tool.result_status"]).toBe("success");
    expect(tool.attributes["switchboard.tool.duration_ms"]).toBe(12);
  });

  it("never writes raw param VALUES to any span (privacy); records presence only", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [
          {
            toolCalls: [
              {
                toolId: "t",
                operation: "op",
                params: { customerPhone: "+6591234567", depositRef: "DEP-SECRET-XYZ" },
                result: { status: "success" },
                durationMs: 1,
                governanceDecision: "auto-approved",
              },
            ],
          },
        ],
      },
      tracer,
    );
    const allValues = tracer.spans
      .flatMap((s) => Object.values(s.attributes))
      .map(String)
      .join("|");
    expect(allValues).not.toContain("+6591234567");
    expect(allValues).not.toContain("DEP-SECRET-XYZ");
    const tool = tracer.spans.find((s) => s.name.startsWith("execute_tool"))!;
    expect(tool.attributes["switchboard.tool.params_present"]).toBe(true);
  });

  it("sets ERROR status for denied governance / error+denied tool results", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1", governanceOutcome: "deny", outcome: "failed" },
        executions: [
          {
            status: "error",
            toolCalls: [
              {
                toolId: "t1",
                operation: "o",
                params: {},
                result: { status: "denied" },
                durationMs: 1,
                governanceDecision: "denied",
              },
              {
                toolId: "t2",
                operation: "o",
                params: {},
                result: { status: "pending_approval" },
                durationMs: 1,
                governanceDecision: "require-approval",
              },
            ],
          },
        ],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.status?.code).toBe("ERROR");
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.status?.code).toBe("ERROR");
    const denied = tracer.spans.find((s) => s.name === "execute_tool t1")!;
    expect(denied.status?.code).toBe("ERROR");
    const pending = tracer.spans.find((s) => s.name === "execute_tool t2")!;
    expect(pending.status?.code).toBe("OK"); // pending_approval is a parked state, not a failure
  });

  it("guards non-finite numbers (NaN/Infinity skipped, not written)", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1", riskScore: Number.NaN, durationMs: Infinity },
        executions: [{ durationMs: Number.NaN, inputTokens: Number.NaN, toolCalls: [] }],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect("switchboard.risk_score" in root.attributes).toBe(false);
    expect("switchboard.duration_ms" in root.attributes).toBe(false);
  });

  it("fails SOFT on a malformed tool record (marker attribute, no throw)", () => {
    const tracer = new RecordingTracer();
    const input = {
      workUnit: { workUnitId: "wu_1" },
      executions: [
        { toolCalls: [null as unknown, { toolId: 42 } as unknown] as ReadonlyArray<never> },
      ],
    } as unknown as WorkUnitSpanInput;
    expect(() => projectWorkUnitSpans(input, tracer)).not.toThrow();
    const malformed = tracer.spans.filter(
      (s) => s.attributes["switchboard.tool.malformed"] === true,
    );
    expect(malformed.length).toBeGreaterThanOrEqual(1);
    expect(malformed.every((s) => s.ended)).toBe(true);
  });

  it("is read-only: does not mutate a deep-frozen input (one-directionality)", () => {
    const tracer = new RecordingTracer();
    const input: WorkUnitSpanInput = {
      workUnit: Object.freeze({ workUnitId: "wu_1" }),
      executions: Object.freeze([
        Object.freeze({
          toolCalls: Object.freeze([
            Object.freeze({
              toolId: "t",
              operation: "o",
              params: Object.freeze({}),
              result: Object.freeze({ status: "success" as const }),
              durationMs: 1,
              governanceDecision: "auto-approved" as const,
            }),
          ]),
        }),
      ]),
    } as WorkUnitSpanInput;
    expect(() => projectWorkUnitSpans(input, tracer)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts`
      Expected: FAIL on the attribute/status/guard/malformed assertions (only `switchboard.work_unit.id` + structure exist from Task 2).

- [ ] **Step 3: Implement the full attribute mapping + guards** — rewrite `projectWorkUnitSpans` internals. Helpers + the three emitters:

```ts
function setIfString(span: Span, key: string, value: unknown): void {
  if (typeof value === "string" && value.length > 0) span.setAttribute(key, value);
}
function setIfFinite(span: Span, key: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) span.setAttribute(key, value);
}

function workUnitStatus(wu: WorkUnitSpanParent): "OK" | "ERROR" {
  if (wu.governanceOutcome === "deny") return "ERROR";
  if (typeof wu.outcome === "string" && /fail|error|denied/i.test(wu.outcome)) return "ERROR";
  return "OK";
}
function executionStatus(status: unknown): "OK" | "ERROR" {
  return status === "error" || status === "budget_exceeded" || status === "denied" ? "ERROR" : "OK";
}
function toolStatus(resultStatus: unknown, governance: unknown): "OK" | "ERROR" {
  if (resultStatus === "error" || resultStatus === "denied") return "ERROR";
  if (governance === "denied") return "ERROR";
  return "OK";
}
```

- work-unit span: `gen_ai.system` = "switchboard", `gen_ai.operation.name` = "invoke_agent", + `switchboard.work_unit.id` (always), and `setIfString`/`setIfFinite` for `switchboard.organization.id`, `switchboard.deployment.id`, `switchboard.intent`, `switchboard.governance.outcome`, `switchboard.work.outcome`, `switchboard.risk_score`, `switchboard.duration_ms`; `root.setStatus(workUnitStatus(input.workUnit))` before children, end after.
- execution span: `gen_ai.system` = "switchboard", `gen_ai.operation.name` = "chat", `setIfString` `gen_ai.request.model` (execution.model), `setIfFinite` `gen_ai.usage.input_tokens`/`gen_ai.usage.output_tokens`, `switchboard.skill.slug`/`switchboard.skill.version`/`switchboard.session.id`/`switchboard.execution.status`/`switchboard.turn_count`/`switchboard.duration_ms`; `setStatus(executionStatus(execution.status))`.
- tool span: narrow each `call` defensively. If not a non-null object -> `setAttribute("switchboard.tool.malformed", true)`, end, continue. Else read `toolId`(string-guard), `operation`, `result?.status`, `governanceDecision`, `durationMs`: `gen_ai.operation.name` = "execute_tool", `gen_ai.tool.name` = toolId (guard; mark malformed if non-string), `switchboard.tool.operation`, `switchboard.tool.result_status`, `switchboard.governance.decision`, `switchboard.tool.duration_ms`, `switchboard.tool.error_code` (from `result.error.code` if present), and `switchboard.tool.params_present` = `(call.params !== undefined && call.params !== null)`. **Never** read or write `call.params` VALUES. `setStatus(toolStatus(...))`, end.

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts` -> PASS (all describe blocks).

- [ ] **Step 5: Add the no-db-import guard test** — append a meta-test pinning one-directionality at the import level (mirrors S7's import-closure proof):

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

it("the projection module imports nothing from the db layer (one-directional)", () => {
  const src = readFileSync(fileURLToPath(new URL("./work-unit-spans.ts", import.meta.url)), "utf8");
  expect(src).not.toMatch(/@switchboard\/db/);
  expect(src).not.toMatch(/from\s+["'].*\/db\//);
});
```

- [ ] **Step 6: Run + full core test** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts && pnpm --filter @switchboard/core test` -> PASS (no regression in the 4345+ core suite).

- [ ] **Step 7: Commit** — `git add packages/core/src/telemetry/work-unit-spans.ts packages/core/src/telemetry/work-unit-spans.test.ts && git commit -m "feat(core): map GenAI span attributes with fail-soft guards and param scrubbing"`

---

### Task 4: Apps mapper + flag-gated exporter + producer->consumer seam test

**Files:**

- Create: `apps/api/src/telemetry/work-unit-span-export.ts`
- Create: `apps/api/src/telemetry/__tests__/work-unit-span-export.test.ts` (confirm the api vitest include glob; if it scans co-located, place next to the source instead)

**Interfaces:**

- Consumes: `projectWorkUnitSpans`, `getTracer`, `WorkUnitSpanInput`, `WorkUnitExecution` from `@switchboard/core`; the `findByWorkUnitId` row shape + `WorkTraceStore.getByWorkUnitId` from `@switchboard/db` / core.
- Produces:
  - `export function mapExecutionTracesToSpanInput(workUnitId: string, traces: ReadonlyArray<ExecutionTraceRow>, workTrace?: WorkTraceSummary): WorkUnitSpanInput`
  - `export function isWorkUnitTracingEnabled(): boolean`
  - `export async function exportWorkUnitSpans(deps: WorkUnitSpanExportDeps, orgId: string, workUnitId: string): Promise<void>`
  - local types `ExecutionTraceRow` (structural subset of the findByWorkUnitId row), `WorkTraceSummary`, `WorkUnitSpanExportDeps`.

- [ ] **Step 1: Write the failing tests** — `__tests__/work-unit-span-export.test.ts`

```ts
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { setTracer, getTracer, type Span, type Tracer } from "@switchboard/core";
import {
  mapExecutionTracesToSpanInput,
  exportWorkUnitSpans,
  isWorkUnitTracingEnabled,
} from "../work-unit-span-export.js";

// minimal recording tracer (mirrors the core test double)
class RecordingTracer implements Tracer {
  spans: Array<{
    id: number;
    name: string;
    attributes: Record<string, unknown>;
    parentId: number | null;
  }> = [];
  private m = new WeakMap<Span, number>();
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
  ): Span {
    const id = this.spans.length;
    this.spans.push({
      id,
      name,
      attributes: { ...(attributes ?? {}) },
      parentId: parent ? (this.m.get(parent) ?? null) : null,
    });
    const span: Span = {
      setAttribute: (k, v) => {
        this.spans[id]!.attributes[k] = v;
      },
      setStatus: () => {},
      end: () => {},
    };
    this.m.set(span, id);
    return span;
  }
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "et_1",
    organizationId: "org_1",
    deploymentId: "dep_1",
    skillSlug: "alex",
    skillVersion: "3",
    sessionId: "sess_1",
    workUnitId: "wu_1",
    status: "success",
    durationMs: 100,
    turnCount: 2,
    tokenUsage: { input: 100, output: 50, model: "claude-opus-4-6" },
    toolCalls: [
      {
        toolId: "book",
        operation: "create",
        params: { x: 1 },
        result: { status: "success" },
        durationMs: 5,
        governanceDecision: "auto-approved",
      },
    ],
    ...overrides,
  };
}

describe("mapExecutionTracesToSpanInput", () => {
  it("maps findByWorkUnitId rows into a WorkUnitSpanInput (narrows toolCalls, lifts token aggregate)", () => {
    const input = mapExecutionTracesToSpanInput("wu_1", [row()], {
      organizationId: "org_1",
      intent: "book",
      governanceOutcome: "execute",
      outcome: "succeeded",
      riskScore: 0.2,
    });
    expect(input.workUnit.workUnitId).toBe("wu_1");
    expect(input.workUnit.intent).toBe("book");
    expect(input.executions).toHaveLength(1);
    expect(input.executions[0]!.model).toBe("claude-opus-4-6");
    expect(input.executions[0]!.inputTokens).toBe(100);
    expect(input.executions[0]!.toolCalls).toHaveLength(1);
    expect(input.executions[0]!.toolCalls[0]!.toolId).toBe("book");
  });
});

describe("seam: findByWorkUnitId rows -> mapper -> projection", () => {
  it("produces a parented work-unit -> execution -> tool tree from realistic store rows", () => {
    const tracer = new RecordingTracer();
    const input = mapExecutionTracesToSpanInput("wu_1", [
      row(),
      row({ id: "et_2", toolCalls: [] }),
    ]);
    // import projectWorkUnitSpans dynamically to keep this test colocated with the apps seam:
    return import("@switchboard/core").then(({ projectWorkUnitSpans }) => {
      projectWorkUnitSpans(input, tracer);
      const root = tracer.spans.filter((s) => s.parentId === null);
      expect(root).toHaveLength(1);
      const execs = tracer.spans.filter((s) => s.parentId === root[0]!.id);
      expect(execs).toHaveLength(2);
      const tools = tracer.spans.filter((s) => execs.some((e) => e.id === s.parentId));
      expect(tools).toHaveLength(1); // first row has 1 tool, second has 0
    });
  });
});

describe("exportWorkUnitSpans — flag gate + enrichment + read-only", () => {
  const OLD = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  let originalTracer: Tracer;
  beforeEach(() => {
    originalTracer = getTracer();
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
    else process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = OLD;
    setTracer(originalTracer);
  });

  it("is a no-op (no store read) when OTEL endpoint is unset", async () => {
    delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
    expect(isWorkUnitTracingEnabled()).toBe(false);
    const findByWorkUnitId = vi.fn();
    await exportWorkUnitSpans({ executionTraceStore: { findByWorkUnitId } }, "org_1", "wu_1");
    expect(findByWorkUnitId).not.toHaveBeenCalled();
  });

  it("enriches the work-unit span from WorkTrace.trace.* and only READS the store", async () => {
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost:4318";
    const tracer = new RecordingTracer();
    setTracer(tracer);
    const findByWorkUnitId = vi.fn(async () => [row()]);
    // real getByWorkUnitId returns WorkTraceReadResult = { trace, integrity }; enrichment fields under .trace
    const getByWorkUnitId = vi.fn(async () => ({
      trace: {
        organizationId: "org_1",
        intent: "book_appt",
        governanceOutcome: "execute",
        outcome: "succeeded",
        riskScore: 0.2,
        durationMs: 100,
      },
    }));
    await exportWorkUnitSpans(
      { executionTraceStore: { findByWorkUnitId }, workTraceStore: { getByWorkUnitId } },
      "org_1",
      "wu_1",
    );
    expect(findByWorkUnitId).toHaveBeenCalledWith("org_1", "wu_1");
    expect(getByWorkUnitId).toHaveBeenCalledWith("wu_1");
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.attributes["switchboard.intent"]).toBe("book_appt"); // PINS the nested .trace read path
  });

  it("skips WorkTrace enrichment on a tenant mismatch (no cross-tenant leak)", async () => {
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost:4318";
    const tracer = new RecordingTracer();
    setTracer(tracer);
    const findByWorkUnitId = vi.fn(async () => [row()]);
    const getByWorkUnitId = vi.fn(async () => ({
      trace: { organizationId: "OTHER_ORG", intent: "leak" },
    }));
    await exportWorkUnitSpans(
      { executionTraceStore: { findByWorkUnitId }, workTraceStore: { getByWorkUnitId } },
      "org_1",
      "wu_1",
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.attributes["switchboard.intent"]).toBeUndefined(); // enrichment skipped -> no leak
  });
});
```

NOTE: the seam test's `RecordingTracer` must also implement `setStatus`/`end` no-ops (it already does) so `setTracer(tracer)` is a complete Tracer. Restore the original tracer in `afterEach` (captured in `beforeEach`).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @switchboard/api test -- work-unit-span-export.test.ts`
      Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/telemetry/work-unit-span-export.ts`

```ts
import {
  projectWorkUnitSpans,
  getTracer,
  type WorkUnitSpanInput,
  type WorkUnitExecution,
} from "@switchboard/core";

/** Structural subset of a findByWorkUnitId row (avoids importing the store-local mirror type). */
export interface ExecutionTraceRow {
  organizationId?: string;
  deploymentId?: string;
  skillSlug?: string;
  skillVersion?: string;
  sessionId?: string;
  status?: string;
  durationMs?: number;
  turnCount?: number;
  tokenUsage?: { input?: number; output?: number; model?: string };
  toolCalls?: unknown[];
}

/** FLAT enrichment passed to the mapper (already lifted out of WorkTrace.trace). */
export interface WorkTraceSummary {
  organizationId?: string;
  intent?: string;
  governanceOutcome?: string;
  outcome?: string;
  riskScore?: number;
  durationMs?: number;
}

/**
 * Structural subset of core's `WorkTraceReadResult` (= `{ trace: WorkTrace; integrity }`).
 * getByWorkUnitId returns the WorkTrace fields UNDER `.trace` — NOT flat. Fields are loose/optional
 * so the REAL `WorkTraceStore.getByWorkUnitId(): Promise<WorkTraceReadResult | null>` return is
 * assignable here when E4c wires the live store. (governanceOutcome/outcome are string unions on
 * WorkTrace -> assignable to string; if a field is not string-assignable, String()-coerce in the body.)
 */
export interface WorkTraceReadLike {
  trace: {
    organizationId?: string;
    intent?: string;
    governanceOutcome?: string;
    outcome?: string;
    riskScore?: number;
    durationMs?: number;
  };
}

export interface WorkUnitSpanExportDeps {
  executionTraceStore: {
    findByWorkUnitId(orgId: string, workUnitId: string): Promise<ExecutionTraceRow[]>;
  };
  workTraceStore?: { getByWorkUnitId(workUnitId: string): Promise<WorkTraceReadLike | null> };
}

export function mapExecutionTracesToSpanInput(
  workUnitId: string,
  traces: ReadonlyArray<ExecutionTraceRow>,
  workTrace?: WorkTraceSummary,
): WorkUnitSpanInput {
  const first = traces[0];
  const executions: WorkUnitExecution[] = traces.map((t) => ({
    skillSlug: t.skillSlug,
    skillVersion: t.skillVersion,
    sessionId: t.sessionId,
    status: t.status,
    durationMs: t.durationMs,
    turnCount: t.turnCount,
    model: t.tokenUsage?.model,
    inputTokens: t.tokenUsage?.input,
    outputTokens: t.tokenUsage?.output,
    // toolCalls is unknown[] from JSON; the core projection guards each field defensively.
    toolCalls: (t.toolCalls ?? []) as WorkUnitExecution["toolCalls"],
  }));
  return {
    workUnit: {
      workUnitId,
      organizationId: workTrace?.organizationId ?? first?.organizationId,
      deploymentId: first?.deploymentId,
      intent: workTrace?.intent,
      governanceOutcome: workTrace?.governanceOutcome,
      outcome: workTrace?.outcome,
      riskScore: workTrace?.riskScore,
      durationMs: workTrace?.durationMs,
    },
    executions,
  };
}

export function isWorkUnitTracingEnabled(): boolean {
  return Boolean(process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]);
}

export async function exportWorkUnitSpans(
  deps: WorkUnitSpanExportDeps,
  orgId: string,
  workUnitId: string,
): Promise<void> {
  if (!isWorkUnitTracingEnabled()) return;
  const traces = await deps.executionTraceStore.findByWorkUnitId(orgId, workUnitId);
  if (traces.length === 0) return;
  let workTrace: WorkTraceSummary | undefined;
  const wt = await deps.workTraceStore?.getByWorkUnitId(workUnitId);
  // getByWorkUnitId returns WorkTraceReadResult = { trace, integrity }; enrichment fields are under .trace.
  // tenant guard: only enrich from a WorkTrace that belongs to the same org (no cross-tenant leak).
  if (wt && wt.trace.organizationId === orgId) {
    workTrace = {
      organizationId: wt.trace.organizationId,
      intent: wt.trace.intent,
      governanceOutcome: wt.trace.governanceOutcome,
      outcome: wt.trace.outcome,
      riskScore: wt.trace.riskScore,
      durationMs: wt.trace.durationMs,
    };
  }
  projectWorkUnitSpans(mapExecutionTracesToSpanInput(workUnitId, traces, workTrace), getTracer());
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/api test -- work-unit-span-export.test.ts` -> PASS.

- [ ] **Step 5: Typecheck api** — `pnpm --filter @switchboard/api typecheck` -> clean.

- [ ] **Step 6: Commit** — `git add apps/api/src/telemetry/work-unit-span-export.ts apps/api/src/telemetry/__tests__/work-unit-span-export.test.ts && git commit -m "feat(api): flag-gated read-only exporter mapping work-unit traces to OTel spans"`

---

## Self-review (run after writing all tasks)

- **Spec coverage:** (a) hierarchy + GenAI attrs = Tasks 2/3; (b) pure fn + injected tracer + one-directionality = Tasks 2/3/4; parenting honored end-to-end = Task 1; (c) flag/env gating (reuse, no new var) = Task 4. All covered.
- **No new env var, no schema, no governance/send/auth edit** -> no merge-stop glob (re-verify with `git diff origin/main...HEAD --name-only` at VERIFY).
- **Type consistency:** `WorkUnitSpanInput`/`WorkUnitExecution`/`WorkUnitSpanParent` identical across Tasks 2/3/4; `projectWorkUnitSpans` signature stable; `createOTelTracer(otelTracer, contextBridge?)` matches the otel-init call.
- **Deferred (documented, not fabricated):** per-individual-LLM-call spans (no data source; turnCount as an attribute instead); the live trigger/wiring (E4c); a real OTLP end-to-end export (optional; in-memory fake proves emission).
- **Plan-grade REVISE applied (round 1):** both subagents flagged that `getByWorkUnitId` returns nested `{ trace, integrity }`, not flat — Task 4 now reads `wt.trace.*`, the dep type is `WorkTraceReadLike`, and the seam tests use `setTracer` + a RecordingTracer to assert enrichment actually LANDS on a tenant match and is ABSENT on a mismatch (no longer fake-masks-real). OTel API (`@opentelemetry/api@1.9.1` `trace.setSpan`/`context.active`/3-arg `startSpan`), the 2 back-compat `startSpan` callers, the api `__tests__` vitest glob, and the GenAI attribute keys all graded OK.
- **PR-description scope note (must include):** "E4b ships the read-only projection + flag-gated exporter; NO production work unit is traced until E4c wires the trigger." Prevents over-reading the capability (a reviewer noted the un-triggered exporter is correct AS SCOPED, not the inert-flag anti-pattern).
