import { describe, it, expect } from "vitest";
import type {
  ToolDeclaration,
  AgentPort,
  LifecycleAdvancer,
  AgentContext,
  ThreadUpdate,
  ActionRequest,
  PortValidationResult,
} from "../agent-types.js";

describe("Agent types", () => {
  it("ToolDeclaration is structurally valid", () => {
    const tool: ToolDeclaration = {
      name: "search",
      description: "Search for leads",
      parameters: { query: { type: "string" } },
    };
    expect(tool.name).toBe("search");
  });

  it("AgentPort is structurally valid", () => {
    const port: AgentPort = {
      agentId: "employee-a",
      version: "1.0.0",
      inboundEvents: ["lead.received"],
      outboundEvents: ["lead.qualified"],
      tools: [],
      configSchema: {},
    };
    expect(port.agentId).toBe("employee-a");
    expect(port.conversionActionTypes).toBeUndefined();
  });

  it("AgentContext is structurally valid", () => {
    const ctx: AgentContext = {
      organizationId: "org-1",
    };
    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.thread).toBeUndefined();
    expect(ctx.lifecycle).toBeUndefined();
  });

  it("ThreadUpdate is structurally valid", () => {
    const update: ThreadUpdate = {
      stage: "responding",
      assignedAgent: "employee-a",
      messageCount: 5,
    };
    expect(update.stage).toBe("responding");
  });

  it("ActionRequest is structurally valid", () => {
    const action: ActionRequest = {
      actionType: "send_message",
      parameters: { text: "Hello" },
    };
    expect(action.actionType).toBe("send_message");
  });

  it("PortValidationResult is structurally valid", () => {
    const result: PortValidationResult = {
      valid: true,
      errors: [],
    };
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("LifecycleAdvancer interface can be implemented", () => {
    const advancer: LifecycleAdvancer = {
      advanceOpportunityStage: async (_orgId, _oppId, _toStage, _advancedBy) => undefined,
      reopenOpportunity: async (_orgId, _oppId, _toStage) => undefined,
    };
    expect(typeof advancer.advanceOpportunityStage).toBe("function");
    expect(typeof advancer.reopenOpportunity).toBe("function");
  });
});
