import { notFound } from "next/navigation";
import { AGENT_KEYS } from "@switchboard/schemas";
import type { AgentKey } from "@switchboard/schemas";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";
import { AgentHomeClient } from "./agent-home-client";

export default async function AgentHomePage({ params }: { params: { agentKey: string } }) {
  if (!(AGENT_KEYS as readonly string[]).includes(params.agentKey)) notFound();
  const agentKey = params.agentKey as AgentKey;

  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes(agentKey)) notFound();

  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") notFound();

  return (
    <EditorialAuthShell>
      <AgentHomeClient agentKey={agentKey} />
    </EditorialAuthShell>
  );
}
