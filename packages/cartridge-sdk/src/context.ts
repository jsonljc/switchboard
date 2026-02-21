export interface CartridgeConnectionConfig {
  serviceId: string;
  serviceName: string;
  authType: "oauth2" | "api_key" | "service_account";
  requiredScopes: string[];
  refreshStrategy: "auto" | "manual" | "none";
}

export function validateConnection(
  config: CartridgeConnectionConfig,
  credentials: Record<string, unknown>,
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  switch (config.authType) {
    case "oauth2":
      if (!credentials["accessToken"]) missing.push("accessToken");
      break;
    case "api_key":
      if (!credentials["apiKey"]) missing.push("apiKey");
      break;
    case "service_account":
      if (!credentials["serviceAccountKey"]) missing.push("serviceAccountKey");
      break;
  }

  return { valid: missing.length === 0, missing };
}
