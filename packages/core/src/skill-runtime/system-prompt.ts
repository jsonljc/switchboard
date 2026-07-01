import type { SkillDefinition } from "./types.js";
import { interpolate } from "./template-engine.js";
import { getGovernanceConstraints } from "./governance-injector.js";

/**
 * Assemble the exact system prompt the skill executor sends the model: the
 * interpolated skill body followed by the runtime governance constraints.
 *
 * This is the SINGLE source of truth for system-prompt assembly.
 * `SkillExecutorImpl.execute` calls it once (before the tool loop, reused across
 * every continuation), and the golden prompt-diff harness snapshots its output,
 * so production and the harness can never drift.
 */
export function buildSystemPrompt(
  skill: SkillDefinition,
  parameters: Record<string, unknown>,
): string {
  const interpolated = interpolate(skill.body, parameters, skill.parameters);
  return `${interpolated}\n\n${getGovernanceConstraints()}`;
}
