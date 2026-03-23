import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversationThreadStore } from "../prisma-thread-store.js";

function mockPrisma() {
  return {
    conversationThread: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

describe("PrismaConversationThreadStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaConversationThreadStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaConversationThreadStore(prisma);
  });

  it("getByContact returns null when no thread exists", async () => {
    (prisma.conversationThread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await store.getByContact("c-1", "org-1");
    expect(result).toBeNull();
    expect(prisma.conversationThread.findUnique).toHaveBeenCalledWith({
      where: { contactId_organizationId: { contactId: "c-1", organizationId: "org-1" } },
    });
  });

  it("getByContact maps Prisma row to ConversationThread", async () => {
    const now = new Date();
    (prisma.conversationThread.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "responding",
      assignedAgent: "lead-responder",
      agentContext: {
        objectionsEncountered: ["price"],
        preferencesLearned: {},
        offersMade: [],
        topicsDiscussed: [],
        sentimentTrend: "neutral",
      },
      currentSummary: "Lead asked about pricing.",
      followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
      lastOutcomeAt: null,
      messageCount: 5,
      createdAt: now,
      updatedAt: now,
    });

    const result = await store.getByContact("c-1", "org-1");
    expect(result).not.toBeNull();
    expect(result!.stage).toBe("responding");
    expect(result!.agentContext.objectionsEncountered).toEqual(["price"]);
    expect(result!.messageCount).toBe(5);
  });

  it("create persists a new thread", async () => {
    const now = new Date();
    const thread = {
      id: "t-1",
      contactId: "c-1",
      organizationId: "org-1",
      stage: "new" as const,
      assignedAgent: "lead-responder",
      agentContext: {
        objectionsEncountered: [],
        preferencesLearned: {},
        offersMade: [],
        topicsDiscussed: [],
        sentimentTrend: "unknown" as const,
      },
      currentSummary: "",
      followUpSchedule: { nextFollowUpAt: null, reason: null, cadenceId: null },
      lastOutcomeAt: null,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await store.create(thread);
    expect(prisma.conversationThread.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "t-1", contactId: "c-1", stage: "new" }),
    });
  });

  it("update applies partial changes", async () => {
    await store.update("t-1", { stage: "qualifying", messageCount: 6 });
    expect(prisma.conversationThread.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: expect.objectContaining({ stage: "qualifying", messageCount: 6 }),
    });
  });
});
