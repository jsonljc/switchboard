/**
 * Lightweight OpenTelemetry-compatible tracing abstraction.
 * When @opentelemetry/api is installed, uses real spans.
 * Otherwise falls back to no-op so the core package has no hard dependency.
 */

export interface SpanStartOptions {
  /** Span start time as epoch milliseconds. The OTel adapter converts to an HrTime tuple. */
  startTime?: number;
  /** OTel SpanKind numeric value (INTERNAL=0, SERVER=1, CLIENT=2, PRODUCER=3, CONSUMER=4). */
  kind?: number;
}

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(code: "OK" | "ERROR", message?: string): void;
  end(endTime?: number): void;
}

export interface Tracer {
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parent?: Span,
    options?: SpanStartOptions,
  ): Span;
}

class NoopSpan implements Span {
  setAttribute(_key: string, _value: string | number | boolean): void {}
  setStatus(_code: "OK" | "ERROR", _message?: string): void {}
  end(_endTime?: number): void {}
}

export class NoopTracer implements Tracer {
  startSpan(
    _name: string,
    _attributes?: Record<string, string | number | boolean>,
    _parent?: Span,
    _options?: SpanStartOptions,
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
  end(endTime?: unknown): void;
}

/**
 * Convert epoch milliseconds to an OTel HrTime tuple [seconds, nanoseconds] (unambiguous across
 * OTel versions vs a bare number). Clamps negative epochs to zero — a negative epoch is never
 * valid for persisted `requestedAt`/`createdAt` anchors, but guards against arithmetic underflow
 * in derived timestamps (e.g. createdAt - durationMs when durationMs is unexpectedly large).
 */
function epochMsToHrTime(epochMs: number): [number, number] {
  const ms = epochMs > 0 ? epochMs : 0; // a negative epoch is never valid
  const seconds = Math.trunc(ms / 1000);
  const nanos = Math.round((ms - seconds * 1000) * 1e6);
  // a fractional ms can round nanos up to 1e9 -> carry into seconds
  return nanos >= 1_000_000_000 ? [seconds + 1, nanos - 1_000_000_000] : [seconds, nanos];
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
      end(endTime) {
        raw.end(endTime !== undefined ? epochMsToHrTime(endTime) : undefined);
      },
    };
    rawByWrapper.set(span, raw);
    return span;
  }

  return {
    startSpan(name, attributes?, parent?, options?) {
      const parentRaw = parent ? rawByWrapper.get(parent) : undefined;
      const context =
        parentRaw && contextBridge
          ? contextBridge.with(contextBridge.active(), parentRaw)
          : undefined;
      let otelOptions: { startTime?: [number, number]; kind?: number } | undefined;
      if (options && (options.kind !== undefined || options.startTime !== undefined)) {
        otelOptions = {};
        if (options.kind !== undefined) otelOptions.kind = options.kind;
        if (options.startTime !== undefined)
          otelOptions.startTime = epochMsToHrTime(options.startTime);
      }
      const raw = otelTracer.startSpan(name, otelOptions, context);
      if (attributes) {
        for (const [k, v] of Object.entries(attributes)) raw.setAttribute(k, v);
      }
      return wrap(raw);
    },
  };
}
