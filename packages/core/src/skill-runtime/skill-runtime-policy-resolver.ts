import type { SkillRuntimePolicy, SkillDefinition } from "./types.js";
import { DEFAULT_SKILL_RUNTIME_POLICY } from "./types.js";
import type { ModelSlot } from "../model-router.js";
import type { TrustLevel } from "./governance.js";

interface DeploymentRecord {
  trustLevel: string;
  circuitBreakerThreshold?: number | null;
  maxWritesPerHour?: number | null;
  allowedModelTiers?: string[];
}

const TRUST_LEVEL_MAP: Record<string, TrustLevel> = {
  observe: "autonomous",
  guarded: "guided",
  strict: "supervised",
  locked: "supervised",
};

export class SkillRuntimePolicyResolver {
  resolve(deployment: DeploymentRecord, skill: SkillDefinition): SkillRuntimePolicy {
    const trustLevel = TRUST_LEVEL_MAP[deployment.trustLevel] ?? "guided";

    const allowedModelTiers: ModelSlot[] =
      deployment.allowedModelTiers && deployment.allowedModelTiers.length > 0
        ? (deployment.allowedModelTiers as ModelSlot[])
        : [...DEFAULT_SKILL_RUNTIME_POLICY.allowedModelTiers];

    if (skill.minimumModelTier && !allowedModelTiers.includes(skill.minimumModelTier)) {
      throw new Error(
        `Skill "${skill.slug}" requires minimumModelTier "${skill.minimumModelTier}" ` +
          `but deployment only allows [${allowedModelTiers.join(", ")}]`,
      );
    }

    const policy: SkillRuntimePolicy = {
      ...DEFAULT_SKILL_RUNTIME_POLICY,
      trustLevel,
      allowedModelTiers,
      minimumModelTier: skill.minimumModelTier,
      circuitBreakerThreshold:
        deployment.circuitBreakerThreshold ?? DEFAULT_SKILL_RUNTIME_POLICY.circuitBreakerThreshold,
      maxWritesPerHour:
        deployment.maxWritesPerHour ?? DEFAULT_SKILL_RUNTIME_POLICY.maxWritesPerHour,
    };

    return Object.freeze(policy);
  }
}
