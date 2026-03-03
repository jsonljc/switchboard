/**
 * OpenTelemetry SDK initialization for the API server.
 *
 * Call `initTelemetry()` before Fastify starts.
 * If OTel packages are not installed, silently falls back to no-op.
 */

import { setTracer, createOTelTracer } from "@switchboard/core";

export async function initTelemetry(): Promise<void> {
  const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  if (!endpoint) {
    return;
  }

  try {
    // Use dynamic require to avoid TypeScript module resolution errors
    // These packages are optional — if not installed, the catch block handles it
    const loadModule = (name: string) => {
      try {
        return require(name);
      } catch {
        return null;
      }
    };

    const sdkNode = loadModule("@opentelemetry/sdk-node");
    const otlpHttp = loadModule("@opentelemetry/exporter-trace-otlp-http");
    const autoInst = loadModule("@opentelemetry/auto-instrumentations-node");
    const resources = loadModule("@opentelemetry/resources");
    const semconv = loadModule("@opentelemetry/semantic-conventions");
    const otelApi = loadModule("@opentelemetry/api");

    if (!sdkNode || !otlpHttp || !autoInst || !resources || !otelApi) {
      return; // OTel packages not installed
    }

    const resource = new resources.Resource({
      [semconv.ATTR_SERVICE_NAME ?? "service.name"]:
        process.env["OTEL_SERVICE_NAME"] ?? "switchboard-api",
      [semconv.ATTR_SERVICE_VERSION ?? "service.version"]:
        process.env["npm_package_version"] ?? "0.1.0",
      "deployment.environment": process.env.NODE_ENV ?? "development",
    });

    const traceExporter = new otlpHttp.OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
    });

    const sdk = new sdkNode.NodeSDK({
      resource,
      traceExporter,
      instrumentations: [
        autoInst.getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-dns": { enabled: false },
        }),
      ],
    });

    sdk.start();

    // Wire OTel tracer into Switchboard's tracing abstraction
    const otelTracer = otelApi.trace.getTracer("switchboard-api");
    setTracer(createOTelTracer(otelTracer));

    // Graceful shutdown
    process.on("SIGTERM", () => {
      sdk.shutdown().catch(() => {});
    });
  } catch {
    // OTel packages not installed or initialization failed — silently skip
  }
}
