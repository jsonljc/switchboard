# E4c Slice 1.1 — projection hardening (post-merge review follow-ups)

> [AUTO] follow-up to PR #1220. Telemetry-only, no stop-glob. TDD: RED proof per fix. Lands the safety/correctness cluster from the 3-agent post-merge review BEFORE Slice 2 wires the live trigger. The real-SDK InMemorySpanExporter test + the gen_ai.system/provider semconv coherence are DEFERRED (planned separately).

**Principle for timing:** a span is either FULLY timed (both start AND end derivable) or FULLY flat (no explicit time). This prevents the real OTel SDK from substituting `Date.now()` for a missing end (start-without-end -> multi-month span) or a missing start (end-without-start -> inverted span). Plus the tree must be well-formed: a child span never starts before its parent nor ends after it.

## Files

- `packages/core/src/telemetry/work-unit-spans.ts` (+ `.test.ts`)
- `packages/core/src/telemetry/tracing.ts` (+ `.test.ts`)
- `apps/api/src/telemetry/work-unit-span-export.ts` (+ `__tests__/work-unit-span-export.test.ts`)

## Fix A — intrinsic throw-safety (work-unit-spans.ts)

`projectWorkUnitSpans` must never throw on degenerate input (the never-throw telemetry contract). `executions` / `toolCalls` are typed arrays but at runtime come from Prisma `Json` columns that can hold a non-array. Guard:

```ts
// in projectWorkUnitSpans, replace `for (const execution of input.executions)`:
const executions = Array.isArray(input.executions) ? input.executions : [];
for (const execution of executions) { ... }
// inside the loop, replace `for (const call of execution.toolCalls)`:
const toolCalls = Array.isArray(execution.toolCalls) ? execution.toolCalls : [];
let cursorMs = execStartMs;
for (const call of toolCalls) { cursorMs = emitToolSpan(call, execSpan, tracer, cursorMs, execEndMs); }
```

## Fix C — symmetric timing guard + Fix B geometry clamps (work-unit-spans.ts)

Rewrite the timing computation in `projectWorkUnitSpans`:

```ts
const wu = input.workUnit;
const rootStartRaw = finiteOrUndef(wu.requestedAtMs);
const wuDuration = finiteOrUndef(wu.durationMs);
const rootEndRaw =
  finiteOrUndef(wu.completedAtMs) ??
  (rootStartRaw !== undefined && wuDuration !== undefined ? rootStartRaw + wuDuration : undefined);
// symmetric: both or neither
const rootTimed = rootStartRaw !== undefined && rootEndRaw !== undefined;
const rootStartMs = rootTimed ? rootStartRaw : undefined;
const rootEndMs = rootTimed ? rootEndRaw : undefined;
const root = tracer.startSpan("invoke_agent", undefined, undefined, {
  startTime: rootStartMs,
  kind: SPAN_KIND.INTERNAL,
});
// ... attrs ... root.setStatus(...) ...
// per execution:
const execEndRaw = finiteOrUndef(execution.createdAtMs);
const execDuration = finiteOrUndef(execution.durationMs);
const execStartRaw =
  execEndRaw !== undefined && execDuration !== undefined ? execEndRaw - execDuration : undefined;
const execTimed = execStartRaw !== undefined && execEndRaw !== undefined; // symmetric
let execStartMs = execTimed ? execStartRaw : undefined;
const execEndMs = execTimed ? execEndRaw : undefined;
// Fix B: a child cannot start before its parent
if (execStartMs !== undefined && rootStartMs !== undefined && execStartMs < rootStartMs) {
  execStartMs = rootStartMs;
}
const execSpan = tracer.startSpan(`chat ${execution.skillSlug ?? "skill"}`, undefined, root, {
  startTime: execStartMs,
  kind: SPAN_KIND.CLIENT,
});
// ... attrs ... if (execStartMs !== undefined) execSpan.setAttribute("switchboard.timing.synthetic", true);
// ... tools ... execSpan.end(execEndMs);
// root.end(rootEndMs);
```

`emitToolSpan(call, execSpan, tracer, cursorMs, execEndMs)` — clamp tool start+end into `[.., execEndMs]`, advance cursor by REAL dur:

```ts
function emitToolSpan(call, execSpan, tracer, cursorMs, execEndMs): number | undefined {
  const timed = cursorMs !== undefined && execEndMs !== undefined;
  const clampStart = timed ? Math.min(cursorMs!, execEndMs!) : undefined;
  // malformed paths: zero-width clamped span, cursor unchanged
  if (call === null || typeof call !== "object") {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan, {
      startTime: clampStart,
      kind: SPAN_KIND.INTERNAL,
    });
    s.setAttribute("switchboard.tool.malformed", true);
    s.end(clampStart);
    return cursorMs;
  }
  const rec = call as Record<string, unknown>;
  const toolId = rec["toolId"];
  if (typeof toolId !== "string") {
    const s = tracer.startSpan("execute_tool <malformed>", undefined, execSpan, {
      startTime: clampStart,
      kind: SPAN_KIND.INTERNAL,
    });
    s.setAttribute("switchboard.tool.malformed", true);
    s.end(clampStart);
    return cursorMs;
  }
  const dur = finiteOrUndef(rec["durationMs"]) ?? 0;
  const toolStartMs = clampStart;
  const toolEndMs = timed ? Math.min(cursorMs! + dur, execEndMs!) : undefined; // Fix B: never past parent end
  const toolSpan = tracer.startSpan(`execute_tool ${toolId}`, undefined, execSpan, {
    startTime: toolStartMs,
    kind: SPAN_KIND.INTERNAL,
  });
  // ... existing attrs (operation/result_status/error_code/governance.decision/duration_ms/params_present) ...
  if (toolStartMs !== undefined) toolSpan.setAttribute("switchboard.timing.synthetic", true);
  toolSpan.setStatus(toolStatus(resultStatus, rec["governanceDecision"]));
  toolSpan.end(toolEndMs);
  return timed ? cursorMs! + dur : cursorMs; // advance by REAL dur (ordering), not the clamped end
}
```

(Keep all existing tool attribute/status/privacy logic verbatim; only the signature, the clamped start/end, and the cursor advance change.)

## Fix D — toEpochMs numeric epoch (work-unit-span-export.ts)

```ts
function toEpochMs(value: Date | string | number | undefined): number | undefined {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}
```

Also widen `ExecutionTraceRow.createdAt?: Date | string | number;`.

## Fix E — epochMsToHrTime defensive (tracing.ts)

```ts
function epochMsToHrTime(epochMs: number): [number, number] {
  const ms = epochMs > 0 ? epochMs : 0; // a negative epoch is never valid
  const seconds = Math.trunc(ms / 1000);
  const nanos = Math.round((ms - seconds * 1000) * 1e6);
  // a fractional ms can round nanos up to 1e9 -> carry into seconds
  return nanos >= 1_000_000_000 ? [seconds + 1, nanos - 1_000_000_000] : [seconds, nanos];
}
```

## RED tests (write first, watch fail, then implement)

**tracing.test.ts** — append:

- "epochMsToHrTime clamps a negative epoch and never emits negative nanos": `createOTelTracer(fake).startSpan("x", undefined, undefined, { startTime: -500 })` -> assert the fake received `options.startTime` deep-equals `[0, 0]`.

**work-unit-spans.test.ts** — append (RecordingTracer already captures startTimeMs/endTimeMs/kind):

- "does not throw when executions is not an array": call with `{ workUnit: { workUnitId: "wu" }, executions: null } as any` -> `expect(() => ...).not.toThrow()`; exactly 1 span (root).
- "does not throw when toolCalls is a non-array": one execution with `toolCalls: { not: "an array" } as any` -> no throw; exec span present; 0 tool spans.
- "root degrades FULLY flat when end is underivable (symmetric)": `workUnit: { workUnitId: "wu", requestedAtMs: T0 }` (no completedAtMs, no durationMs) -> `root.startTimeMs` undefined AND `root.endTimeMs` undefined (NOT start-only).
- "execution degrades FULLY flat when durationMs absent (symmetric)": one execution `{ createdAtMs: T0+100, toolCalls: [] }` (no durationMs) -> `exec.startTimeMs` undefined AND `exec.endTimeMs` undefined.
- "tool end is clamped to the execution end (no child-exceeds-parent)": execution `{ createdAtMs: T0+100, durationMs: 30, toolCalls: [tool(25), tool(25)] }` -> execEnd = T0+100; second tool `endTimeMs` <= T0+100 (clamped), and every tool `startTimeMs`/`endTimeMs` within `[execStart, execEnd]`.
- "execution start is clamped to >= the root start (no child-precedes-parent)": `workUnit: { workUnitId:"wu", requestedAtMs: T0+90, durationMs: 100 }`, execution `{ createdAtMs: T0+100, durationMs: 80, toolCalls: [] }` (derived exec start = T0+20 < root start T0+90) -> `exec.startTimeMs` === T0+90 (clamped).

**work-unit-span-export.test.ts** — append:

- "mapper accepts a numeric epoch createdAt": `mapExecutionTracesToSpanInput("wu", [row({ createdAt: 1_700_000_000_100 })])` -> `executions[0].createdAtMs === 1_700_000_000_100`.

## Verify

`pnpm --filter @switchboard/core test` + `pnpm --filter @switchboard/core build && pnpm --filter @switchboard/api test` + `pnpm typecheck` + `pnpm lint && pnpm format:check && pnpm arch:check` + `CI=1 npx tsx scripts/local-verify-fast.ts` + `pnpm build` + `pnpm audit --audit-level=high`. All existing E4c tests must still pass.

## REVISE round 1 (independent review caught a real inversion bug my clamps introduced)

The geometry clamps (B) prevented child-escapes-parent but introduced `start > end` INVERSIONS on degenerate input: (1) exec-start clamped above its own end when `rootStartMs > execEndRaw`; (2) root clock-skew `completedAt < requestedAt`; (3) negative tool `durationMs`. Also the throw-safety (A) didn't narrow a null/non-object EXECUTION element. Fix:

**work-unit-spans.ts — add a pure timing helper (homes the inversion fix + cuts complexity):**

```ts
/**
 * Derive an honest [start,end] for a span: both set iff both anchors exist, the optional
 * parent-start clamp keeps the child from starting before its parent, AND the result is not
 * inverted. Any inconsistency (missing anchor, clock skew, clamp-induced inversion) degrades
 * to flat timing rather than emit a misleading/inverted span.
 */
function deriveSpanTiming(
  startRaw: number | undefined,
  endRaw: number | undefined,
  parentStartMs?: number,
): { startMs?: number; endMs?: number } {
  if (startRaw === undefined || endRaw === undefined) return {};
  let start = startRaw;
  if (parentStartMs !== undefined && start < parentStartMs) start = parentStartMs;
  if (start > endRaw) return {};
  return { startMs: start, endMs: endRaw };
}
```

- root: `const { startMs: rootStartMs, endMs: rootEndMs } = deriveSpanTiming(rootStartRaw, rootEndRaw);` (replaces the inline `rootTimed` block; clock skew -> flat).
- executions loop: type the guarded array `unknown[]` and narrow each element:

```ts
const executions: unknown[] = Array.isArray(input.executions) ? input.executions : [];
for (const execRaw of executions) {
  if (execRaw === null || typeof execRaw !== "object") continue; // null/non-object element -> skip (never throw)
  const execution = execRaw as WorkUnitExecution;
  const execEndRaw = finiteOrUndef(execution.createdAtMs);
  const execDuration = finiteOrUndef(execution.durationMs);
  const execStartRaw =
    execEndRaw !== undefined && execDuration !== undefined ? execEndRaw - execDuration : undefined;
  const { startMs: execStartMs, endMs: execEndMs } = deriveSpanTiming(
    execStartRaw,
    execEndRaw,
    rootStartMs,
  );
  // ... span + attrs ... if (execStartMs !== undefined) mark synthetic ...
  const toolCalls: unknown[] = Array.isArray(execution.toolCalls) ? execution.toolCalls : [];
  let cursorMs = execStartMs;
  for (const call of toolCalls)
    cursorMs = emitToolSpan(call, execSpan, tracer, cursorMs, execEndMs);
  execSpan.end(execEndMs);
}
```

- `emitToolSpan`: floor dur at 0 + DRY the malformed path (cuts complexity, kills tool inversion):

```ts
const dur = Math.max(0, finiteOrUndef(rec["durationMs"]) ?? 0); // negative dur would invert
// DRY the two malformed branches into one local `emitMalformed()` that emits a zero-width clamped span.
// toolStart = clampStart; toolEnd = min(cursor+dur, execEnd); dur>=0 so start<=end always.
```

**RED tests (work-unit-spans.test.ts) — add before implementing:**

- "root degrades flat on clock skew": `workUnit { requestedAtMs: T0+200, completedAtMs: T0+100 }` -> root.startTimeMs AND endTimeMs both undefined.
- "execution degrades flat when its window ends before the root start": `workUnit { requestedAtMs: T0+200, durationMs: 50 }`, exec `{ createdAtMs: T0+150, durationMs: 80, toolCalls: [] }` -> exec.startTimeMs AND endTimeMs both undefined (clamp would invert).
- "tool with negative durationMs never inverts": exec `{ createdAtMs: T0+100, durationMs: 50, toolCalls: [tool(-30)] }` -> tool.startTimeMs === tool.endTimeMs === T0+50 (dur floored to 0), and `tool.startTimeMs <= tool.endTimeMs`.
- "null execution element does not throw and is skipped": `executions: [null, {createdAtMs:T0+100,durationMs:10,toolCalls:[]}] as any` -> no throw; exactly 1 chat span.
- "no emitted span is inverted": across the above inputs, assert every recorded span has `startTimeMs === undefined || endTimeMs === undefined || startTimeMs <= endTimeMs`.
  Keep ALL prior hardening + E4c tests green (the existing "clamp exec start to root start" GREEN test still holds: T0+20 clamps to T0+90 which is <= execEnd T0+100, so still timed).

## Deferred (PLAN, not in this PR) -> see backlog

- Real-SDK `InMemorySpanExporter` test pinning the adapter->SDK leg (needs adding `@opentelemetry/sdk-trace-base` as a dep; do it with Slice 2's real-collector validation).
- `gen_ai.system="switchboard"` (E4b) vs `gen_ai.provider.name="anthropic"` (E4c) semconv coherence (same concept, two keys) -> a deliberate semconv pass, ideally with Slice 2 before dashboards depend on it.
