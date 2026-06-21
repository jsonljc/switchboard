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
