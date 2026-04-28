import type { PrismaClient } from "@switchboard/db";
import {
  evaluateEntitlement,
  type BillingEntitlementResolver,
  type OrganizationEntitlement,
} from "@switchboard/core/billing";

export class PrismaBillingEntitlementResolver implements BillingEntitlementResolver {
  constructor(private readonly prisma: PrismaClient) {}

  async resolve(organizationId: string): Promise<OrganizationEntitlement> {
    const row = await this.prisma.organizationConfig.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true, entitlementOverride: true },
    });

    if (!row) {
      return { entitled: false, reason: "blocked", blockedStatus: "missing" };
    }

    return evaluateEntitlement({
      subscriptionStatus: row.subscriptionStatus,
      entitlementOverride: row.entitlementOverride,
    });
  }
}
