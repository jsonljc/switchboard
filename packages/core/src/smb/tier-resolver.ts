import type { OrganizationTier, SmbOrgConfig } from "@switchboard/schemas";

export interface TierStore {
  getTier(orgId: string): Promise<OrganizationTier>;
  getSmbConfig(orgId: string): Promise<SmbOrgConfig | null>;
  setSmbConfig(orgId: string, config: SmbOrgConfig): Promise<void>;
  upgradeTier(orgId: string, to: "enterprise"): Promise<void>;
}

/**
 * In-memory TierStore for testing and development.
 * Defaults to "smb" for unknown orgs.
 */
export class InMemoryTierStore implements TierStore {
  private tiers = new Map<string, OrganizationTier>();
  private configs = new Map<string, SmbOrgConfig>();

  async getTier(orgId: string): Promise<OrganizationTier> {
    return this.tiers.get(orgId) ?? "smb";
  }

  async getSmbConfig(orgId: string): Promise<SmbOrgConfig | null> {
    const tier = this.tiers.get(orgId) ?? "smb";
    if (tier !== "smb") return null;
    return this.configs.get(orgId) ?? null;
  }

  async setSmbConfig(orgId: string, config: SmbOrgConfig): Promise<void> {
    this.tiers.set(orgId, "smb");
    this.configs.set(orgId, config);
  }

  async upgradeTier(orgId: string, to: "enterprise"): Promise<void> {
    this.tiers.set(orgId, to);
    this.configs.delete(orgId);
  }

  /** For testing: set a tier directly. */
  setTier(orgId: string, tier: OrganizationTier): void {
    this.tiers.set(orgId, tier);
  }
}
