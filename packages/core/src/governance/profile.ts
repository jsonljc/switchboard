import type { GovernanceProfile } from "@switchboard/schemas";
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

export interface GovernanceProfileStore {
  /** Get profile for organization (null = global default). */
  get(organizationId: string | null): Promise<GovernanceProfile>;
  set(organizationId: string | null, profile: GovernanceProfile): Promise<void>;
}

export class InMemoryGovernanceProfileStore implements GovernanceProfileStore {
  private store = new Map<string, GovernanceProfile>();

  private key(organizationId: string | null): string {
    return organizationId ?? "global";
  }

  async get(organizationId: string | null): Promise<GovernanceProfile> {
    const k = this.key(organizationId);
    return this.store.get(k) ?? DEFAULT_GOVERNANCE_PROFILE;
  }

  async set(organizationId: string | null, profile: GovernanceProfile): Promise<void> {
    this.store.set(this.key(organizationId), profile);
  }
}
