import { ok, getToolGovernanceDecision } from "@switchboard/core/skill-runtime";
import type {
  SkillTool,
  EffectCategory,
  TrustLevel,
  GovernanceDecision,
} from "@switchboard/core/skill-runtime";

/**
 * `SkillToolOperation` is not re-exported by name from `@switchboard/core/skill-runtime`,
 * so we derive it structurally from `SkillTool["operations"][string]` — the same
 * pattern `evals/alex-conversation/mock-tools.ts` uses for the operation type.
 */
type ToolOperation = SkillTool["operations"][string];

/**
 * Build a minimal valid `SkillToolOperation` carrying only the governance-relevant
 * fields. `getToolGovernanceDecision` reads only `effectCategory` and
 * `governanceOverride`; the rest is the smallest shape that satisfies the type.
 * `execute` is never invoked.
 */
function makeOp(
  effectCategory: EffectCategory,
  governanceOverride?: Partial<Record<TrustLevel, GovernanceDecision>>,
): ToolOperation {
  return {
    description: "governance-decision eval op",
    effectCategory,
    idempotent: true,
    inputSchema: { type: "object" },
    execute: async () => ok(undefined),
    ...(governanceOverride ? { governanceOverride } : {}),
  };
}

/**
 * Resolve a governance decision through the REAL live gate
 * (`getToolGovernanceDecision`), including its override-resolution logic. This is
 * the single source of truth shared by the runner and the test, so both pin the
 * actual function behavior — not a re-implementation of the policy table.
 */
export function decideForCase(input: {
  effectCategory: EffectCategory;
  trustLevel: TrustLevel;
  governanceOverride?: Partial<Record<TrustLevel, GovernanceDecision>>;
}): GovernanceDecision {
  return getToolGovernanceDecision(
    makeOp(input.effectCategory, input.governanceOverride),
    input.trustLevel,
  );
}
