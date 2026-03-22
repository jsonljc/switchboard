import type {
  GatewayCorrelationMeta,
  GatewayInitialInvokeRequest,
  GatewayInvokeResponse,
  GatewayResumeInvokeRequest,
} from "@switchboard/schemas";

/**
 * HTTP paths implemented by {@link HttpGatewayClient}.
 * @see docs/openclaw-gateway-contract.md
 */
export const OPENCLAW_GATEWAY_HTTP_PATHS = {
  invoke: "/invoke",
  health: "/health",
  cancel: "/cancel",
} as const;

export function buildOpenClawGatewayHeaders(input: {
  sessionToken: string;
  traceId: string;
}): Record<string, string> {
  return {
    Authorization: `Bearer ${input.sessionToken}`,
    "Content-Type": "application/json",
    "X-Switchboard-Trace-Id": input.traceId,
  };
}

/** Stable JSON for contract tests — same shape as fetch body for POST /invoke */
export function serializeGatewayInvokePayload(
  body: GatewayInitialInvokeRequest | GatewayResumeInvokeRequest,
): string {
  return JSON.stringify(body);
}

export function serializeGatewayCancelPayload(input: {
  sessionId: string;
  runId: string;
  sessionToken: string;
  traceId: string;
}): string {
  return JSON.stringify(input);
}

function firstHeader(headers: Headers, names: string[]): string | undefined {
  for (const n of names) {
    const v = headers.get(n);
    if (v?.trim()) return v.trim();
  }
  return undefined;
}

export function parseGatewayCorrelationHeaders(headers: Headers): GatewayCorrelationMeta {
  const gatewayRequestId = firstHeader(headers, ["x-gateway-request-id", "x-request-id"]);
  const runtimeCorrelationId = firstHeader(headers, [
    "x-openclaw-correlation-id",
    "x-correlation-id",
    "x-trace-id",
  ]);
  const out: GatewayCorrelationMeta = {};
  if (gatewayRequestId) out.gatewayRequestId = gatewayRequestId;
  if (runtimeCorrelationId) out.runtimeCorrelationId = runtimeCorrelationId;
  return out;
}

export function mergeGatewayInvokeResponseCorrelation(
  body: GatewayInvokeResponse,
  fromHeaders: GatewayCorrelationMeta,
): GatewayInvokeResponse {
  if (!fromHeaders.gatewayRequestId && !fromHeaders.runtimeCorrelationId && !body.correlation) {
    return body;
  }
  return {
    ...body,
    correlation: {
      ...body.correlation,
      ...fromHeaders,
    },
  };
}
