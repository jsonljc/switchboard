import type { ConnectionHealth } from "@switchboard/schemas";

export interface ConnectionContract {
  serviceId: string;
  serviceName: string;
  authType: "oauth2" | "api_key" | "service_account";
  requiredScopes: string[];
  refreshStrategy: "auto" | "manual" | "none";
  healthCheck(): Promise<ConnectionHealth>;
}

export function createConnectionContract(
  config: Omit<ConnectionContract, "healthCheck">,
  healthCheckFn: () => Promise<ConnectionHealth>,
): ConnectionContract {
  return {
    ...config,
    healthCheck: healthCheckFn,
  };
}
