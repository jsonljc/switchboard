import type { AgentKey } from "@switchboard/schemas";

const SOURCE_AGENT_TO_KEY: Record<string, AgentKey> = {
  alex: "alex",
  "lead-specialist": "alex",
  "speed-to-lead": "alex",
  riley: "riley",
  "ad-optimizer": "riley",
  "digital-ads": "riley",
  mira: "mira",
  "creative-director": "mira",
  creative: "mira",
};

/**
 * Maps free-form sourceAgent / assignedAgent strings to the canonical AgentKey.
 * Default-to-Alex is deliberate: Alex owns the lead-to-consultation surface
 * where almost all handoffs originate in the launch vertical (med spa /
 * beauty / dental aesthetic).
 */
export function resolveAgentKey(sourceAgent: string | null | undefined): AgentKey {
  if (!sourceAgent) return "alex";
  return SOURCE_AGENT_TO_KEY[sourceAgent.toLowerCase()] ?? "alex";
}
