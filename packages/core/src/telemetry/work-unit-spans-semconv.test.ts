import { describe, it, expect } from "vitest";
import type { Span, SpanStartOptions, Tracer } from "./tracing.js";
import { projectWorkUnitSpans } from "./work-unit-spans.js";

interface RecordedSpan {
  id: number;
  name: string;
  parentId: number | null;
  attributes: Record<string, string | number | boolean>;
}

/** Minimal in-memory Tracer mirroring the adapter contract (attributes + parenting only). */
class RecordingTracer implements Tracer {
  readonly spans: RecordedSpan[] = [];
  private byWrapper = new WeakMap<Span, RecordedSpan>();
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
    _options?: SpanStartOptions,
  ): Span {
    const rec: RecordedSpan = {
      id: this.spans.length,
      name,
      parentId: parent ? (this.byWrapper.get(parent)?.id ?? null) : null,
      attributes: { ...(attributes ?? {}) },
    };
    this.spans.push(rec);
    const span: Span = {
      setAttribute: (k, v) => {
        rec.attributes[k] = v;
      },
      setStatus: () => {},
      end: () => {},
    };
    this.byWrapper.set(span, rec);
    return span;
  }
}

const rootSpan = (t: RecordingTracer): RecordedSpan => t.spans.find((s) => s.parentId === null)!;
const execSpan = (t: RecordingTracer): RecordedSpan =>
  t.spans.find((s) => s.name.startsWith("chat"))!;

// OTel GenAI semconv renamed gen_ai.system -> gen_ai.provider.name (the SAME concept: the model
// provider). E4b set gen_ai.system="switchboard" (not a provider) and E4c slice 1 added
// gen_ai.provider.name="anthropic" on the exec span — declaring BOTH is incoherent. The provider
// belongs on gen_ai.provider.name; "Switchboard orchestrated this" lives in switchboard.*.
describe("projectWorkUnitSpans — gen_ai provider semconv coherence (E4c)", () => {
  it("keeps the real model provider on gen_ai.provider.name and drops gen_ai.system on the exec span", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [{ skillSlug: "alex", model: "claude-opus-4-6", toolCalls: [] }],
      },
      tracer,
    );
    const e = execSpan(tracer);
    expect(e.attributes["gen_ai.provider.name"]).toBe("anthropic");
    expect("gen_ai.system" in e.attributes).toBe(false);
  });

  it("derives gen_ai.provider.name on the root invoke_agent span (semconv: Required on agent spans)", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1" },
        executions: [{ model: "claude-haiku-4-5", toolCalls: [] }],
      },
      tracer,
    );
    const r = rootSpan(tracer);
    expect(r.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    expect(r.attributes["gen_ai.provider.name"]).toBe("anthropic");
    expect("gen_ai.system" in r.attributes).toBe(false);
  });

  it("omits gen_ai.provider.name on the root when no execution has a resolvable provider", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      { workUnit: { workUnitId: "wu_1" }, executions: [{ model: "gpt-4o", toolCalls: [] }] },
      tracer,
    );
    expect("gen_ai.provider.name" in rootSpan(tracer).attributes).toBe(false);
  });

  it("omits gen_ai.provider.name on the root when there are no executions (e.g. a deny path)", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans({ workUnit: { workUnitId: "wu_1" }, executions: [] }, tracer);
    expect("gen_ai.provider.name" in rootSpan(tracer).attributes).toBe(false);
  });

  it("never declares the deprecated gen_ai.system on any span in the tree", () => {
    const tracer = new RecordingTracer();
    projectWorkUnitSpans(
      {
        workUnit: { workUnitId: "wu_1", intent: "book_appointment" },
        executions: [
          {
            skillSlug: "alex",
            model: "claude-opus-4-6",
            toolCalls: [
              {
                toolId: "book_appointment",
                operation: "create",
                params: {},
                result: { status: "success" },
                durationMs: 5,
                governanceDecision: "auto-approved",
              },
            ],
          },
        ],
      },
      tracer,
    );
    // root + exec + tool
    expect(tracer.spans.length).toBe(3);
    for (const s of tracer.spans) {
      expect("gen_ai.system" in s.attributes).toBe(false);
    }
  });
});
