import type { PrismaClient } from "@prisma/client";
import type { OrganizationTier, SmbOrgConfig, GovernanceProfile } from "@switchboard/schemas";
import type { TierStore } from "@switchboard/core";

export class PrismaTierStore implements TierStore {
  constructor(private prisma: PrismaClient) {}

  async getTier(orgId: string): Promise<OrganizationTier> {
    const config = await this.prisma.organizationConfig.findUnique({
      where: { id: orgId },
      select: { tier: true },
    });
    return (config?.tier as OrganizationTier) ?? "smb";
  }

  async getSmbConfig(orgId: string): Promise<SmbOrgConfig | null> {
    const config = await this.prisma.organizationConfig.findUnique({
      where: { id: orgId },
    });
    if (!config || config.tier !== "smb") return null;
    if (!config.smbOwnerId) return null;

    return {
      tier: "smb",
      governanceProfile: config.governanceProfile as GovernanceProfile,
      allowedActionTypes:
        config.smbAllowedActions.length > 0 ? config.smbAllowedActions : undefined,
      blockedActionTypes:
        config.smbBlockedActions.length > 0 ? config.smbBlockedActions : undefined,
      perActionSpendLimit: config.smbPerActionLimit,
      dailySpendLimit: config.smbDailyLimit,
      ownerId: config.smbOwnerId,
    };
  }

  async setSmbConfig(orgId: string, config: SmbOrgConfig): Promise<void> {
    await this.prisma.organizationConfig.update({
      where: { id: orgId },
      data: {
        tier: "smb",
        governanceProfile: config.governanceProfile,
        smbOwnerId: config.ownerId,
        smbPerActionLimit: config.perActionSpendLimit,
        smbDailyLimit: config.dailySpendLimit,
        smbAllowedActions: config.allowedActionTypes ?? [],
        smbBlockedActions: config.blockedActionTypes ?? [],
      },
    });
  }

  async upgradeTier(orgId: string, to: "enterprise"): Promise<void> {
    await this.prisma.organizationConfig.update({
      where: { id: orgId },
      data: {
        tier: to,
        smbOwnerId: null,
        smbPerActionLimit: null,
        smbDailyLimit: null,
        smbAllowedActions: [],
        smbBlockedActions: [],
      },
    });
  }
}
