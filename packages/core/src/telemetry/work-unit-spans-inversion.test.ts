/**
 * REVISE round 1 — inversion bug fixes for work-unit span projection.
 *
 * Split from work-unit-spans.test.ts to keep each file under the 600-line limit.
 * Tests the deriveSpanTiming helper, null-execution narrowing, and dur flooring.
 */
import { describe, it, expect } from "vitest";
import type { Span, SpanStartOptions, Tracer } from "./tracing.js";
import { projectWorkUnitSpans } from "./work-unit-spans.js";

interface RecordedSpan {
  id: number;
  name: string;
  attributes: Record<string, string | number | boolean>;
  parentId: number | null;
  status?: { code: "OK" | "ERROR"; message?: string };
  ended: boolean;
  kind?: number;
  startTimeMs?: number;
  endTimeMs?: number;
}

class RecordingTracer implements Tracer {
  readonly spans: RecordedSpan[] = [];
  private byWrapper = new WeakMap<Span, RecordedSpan>();
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
    options?: SpanStartOptions,
  ): Span {
    const rec: RecordedSpan = {
      id: this.spans.length,
      name,
      attributes: { ...(attributes ?? {}) },
      parentId: parent ? (this.byWrapper.get(parent)?.id ?? null) : null,
      ended: false,
      kind: options?.kind,
      startTimeMs: options?.startTime,
    };
    this.spans.push(rec);
    const span: Span = {
      setAttribute: (k, v) => {
        rec.attributes[k] = v;
      },
      setStatus: (code, message) => {
        rec.status = { code, message };
      },
      end: (endTime?: number) => {
        rec.ended = true;
        rec.endTimeMs = endTime;
      },
    };
    this.byWrapper.set(span, rec);
    return span;
  }
}

describe("projectWorkUnitSpans — REVISE round 1 (inversion bug fixes)", () => {
  const T0 = 1_700_000_000_000;

  const mkTool = (toolId: string, durationMs: number) => ({
    toolId,
    operation: "op",
    params: {},
    result: { status: "success" as const },
    durationMs,
    governanceDecision: "auto-approved" as const,
  });

  it("root degrades flat on clock skew (completedAt < requestedAt)", () => {
    const tracer = new RecordingTracer();
    // clock-skew: completedAt before requestedAt -> inverted raw window -> must degrade to flat
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu", requestedAtMs: T0 + 200, completedAtMs: T0 + 100 },
        executions: [],
      },
      tracer,
    );
    const root = tracer.spans.find((s) => s.parentId === null)!;
    // Both must be undefined — not start-only or inverted
    expect(root.startTimeMs).toBeUndefined();
    expect(root.endTimeMs).toBeUndefined();
  });

  it("execution degrades flat when its window ends before the root start (clamp would invert)", () => {
    const tracer = new RecordingTracer();
    // rootStart = T0+200, rootEnd = T0+250
    // exec: createdAtMs = T0+150, durationMs = 80 -> derived execStart = T0+70, execEnd = T0+150
    // Clamp execStart to rootStart (T0+200) but T0+200 > T0+150 (execEnd) -> inversion -> degrade flat
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu", requestedAtMs: T0 + 200, durationMs: 50 },
        executions: [{ createdAtMs: T0 + 150, durationMs: 80, toolCalls: [] }],
      },
      tracer,
    );
    const exec = tracer.spans.find((s) => s.name.startsWith("chat"))!;
    // Both must be undefined — clamp-induced inversion must degrade to flat
    expect(exec.startTimeMs).toBeUndefined();
    expect(exec.endTimeMs).toBeUndefined();
  });

  it("tool with negative durationMs never inverts (dur floored to 0)", () => {
    const tracer = new RecordingTracer();
    // exec: createdAtMs = T0+100, durationMs = 50 -> execStart = T0+50, execEnd = T0+100
    // tool: durationMs = -30 -> without floor, cursor+(-30) < cursor -> inversion
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu" },
        executions: [
          {
            createdAtMs: T0 + 100,
            durationMs: 50,
            toolCalls: [mkTool("bad-tool", -30)],
          },
        ],
      },
      tracer,
    );
    const tool = tracer.spans.find((s) => s.name === "execute_tool bad-tool")!;
    // dur floored to 0 -> tool is zero-width at execStart (T0+50)
    expect(tool.startTimeMs).toBe(T0 + 50);
    expect(tool.endTimeMs).toBe(T0 + 50);
    expect(tool.startTimeMs!).toBeLessThanOrEqual(tool.endTimeMs!);
  });

  it("null execution element does not throw and is skipped", () => {
    const tracer = new RecordingTracer();
    const executions = [
      null,
      { createdAtMs: T0 + 100, durationMs: 10, toolCalls: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(() =>
      projectWorkUnitSpans({ workUnit: { workUnitId: "wu" }, executions }, tracer),
    ).not.toThrow();
    // null element skipped -> exactly 1 chat span (from the valid execution)
    const chatSpans = tracer.spans.filter((s) => s.name.startsWith("chat"));
    expect(chatSpans).toHaveLength(1);
  });

  it("no emitted span is inverted (startTimeMs <= endTimeMs for all timed spans)", () => {
    const tracer = new RecordingTracer();
    // Clock-skew root
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu1", requestedAtMs: T0 + 200, completedAtMs: T0 + 100 },
        executions: [],
      },
      tracer,
    );
    // Exec that would invert after clamp
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu2", requestedAtMs: T0 + 200, durationMs: 50 },
        executions: [{ createdAtMs: T0 + 150, durationMs: 80, toolCalls: [] }],
      },
      tracer,
    );
    // Negative-dur tool
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu3" },
        executions: [{ createdAtMs: T0 + 100, durationMs: 50, toolCalls: [mkTool("bad", -30)] }],
      },
      tracer,
    );
    // Assert invariant: no span has start > end
    for (const span of tracer.spans) {
      if (span.startTimeMs !== undefined && span.endTimeMs !== undefined) {
        expect(span.startTimeMs).toBeLessThanOrEqual(span.endTimeMs);
      }
    }
  });
});
