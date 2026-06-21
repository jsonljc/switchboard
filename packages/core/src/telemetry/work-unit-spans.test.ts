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
