import { describe, it, expect } from "vitest";
import {
  buildOpenClawGatewayHeaders,
  mergeGatewayInvokeResponseCorrelation,
  parseGatewayCorrelationHeaders,
  serializeGatewayCancelPayload,
  serializeGatewayInvokePayload,
} from "../openclaw-gateway-protocol.js";

describe("openclaw-gateway-protocol", () => {
  it("serializeGatewayInvokePayload matches exact JSON field order expectations for stable contract tests", () => {
    const body = {
      kind: "initial" as const,
      sessionId: "550e8400-e29b-41d4-a716-446655440001",
      runId: "550e8400-e29b-41d4-a716-446655440002",
      roleId: "role-a",
      sessionToken: "tok",
      traceId: "trace-1",
      idempotencyKey: "k1",
      instruction: "go",
      allowedToolPack: ["t1"],
      governanceProfile: "strict",
      safetyLimits: {
        maxToolCalls: 10,
        maxMutations: 2,
        maxDollarsAtRisk: 100,
        sessionTimeoutMs: 60_000,
      },
    };
    const s = serializeGatewayInvokePayload(body);
    const roundTrip = JSON.parse(s);
    expect(roundTrip).toEqual(body);
  });

  it("serializeGatewayCancelPayload includes all cancel fields", () => {
    const s = serializeGatewayCancelPayload({
      sessionId: "550e8400-e29b-41d4-a716-446655440001",
      runId: "550e8400-e29b-41d4-a716-446655440002",
      sessionToken: "st",
      traceId: "tr",
    });
    expect(JSON.parse(s)).toEqual({
      sessionId: "550e8400-e29b-41d4-a716-446655440001",
      runId: "550e8400-e29b-41d4-a716-446655440002",
      sessionToken: "st",
      traceId: "tr",
    });
  });

  it("buildOpenClawGatewayHeaders sets bearer and trace", () => {
    expect(buildOpenClawGatewayHeaders({ sessionToken: "abc", traceId: "t-9" })).toEqual({
      Authorization: "Bearer abc",
      "Content-Type": "application/json",
      "X-Switchboard-Trace-Id": "t-9",
    });
  });

  it("parseGatewayCorrelationHeaders prefers gateway id and openclaw correlation", () => {
    const h = new Headers();
    h.set("x-request-id", "req-a");
    h.set("x-openclaw-correlation-id", "oc-b");
    expect(parseGatewayCorrelationHeaders(h)).toEqual({
      gatewayRequestId: "req-a",
      runtimeCorrelationId: "oc-b",
    });
  });

  it("mergeGatewayInvokeResponseCorrelation prefers header values over body", () => {
    const merged = mergeGatewayInvokeResponseCorrelation(
      {
        status: "completed",
        correlation: { gatewayRequestId: "from-body", runtimeCorrelationId: "rb" },
      },
      { gatewayRequestId: "from-header" },
    );
    expect(merged.correlation).toEqual({
      gatewayRequestId: "from-header",
      runtimeCorrelationId: "rb",
    });
  });
});
