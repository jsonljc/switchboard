export interface AgentDisplay {
  name: string;
  role: string | null;
}

const MAP: Record<string, AgentDisplay> = {
  "billing-agent": { name: "Alex", role: "Billing & Bookings" },
  "bookings-agent": { name: "Alex", role: "Billing & Bookings" },
  "growth-agent": { name: "Riley", role: "Growth" },
  "ad-optimizer": { name: "Riley", role: "Growth" },
  "support-agent": { name: "Mira", role: "Care" },
  "compliance-agent": { name: "Mira", role: "Care" },
  "ops-agent": { name: "Mira", role: "Care" },
  "data-agent": { name: "Mira", role: "Care" },
};

/**
 * Maps an internal agent id to the customer-facing display.
 * Unknown ids return a generic fallback — never the raw id.
 */
export function agentDisplay(agentId: string | undefined | null): AgentDisplay {
  if (!agentId) return { name: "an agent", role: null };
  return MAP[agentId] ?? { name: "an agent", role: null };
}
