import { describe, it, expect, vi } from "vitest";
import { handleContentRequested } from "../../handlers/content-requested.js";
import { createEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext } from "@switchboard/employee-sdk";

function createMockContext(overrides?: Partial<EmployeeContext>): EmployeeContext {
  return {
    organizationId: "org-1",
    knowledge: { search: vi.fn().mockResolvedValue([]) },
    memory: {
      brand: {
        search: vi
          .fn()
          .mockResolvedValue([{ content: "Brand is professional and modern.", similarity: 0.9 }]),
      },
      skills: {
        getRelevant: vi
          .fn()
          .mockResolvedValue([{ pattern: "Use short paragraphs for LinkedIn.", score: 0.8 }]),
      },
      performance: {
        getTop: vi.fn().mockResolvedValue([]),
      },
    },
    llm: {
      generate: vi.fn().mockResolvedValue({ text: "Generated content about AI trends." }),
    },
    actions: {
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
    emit: vi.fn(),
    learn: vi.fn().mockResolvedValue(undefined),
    personality: { toPrompt: () => "You are a creative strategist." },
    ...overrides,
  };
}

describe("handleContentRequested", () => {
  it("generates content and returns draft action + event", async () => {
    const ctx = createMockContext();
    const event = createEventEnvelope({
      eventType: "content.requested",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: {
        channel: "linkedin",
        format: "post",
        topic: "AI trends in 2026",
      },
    });

    const result = await handleContentRequested(event, ctx);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.type).toBe("creative.content.draft");
    expect(result.actions[0]!.params.content).toBe("Generated content about AI trends.");
    expect(result.actions[0]!.params.channel).toBe("linkedin");

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe("content.draft_ready");

    expect(ctx.memory.brand.search).toHaveBeenCalled();
    expect(ctx.memory.skills.getRelevant).toHaveBeenCalledWith("content_creation", "post", 3);
    expect(ctx.llm.generate).toHaveBeenCalled();
  });
});
