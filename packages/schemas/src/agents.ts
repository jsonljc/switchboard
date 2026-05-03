import { z } from "zod";

export const AGENT_REGISTRY = {
  alex: {
    key: "alex",
    slug: "alex",
    role: "lead-to-speed",
    displayName: "Alex",
    accent: "hsl(20 90% 55%)", // marketing orange
    launchTier: "day-one",
  },
  riley: {
    key: "riley",
    slug: "riley",
    role: "ad-optimizer",
    displayName: "Riley",
    accent: "hsl(15 45% 50%)", // warm clay
    launchTier: "day-one",
  },
  mira: {
    key: "mira",
    slug: "mira",
    role: "creative",
    displayName: "Mira",
    accent: "hsl(265 30% 35%)", // ink violet
    launchTier: "day-thirty",
  },
} as const;

export type AgentKey = keyof typeof AGENT_REGISTRY;
export type AgentRegistryEntry = (typeof AGENT_REGISTRY)[AgentKey];

export const AGENT_KEYS = Object.keys(AGENT_REGISTRY) as readonly AgentKey[];

// Derived from AGENT_REGISTRY — adding a new agent to the const auto-extends
// validation. Do NOT maintain a parallel list.
export const AgentKeySchema = z.enum(AGENT_KEYS as unknown as [AgentKey, ...AgentKey[]]);

export function getAgent(key: AgentKey): AgentRegistryEntry {
  return AGENT_REGISTRY[key];
}

export function isAgentKey(s: string): s is AgentKey {
  return Object.prototype.hasOwnProperty.call(AGENT_REGISTRY, s);
}
