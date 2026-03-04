import { describe, it, expect } from "vitest";

// We test parseMessages via the module's internal logic by importing and
// exercising toConversationStateData through the store's get/save flow.
// Since PrismaConversationStore depends on a Prisma client, we test the
// parsing logic directly.

// Re-create the parseMessages function here since it's not exported.
// This mirrors the implementation in prisma-store.ts exactly.
function parseMessages(raw: unknown): Array<{ role: string; text: string; timestamp: Date }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Array<{ role: string; text: string; timestamp: Date }>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Array<{ role: string; text: string; timestamp: Date }>;
    } catch {
      return [];
    }
  }
  return [];
}

describe("parseMessages", () => {
  it("returns empty array for null/undefined", () => {
    expect(parseMessages(null)).toEqual([]);
    expect(parseMessages(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseMessages("")).toEqual([]);
  });

  it("parses a JSON string of messages", () => {
    const messages = [
      { role: "user", text: "hello", timestamp: "2024-01-01T00:00:00Z" },
      { role: "assistant", text: "hi there", timestamp: "2024-01-01T00:00:01Z" },
    ];
    const result = parseMessages(JSON.stringify(messages));
    expect(result).toEqual(messages);
  });

  it("returns the array as-is when given an array directly", () => {
    const messages = [{ role: "user", text: "hello", timestamp: new Date() }];
    expect(parseMessages(messages)).toBe(messages);
  });

  it("returns empty array for invalid JSON string", () => {
    expect(parseMessages("not valid json")).toEqual([]);
  });

  it("returns empty array for non-string/non-array types", () => {
    expect(parseMessages(42)).toEqual([]);
    expect(parseMessages({})).toEqual([]);
    expect(parseMessages(true)).toEqual([]);
  });

  it("handles the default Prisma Json value '[]'", () => {
    expect(parseMessages("[]")).toEqual([]);
  });
});

describe("PrismaConversationStore integration", () => {
  it("save includes messages in both create and update data", async () => {
    // Verify the structure by creating a mock PrismaClient and checking
    // that messages are included in the upsert call
    const upsertArgs: unknown[] = [];
    const mockPrisma = {
      conversationState: {
        upsert: async (args: unknown) => {
          upsertArgs.push(args);
        },
        findUnique: async () => null,
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
      },
    };

    // Dynamic import to avoid issues with Prisma type expectations
    const { PrismaConversationStore } = await import("../conversation/prisma-store.js");
    const store = new PrismaConversationStore(mockPrisma as never);

    const state = {
      id: "conv_test",
      threadId: "thread_1",
      channel: "slack",
      principalId: "user_1",
      status: "active" as const,
      currentIntent: null,
      pendingProposalIds: [],
      pendingApprovalIds: [],
      clarificationQuestion: null,
      firstReplyAt: null,
      messages: [
        { role: "user" as const, text: "hello", timestamp: new Date("2024-01-01") },
        { role: "assistant" as const, text: "hi", timestamp: new Date("2024-01-01") },
      ],
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };

    await store.save(state);

    expect(upsertArgs).toHaveLength(1);
    const arg = upsertArgs[0] as {
      create: { messages: string };
      update: { messages: string };
    };
    const createMessages = JSON.parse(arg.create.messages);
    const updateMessages = JSON.parse(arg.update.messages);
    expect(createMessages).toHaveLength(2);
    expect(updateMessages).toHaveLength(2);
    expect(createMessages[0].role).toBe("user");
    expect(createMessages[0].text).toBe("hello");
  });

  it("get returns parsed messages from stored data", async () => {
    const storedMessages = [{ role: "user", text: "hello", timestamp: "2024-01-01T00:00:00Z" }];

    const mockPrisma = {
      conversationState: {
        findUnique: async () => ({
          id: "conv_test",
          threadId: "thread_1",
          channel: "slack",
          principalId: "user_1",
          status: "active",
          currentIntent: null,
          pendingProposalIds: [],
          pendingApprovalIds: [],
          clarificationQuestion: null,
          messages: storedMessages, // Prisma returns parsed JSON
          lastActivityAt: new Date(),
          expiresAt: new Date(),
        }),
      },
    };

    const { PrismaConversationStore } = await import("../conversation/prisma-store.js");
    const store = new PrismaConversationStore(mockPrisma as never);

    const result = await store.get("thread_1");
    expect(result).not.toBeUndefined();
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0]!.role).toBe("user");
    expect(result!.messages[0]!.text).toBe("hello");
  });

  it("get returns empty messages for row with no messages field (backward compat)", async () => {
    const mockPrisma = {
      conversationState: {
        findUnique: async () => ({
          id: "conv_test",
          threadId: "thread_1",
          channel: "slack",
          principalId: "user_1",
          status: "active",
          currentIntent: null,
          pendingProposalIds: [],
          pendingApprovalIds: [],
          clarificationQuestion: null,
          messages: null, // Old rows might have null
          lastActivityAt: new Date(),
          expiresAt: new Date(),
        }),
      },
    };

    const { PrismaConversationStore } = await import("../conversation/prisma-store.js");
    const store = new PrismaConversationStore(mockPrisma as never);

    const result = await store.get("thread_1");
    expect(result).not.toBeUndefined();
    expect(result!.messages).toEqual([]);
  });
});
