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
