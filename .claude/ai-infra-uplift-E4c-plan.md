# E4c Slice 1 — OTel work-unit projection TIMELINE/quality fix (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps use checkbox (`- [ ]`). TDD: a RED proof (test seen failing) is a hard done-condition per implementation step.

**Goal:** Make the merged-but-temporally-flat E4b OTel projection render an honest waterfall: real/derived/synthetic span start+end times + SpanKind, plus cache/cost attributes and two minor follow-ups. Pure quality fix to the read-only projection; NO live trigger, NO env var, NO ingress seam (that is Slice 2, SURFACE).

**Architecture:** The internal `Tracer` gains `startSpan(..., options?: {startTime?; kind?})` + `Span.end(endTime?)`; the OTel adapter converts epoch-ms -> an unambiguous HrTime tuple and forwards `{startTime, kind}` + `endTime` to the real OTel span. The core `projectWorkUnitSpans` synthesizes honest timing from persisted anchors (work-unit = REAL `requestedAt`/`completedAt`; execution end = REAL `createdAt`, start = `createdAt - durationMs` derived; tools = sequential packing within the exec window), marks derived spans `switchboard.timing.synthetic=true`, and tags SpanKind. The apps mapper lifts the timestamps (ISO/Date -> epoch-ms) + cache/cost from `tokenUsage`. WorkTrace stays canonical; projection stays one-directional + read-only.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Vitest, `@opentelemetry/api@1.9.1` (apps-only, dynamic), existing `@switchboard/core` telemetry.

## Global Constraints (verbatim, every task)

- ESM only, `.js` extensions in relative imports. Double quotes, semis, 2-space indent, trailing commas, 100-char width (prettier). No `console.log`. **No `any`** — proper types or `unknown`. Unused vars prefixed `_`.
- Layers: core (Layer 3) must NOT import `@switchboard/db`, any app, or `@opentelemetry/api`. apps/api (Layer 5) may import anything. NO circular deps.
- **One-directional / read-only:** the core projection takes no store/db/network param; the Tracer is the only sink. WorkTrace is NEVER written. No governance-text edit.
- **No new env var, no schema, no governance/send/auth/route edit** -> no merge-stop glob. Re-verify with `git diff origin/main...HEAD --name-only` at VERIFY.
- **Honesty:** prefer REAL persisted timestamps; mark every DERIVED/SYNTHETIC placement with `switchboard.timing.synthetic=true`; never fabricate precision. Degrade to no-explicit-time (E4b flat) when an anchor is missing — never crash, never wall-clock (`Date.now()`).
- Numeric attributes guarded with `Number.isFinite`. Malformed records fail SOFT. Tests use an in-memory recording tracer / fakes only — no live OTLP, no DB, no key.

## Ground-truth (verified on current main cc6fd4645 — do not re-derive)

- `tracing.ts`: `Span { setAttribute; setStatus(code,message?); end() }`; `Tracer.startSpan(name, attributes?, parent?)`; adapter `createOTelTracer(otelTracer, contextBridge?)` calls `otelTracer.startSpan(name, undefined, context)` (2nd arg = options slot, currently `undefined`); `RawOtelSpan.end()` no-arg; `OTelContextBridge` exported at line 53 but ABSENT from the barrel `index.ts`. 2 existing 2-arg `startSpan` callers (execution-manager.ts, propose-pipeline.ts).
- `@opentelemetry/api@1.9.1`: `SpanOptions { kind?: SpanKind; startTime?: TimeInput }`; `Tracer.startSpan(name, options?, context?)`; `Span.end(endTime?: TimeInput)`; `TimeInput = HrTime | number | Date` (HrTime = `[seconds, nanos]`). SpanKind {INTERNAL=0, CLIENT=2}.
- `work-unit-spans.ts`: `WorkUnitSpanParent` (workUnitId + org/dep/intent/gov/outcome/risk/durationMs), `WorkUnitExecution` (skill/session/status/durationMs/turnCount/model/in+out tokens/toolCalls), helpers `setIfString`/`setIfFinite`/`workUnitStatus`/`executionStatus`/`toolStatus`, `projectWorkUnitSpans`, `emitToolSpan`. Root sets `switchboard.work_unit.id` UNGUARDED.
- `work-unit-span-export.ts` (apps): `ExecutionTraceRow` (`tokenUsage?: {input?;output?;model?}`, no createdAt), `WorkTraceSummary` (no timestamps), `WorkTraceReadLike.trace` (no timestamps), `mapExecutionTracesToSpanInput`, `exportWorkUnitSpans` (reads `wt.trace.*`, tenant-guards on `wt.trace.organizationId === orgId`).
- Persisted timing: WorkTrace `.trace` carries `requestedAt:string`(REQ), `completedAt?:string`, `durationMs:number`(REQ). ExecutionTrace row carries `createdAt:Date` (persist≈end) + `durationMs:number`, ordered createdAt asc. ToolCallRecord carries `durationMs` only. `tokenUsage` carries `cacheRead?/cacheCreation?/costUsd?/model?`.

---

### Task 1: Tracer timing+kind extension + OTel adapter forwarding (HrTime) + endTime

**Files:**

- Modify: `packages/core/src/telemetry/tracing.ts`
- Modify: `packages/core/src/telemetry/tracing.test.ts` (APPEND a describe block; do NOT alter the existing E4b tests except: the existing tests are unaffected — they use 2/3-arg `startSpan` and no-arg `end`, both still valid)

**Interfaces produced:**

- `export interface SpanStartOptions { startTime?: number; kind?: number }`
- `Tracer.startSpan(name: string, attributes?: Record<string,string|number|boolean>, parent?: Span, options?: SpanStartOptions): Span`
- `Span.end(endTime?: number): void`

- [ ] **Step 1: Write the failing tests** — append to `packages/core/src/telemetry/tracing.test.ts` (keep the existing `import { NoopTracer, createOTelTracer } from "./tracing.js";` + `vi`):

```ts
describe("Tracer timing + kind extension (E4c)", () => {
  it("forwards startTime (as an HrTime tuple) + kind via the OTel options slot, and endTime to raw.end", () => {
    const started: Array<{ name: string; options: unknown; context: unknown }> = [];
    const ended: unknown[] = [];
    const fakeOtelTracer = {
      startSpan: vi.fn((name: string, options?: unknown, context?: unknown) => {
        started.push({ name, options, context });
        return {
          setAttribute: vi.fn(),
          setStatus: vi.fn(),
          end: vi.fn((endTime?: unknown) => ended.push(endTime)),
        };
      }),
    };
    const tracer = createOTelTracer(fakeOtelTracer);
    const span = tracer.startSpan("chat alex", { a: "1" }, undefined, {
      startTime: 1_700_000_000_500,
      kind: 2,
    });
    span.end(1_700_000_001_000);

    expect(started).toHaveLength(1);
    // 1_700_000_000_500 ms -> [1_700_000_000 s, 500_000_000 ns]; kind passed through verbatim
    expect(started[0]!.options).toEqual({ startTime: [1_700_000_000, 500_000_000], kind: 2 });
    // 1_700_000_001_000 ms -> [1_700_000_001, 0]
    expect(ended).toEqual([[1_700_000_001, 0]]);
  });

  it("builds NO OTel options object when neither startTime nor kind is supplied (E4b back-compat)", () => {
    const started: Array<{ options: unknown }> = [];
    const fakeOtelTracer = {
      startSpan: vi.fn((_name: string, options?: unknown) => {
        started.push({ options });
        return { setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
      }),
    };
    const tracer = createOTelTracer(fakeOtelTracer);
    tracer.startSpan("p", { a: "1" }); // legacy 2-arg caller
    expect(started[0]!.options).toBeUndefined();
  });

  it("passes only kind (no startTime key) when startTime is omitted", () => {
    const started: Array<{ options: unknown }> = [];
    const fakeOtelTracer = {
      startSpan: vi.fn((_name: string, options?: unknown) => {
        started.push({ options });
        return { setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
      }),
    };
    const tracer = createOTelTracer(fakeOtelTracer);
    tracer.startSpan("invoke_agent", undefined, undefined, { kind: 0 });
    expect(started[0]!.options).toEqual({ kind: 0 });
  });

  it("NoopTracer accepts the 4-arg form + end(endTime) and stays a no-op", () => {
    const tracer = new NoopTracer();
    const parent = tracer.startSpan("p", { a: "1" });
    const child = tracer.startSpan("c", { b: "2" }, parent, { startTime: 1, kind: 0 });
    expect(() => child.end(2)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @switchboard/core test -- tracing.test.ts`
      Expected: FAIL — `startSpan` rejects the 4th arg / `end` rejects an arg / options not forwarded.

- [ ] **Step 3: Implement** — edit `tracing.ts`:
  - Add the public type + extend the interfaces:

```ts
export interface SpanStartOptions {
  /** Span start time as epoch milliseconds. The OTel adapter converts to an HrTime tuple. */
  startTime?: number;
  /** OTel SpanKind numeric value (INTERNAL=0, SERVER=1, CLIENT=2, PRODUCER=3, CONSUMER=4). */
  kind?: number;
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: "OK" | "ERROR", message?: string): void;
  end(endTime?: number): void;
}

export interface Tracer {
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
    options?: SpanStartOptions,
  ): Span;
}
```

- `NoopSpan.end(_endTime?: number)`; `NoopTracer.startSpan(_name, _attributes?, _parent?, _options?)`.
- Widen `RawOtelSpan`: `end(endTime?: unknown): void;`.
- Add the converter (module-scope, not exported):

```ts
/**
 * Convert epoch milliseconds to an OTel HrTime tuple [seconds, nanoseconds] (unambiguous across
 * OTel versions vs a bare number). Assumes a non-negative epoch — always true for persisted
 * `requestedAt`/`createdAt` anchors and `createdAt - durationMs` (durationMs << createdAt).
 */
function epochMsToHrTime(epochMs: number): [number, number] {
  const seconds = Math.trunc(epochMs / 1000);
  const nanos = Math.round((epochMs - seconds * 1000) * 1e6);
  return [seconds, nanos];
}
```

- Rewrite the adapter `wrap`/`startSpan`:

```ts
function wrap(raw: RawOtelSpan): Span {
  const span: Span = {
    setAttribute(key, value) {
      raw.setAttribute(key, value);
    },
    setStatus(code, message) {
      raw.setStatus({ code: code === "OK" ? 1 : 2, message });
    },
    end(endTime) {
      raw.end(endTime !== undefined ? epochMsToHrTime(endTime) : undefined);
    },
  };
  rawByWrapper.set(span, raw);
  return span;
}

return {
  startSpan(name, attributes?, parent?, options?) {
    const parentRaw = parent ? rawByWrapper.get(parent) : undefined;
    const context =
      parentRaw && contextBridge
        ? contextBridge.with(contextBridge.active(), parentRaw)
        : undefined;
    let otelOptions: { startTime?: [number, number]; kind?: number } | undefined;
    if (options && (options.kind !== undefined || options.startTime !== undefined)) {
      otelOptions = {};
      if (options.kind !== undefined) otelOptions.kind = options.kind;
      if (options.startTime !== undefined)
        otelOptions.startTime = epochMsToHrTime(options.startTime);
    }
    const raw = otelTracer.startSpan(name, otelOptions, context);
    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) raw.setAttribute(k, v);
    }
    return wrap(raw);
  },
};
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/core test -- tracing.test.ts` -> PASS (new block + all existing E4b adapter tests).

- [ ] **Step 5: Typecheck core + api** — `pnpm --filter @switchboard/core typecheck && pnpm --filter @switchboard/api typecheck` -> clean (the 2 existing 2-arg callers + otel-init still compile; otel-init is UNCHANGED).

- [ ] **Step 6: Commit** — `git add packages/core/src/telemetry/tracing.ts packages/core/src/telemetry/tracing.test.ts && git commit -m "feat(core): add span startTime/endTime/kind to Tracer and honor them in the OTel adapter"`

---

### Task 2: Projection timing synthesis (real/derived/synthetic) + SpanKind + root id guard

**Files:**

- Modify: `packages/core/src/telemetry/work-unit-spans.ts`
- Modify: `packages/core/src/telemetry/work-unit-spans.test.ts` (extend the RecordingTracer to the new signatures + APPEND a timing describe block)

**Interfaces:**

- Consumes: `SpanStartOptions`, `Tracer`, `Span` (Task 1).
- Produces (extends): `WorkUnitSpanParent` += `requestedAtMs?: number; completedAtMs?: number`; `WorkUnitExecution` += `createdAtMs?: number`. `projectWorkUnitSpans` signature unchanged.

- [ ] **Step 1a (MANDATORY — do NOT skip; the interface compiles WITHOUT it, but then every timing assertion silently reads `undefined`):** EXTEND the existing `RecordingTracer` in `work-unit-spans.test.ts` to capture the new fields. Concretely: `import type { SpanStartOptions } from "./tracing.js";`; add `kind?: number; startTimeMs?: number; endTimeMs?: number` to its `RecordedSpan` interface; change its `startSpan` to the 4-arg signature `startSpan(name, attributes?, parent?, options?: SpanStartOptions)` and set `rec.kind = options?.kind; rec.startTimeMs = options?.startTime;`; change the returned span's `end` to `end: (endTime?: number) => { rec.ended = true; rec.endTimeMs = endTime; }`. Leave all existing recorded fields + assertions intact (additive change; reviewer B confirmed it's non-breaking).

- [ ] **Step 1b: Write the failing tests** — APPEND:

```ts
describe("projectWorkUnitSpans — honest timing + SpanKind (E4c)", () => {
  const T0 = 1_700_000_000_000;

  it("work-unit span carries REAL requestedAt/completedAt times + INTERNAL kind", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: {
          workUnitId: "wu_1",
          requestedAtMs: T0,
          completedAtMs: T0 + 120,
          durationMs: 120,
        },
        executions: [],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.startTimeMs).toBe(T0);
    expect(root.endTimeMs).toBe(T0 + 120);
    expect(root.kind).toBe(0); // INTERNAL
    expect("switchboard.timing.synthetic" in root.attributes).toBe(false); // real, not marked
  });

  it("work-unit end falls back to requestedAt + durationMs when completedAt is absent", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      { workUnit: { workUnitId: "wu_1", requestedAtMs: T0, durationMs: 90 }, executions: [] },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect(root.endTimeMs).toBe(T0 + 90);
  });

  it("execution span: end = createdAt, start = createdAt - durationMs, CLIENT kind, marked synthetic", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1", requestedAtMs: T0 },
        executions: [{ skillSlug: "alex", createdAtMs: T0 + 100, durationMs: 40, toolCalls: [] }],
      },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.startTimeMs).toBe(T0 + 60);
    expect(exec.endTimeMs).toBe(T0 + 100);
    expect(exec.kind).toBe(2); // CLIENT
    expect(exec.attributes["switchboard.timing.synthetic"]).toBe(true);
  });

  it("tool spans pack sequentially within the exec window, INTERNAL kind, marked synthetic", () => {
    const tracer = new RecordingTracer();
    const tool = (toolId: string, durationMs: number) => ({
      toolId,
      operation: "op",
      params: {},
      result: { status: "success" as const },
      durationMs,
      governanceDecision: "auto-approved" as const,
    });
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [
          {
            createdAtMs: T0 + 100,
            durationMs: 50,
            toolCalls: [tool("book", 10), tool("notify", 15)],
          },
        ],
      },
      tracer,
    );
    // execStart = (T0+100) - 50 = T0+50
    const t0 = tracer.spans.find((s) => s.name === "execute_tool book")!;
    const t1 = tracer.spans.find((s) => s.name === "execute_tool notify")!;
    expect(t0.startTimeMs).toBe(T0 + 50);
    expect(t0.endTimeMs).toBe(T0 + 60);
    expect(t1.startTimeMs).toBe(T0 + 60);
    expect(t1.endTimeMs).toBe(T0 + 75);
    expect(t0.kind).toBe(0);
    expect(t0.attributes["switchboard.timing.synthetic"]).toBe(true);
    expect(t1.attributes["switchboard.timing.synthetic"]).toBe(true);
  });

  it("degrades to no explicit times (E4b flat) when anchors are missing — structure preserved", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [{ skillSlug: "a", durationMs: 10, toolCalls: [] }],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(root.startTimeMs).toBeUndefined();
    expect(exec.startTimeMs).toBeUndefined();
    expect("switchboard.timing.synthetic" in exec.attributes).toBe(false); // nothing synthesized -> not marked
    expect(tracer.spans.every((s) => s.ended)).toBe(true);
  });

  it("guards the root work_unit.id with setIfString (empty id -> attribute absent)", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans({ workUnit: { workUnitId: "" }, executions: [] }, tracer);
    const root = tracer.spans.find((s) => s.parentId === null)!;
    expect("switchboard.work_unit.id" in root.attributes).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts`
      Expected: FAIL — startTimeMs/endTimeMs/kind undefined; `switchboard.timing.synthetic` absent; root id still set for empty string.

- [ ] **Step 3: Implement** — edit `work-unit-spans.ts`:
  - Extend the interfaces: `WorkUnitSpanParent` add `requestedAtMs?: number;` and `completedAtMs?: number;`. `WorkUnitExecution` add `createdAtMs?: number;`.
  - Add helper + kind constant near the other helpers:

```ts
/** Mirrors @opentelemetry/api SpanKind numeric values (stable wire-level constants; lets core stay OTel-free). */
const SPAN_KIND = { INTERNAL: 0, CLIENT: 2 } as const;

function finiteOrUndef(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
```

- Rewrite `projectWorkUnitSpans` (timing + kind + the `setIfString` root-id guard; cache/provider land in Task 3):

```ts
export function projectWorkUnitSpans(input: WorkUnitSpanInput, tracer: Tracer): void {
  const wu = input.workUnit;

  const rootStartMs = finiteOrUndef(wu.requestedAtMs);
  const wuDuration = finiteOrUndef(wu.durationMs);
  const rootEndMs =
    finiteOrUndef(wu.completedAtMs) ??
    (rootStartMs !== undefined && wuDuration !== undefined ? rootStartMs + wuDuration : undefined);

  const root = tracer.startSpan("invoke_agent", undefined, undefined, {
    startTime: rootStartMs,
    kind: SPAN_KIND.INTERNAL,
  });
  root.setAttribute("gen_ai.system", "switchboard");
  root.setAttribute("gen_ai.operation.name", "invoke_agent");
  setIfString(root, "switchboard.work_unit.id", wu.workUnitId);
  setIfString(root, "switchboard.organization.id", wu.organizationId);
  setIfString(root, "switchboard.deployment.id", wu.deploymentId);
  setIfString(root, "switchboard.intent", wu.intent);
  setIfString(root, "switchboard.governance.outcome", wu.governanceOutcome);
  setIfString(root, "switchboard.work.outcome", wu.outcome);
  setIfFinite(root, "switchboard.risk_score", wu.riskScore);
  setIfFinite(root, "switchboard.duration_ms", wu.durationMs);
  root.setStatus(workUnitStatus(wu));

  for (const execution of input.executions) {
    const execEndMs = finiteOrUndef(execution.createdAtMs);
    const execDuration = finiteOrUndef(execution.durationMs);
    const execStartMs =
      execEndMs !== undefined && execDuration !== undefined ? execEndMs - execDuration : undefined;

    const execSpan = tracer.startSpan(`chat ${execution.skillSlug ?? "skill"}`, undefined, root, {
      startTime: execStartMs,
      kind: SPAN_KIND.CLIENT,
    });
    execSpan.setAttribute("gen_ai.system", "switchboard");
    execSpan.setAttribute("gen_ai.operation.name", "chat");
    setIfString(execSpan, "gen_ai.request.model", execution.model);
    setIfFinite(execSpan, "gen_ai.usage.input_tokens", execution.inputTokens);
    setIfFinite(execSpan, "gen_ai.usage.output_tokens", execution.outputTokens);
    setIfString(execSpan, "switchboard.skill.slug", execution.skillSlug);
    setIfString(execSpan, "switchboard.skill.version", execution.skillVersion);
    setIfString(execSpan, "switchboard.session.id", execution.sessionId);
    setIfString(execSpan, "switchboard.execution.status", execution.status);
    setIfFinite(execSpan, "switchboard.turn_count", execution.turnCount);
    setIfFinite(execSpan, "switchboard.duration_ms", execution.durationMs);
    if (execStartMs !== undefined) execSpan.setAttribute("switchboard.timing.synthetic", true);
    execSpan.setStatus(executionStatus(execution.status));

    let cursorMs = execStartMs;
    for (const call of execution.toolCalls) {
      cursorMs = emitToolSpan(call, execSpan, tracer, cursorMs);
    }

    execSpan.end(execEndMs);
  }

  root.end(rootEndMs);
}
```

- Rewrite `emitToolSpan` to take + return the cursor and emit timing (keep the existing attribute/status/privacy logic verbatim — only the signature, the two `startSpan` options args, the synthetic mark, and the `end(...)`/return change):

```ts
function emitToolSpan(
  call: unknown,
  execSpan: Span,
  tracer: Tracer,
  cursorMs: number | undefined,
): number | undefined {
  if (call === null || typeof call !== "object") {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan, {
      startTime: cursorMs,
      kind: SPAN_KIND.INTERNAL,
    });
    s.setAttribute("switchboard.tool.malformed", true);
    s.end(cursorMs);
    return cursorMs;
  }
  const rec = call as Record<string, unknown>;
  const toolId = rec["toolId"];
  if (typeof toolId !== "string") {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan, {
      startTime: cursorMs,
      kind: SPAN_KIND.INTERNAL,
    });
    s.setAttribute("switchboard.tool.malformed", true);
    s.end(cursorMs);
    return cursorMs;
  }

  const dur = finiteOrUndef(rec["durationMs"]) ?? 0;
  const toolEndMs = cursorMs !== undefined ? cursorMs + dur : undefined;

  const toolSpan = tracer.startSpan(`execute_tool ${toolId}`, undefined, execSpan, {
    startTime: cursorMs,
    kind: SPAN_KIND.INTERNAL,
  });
  toolSpan.setAttribute("gen_ai.operation.name", "execute_tool");
  toolSpan.setAttribute("gen_ai.tool.name", toolId);
  setIfString(toolSpan, "switchboard.tool.operation", rec["operation"]);
  const result = rec["result"];
  const resultStatus =
    result !== null && typeof result === "object"
      ? (result as Record<string, unknown>)["status"]
      : undefined;
  setIfString(toolSpan, "switchboard.tool.result_status", resultStatus);
  if (result !== null && typeof result === "object") {
    const resultRec = result as Record<string, unknown>;
    const errObj = resultRec["error"];
    if (errObj !== null && typeof errObj === "object") {
      setIfString(
        toolSpan,
        "switchboard.tool.error_code",
        (errObj as Record<string, unknown>)["code"],
      );
    }
  }
  setIfString(toolSpan, "switchboard.governance.decision", rec["governanceDecision"]);
  setIfFinite(toolSpan, "switchboard.tool.duration_ms", rec["durationMs"]);
  const params = rec["params"];
  toolSpan.setAttribute("switchboard.tool.params_present", params !== undefined && params !== null);
  if (cursorMs !== undefined) toolSpan.setAttribute("switchboard.timing.synthetic", true);
  toolSpan.setStatus(toolStatus(resultStatus, rec["governanceDecision"]));
  toolSpan.end(toolEndMs);
  return toolEndMs;
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts` -> PASS (new block + ALL existing E4b tests: structure/attrs/status/privacy/NaN/malformed/read-only).

- [ ] **Step 5: Full core test + typecheck** — `pnpm --filter @switchboard/core test && pnpm --filter @switchboard/core typecheck` -> PASS (no regression in the core suite).

- [ ] **Step 6: Commit** — `git add packages/core/src/telemetry/work-unit-spans.ts packages/core/src/telemetry/work-unit-spans.test.ts && git commit -m "feat(core): synthesize honest span timing and SpanKind in the work-unit projection"`

---

### Task 3: Cache/cost + provider attributes + barrel re-export of OTelContextBridge

**Files:**

- Modify: `packages/core/src/telemetry/work-unit-spans.ts`
- Modify: `packages/core/src/telemetry/work-unit-spans.test.ts` (APPEND)
- Modify: `packages/core/src/telemetry/index.ts`

**Interfaces:**

- Produces (extends): `WorkUnitExecution` += `cacheReadTokens?: number; cacheCreationTokens?: number; costUsd?: number`. Barrel re-exports `OTelContextBridge` + `SpanStartOptions` types.

- [ ] **Step 1: Write the failing tests** — append to `work-unit-spans.test.ts`:

```ts
import type { OTelContextBridge, SpanStartOptions } from "./index.js";

describe("projectWorkUnitSpans — cache/cost + provider attributes (E4c)", () => {
  it("maps cache token + cost attributes on the execution span", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [
          {
            skillSlug: "alex",
            model: "claude-opus-4-6",
            cacheReadTokens: 900,
            cacheCreationTokens: 100,
            costUsd: 0.012,
            toolCalls: [],
          },
        ],
      },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect(exec.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(900);
    expect(exec.attributes["gen_ai.usage.cache_creation_input_tokens"]).toBe(100);
    expect(exec.attributes["switchboard.cost_usd"]).toBe(0.012);
    expect(exec.attributes["gen_ai.provider.name"]).toBe("anthropic");
  });

  it("omits gen_ai.provider.name when the model is not a Claude model", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      { workUnit: { workUnitId: "wu_1" }, executions: [{ model: "gpt-4o", toolCalls: [] }] },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    expect("gen_ai.provider.name" in exec.attributes).toBe(false);
  });
});

describe("telemetry barrel (E4c)", () => {
  it("re-exports OTelContextBridge + SpanStartOptions types", () => {
    const bridge: OTelContextBridge = { active: () => null, with: (_c, _s) => null };
    const opts: SpanStartOptions = { startTime: 1, kind: 0 };
    expect(typeof bridge.active).toBe("function");
    expect(opts.kind).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts`
      Expected: FAIL — cache/cost/provider attrs absent; the `./index.js` type import fails to resolve `OTelContextBridge`/`SpanStartOptions` (barrel does not re-export them).

- [ ] **Step 3: Implement**
  - `work-unit-spans.ts`: add the type fields to `WorkUnitExecution`: `cacheReadTokens?: number; cacheCreationTokens?: number; costUsd?: number;`. Add the helper:

```ts
function providerForModel(model: unknown): string | undefined {
  return typeof model === "string" && model.toLowerCase().includes("claude")
    ? "anthropic"
    : undefined;
}
```

- Insert into the execution-span block (right after the `gen_ai.request.model` line):

```ts
setIfString(execSpan, "gen_ai.provider.name", providerForModel(execution.model));
setIfFinite(execSpan, "gen_ai.usage.cache_read_input_tokens", execution.cacheReadTokens);
setIfFinite(execSpan, "gen_ai.usage.cache_creation_input_tokens", execution.cacheCreationTokens);
setIfFinite(execSpan, "switchboard.cost_usd", execution.costUsd);
```

- `index.ts`: extend the type re-export line. Change `export type { Tracer, Span } from "./tracing.js";` to:

```ts
export type { Tracer, Span, OTelContextBridge, SpanStartOptions } from "./tracing.js";
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @switchboard/core test -- work-unit-spans.test.ts && pnpm --filter @switchboard/core typecheck` -> PASS.

- [ ] **Step 5: Commit** — `git add packages/core/src/telemetry/work-unit-spans.ts packages/core/src/telemetry/work-unit-spans.test.ts packages/core/src/telemetry/index.ts && git commit -m "feat(core): add cache/cost + provider span attributes and re-export OTelContextBridge"`

---

### Task 4: Apps mapper — lift timestamps + cache/cost + producer->consumer seam timing test

**Files:**

- Modify: `apps/api/src/telemetry/work-unit-span-export.ts`
- Modify: `apps/api/src/telemetry/__tests__/work-unit-span-export.test.ts` (extend the seam RecordingTracer to capture timing + APPEND)

**Interfaces:**

- Produces (extends): `ExecutionTraceRow` += `createdAt?: Date | string` and widened `tokenUsage`; `WorkTraceSummary` + `WorkTraceReadLike.trace` += `requestedAt?/executionStartedAt?/completedAt?: string`. `mapExecutionTracesToSpanInput` now lifts timestamps + cache/cost.

- [ ] **Step 1a (MANDATORY):** extend the apps test file's `RecordingTracer` to capture timing: change `startSpan` to the 4-arg form `startSpan(name, attributes?, parent?, options?: SpanStartOptions)` (import the type from `@switchboard/core`), record `startTimeMs = options?.startTime` + `kind = options?.kind` on the recorded span, and capture `endTimeMs` via `end: (endTime?: number) => { ... }`. (Reviewer B confirmed the current apps `RecordingTracer` is 3-arg with `setStatus:()=>{}` + `end:()=>{}` and `attributes: Record<string, unknown>`, so this is additive.)

- [ ] **Step 1b: Write the failing tests** — APPEND:

```ts
describe("mapExecutionTracesToSpanInput — timing + cache/cost lift (E4c)", () => {
  it("lifts createdAt -> createdAtMs and cache/cost from tokenUsage", () => {
    const createdAt = new Date(1_700_000_000_100);
    const input = mapExecutionTracesToSpanInput("wu_1", [
      row({
        createdAt,
        tokenUsage: {
          input: 100,
          output: 50,
          cacheRead: 900,
          cacheCreation: 100,
          costUsd: 0.01,
          model: "claude-opus-4-6",
        },
      }),
    ]);
    expect(input.executions[0]!.createdAtMs).toBe(1_700_000_000_100);
    expect(input.executions[0]!.cacheReadTokens).toBe(900);
    expect(input.executions[0]!.cacheCreationTokens).toBe(100);
    expect(input.executions[0]!.costUsd).toBe(0.01);
  });

  it("lifts WorkTrace ISO timestamps -> epoch-ms on the work-unit", () => {
    const input = mapExecutionTracesToSpanInput("wu_1", [row()], {
      requestedAt: "2023-11-14T22:13:20.000Z", // = 1_700_000_000_000
      completedAt: "2023-11-14T22:13:20.120Z", // = 1_700_000_000_120
    });
    expect(input.workUnit.requestedAtMs).toBe(1_700_000_000_000);
    expect(input.workUnit.completedAtMs).toBe(1_700_000_000_120);
  });
});

describe("seam: realistic store rows -> mapper -> projection carry REAL timing (E4c)", () => {
  it("root span gets real requestedAt/completedAt; execution span gets derived synthetic timing + cache attrs", () => {
    return import("@switchboard/core").then(({ projectWorkUnitSpans }) => {
      const tracer = new RecordingTracer();
      const input = mapExecutionTracesToSpanInput(
        "wu_1",
        [
          row({
            createdAt: new Date(1_700_000_000_100),
            durationMs: 40,
            tokenUsage: { input: 1, output: 1, cacheRead: 7, model: "claude-opus-4-6" },
          }),
        ],
        { requestedAt: "2023-11-14T22:13:20.000Z", completedAt: "2023-11-14T22:13:20.120Z" },
      );
      projectWorkUnitSpans(input, tracer);
      const root = tracer.spans.find((s) => s.parentId === null)!;
      const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
      expect(root.startTimeMs).toBe(1_700_000_000_000);
      expect(root.endTimeMs).toBe(1_700_000_000_120);
      expect(exec.endTimeMs).toBe(1_700_000_000_100);
      expect(exec.startTimeMs).toBe(1_700_000_000_060); // createdAt - durationMs
      expect(exec.attributes["switchboard.timing.synthetic"]).toBe(true);
      expect(exec.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(7);
    });
  });
});
```

NOTE: ensure the test's `row(...)` helper passes through `createdAt`/widened `tokenUsage` overrides (it already spreads `...overrides`). If the existing seam `RecordingTracer` lacks `setStatus`/`end(endTime)`, extend it.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @switchboard/api test -- work-unit-span-export.test.ts`
      Expected: FAIL — `createdAtMs`/cache fields undefined; `requestedAtMs`/`completedAtMs` undefined; seam timing assertions fail.

- [ ] **Step 3: Implement** — edit `work-unit-span-export.ts`:
  - `ExecutionTraceRow`: add `createdAt?: Date | string;` and widen `tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number; costUsd?: number; model?: string };`.
  - `WorkTraceSummary`: add `requestedAt?: string; completedAt?: string;` (NOT executionStartedAt — unused by the timing model; YAGNI).
  - `WorkTraceReadLike.trace`: add `requestedAt?: string; completedAt?: string;` (the REAL WorkTrace is a superset, so it stays assignable).
  - Add the converter (module-scope):

```ts
/** ISO string or Date -> epoch milliseconds; undefined when unparseable. */
function toEpochMs(value: Date | string | undefined): number | undefined {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}
```

- In `mapExecutionTracesToSpanInput`, extend the per-execution map object with:

```ts
    createdAtMs: toEpochMs(t.createdAt),
    cacheReadTokens: t.tokenUsage?.cacheRead,
    cacheCreationTokens: t.tokenUsage?.cacheCreation,
    costUsd: t.tokenUsage?.costUsd,
```

- and the `workUnit` object with:

```ts
    requestedAtMs: toEpochMs(workTrace?.requestedAt),
    completedAtMs: toEpochMs(workTrace?.completedAt),
```

- In `exportWorkUnitSpans`, inside the tenant-guard block, add the three timestamp fields to the `workTrace = { ... }` summary it builds:

```ts
      requestedAt: wt.trace.requestedAt,
      completedAt: wt.trace.completedAt,
```

- [ ] **Step 4: REBUILD CORE then run the apps test (do NOT skip the build).** The seam test does `import("@switchboard/core")`, which resolves to `packages/core/dist` (the package `main`), NOT src — and `pnpm --filter @switchboard/api test` does NOT trigger turbo's `^build`. So the new `projectWorkUnitSpans` timing/cache code (T2/T3, in core src) is absent from dist until rebuilt; against stale dist the seam timing/cache assertions stay RED (the "import resolves to stale dist" trap, plan-grade CRITICAL). Run:
      `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/api test -- work-unit-span-export.test.ts` -> PASS (new blocks + existing flag-gate/enrichment/tenant-mismatch tests).
      (The pure mapper tests pass without the core build; only the cross-package SEAM test needs the fresh core dist.)

- [ ] **Step 5: Typecheck api** — `pnpm --filter @switchboard/api typecheck` -> clean.

- [ ] **Step 6: Commit** — `git add apps/api/src/telemetry/work-unit-span-export.ts apps/api/src/telemetry/__tests__/work-unit-span-export.test.ts && git commit -m "feat(api): lift work-unit/execution timestamps and cache/cost into the span mapper"`

---

## Self-review

- **Spec coverage:** timing+SpanKind (E4c follow-up 1) = T1+T2; cache/cost attrs (follow-up 2) = T3+T4; root-id setIfString guard + barrel OTelContextBridge re-export (follow-up 3) = T2+T3. Provider attr = T3. All decomposition E4c [AUTO] items covered. Live trigger + new env var = Slice 2 (SURFACE), deliberately NOT here.
- **No new env var, no schema, no governance/send/auth/route edit** -> no merge-stop glob (re-verify at VERIFY with `git diff origin/main...HEAD --name-only`).
- **Type consistency:** `SpanStartOptions` (T1) consumed by T2/T3; `WorkUnitSpanParent.requestedAtMs/completedAtMs` + `WorkUnitExecution.createdAtMs` (T2) produced by the mapper (T4); `WorkUnitExecution.cacheReadTokens/cacheCreationTokens/costUsd` (T3) produced by the mapper (T4). `projectWorkUnitSpans` signature stable. epoch-ms numbers throughout; adapter is the only HrTime converter.
- **Honesty (reviewer will check):** work-unit = REAL `requestedAt`/`completedAt`; execution start = `createdAt - durationMs` (derived) + END = real `createdAt`, marked `synthetic`; tools = packed sequentially, marked `synthetic`; missing anchors -> no explicit time (degrade, never fabricate). The synthetic marker is the honesty signal.
- **Seam pin (feedback_per_slice_review_misses_cross_slice_seams + producer-population):** T4's seam test drives timing from REALISTIC `findByWorkUnitId`/WorkTrace row shapes through the mapper into the projection, not a hand-built core input — proving the producer (store row) -> consumer (projection) timestamp contract end-to-end.
- **Deferred (documented, not built here):** the live trigger (route/callback) + a real OTLP export + any dedicated enable-flag = Slice 2 (SURFACE).
