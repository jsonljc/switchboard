import type { LifecycleWriteCapability } from "./types.js";
import {
  resolveLifecycleTaggingMechanicalConfig,
  resolveLifecycleQualificationConfig,
  type GovernanceConfig,
} from "@switchboard/schemas";

export interface LifecycleConfigResolverConfig {
  /**
   * Resolves a governance config for a given organization ID.
   * Returns the config object (or null/undefined for missing/off).
   * The resolver is called fresh on every `resolveCapabilities` call — no caching.
   */
  governanceConfigResolver: {
    resolve(organizationId: string): Promise<GovernanceConfig | null | undefined | unknown>;
  };
}

/**
 * Resolves the set of `LifecycleWriteCapability` values enabled for a given
 * organization by reading `lifecycleTagging.mechanical` and
 * `lifecycleTagging.qualification` from the org's governance config.
 *
 * Dependency constraint: if `qualification=on` but `mechanical=off`, mechanical
 * is auto-enabled (with a `console.warn`) because qualification state mutations
 * require a mechanical snapshot to exist.
 *
 * Config is read freshly on every call — feature flags are not cached.
 */
export class LifecycleConfigResolver {
  constructor(private readonly deps: LifecycleConfigResolverConfig) {}

  async resolveCapabilities(organizationId: string): Promise<Set<LifecycleWriteCapability>> {
    const config = (await this.deps.governanceConfigResolver.resolve(
      organizationId,
    )) as GovernanceConfig | null;

    const caps = new Set<LifecycleWriteCapability>();

    const mechanicalOn = resolveLifecycleTaggingMechanicalConfig(config).mode === "on";
    const qualificationOn = resolveLifecycleQualificationConfig(config).mode === "on";

    if (mechanicalOn) caps.add("mechanical");
    if (qualificationOn) caps.add("qualification");

    if (qualificationOn && !mechanicalOn) {
      console.warn(
        `[lifecycle] org ${organizationId}: lifecycleTagging.qualification=on but mechanical=off; auto-enabling mechanical for this org`,
      );
      caps.add("mechanical");
    }

    return caps;
  }
}
