import type { GatewayClient } from "./gateway-client.js";

/**
 * Periodically calls {@link GatewayClient.healthCheck} so {@link ResilientGatewayClient}
 * can close the circuit without waiting for the next real invoke.
 */
export function startOpenClawGatewayHealthProbes(input: {
  gatewayClient: GatewayClient;
  intervalMs: number;
  logger: { warn: (...args: unknown[]) => void };
}): () => void {
  const { gatewayClient, intervalMs, logger } = input;
  if (intervalMs <= 0) {
    return () => {};
  }

  const id = setInterval(() => {
    void gatewayClient.healthCheck().catch((err: unknown) => {
      logger.warn({ err }, "OpenClaw gateway health probe failed");
    });
  }, intervalMs);

  return () => clearInterval(id);
}
