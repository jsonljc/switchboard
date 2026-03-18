/** Maps agent roles to the action type prefixes they own. */
const AGENT_ACTION_PREFIXES: Record<string, string[]> = {
  lead_agent: ["customer-engagement", "crm.contact", "crm.deal"],
  ad_agent: ["digital-ads", "campaign"],
  booking_agent: ["customer-engagement.appointment", "customer-engagement.booking"],
  follow_up_agent: ["customer-engagement.cadence", "customer-engagement.follow"],
};

export function getAgentForAction(actionType: string): string | null {
  // Check most specific prefixes first (longer = more specific)
  const entries = Object.entries(AGENT_ACTION_PREFIXES).sort(
    ([, a], [, b]) => Math.max(...b.map((p) => p.length)) - Math.max(...a.map((p) => p.length)),
  );
  for (const [role, prefixes] of entries) {
    for (const prefix of prefixes) {
      if (actionType.startsWith(prefix)) return role;
    }
  }
  return null;
}

export function agentRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    lead_agent: "Lead Agent",
    ad_agent: "Ad Agent",
    booking_agent: "Booking Agent",
    follow_up_agent: "Follow-Up Agent",
  };
  return labels[role] ?? role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
