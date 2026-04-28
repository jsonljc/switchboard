export interface OrganizationEntitlement {
  entitled: boolean;
  reason: "active" | "trialing" | "override" | "blocked";
  blockedStatus?: string;
}

export interface EntitlementInputs {
  subscriptionStatus: string;
  entitlementOverride: boolean;
}

export interface BillingEntitlementResolver {
  resolve(organizationId: string): Promise<OrganizationEntitlement>;
}

export function evaluateEntitlement(input: EntitlementInputs): OrganizationEntitlement {
  if (input.entitlementOverride) {
    return { entitled: true, reason: "override" };
  }
  if (input.subscriptionStatus === "active") {
    return { entitled: true, reason: "active" };
  }
  if (input.subscriptionStatus === "trialing") {
    return { entitled: true, reason: "trialing" };
  }
  return {
    entitled: false,
    reason: "blocked",
    blockedStatus: input.subscriptionStatus,
  };
}
