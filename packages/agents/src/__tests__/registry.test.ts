import { describe, it, expect } from "vitest";
import { AgentRegistry } from "../registry.js";

describe("AgentRegistry", () => {
  it("registers an agent with draft status", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "draft",
      config: {},
      capabilities: {
        accepts: ["lead.received"],
        emits: ["lead.qualified", "lead.disqualified"],
        tools: ["qualify_lead", "score_lead"],
      },
    });

    const entry = registry.get("org-1", "lead-responder");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("draft");
    expect(entry!.installed).toBe(true);
  });

  it("activates a draft agent", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "draft",
      config: { autoQualify: true },
      capabilities: {
        accepts: ["lead.received"],
        emits: ["lead.qualified"],
        tools: ["qualify_lead"],
      },
    });

    registry.updateStatus("org-1", "lead-responder", "active");
    const entry = registry.get("org-1", "lead-responder");
    expect(entry!.status).toBe("active");
  });

  it("lists only active agents for an org", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });
    registry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "draft",
      config: {},
      capabilities: { accepts: ["lead.qualified"], emits: [], tools: [] },
    });
    registry.register("org-1", {
      agentId: "nurture",
      version: "0.1.0",
      installed: true,
      status: "paused",
      config: {},
      capabilities: { accepts: ["stage.advanced"], emits: [], tools: [] },
    });

    const active = registry.listActive("org-1");
    expect(active).toHaveLength(1);
    expect(active[0]!.agentId).toBe("lead-responder");
  });

  it("finds agents that accept a given event type", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });
    registry.register("org-1", {
      agentId: "sales-closer",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.qualified"], emits: [], tools: [] },
    });

    const responders = registry.findByInboundEvent("org-1", "lead.received");
    expect(responders).toHaveLength(1);
    expect(responders[0]!.agentId).toBe("lead-responder");
  });

  it("returns empty array for unknown org", () => {
    const registry = new AgentRegistry();
    expect(registry.listActive("unknown-org")).toEqual([]);
    expect(registry.findByInboundEvent("unknown-org", "lead.received")).toEqual([]);
  });

  it("updates runtime info", () => {
    const registry = new AgentRegistry();
    registry.register("org-1", {
      agentId: "lead-responder",
      version: "0.1.0",
      installed: true,
      status: "active",
      config: {},
      capabilities: { accepts: ["lead.received"], emits: [], tools: [] },
    });

    registry.updateRuntime("org-1", "lead-responder", {
      provider: "openclaw",
      sessionId: "sess-123",
      health: "healthy",
      lastHeartbeatAt: "2026-03-18T10:00:00Z",
    });

    const entry = registry.get("org-1", "lead-responder");
    expect(entry!.runtime?.sessionId).toBe("sess-123");
    expect(entry!.runtime?.health).toBe("healthy");
  });
});
