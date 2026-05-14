"use client";

import type { AgentKey } from "@switchboard/schemas";
import { CockpitPage } from "@/components/cockpit/cockpit-page";
import { LegacyAgentHomeClient } from "./legacy-agent-home-client";

export function AgentHomeClient({ agentKey }: { agentKey: AgentKey }) {
  if (agentKey === "alex") return <CockpitPage />;
  return <LegacyAgentHomeClient agentKey={agentKey} />;
}
