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
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span;
}

class NoopSpan implements Span {
  setAttribute(_key: string, _value: string | number | boolean): void {}
  setStatus(_code: "OK" | "ERROR", _message?: string): void {}
  end(): void {}
}

export class NoopTracer implements Tracer {
  startSpan(_name: string, _attributes?: Record<string, string | number | boolean>): Span {
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
 * OTel adapter: wraps @opentelemetry/api tracer into our Tracer interface.
 * Call this from the app entry point after OTel SDK is initialized.
 */
export function createOTelTracer(otelTracer: {
  startSpan: (name: string) => {
    setAttribute: (key: string, value: unknown) => void;
    setStatus: (status: { code: number; message?: string }) => void;
    end: () => void;
  };
}): Tracer {
  return {
    startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span {
      const span = otelTracer.startSpan(name);
      if (attributes) {
        for (const [k, v] of Object.entries(attributes)) {
          span.setAttribute(k, v);
        }
      }
      return {
        setAttribute(key: string, value: string | number | boolean) {
          span.setAttribute(key, value);
        },
        setStatus(code: "OK" | "ERROR", message?: string) {
          span.setStatus({ code: code === "OK" ? 1 : 2, message });
        },
        end() {
          span.end();
        },
      };
    },
  };
}
