import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConversationStore } from "../prisma-conversation-store.js";

function mockPrisma() {
  return {
    conversationMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
    },
    contactLifecycle: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("PrismaConversationStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaConversationStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaConversationStore(prisma as never, "org-1");
  });

  it("getHistory returns messages ordered by createdAt", async () => {
    prisma.conversationMessage.findMany.mockResolvedValue([
      {
        id: "m1",
        contactId: "c1",
        direction: "inbound",
        content: "hi",
        channel: "whatsapp",
        metadata: {},
        createdAt: new Date("2026-01-01"),
      },
    ]);

    const messages = await store.getHistory("c1");
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe("hi");
    expect(prisma.conversationMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId: "c1", orgId: "org-1" },
      }),
    );
  });

  it("appendMessage creates a new message record", async () => {
    await store.appendMessage("c1", {
      id: "m2",
      contactId: "c1",
      direction: "outbound",
      content: "hello",
      timestamp: "2026-01-01T00:00:00Z",
      channel: "whatsapp",
    });

    expect(prisma.conversationMessage.create).toHaveBeenCalledOnce();
  });

  it("getStage returns 'lead' when no lifecycle record exists", async () => {
    prisma.contactLifecycle.findUnique.mockResolvedValue(null);
    const stage = await store.getStage("c1");
    expect(stage).toBe("lead");
  });

  it("setStage upserts lifecycle record", async () => {
    await store.setStage("c1", "qualified");
    expect(prisma.contactLifecycle.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId_orgId: { contactId: "c1", orgId: "org-1" } },
      }),
    );
  });

  it("isOptedOut returns false when no record exists", async () => {
    prisma.contactLifecycle.findUnique.mockResolvedValue(null);
    expect(await store.isOptedOut("c1")).toBe(false);
  });

  it("setOptOut upserts opt-out status", async () => {
    await store.setOptOut("c1", true);
    expect(prisma.contactLifecycle.upsert).toHaveBeenCalledOnce();
  });
});
