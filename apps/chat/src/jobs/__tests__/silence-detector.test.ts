import { describe, it, expect, vi } from "vitest";
import { detectSilentConversations } from "../silence-detector.js";

function createMockPrisma(conversations: unknown[] = []) {
  return {
    conversationState: {
      findMany: vi.fn().mockResolvedValue(conversations),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("detectSilentConversations", () => {
  it("emits 'unresponsive' for conversations silent > 72 hours", async () => {
    const outcomePipeline = {
      emitOutcome: vi.fn().mockResolvedValue({}),
    };

    const now = new Date();
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);

    const prisma = createMockPrisma([
      {
        threadId: "thread-1",
        organizationId: "org-1",
        status: "active",
        lastInboundAt: fourDaysAgo,
      },
    ]);

    const count = await detectSilentConversations({
      prisma: prisma as never,
      outcomePipeline: outcomePipeline as never,
    });

    expect(outcomePipeline.emitOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "thread-1",
        organizationId: "org-1",
        outcomeType: "unresponsive",
      }),
    );
    expect(prisma.conversationState.update).toHaveBeenCalledWith({
      where: { threadId: "thread-1" },
      data: { status: "completed" },
    });
    expect(count).toBe(1);
  });

  it("does NOT flag conversations with recent activity", async () => {
    const outcomePipeline = { emitOutcome: vi.fn().mockResolvedValue({}) };

    // DB query filters by lastInboundAt < cutoff, so recent conversations won't be returned
    const prismaNoResults = createMockPrisma([]);

    const count = await detectSilentConversations({
      prisma: prismaNoResults as never,
      outcomePipeline: outcomePipeline as never,
    });

    expect(outcomePipeline.emitOutcome).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("skips conversations without organizationId", async () => {
    const outcomePipeline = { emitOutcome: vi.fn().mockResolvedValue({}) };
    const prisma = createMockPrisma([
      { threadId: "thread-3", organizationId: null, status: "active" },
    ]);

    const count = await detectSilentConversations({
      prisma: prisma as never,
      outcomePipeline: outcomePipeline as never,
    });

    expect(outcomePipeline.emitOutcome).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
