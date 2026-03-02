import type { PrismaClient } from "@prisma/client";
import type { GovernanceProfile, GovernanceProfileConfig } from "@switchboard/schemas";

const DEFAULT_PROFILE: GovernanceProfile = "guarded";

/**
 * Prisma-backed GovernanceProfileStore.
 * Reads/writes from the OrganizationConfig table — no new models needed.
 */
export class PrismaGovernanceProfileStore {
  constructor(private prisma: PrismaClient) {}

  async get(organizationId: string | null): Promise<GovernanceProfile> {
    if (!organizationId) return DEFAULT_PROFILE;

    const config = await this.prisma.organizationConfig.findUnique({
      where: { id: organizationId },
      select: { governanceProfile: true },
    });

    if (!config) return DEFAULT_PROFILE;

    return (config.governanceProfile as GovernanceProfile) ?? DEFAULT_PROFILE;
  }

  async set(organizationId: string | null, profile: GovernanceProfile): Promise<void> {
    if (!organizationId) return; // global profile not persisted

    await this.prisma.organizationConfig.upsert({
      where: { id: organizationId },
      create: {
        id: organizationId,
        name: "",
        governanceProfile: profile,
      },
      update: {
        governanceProfile: profile,
      },
    });
  }

  async getConfig(organizationId: string | null): Promise<GovernanceProfileConfig | null> {
    if (!organizationId) return null;

    const config = await this.prisma.organizationConfig.findUnique({
      where: { id: organizationId },
      select: {
        governanceProfile: true,
        smbAllowedActions: true,
        smbBlockedActions: true,
      },
    });

    if (!config) return null;

    const profile = (config.governanceProfile as GovernanceProfile) ?? DEFAULT_PROFILE;
    const allowed = config.smbAllowedActions ?? [];
    const blocked = config.smbBlockedActions ?? [];

    // Only return config if there are action type restrictions
    if (allowed.length === 0 && blocked.length === 0) {
      return { profile };
    }

    return {
      profile,
      ...(allowed.length > 0 && { allowedActionTypes: allowed }),
      ...(blocked.length > 0 && { blockedActionTypes: blocked }),
    };
  }

  async setConfig(organizationId: string | null, config: GovernanceProfileConfig): Promise<void> {
    if (!organizationId) return;

    await this.prisma.organizationConfig.upsert({
      where: { id: organizationId },
      create: {
        id: organizationId,
        name: "",
        governanceProfile: config.profile,
        smbAllowedActions: config.allowedActionTypes ?? [],
        smbBlockedActions: config.blockedActionTypes ?? [],
      },
      update: {
        governanceProfile: config.profile,
        smbAllowedActions: config.allowedActionTypes ?? [],
        smbBlockedActions: config.blockedActionTypes ?? [],
      },
    });
  }
}
