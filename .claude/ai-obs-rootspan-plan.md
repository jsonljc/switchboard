# Slice 1 plan — root-only work-unit span for non-executing legs (TDD, [AUTO])

Telemetry-only follow-up to the #1236 review's documented limitation: the exporter's
`traces.length === 0` early-return means deny / require_approval / governance-error work units
(a WorkTrace but zero ExecutionTrace rows) render no span. Fix the exporter so those legs render a
root-only span. ONE file + its test: `apps/api/src/telemetry/work-unit-span-export.ts`.

## Acceptance criteria

- AC1 (unchanged): tracing gated OFF (`OTEL_EXPORTER_OTLP_ENDPOINT` unset) -> no store read, no projection.
- AC2 (the fix): zero execution rows + a tenant-matched WorkTrace -> `projectWorkUnitSpans` called once
  with `executions: []` -> exactly ONE root span carrying the WorkTrace enrichment (governanceOutcome /
  intent / outcome / risk / duration / org / work_unit.id); zero exec/tool children.
- AC3: zero execution rows + no WorkTrace (store returns null) -> no-op (no projection).
- AC4: zero execution rows + a cross-tenant WorkTrace (org mismatch) -> no-op (no bare root, no leak).
- AC5 (regression): execution rows present -> unchanged full waterfall + enrichment (existing tests stay green).
- AC6 (safety): read-only + never throws/blocks (unchanged: the hook's `.catch` swallows; no new throw path).

## VERIFY-FIRST (confirmed, work-unit-spans.ts:112-204)

`projectWorkUnitSpans({workUnit, executions: []}, tracer)` emits a valid root-only span: the root is
created at :128 BEFORE the `for (execRaw of executions)` loop at :148, the empty loop is skipped, and
`root.end()` at :203 closes it. `deriveWorkUnitProvider([])` returns undefined -> no `gen_ai.provider.name`
on a no-model root (correct). No core change needed — slice 1 is apps/api only.

## TDD step 1 (RED -> GREEN)

RED: append the new describe block below to `__tests__/work-unit-span-export.test.ts` and run
`pnpm --filter @switchboard/api test -- work-unit-span-export`. The first test ("renders exactly one
root span ...") FAILS with `roots` length 0 because the exporter early-returns on zero traces. (Tests 2
and 3 are guard tests: they pass both before AND after the fix — they pin that the no-op conditions are
preserved.)

GREEN: apply the exporter restructure below; re-run -> all green; existing tests stay green.

### New tests (append; reuse existing `RecordingTracer`, `setTracer`/`getTracer` imports)

```ts
describe("exportWorkUnitSpans — root-only span for non-executing legs (deny/approval/gov-error)", () => {
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

  it("renders exactly one root span (no exec/tool children) from the WorkTrace when there are zero execution rows", async () => {
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost:4318";
    const tracer = new RecordingTracer();
    setTracer(tracer);
    const findByWorkUnitId = vi.fn(async () => []); // deny/approval/gov-error: WorkTrace but 0 exec rows
    const getByWorkUnitId = vi.fn(async () => ({
      trace: {
        organizationId: "org_1",
        intent: "book_appt",
        governanceOutcome: "deny",
        outcome: "denied",
        riskScore: 0.9,
        durationMs: 12,
      },
    }));
    await exportWorkUnitSpans(
      { executionTraceStore: { findByWorkUnitId }, workTraceStore: { getByWorkUnitId } },
      "org_1",
      "wu_1",
    );
    const roots = tracer.spans.filter((s) => s.parentId === null);
    expect(roots).toHaveLength(1); // RED before fix: 0 (early-return on zero traces)
    expect(tracer.spans).toHaveLength(1); // root only — no exec/tool spans
    expect(roots[0]!.attributes["switchboard.governance.outcome"]).toBe("deny");
    expect(roots[0]!.attributes["switchboard.intent"]).toBe("book_appt");
    expect(roots[0]!.attributes["switchboard.work_unit.id"]).toBe("wu_1");
  });

  it("is a no-op when there are zero execution rows AND no WorkTrace (store returns null)", async () => {
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost:4318";
    const tracer = new RecordingTracer();
    setTracer(tracer);
    const findByWorkUnitId = vi.fn(async () => []);
    const getByWorkUnitId = vi.fn(async () => null);
    await exportWorkUnitSpans(
      { executionTraceStore: { findByWorkUnitId }, workTraceStore: { getByWorkUnitId } },
      "org_1",
      "wu_1",
    );
    expect(tracer.spans).toHaveLength(0);
  });

  it("is a no-op when zero execution rows + a cross-tenant WorkTrace (no bare root, no leak)", async () => {
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost:4318";
    const tracer = new RecordingTracer();
    setTracer(tracer);
    const findByWorkUnitId = vi.fn(async () => []);
    const getByWorkUnitId = vi.fn(async () => ({
      trace: { organizationId: "OTHER_ORG", intent: "leak" },
    }));
    await exportWorkUnitSpans(
      { executionTraceStore: { findByWorkUnitId }, workTraceStore: { getByWorkUnitId } },
      "org_1",
      "wu_1",
    );
    expect(tracer.spans).toHaveLength(0); // tenant guard -> nothing rendered for this org
  });
});
```

### Exporter restructure (replace the body of `exportWorkUnitSpans`)

Replace the current early-return + post-fetch shape so the WorkTrace is fetched first (tenant-guarded),
and the no-op only fires when there is genuinely nothing to render:

```ts
export async function exportWorkUnitSpans(
  deps: WorkUnitSpanExportDeps,
  orgId: string,
  workUnitId: string,
): Promise<void> {
  if (!isWorkUnitTracingEnabled()) return;
  const traces = await deps.executionTraceStore.findByWorkUnitId(orgId, workUnitId);

  // Lift the (tenant-guarded) WorkTrace enrichment. Fetched even with zero execution rows so a
  // non-executing work unit (deny / require_approval / governance-error: a WorkTrace but no
  // ExecutionTrace rows) still renders a root-only span. getByWorkUnitId returns
  // WorkTraceReadResult = { trace, integrity }; enrichment fields live under .trace.
  let workTrace: WorkTraceSummary | undefined;
  const wt = await deps.workTraceStore?.getByWorkUnitId(workUnitId);
  // tenant guard: only enrich from a WorkTrace that belongs to the same org (no cross-tenant leak).
  if (wt && wt.trace.organizationId === orgId) {
    workTrace = {
      organizationId: wt.trace.organizationId,
      intent: wt.trace.intent,
      governanceOutcome: wt.trace.governanceOutcome,
      outcome: wt.trace.outcome,
      riskScore: wt.trace.riskScore,
      durationMs: wt.trace.durationMs,
      requestedAt: wt.trace.requestedAt,
      completedAt: wt.trace.completedAt,
    };
  }

  // Nothing to render: no execution rows AND no tenant-matched WorkTrace (true no-op).
  if (traces.length === 0 && !workTrace) return;

  // Zero traces + a WorkTrace -> a root-only span (governance outcome / status / org). With rows,
  // the full work-unit -> execution -> tool waterfall (unchanged).
  projectWorkUnitSpans(mapExecutionTracesToSpanInput(workUnitId, traces, workTrace), getTracer());
}
```

Behavior: gated-off -> return (no DB read). has-traces -> fetch wt + enrich + full waterfall (identical
to today). zero-traces + tenant wt -> root-only (the fix). zero-traces + null/cross-tenant wt -> no-op.

## VERIFY (full required gate suite, fresh-context)

typecheck; `pnpm test` + `--filter @switchboard/api test`; lint; format:check; arch:check;
`CI=1 npx tsx scripts/local-verify-fast.ts` (no new route/env debt expected); `pnpm build` (apps changed);
security (`pnpm audit --audit-level=high`). Then an INDEPENDENT fresh-context review (diff + criteria +
the load-bearing lessons): must confirm telemetry can't block/break the request or read path, one-direction
/ read-only preserved, the tenant guard still holds, the seam holds vs the real stores, core untouched.
DONE = all required gates green + every AC evidenced + review 0 sev>=warn -> [AUTO] merge clean.
