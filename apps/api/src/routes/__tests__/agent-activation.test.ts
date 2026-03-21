import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentRegistry,
  LEAD_RESPONDER_PORT,
  SALES_CLOSER_PORT,
  NURTURE_AGENT_PORT,
  AD_OPTIMIZER_PORT,
  REVENUE_TRACKER_PORT,
} from "@switchboard/agents";
import type { AgentPort } from "@switchboard/agents";

function registerAgentsForOrg(
  registry: AgentRegistry,
  organizationId: string,
  purchasedAgents?: string[],
): void {
  const ports: AgentPort[] = [
    LEAD_RESPONDER_PORT,
    SALES_CLOSER_PORT,
    NURTURE_AGENT_PORT,
    AD_OPTIMIZER_PORT,
    REVENUE_TRACKER_PORT,
  ];

  for (const port of ports) {
    const isPurchased =
      !purchasedAgents || purchasedAgents.length === 0 || purchasedAgents.includes(port.agentId);

    registry.register(
      organizationId,
      {
        agentId: port.agentId,
        version: port.version,
        installed: true,
        status: isPurchased ? "active" : "disabled",
        config: {},
        capabilities: {
          accepts: port.inboundEvents,
          emits: port.outboundEvents,
          tools: port.tools.map((t) => t.name),
        },
      },
      { forceOverwrite: true },
    );
  }
}

describe("Agent Activation Model", () => {
  let registry: AgentRegistry;
  const orgId = "org_test_activation";

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it("registers all agents as active when purchasedAgents is empty", () => {
    registerAgentsForOrg(registry, orgId, []);
    const all = registry.listAll(orgId);
    expect(all).toHaveLength(5);
    expect(all.every((a) => a.status === "active")).toBe(true);
  });

  it("registers all agents as active when purchasedAgents is undefined", () => {
    registerAgentsForOrg(registry, orgId);
    const all = registry.listAll(orgId);
    expect(all).toHaveLength(5);
    expect(all.every((a) => a.status === "active")).toBe(true);
  });

  it("sets unpurchased agents to disabled", () => {
    registerAgentsForOrg(registry, orgId, ["lead-responder", "sales-closer"]);
    const all = registry.listAll(orgId);
    expect(all).toHaveLength(5);

    const lr = registry.get(orgId, "lead-responder");
    expect(lr?.status).toBe("active");

    const sc = registry.get(orgId, "sales-closer");
    expect(sc?.status).toBe("active");

    const nurture = registry.get(orgId, "nurture");
    expect(nurture?.status).toBe("disabled");

    const adOpt = registry.get(orgId, "ad-optimizer");
    expect(adOpt?.status).toBe("disabled");

    const revTracker = registry.get(orgId, "revenue-tracker");
    expect(revTracker?.status).toBe("disabled");
  });

  it("disabled agents are not returned by listActive", () => {
    registerAgentsForOrg(registry, orgId, ["lead-responder"]);
    const active = registry.listActive(orgId);
    expect(active).toHaveLength(1);
    expect(active[0]?.agentId).toBe("lead-responder");
  });

  it("disabled agents are not found by findByInboundEvent", () => {
    registerAgentsForOrg(registry, orgId, ["lead-responder"]);
    const matches = registry.findByInboundEvent(orgId, "message.received");
    expect(matches.every((m) => m.agentId === "lead-responder")).toBe(true);
  });
});
