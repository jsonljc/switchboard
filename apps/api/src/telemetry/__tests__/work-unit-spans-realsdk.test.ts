import { describe, it, expect, beforeEach } from "vitest";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import {
  trace,
  context,
  SpanKind,
  type Context,
  type Span as OtelSpan,
  type SpanOptions,
} from "@opentelemetry/api";
import { createOTelTracer, projectWorkUnitSpans, type WorkUnitSpanInput } from "@switchboard/core";

/**
 * Pins the `createOTelTracer` adapter -> REAL `@opentelemetry/sdk-trace-base` SDK leg.
 *
 * Every other timing test asserts the in-memory RecordingTracer (the adapter CONTRACT). This wires
 * the adapter to a real `BasicTracerProvider` + `InMemorySpanExporter` and asserts the FINISHED
 * spans carry the right name / kind / start / end / parenting plus the coherent gen_ai semconv —
 * the level that would have caught the slice-1.1 timing-inversion bug, and any future HrTime,
 * SpanKind, or context-propagation regression that the fake tracer cannot see.
 *
 * No collector, no network, no env — `SimpleSpanProcessor` exports synchronously into memory.
 */

const T0 = 1_700_000_000_000; // fixed epoch ms; no wall-clock anywhere
const hrToMs = (hr: readonly [number, number]): number => hr[0] * 1000 + hr[1] / 1e6;

function sampleInput(): WorkUnitSpanInput {
  return {
    workUnit: {
      workUnitId: "wu_real",
      organizationId: "org_1",
      intent: "book_appointment",
      requestedAtMs: T0, // REAL root start
      completedAtMs: T0 + 500, // REAL root end
      durationMs: 500,
    },
    executions: [
      {
        skillSlug: "alex",
        model: "claude-opus-4-6",
        durationMs: 200,
        createdAtMs: T0 + 450, // REAL exec end; DERIVED start = createdAt - durationMs = T0 + 250
        inputTokens: 100,
        outputTokens: 50,
        toolCalls: [
          {
            toolId: "book_appointment",
            operation: "create",
            params: {},
            result: { status: "success" },
            durationMs: 30, // packed from exec start: [T0+250, T0+280]
            governanceDecision: "auto-approved",
          },
        ],
      },
    ],
  };
}

describe("projectWorkUnitSpans wired to the REAL @opentelemetry/sdk-trace-base (adapter -> SDK leg)", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  function project(input: WorkUnitSpanInput): ReadableSpan[] {
    const otelTracer = provider.getTracer("realsdk-test");
    const contextBridge = {
      active: () => context.active(),
      with: (ctx: unknown, span: unknown) => trace.setSpan(ctx as Context, span as OtelSpan),
    };
    // createOTelTracer types its tracer param loosely (`options?: unknown`) so core needn't import
    // @opentelemetry/api types; adapt the statically-typed real Tracer to that shape with a thin
    // pass-through (otel-init.ts gets this for free via an untyped require).
    const tracer = createOTelTracer(
      {
        startSpan: (name, options, ctx) =>
          otelTracer.startSpan(
            name,
            options as SpanOptions | undefined,
            ctx as Context | undefined,
          ),
      },
      contextBridge,
    );
    projectWorkUnitSpans(input, tracer);
    return exporter.getFinishedSpans(); // SimpleSpanProcessor exports synchronously on span.end()
  }

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  });

  it("emits a 3-span tree with correct names, kinds, real timing, parenting and coherent semconv", () => {
    const spans = project(sampleInput());

    expect(spans.map((s) => s.name).sort()).toEqual([
      "chat alex",
      "execute_tool book_appointment",
      "invoke_agent",
    ]);
    const root = spans.find((s) => s.name === "invoke_agent")!;
    const exec = spans.find((s) => s.name.startsWith("chat"))!;
    const tool = spans.find((s) => s.name.startsWith("execute_tool"))!;

    // SpanKind asserted against the REAL @opentelemetry/api enum (not core's mirrored numbers)
    expect(root.kind).toBe(SpanKind.INTERNAL);
    expect(exec.kind).toBe(SpanKind.CLIENT);
    expect(tool.kind).toBe(SpanKind.INTERNAL);

    // Honest timing round-trips exactly through the real epoch-ms -> HrTime conversion
    expect(hrToMs(root.startTime)).toBe(T0); // REAL requestedAt
    expect(hrToMs(root.endTime)).toBe(T0 + 500); // REAL completedAt
    expect(hrToMs(exec.endTime)).toBe(T0 + 450); // REAL createdAt
    expect(hrToMs(exec.startTime)).toBe(T0 + 250); // DERIVED createdAt - durationMs
    expect(hrToMs(tool.startTime)).toBe(T0 + 250); // packed at exec start
    expect(hrToMs(tool.endTime)).toBe(T0 + 280); // + tool durationMs

    // Geometry: every child within its parent's window (the slice-1.1 inversion guard, end to end)
    expect(hrToMs(exec.startTime)).toBeGreaterThanOrEqual(hrToMs(root.startTime));
    expect(hrToMs(exec.endTime)).toBeLessThanOrEqual(hrToMs(root.endTime));
    expect(hrToMs(tool.startTime)).toBeGreaterThanOrEqual(hrToMs(exec.startTime));
    expect(hrToMs(tool.endTime)).toBeLessThanOrEqual(hrToMs(exec.endTime));

    // Real parent linkage — one trace, correct nesting (the leg the RecordingTracer only fakes)
    const traceId = root.spanContext().traceId;
    expect(exec.spanContext().traceId).toBe(traceId);
    expect(tool.spanContext().traceId).toBe(traceId);
    expect(root.parentSpanContext).toBeUndefined();
    expect(exec.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(tool.parentSpanContext?.spanId).toBe(exec.spanContext().spanId);

    // Coherent gen_ai semconv (slice A) survives end to end through the real SDK
    expect(root.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    expect(root.attributes["gen_ai.provider.name"]).toBe("anthropic");
    expect(exec.attributes["gen_ai.provider.name"]).toBe("anthropic");
    expect("gen_ai.system" in root.attributes).toBe(false);
    expect("gen_ai.system" in exec.attributes).toBe(false);
  });

  it("degrades to a flat (start === end) span when an execution has no timing anchors, without throwing", () => {
    const spans = project({
      workUnit: { workUnitId: "wu_flat" }, // no requestedAt/completedAt
      executions: [{ skillSlug: "alex", model: "claude-haiku-4-5", toolCalls: [] }], // no createdAt/duration
    });
    const root = spans.find((s) => s.name === "invoke_agent")!;
    const exec = spans.find((s) => s.name.startsWith("chat"))!;
    // No anchors -> the SDK stamps both ends itself; the span is well-formed (start <= end), never inverted
    expect(hrToMs(root.endTime)).toBeGreaterThanOrEqual(hrToMs(root.startTime));
    expect(hrToMs(exec.endTime)).toBeGreaterThanOrEqual(hrToMs(exec.startTime));
    expect(exec.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
  });
});
