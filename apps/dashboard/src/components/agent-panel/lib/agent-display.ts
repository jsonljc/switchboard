import type { AgentKey } from "@switchboard/schemas";
import type { HeroMetric } from "@/lib/agent-home/types";

export type PanelAgentKey = AgentKey;

export const agentDisplay: Record<PanelAgentKey, { name: string; role: string }> = {
  alex: { name: "Alex", role: "Lead response" },
  riley: { name: "Riley", role: "Ad optimizer" },
  mira: { name: "Mira", role: "Creative" },
};

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
