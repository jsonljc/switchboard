import { describe, it, expect, vi, afterEach } from "vitest";
import { startOpenClawGatewayHealthProbes } from "../openclaw-health-probe.js";
import type { GatewayClient } from "../gateway-client.js";

describe("startOpenClawGatewayHealthProbes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls healthCheck on each interval (runtime wiring contract)", async () => {
    vi.useFakeTimers();
    const healthCheck = vi.fn().mockResolvedValue({ ok: true, version: "t" });
    const gatewayClient = {
      healthCheck,
      invokeInitial: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    } as unknown as GatewayClient;

    const stop = startOpenClawGatewayHealthProbes({
      gatewayClient,
      intervalMs: 10_000,
      logger: { warn: vi.fn() },
    });

    expect(healthCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(healthCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(healthCheck).toHaveBeenCalledTimes(2);
    stop();
  });

  it("returns no-op stop when interval is 0", () => {
    const stop = startOpenClawGatewayHealthProbes({
      gatewayClient: { healthCheck: vi.fn() } as unknown as GatewayClient,
      intervalMs: 0,
      logger: { warn: vi.fn() },
    });
    expect(stop()).toBeUndefined();
  });
});
