export interface ServiceRegistryEntry {
  serviceId: string;
  displayName: string;
  authType: "api_key" | "oauth2" | "service_account";
  requiredFields: { key: string; label: string; type: "text" | "password"; placeholder?: string }[];
  cartridgeId?: string;
  description?: string;
}

/**
 * Static registry of known services with their auth requirements.
 * Cross-referenced with cartridge manifest.requiredConnections.
 */
export const SERVICE_REGISTRY: ServiceRegistryEntry[] = [
  {
    serviceId: "stripe",
    displayName: "Stripe",
    authType: "api_key",
    requiredFields: [
      { key: "secretKey", label: "Secret Key", type: "password", placeholder: "sk_live_..." },
    ],
    cartridgeId: "payments",
    description: "Process payments, refunds, and manage subscriptions.",
  },
  {
    serviceId: "meta-ads",
    displayName: "Meta Ads",
    authType: "api_key",
    requiredFields: [
      { key: "accessToken", label: "Access Token", type: "password", placeholder: "EAA..." },
      { key: "adAccountId", label: "Ad Account ID", type: "text", placeholder: "act_123456789" },
    ],
    cartridgeId: "digital-ads",
    description: "Manage ad campaigns, budgets, and audience targeting.",
  },
  {
    serviceId: "crm-builtin",
    displayName: "Built-in CRM",
    authType: "api_key",
    requiredFields: [],
    cartridgeId: "crm",
    description: "Built-in unified inbox — manage contacts, deals, and activities.",
  },
];

export function getServiceById(serviceId: string): ServiceRegistryEntry | undefined {
  return SERVICE_REGISTRY.find((s) => s.serviceId === serviceId);
}

export function getServiceByCartridge(cartridgeId: string): ServiceRegistryEntry | undefined {
  return SERVICE_REGISTRY.find((s) => s.cartridgeId === cartridgeId);
}
