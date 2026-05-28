import type { OrgAgentEnablementStore } from "@switchboard/core";

// Agent-home access policy (PR3 — Mira M1):
//   - alex / riley: always accessible (day-one agents).
//   - mira: accessible ONLY when an OrgAgentEnablement row with status "enabled"
//     exists for the org (opt-in per pilot org). No global flip.
//   - any other agent id: not accessible.
const ALWAYS_ON = new Set(["alex", "riley"]);
const ENABLEMENT_GATED = new Set(["mira"]);

export async function isAgentHomeAccessible(
  agentId: string,
  orgId: string,
  store: Pick<OrgAgentEnablementStore, "list">,
): Promise<boolean> {
  if (ALWAYS_ON.has(agentId)) return true;
  if (!ENABLEMENT_GATED.has(agentId)) return false;
  const rows = await store.list(orgId);
  return rows.some((r) => r.agentKey === agentId && r.status === "enabled");
}
