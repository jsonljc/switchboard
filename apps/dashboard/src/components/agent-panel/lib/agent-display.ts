import type { AgentKey } from "@switchboard/schemas";
import type { HeroMetric } from "@/lib/agent-home/types";

export type PanelAgentKey = AgentKey;

export const agentDisplay: Record<PanelAgentKey, { name: string; role: string }> = {
  alex: { name: "Alex", role: "Lead response" },
  riley: { name: "Riley", role: "Ad optimizer" },
  mira: { name: "Mira", role: "Creative" },
};

/**
 * Narrows an untrusted value (e.g. a `?agent=` query param) to a known
 * PanelAgentKey, or null. Used by Home's server page to validate the agent
 * deep-link before auto-opening the panel.
 */
export function parsePanelAgentKey(value: unknown): PanelAgentKey | null {
  return typeof value === "string" && value in agentDisplay ? (value as PanelAgentKey) : null;
}

export function labelForHeroKind(kind: HeroMetric["kind"]): string {
  switch (kind) {
    case "tours-booked":
      return "consults booked";
    case "ad-leads":
      return "leads";
    case "creatives-shipped":
      return "creatives shipped";
    case "revenue-attributed":
      return "attributed";
  }
}
