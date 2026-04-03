import { describe, it, expect, vi } from "vitest";
import { createEmployeeContextFactory } from "../employee-context-factory.js";
import { createEventEnvelope } from "@switchboard/schemas";

describe("createEmployeeContextFactory", () => {
  const mockServices = {
    personality: { toPrompt: () => "You are a test." },
    knowledgeRetriever: { search: vi.fn().mockResolvedValue([]) },
    brandMemory: { search: vi.fn().mockResolvedValue([]) },
    skillStore: { getRelevant: vi.fn().mockResolvedValue([]) },
    performanceStore: { getTop: vi.fn().mockResolvedValue([]) },
    llmAdapter: { generate: vi.fn().mockResolvedValue({ text: "hello" }) },
    actionExecutor: {
      propose: vi.fn().mockResolvedValue({
        success: true,
        summary: "ok",
        externalRefs: {},
        rollbackAvailable: false,
        partialFailures: [],
        durationMs: 0,
        undoRecipe: null,
      }),
    },
    skillLearner: { learn: vi.fn().mockResolvedValue(undefined) },
  };

  it("constructs EmployeeContext from AgentContext", () => {
    const factory = createEmployeeContextFactory(mockServices);
    const event = createEventEnvelope({
      eventType: "test",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: {},
    });

    const ctx = factory.fromAgentContext(
      { organizationId: "org-1", contactData: { name: "Alice" } },
      event,
    );

    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.contactData).toEqual({ name: "Alice" });
    expect(ctx.personality.toPrompt()).toBe("You are a test.");
    expect(typeof ctx.knowledge.search).toBe("function");
    expect(typeof ctx.memory.brand.search).toBe("function");
    expect(typeof ctx.memory.skills.getRelevant).toBe("function");
    expect(typeof ctx.memory.performance.getTop).toBe("function");
    expect(typeof ctx.llm.generate).toBe("function");
    expect(typeof ctx.actions.propose).toBe("function");
    expect(typeof ctx.emit).toBe("function");
    expect(typeof ctx.learn).toBe("function");
  });

  it("constructs EmployeeContext from CartridgeContext", () => {
    const factory = createEmployeeContextFactory(mockServices);
    const ctx = factory.fromCartridgeContext({
      principalId: "user-1",
      organizationId: "org-1",
      connectionCredentials: {},
    });

    expect(ctx.organizationId).toBe("org-1");
    expect(ctx.contactData).toBeUndefined();
  });

  it("delegates knowledge.search to knowledgeRetriever", async () => {
    const factory = createEmployeeContextFactory(mockServices);
    const event = createEventEnvelope({
      eventType: "test",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: {},
    });

    const ctx = factory.fromAgentContext({ organizationId: "org-1" }, event);
    await ctx.knowledge.search("test query", 5);

    expect(mockServices.knowledgeRetriever.search).toHaveBeenCalledWith("test query", 5);
  });
});
