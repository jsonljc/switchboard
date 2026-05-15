// packages/core/src/agent-home/targets.ts
export interface AgentTargets {
  avgValueCents: number | null;
  targetCpbCents: number | null;
}

export function getAgentTargets(roster: { config: unknown }): AgentTargets {
  return {
    avgValueCents: readNonNegativeIntKey(roster.config, "avgValueCents"),
    targetCpbCents: readNonNegativeIntKey(roster.config, "targetCpbCents"),
  };
}

function readNonNegativeIntKey(config: unknown, key: string): number | null {
  if (config === null || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[key];
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  return value;
}
