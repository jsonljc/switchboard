import type { OpportunityStage, StageHandlerConfig, ThreadStatus } from "@switchboard/schemas";

export type StageHandlerMap = Record<OpportunityStage, StageHandlerConfig>;

export const DEFAULT_STAGE_HANDLER_MAP: StageHandlerMap = {
  interested: { preferredAgent: "employee-a", fallbackType: "fallback_handoff" },
  qualified: { preferredAgent: "employee-b", fallbackType: "fallback_handoff" },
  quoted: { preferredAgent: "employee-b", fallbackType: "fallback_handoff" },
  booked: { preferredAgent: "system", fallbackType: "none" },
  showed: { preferredAgent: "employee-d", fallbackType: "fallback_handoff" },
  won: { preferredAgent: "employee-d", fallbackType: "fallback_handoff" },
  lost: { preferredAgent: "employee-e", fallbackType: "fallback_handoff" },
  nurturing: { preferredAgent: "employee-e", fallbackType: "fallback_handoff" },
};

interface AgentRegistryLike {
  get(orgId: string, agentId: string): { status: string } | undefined;
}

type RoutingResult =
  | { agentId: string }
  | { fallback: true; missingAgent: string; reason: "not_configured" | "paused" | "errored" }
  | { suppress: true; reason: string };

export function agentForOpportunityStage(
  stage: OpportunityStage,
  stageHandlerMap: StageHandlerMap,
  registry: AgentRegistryLike,
  orgId: string,
  threadStatus?: ThreadStatus,
): RoutingResult {
  // Suppress proactive dispatch when waiting on customer
  if (threadStatus === "waiting_on_customer") {
    return { suppress: true, reason: "waiting_on_customer" };
  }

  const config = stageHandlerMap[stage];
  const preferred = config.preferredAgent;

  if (preferred === null) {
    return { fallback: true, missingAgent: "unknown", reason: "not_configured" };
  }

  // System handler (e.g., booked stage) — always available
  if (preferred === "system") {
    return { agentId: "system" };
  }

  const agents = Array.isArray(preferred) ? preferred : [preferred];

  for (const agentId of agents) {
    const entry = registry.get(orgId, agentId);
    if (entry?.status === "active") {
      return { agentId };
    }
  }

  // No active agent found — determine reason from first preferred
  const firstAgent = agents[0];
  if (!firstAgent) {
    return { fallback: true, missingAgent: "unknown", reason: "not_configured" };
  }

  const entry = registry.get(orgId, firstAgent);

  if (!entry) {
    return { fallback: true, missingAgent: firstAgent, reason: "not_configured" };
  }
  if (entry.status === "paused") {
    return { fallback: true, missingAgent: firstAgent, reason: "paused" };
  }
  return { fallback: true, missingAgent: firstAgent, reason: "errored" };
}
