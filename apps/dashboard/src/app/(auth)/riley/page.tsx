import { notFound } from "next/navigation";
import { fetchEnabledAgentsServer } from "@/lib/api-client/agents-server";
import { EditorialAuthShell } from "@/components/layout/editorial-auth-shell";
import { AgentHomeShell } from "@/components/agent-home/agent-home-shell";

export default async function RileyPage() {
  const enabled = await fetchEnabledAgentsServer();
  if (!enabled.includes("riley")) notFound();

  return (
    <EditorialAuthShell>
      <AgentHomeShell agentKey="riley" />
    </EditorialAuthShell>
  );
}
