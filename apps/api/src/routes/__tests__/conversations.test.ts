import { describe, it, expect, vi } from "vitest";
import {
  buildConversationList,
  buildConversationDetail,
  safeParseMessages,
} from "../conversations.js";

describe("buildConversationList", () => {
  it("returns paginated conversation list with messageCount and lastMessage", async () => {
    const now = new Date();
    const prisma = {
      conversationState: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "id-1",
            threadId: "t1",
            channel: "telegram",
            principalId: "user-1",
            organizationId: "org-1",
            status: "active",
            currentIntent: null,
            messages: JSON.stringify([
              { role: "user", text: "Hi", timestamp: now.toISOString() },
              { role: "assistant", text: "Hello!", timestamp: now.toISOString() },
            ]),
            lastActivityAt: now,
            firstReplyAt: now,
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    };

    const result = await buildConversationList(prisma as never, "org-1", {
      limit: 20,
      offset: 0,
    });

    expect(result.conversations).toHaveLength(1);
    const first = result.conversations[0]!;
    expect(first.threadId).toBe("t1");
    expect(first.messageCount).toBe(2);
    expect(first.lastMessage).toBe("Hello!");
    expect(result.total).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it("applies filters to the query", async () => {
    const prisma = {
      conversationState: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    await buildConversationList(prisma as never, "org-1", {
      status: "active",
      channel: "whatsapp",
      principalId: "p-1",
    });

    const expectedWhere = {
      organizationId: "org-1",
      status: "active",
      channel: "whatsapp",
      principalId: "p-1",
    };
    expect(prisma.conversationState.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(prisma.conversationState.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("clamps limit to max 100", async () => {
    const prisma = {
      conversationState: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    const result = await buildConversationList(prisma as never, "org-1", { limit: 500 });

    expect(result.limit).toBe(100);
    expect(prisma.conversationState.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("returns null lastMessage when no messages exist", async () => {
    const prisma = {
      conversationState: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "id-1",
            threadId: "t1",
            channel: "telegram",
            principalId: "user-1",
            organizationId: "org-1",
            status: "active",
            currentIntent: null,
            messages: "[]",
            lastActivityAt: new Date(),
            firstReplyAt: null,
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    };

    const result = await buildConversationList(prisma as never, "org-1", {});

    const first = result.conversations[0]!;
    expect(first.messageCount).toBe(0);
    expect(first.lastMessage).toBeNull();
    expect(first.firstReplyAt).toBeNull();
  });
});

describe("buildConversationDetail", () => {
  it("returns full conversation with parsed messages", async () => {
    const messages = [
      { role: "user", text: "Hi there", timestamp: new Date().toISOString() },
      { role: "assistant", text: "Welcome!", timestamp: new Date().toISOString() },
    ];
    const prisma = {
      conversationState: {
        findFirst: vi.fn().mockResolvedValue({
          id: "id-1",
          threadId: "t1",
          channel: "whatsapp",
          principalId: "user-1",
          organizationId: "org-1",
          status: "active",
          currentIntent: "booking",
          messages: JSON.stringify(messages),
          lastActivityAt: new Date(),
          firstReplyAt: new Date(),
        }),
      },
    };

    const result = await buildConversationDetail(prisma as never, "org-1", "t1");

    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(2);
    expect(result!.messages[0]!.role).toBe("user");
    expect(result!.messages[1]!.text).toBe("Welcome!");
    expect(result!.threadId).toBe("t1");
    expect(result!.channel).toBe("whatsapp");
  });

  it("queries with both threadId and organizationId for tenant isolation", async () => {
    const prisma = {
      conversationState: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    await buildConversationDetail(prisma as never, "org-1", "t1");

    expect(prisma.conversationState.findFirst).toHaveBeenCalledWith({
      where: { threadId: "t1", organizationId: "org-1" },
    });
  });

  it("returns null when conversation not found", async () => {
    const prisma = {
      conversationState: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const result = await buildConversationDetail(prisma as never, "org-1", "nonexistent");
    expect(result).toBeNull();
  });

  it("handles messages stored as array (already parsed by Prisma)", async () => {
    const messages = [{ role: "user", text: "Hey", timestamp: "2024-01-01T00:00:00Z" }];
    const prisma = {
      conversationState: {
        findFirst: vi.fn().mockResolvedValue({
          id: "id-1",
          threadId: "t1",
          channel: "slack",
          principalId: "user-1",
          organizationId: "org-1",
          status: "active",
          currentIntent: null,
          messages, // Already an array, not a JSON string
          lastActivityAt: new Date(),
          firstReplyAt: null,
        }),
      },
    };

    const result = await buildConversationDetail(prisma as never, "org-1", "t1");

    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0]!.text).toBe("Hey");
  });
});

describe("safeParseMessages", () => {
  it("parses valid JSON string", () => {
    const msgs = safeParseMessages('[{"role":"user","text":"hi","timestamp":"t"}]');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.role).toBe("user");
  });

  it("returns empty array for invalid JSON", () => {
    expect(safeParseMessages("not json")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(safeParseMessages('{"key":"value"}')).toEqual([]);
  });

  it("passes through arrays directly", () => {
    const arr = [{ role: "user", text: "hi", timestamp: "t" }];
    expect(safeParseMessages(arr)).toBe(arr);
  });

  it("returns empty array for null/undefined", () => {
    expect(safeParseMessages(null)).toEqual([]);
    expect(safeParseMessages(undefined)).toEqual([]);
  });
});
