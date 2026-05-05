import type { AgentKey } from "@switchboard/schemas";
import { AGENT_KEYS } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";

/**
 * Server-side equivalent of useAgents() — calls the Fastify /api/dashboard/agents
 * endpoint directly via the api client. Returns the org-enabled agent keys.
 *
 * Falls back to ["alex"] on any failure so the shell still renders for orgs whose
 * enablement row may not be backfilled. The EditorialShellBoundary catches harder
 * errors at the React layer.
 */
export async function fetchEnabledAgentsServer(): Promise<readonly AgentKey[]> {
  try {
    const client = await getApiClient();
    const body = await client.getEnabledAgents();
    return body.agents
      .filter((a) => a.status === "enabled")
      .map((a) => a.key)
      .filter((k): k is AgentKey => (AGENT_KEYS as readonly string[]).includes(k));
  } catch (err) {
    console.warn("[fetchEnabledAgentsServer] falling back to ['alex']:", err);
    return ["alex"];
  }
}
