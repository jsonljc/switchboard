import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  setTracer,
  getTracer,
  type Span,
  type Tracer,
  type SpanStartOptions,
} from "@switchboard/core";
import {
  mapExecutionTracesToSpanInput,
  exportWorkUnitSpans,
  isWorkUnitTracingEnabled,
  buildWorkUnitSpanExportHook,
} from "../work-unit-span-export.js";

// minimal recording tracer (mirrors the core test double)
class RecordingTracer implements Tracer {
  spans: Array<{
    id: number;
    name: string;
    attributes: Record<string, unknown>;
    parentId: number | null;
    startTimeMs?: number;
    endTimeMs?: number;
    kind?: number;
    ended: boolean;
  }> = [];
  private m = new WeakMap<Span, number>();
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
    options?: SpanStartOptions,
  ): Span {
    const id = this.spans.length;
    this.spans.push({
      id,
      name,
      attributes: { ...(attributes ?? {}) },
      parentId: parent ? (this.m.get(parent) ?? null) : null,
      startTimeMs: options?.startTime,
      kind: options?.kind,
      ended: false,
    });
    const span: Span = {
      setAttribute: (k, v) => {
        this.spans[id]!.attributes[k] = v;
      },
      setStatus: () => {},
      end: (endTime?: number) => {
        this.spans[id]!.ended = true;
        this.spans[id]!.endTimeMs = endTime;
      },
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

describe("mapExecutionTracesToSpanInput — numeric epoch createdAt (E4c-hardening)", () => {
  it("mapper accepts a numeric epoch createdAt", () => {
    const numericEpoch = 1_700_000_000_100;
    const input = mapExecutionTracesToSpanInput("wu", [row({ createdAt: numericEpoch })]);
    expect(input.executions[0]!.createdAtMs).toBe(numericEpoch);
  });
});

describe("buildWorkUnitSpanExportHook — fire-and-forget, error-swallowing hook (E4c slice C)", () => {
  const OLD = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  afterEach(() => {
    vi.unstubAllEnvs();
    if (OLD === undefined) delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
    else process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = OLD;
  });

  it("returns a function that invokes the export path so the store is read with (orgId, workUnitId)", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const findByWorkUnitId = vi.fn().mockResolvedValue([]);
    const getByWorkUnitId = vi.fn().mockResolvedValue(null);
    const hook = buildWorkUnitSpanExportHook({
      executionTraceStore: { findByWorkUnitId },
      workTraceStore: { getByWorkUnitId },
    });
    expect(typeof hook).toBe("function");

    hook({ organizationId: "org_1", workUnitId: "wu_1" });

    await vi.waitFor(() => {
      expect(findByWorkUnitId).toHaveBeenCalledWith("org_1", "wu_1");
    });
  });

  it("does NOT read the store when tracing is gated OFF (endpoint unset)", async () => {
    delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
    expect(isWorkUnitTracingEnabled()).toBe(false);
    const findByWorkUnitId = vi.fn().mockResolvedValue([]);
    const hook = buildWorkUnitSpanExportHook({
      executionTraceStore: { findByWorkUnitId },
    });

    hook({ organizationId: "org_1", workUnitId: "wu_1" });

    // Give any (incorrectly) un-gated async leg a tick to fire, then assert it didn't.
    await Promise.resolve();
    expect(findByWorkUnitId).not.toHaveBeenCalled();
  });

  it("swallows a rejecting exporter: the hook returns void synchronously, never throws", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const findByWorkUnitId = vi.fn().mockRejectedValue(new Error("store down"));
    const hook = buildWorkUnitSpanExportHook({
      executionTraceStore: { findByWorkUnitId },
    });

    // Calling the hook must not throw despite the rejecting store.
    expect(() => hook({ organizationId: "org_1", workUnitId: "wu_1" })).not.toThrow();

    // The rejection is swallowed by the hook's .catch (logged, no unhandled rejection).
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        "[work-unit-span-export] span export failed for work unit",
        "wu_1",
        expect.anything(),
      );
    });
    warnSpy.mockRestore();
  });

  it("compile-time seam: the hook return type is assignable to the PlatformIngressConfig hook shape", () => {
    const _pin: (info: { organizationId: string; workUnitId: string }) => void =
      buildWorkUnitSpanExportHook({
        executionTraceStore: { findByWorkUnitId: vi.fn().mockResolvedValue([]) },
      });
    expect(typeof _pin).toBe("function");
  });
});
