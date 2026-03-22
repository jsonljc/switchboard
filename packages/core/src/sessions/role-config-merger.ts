import type { SafetyEnvelope, AgentRoleOverride } from "@switchboard/schemas";

export interface ManifestDefaults {
  safetyEnvelope: SafetyEnvelope;
  toolPack: string[];
  governanceProfile: string;
}

export interface MergedRoleConfig {
  safetyEnvelope: SafetyEnvelope;
  toolPack: string[];
  governanceProfile: string;
}

/**
 * Merge role manifest defaults with org-level and request-level overrides.
 *
 * Rules:
 * - Safety envelope: overrides can only TIGHTEN (lower) limits, never loosen
 * - Tool pack: overrides can only NARROW (subset), never add tools
 * - Governance profile: org override replaces; request cannot override
 *
 * Merge order: manifest → org override → request override
 * Each layer can only make things stricter.
 */
export function mergeRoleConfig(input: {
  manifestDefaults: ManifestDefaults;
  orgOverride: AgentRoleOverride | null;
  requestOverride: Partial<SafetyEnvelope> | undefined;
}): MergedRoleConfig {
  const { manifestDefaults, orgOverride, requestOverride } = input;

  // Start with manifest defaults
  let envelope = { ...manifestDefaults.safetyEnvelope };
  let toolPack = [...manifestDefaults.toolPack];
  let governanceProfile = manifestDefaults.governanceProfile;

  // Apply org override (tighten only)
  if (orgOverride) {
    envelope = tightenEnvelope(envelope, orgOverride.safetyEnvelopeOverride);

    if (orgOverride.allowedTools && orgOverride.allowedTools.length > 0) {
      // Intersection: only tools that are in BOTH manifest and override
      toolPack = toolPack.filter((t) => orgOverride.allowedTools!.includes(t));
    }

    if (orgOverride.governanceProfileOverride) {
      governanceProfile = orgOverride.governanceProfileOverride;
    }
  }

  // Apply request override (tighten only)
  if (requestOverride) {
    envelope = tightenEnvelope(envelope, requestOverride);
  }

  return { safetyEnvelope: envelope, toolPack, governanceProfile };
}

/**
 * Apply override values only when they are LOWER (stricter) than current.
 */
function tightenEnvelope(
  current: SafetyEnvelope,
  override: Partial<SafetyEnvelope> | undefined | null,
): SafetyEnvelope {
  if (!override) return current;

  return {
    maxToolCalls:
      override.maxToolCalls !== undefined && override.maxToolCalls < current.maxToolCalls
        ? override.maxToolCalls
        : current.maxToolCalls,
    maxMutations:
      override.maxMutations !== undefined && override.maxMutations < current.maxMutations
        ? override.maxMutations
        : current.maxMutations,
    maxDollarsAtRisk:
      override.maxDollarsAtRisk !== undefined &&
      override.maxDollarsAtRisk < current.maxDollarsAtRisk
        ? override.maxDollarsAtRisk
        : current.maxDollarsAtRisk,
    sessionTimeoutMs:
      override.sessionTimeoutMs !== undefined &&
      override.sessionTimeoutMs < current.sessionTimeoutMs
        ? override.sessionTimeoutMs
        : current.sessionTimeoutMs,
  };
}
