import type { ConnectionHealth, ConnectionContract } from "@switchboard/schemas";

export type { ConnectionContract } from "@switchboard/schemas";

export function createConnectionContract(
  config: Omit<ConnectionContract, "healthCheck">,
  healthCheckFn: () => Promise<ConnectionHealth>,
): ConnectionContract {
  return {
    ...config,
    healthCheck: healthCheckFn,
  };
}
