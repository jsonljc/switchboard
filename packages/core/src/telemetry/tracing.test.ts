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

describe("epochMsToHrTime — defensive hardening (E4c-hardening)", () => {
  it("clamps a negative epoch to [0,0] and never emits negative nanos", () => {
    const started: Array<{ options: unknown }> = [];
    const fakeOtelTracer = {
      startSpan: vi.fn((_name: string, options?: unknown) => {
        started.push({ options });
        return { setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
      }),
    };
    const tracer = createOTelTracer(fakeOtelTracer);
    tracer.startSpan("x", undefined, undefined, { startTime: -500 });
    // With the fix, epochMsToHrTime(-500) -> clamp to ms=0 -> [0, 0]
    expect(started[0]!.options).toEqual({ startTime: [0, 0] });
  });
});
