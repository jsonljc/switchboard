/**
 * Lightweight OpenTelemetry-compatible tracing abstraction.
 * When @opentelemetry/api is installed, uses real spans.
 * Otherwise falls back to no-op so the core package has no hard dependency.
 */

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: "OK" | "ERROR", message?: string): void;
  end(): void;
}

export interface Tracer {
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
  ): Span;
}

class NoopSpan implements Span {
  setAttribute(_key: string, _value: string | number | boolean): void {}
  setStatus(_code: "OK" | "ERROR", _message?: string): void {}
  end(): void {}
}

export class NoopTracer implements Tracer {
  startSpan(
    _name: string,
    _attributes?: Record<string, string | number | boolean>,
    _parent?: Span,
  ): Span {
    return new NoopSpan();
  }
}

let activeTracer: Tracer = new NoopTracer();

export function setTracer(tracer: Tracer): void {
  activeTracer = tracer;
}

export function getTracer(): Tracer {
  return activeTracer;
}

/**
 * Bridge to @opentelemetry/api context propagation, injected by the app entry point.
 * `active()` returns the current OTel context; `with(context, span)` returns a new context
 * carrying `span` (i.e. `trace.setSpan(context, span)`). Kept untyped (`unknown`) so core
 * never hard-depends on @opentelemetry/api.
 */
export interface OTelContextBridge {
  active(): unknown;
  with(context: unknown, span: unknown): unknown;
}

interface RawOtelSpan {
  setAttribute(key: string, value: unknown): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

/**
 * OTel adapter: wraps @opentelemetry/api tracer into our Tracer interface.
 * Call this from the app entry point after OTel SDK is initialized.
 *
 * When a `parent` span is passed to `startSpan` AND a `contextBridge` is present, the child
 * OTel span is started under the context derived from the parent's raw span, producing a real
 * span tree. Without a bridge it degrades to a flat list (no throw).
 */
export function createOTelTracer(
  otelTracer: { startSpan: (name: string, options?: unknown, context?: unknown) => RawOtelSpan },
  contextBridge?: OTelContextBridge,
): Tracer {
  const rawByWrapper = new WeakMap<Span, RawOtelSpan>();

  function wrap(raw: RawOtelSpan): Span {
    const span: Span = {
      setAttribute(key, value) {
        raw.setAttribute(key, value);
      },
      setStatus(code, message) {
        raw.setStatus({ code: code === "OK" ? 1 : 2, message });
      },
      end() {
        raw.end();
      },
    };
    rawByWrapper.set(span, raw);
    return span;
  }

  return {
    startSpan(name, attributes?, parent?) {
      const parentRaw = parent ? rawByWrapper.get(parent) : undefined;
      const context =
        parentRaw && contextBridge
          ? contextBridge.with(contextBridge.active(), parentRaw)
          : undefined;
      const raw = otelTracer.startSpan(name, undefined, context);
      if (attributes) {
        for (const [k, v] of Object.entries(attributes)) raw.setAttribute(k, v);
      }
      return wrap(raw);
    },
  };
}
