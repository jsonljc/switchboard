import { notFound } from "next/navigation";
import { AGENT_KEYS } from "@switchboard/schemas";
import type { AgentKey } from "@switchboard/schemas";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";
import { AgentHomeShell } from "@/components/agent-home/agent-home-shell";

export default async function AgentHomePage({ params }: { params: Promise<{ agentKey: string }> }) {
  const { agentKey: rawAgentKey } = await params;
  if (!(AGENT_KEYS as readonly string[]).includes(rawAgentKey)) notFound();
  const agentKey = rawAgentKey as AgentKey;

  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes(agentKey)) notFound();

  return (
    <EditorialAuthShell>
      <AgentHomeShell agentKey={agentKey} />
    </EditorialAuthShell>
  );
}
