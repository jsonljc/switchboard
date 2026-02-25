import type { GovernanceProfile, GovernanceProfileConfig } from "@switchboard/schemas";
import type { SystemRiskPosture } from "@switchboard/schemas";

/** Default profile when none is configured (e.g. no org or missing config). */
export const DEFAULT_GOVERNANCE_PROFILE: GovernanceProfile = "guarded";

/**
 * Map governance profile to system risk posture.
 * Used to drive existing policy/approval logic (no new code paths).
 */
export function profileToPosture(profile: GovernanceProfile): SystemRiskPosture {
  switch (profile) {
    case "observe":
      return "normal";
    case "guarded":
      return "normal";
    case "strict":
      return "elevated";
    case "locked":
      return "critical";
    default:
      return "normal";
  }
}

/**
 * Check if an action type is permitted by the org's governance profile config.
 * Returns null if permitted, or a denial reason string if blocked.
 */
export function checkActionTypeRestriction(
  actionType: string,
  config: GovernanceProfileConfig | null,
): string | null {
  if (!config) return null;

  // Allowlist takes precedence
  if (config.allowedActionTypes && config.allowedActionTypes.length > 0) {
    if (!config.allowedActionTypes.includes(actionType)) {
      return `Action type "${actionType}" is not in the organization's allowed action types`;
    }
    return null;
  }

  // Blocklist
  if (config.blockedActionTypes && config.blockedActionTypes.length > 0) {
    if (config.blockedActionTypes.includes(actionType)) {
      return `Action type "${actionType}" is blocked for this organization`;
    }
  }

  return null;
}

export interface GovernanceProfileStore {
  /** Get profile for organization (null = global default). */
  get(organizationId: string | null): Promise<GovernanceProfile>;
  set(organizationId: string | null, profile: GovernanceProfile): Promise<void>;
  /** Get the full config including action type restrictions. */
  getConfig(organizationId: string | null): Promise<GovernanceProfileConfig | null>;
  setConfig(organizationId: string | null, config: GovernanceProfileConfig): Promise<void>;
}

export class InMemoryGovernanceProfileStore implements GovernanceProfileStore {
  private store = new Map<string, GovernanceProfile>();
  private configs = new Map<string, GovernanceProfileConfig>();

  private key(organizationId: string | null): string {
    return organizationId ?? "global";
  }

  async get(organizationId: string | null): Promise<GovernanceProfile> {
    const k = this.key(organizationId);
    const config = this.configs.get(k);
    if (config) return config.profile;
    return this.store.get(k) ?? DEFAULT_GOVERNANCE_PROFILE;
  }

  async set(organizationId: string | null, profile: GovernanceProfile): Promise<void> {
    this.store.set(this.key(organizationId), profile);
  }

  async getConfig(organizationId: string | null): Promise<GovernanceProfileConfig | null> {
    return this.configs.get(this.key(organizationId)) ?? null;
  }

  async setConfig(organizationId: string | null, config: GovernanceProfileConfig): Promise<void> {
    this.configs.set(this.key(organizationId), config);
    this.store.set(this.key(organizationId), config.profile);
  }
}
