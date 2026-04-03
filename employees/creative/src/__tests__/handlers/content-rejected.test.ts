import { describe, it, expect, vi } from "vitest";
import { handleContentRejected } from "../../handlers/content-rejected.js";
import { createEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext } from "@switchboard/employee-sdk";

function createMockContext(): EmployeeContext {
  return {
    organizationId: "org-1",
    knowledge: { search: vi.fn().mockResolvedValue([]) },
    memory: {
      brand: {
        search: vi.fn().mockResolvedValue([]),
      },
      skills: {
        getRelevant: vi.fn().mockResolvedValue([]),
      },
      performance: {
        getTop: vi.fn().mockResolvedValue([]),
      },
    },
    llm: {
      generate: vi.fn().mockResolvedValue({ text: "Revised content addressing feedback." }),
    },
    actions: {
      propose: vi.fn(),
    },
    emit: vi.fn(),
    learn: vi.fn().mockResolvedValue(undefined),
    personality: { toPrompt: () => "You are a creative strategist." },
  };
}

describe("handleContentRejected", () => {
  it("learns from rejection and generates revision", async () => {
    const ctx = createMockContext();
    const event = createEventEnvelope({
      eventType: "content.rejected",
      organizationId: "org-1",
      source: { type: "manual", id: "user-1" },
      payload: {
        draftId: "draft-1",
        content: "Original content that was rejected.",
        channel: "linkedin",
        format: "post",
        feedback: "Too informal, needs more data points.",
      },
    });

    const result = await handleContentRejected(event, ctx);

    // Should learn from rejection
    expect(ctx.learn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "rejection",
        feedback: "Too informal, needs more data points.",
        channel: "linkedin",
      }),
    );

    // Should generate revision
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.type).toBe("creative.content.revise");
    expect(result.actions[0]!.params.originalDraftId).toBe("draft-1");

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe("content.draft_ready");
  });
});
