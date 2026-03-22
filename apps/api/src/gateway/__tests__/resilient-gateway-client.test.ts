import { describe, it, expect, vi } from "vitest";
import type { GatewayClient } from "../gateway-client.js";
import { ResilientGatewayClient } from "../resilient-gateway-client.js";
import { GatewayCircuitBreaker } from "../circuit-breaker.js";
import { GatewayCircuitOpenError, GatewayTransportError } from "../gateway-errors.js";

const minimalInitial = {
  kind: "initial" as const,
  sessionId: "550e8400-e29b-41d4-a716-446655440001",
  runId: "550e8400-e29b-41d4-a716-446655440002",
  roleId: "r",
  sessionToken: "t",
  traceId: "tr",
  idempotencyKey: "k",
  instruction: "i",
  allowedToolPack: ["a"],
  governanceProfile: "g",
  safetyLimits: {
    maxToolCalls: 10,
    maxMutations: 2,
    maxDollarsAtRisk: 100,
    sessionTimeoutMs: 60_000,
  },
};

describe("ResilientGatewayClient", () => {
  it("opens the circuit after repeated transport failures", async () => {
    const inner: GatewayClient = {
      invokeInitial: vi.fn().mockRejectedValue(new GatewayTransportError("down")),
      resume: vi.fn(),
      cancel: vi.fn(),
      healthCheck: vi.fn(),
    };
    const breaker = new GatewayCircuitBreaker(2, 60_000);
    const client = new ResilientGatewayClient(inner, breaker);

    await expect(client.invokeInitial(minimalInitial)).rejects.toThrow(GatewayTransportError);
    await expect(client.invokeInitial(minimalInitial)).rejects.toThrow(GatewayTransportError);
    await expect(client.invokeInitial(minimalInitial)).rejects.toThrow(GatewayCircuitOpenError);
  });

  it("closes circuit on successful healthCheck after invoke opened it", async () => {
    let now = 0;
    const breaker = new GatewayCircuitBreaker(1, 100, () => now);
    const inner: GatewayClient = {
      invokeInitial: vi.fn().mockRejectedValue(new GatewayTransportError("down")),
      resume: vi.fn(),
      cancel: vi.fn(),
      healthCheck: vi.fn().mockResolvedValue({ ok: true, version: "1" }),
    };
    const client = new ResilientGatewayClient(inner, breaker);

    await expect(client.invokeInitial(minimalInitial)).rejects.toThrow(GatewayTransportError);
    expect(breaker.getStateForTests().state).toBe("open");

    now = 100;
    await client.healthCheck();
    expect(breaker.getStateForTests().state).toBe("closed");

    vi.mocked(inner.invokeInitial).mockResolvedValue({ status: "completed", result: {} });
    const r = await client.invokeInitial(minimalInitial);
    expect(r.status).toBe("completed");
  });

  it("allows invoke after cooldown (half-open) without health probe", async () => {
    let now = 0;
    const breaker = new GatewayCircuitBreaker(1, 1000, () => now);
    const inner: GatewayClient = {
      invokeInitial: vi
        .fn()
        .mockRejectedValueOnce(new GatewayTransportError("once"))
        .mockResolvedValueOnce({ status: "completed", result: {} }),
      resume: vi.fn(),
      cancel: vi.fn(),
      healthCheck: vi.fn(),
    };
    const client = new ResilientGatewayClient(inner, breaker);
    await expect(client.invokeInitial(minimalInitial)).rejects.toThrow(GatewayTransportError);
    now = 1000;
    const r = await client.invokeInitial(minimalInitial);
    expect(r.status).toBe("completed");
  });

  it("propagates cancel to inner client", async () => {
    const inner: GatewayClient = {
      invokeInitial: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn(),
    };
    const client = new ResilientGatewayClient(inner, new GatewayCircuitBreaker(5, 60_000));
    await client.cancel({
      sessionId: minimalInitial.sessionId,
      runId: minimalInitial.runId,
      sessionToken: "t",
      traceId: "tr",
    });
    expect(inner.cancel).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: minimalInitial.sessionId,
        runId: minimalInitial.runId,
      }),
    );
  });
});
