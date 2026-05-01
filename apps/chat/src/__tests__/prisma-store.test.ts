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
        findFirst: async () => null,
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
      organizationId: "org_a",
      channel: "slack",
      principalId: "user_1",
      status: "active" as const,
      currentIntent: null,
      pendingProposalIds: [],
      pendingApprovalIds: [],
      clarificationQuestion: null,
      firstReplyAt: null,
      lastInboundAt: null,
      messages: [
        { role: "user" as const, text: "hello", timestamp: new Date("2024-01-01") },
        { role: "assistant" as const, text: "hi", timestamp: new Date("2024-01-01") },
      ],
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      crmContactId: null,
      leadProfile: null,
      detectedLanguage: null,
      machineState: null,
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
        findFirst: async (_args: unknown) => ({
          id: "conv_test",
          threadId: "thread_1",
          organizationId: "org_1",
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

    const result = await store.get("thread_1", "org_1");
    expect(result).not.toBeUndefined();
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0]!.role).toBe("user");
    expect(result!.messages[0]!.text).toBe("hello");
  });

  it("get returns empty messages for row with no messages field (backward compat)", async () => {
    const mockPrisma = {
      conversationState: {
        findFirst: async (_args: unknown) => ({
          id: "conv_test",
          threadId: "thread_1",
          organizationId: "org_1",
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

    const result = await store.get("thread_1", "org_1");
    expect(result).not.toBeUndefined();
    expect(result!.messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant defense — TI-5/TI-6
//
// threadId is @unique at the schema level, so the failure mode is not
// "two orgs share a threadId" but rather "a stale row's organizationId differs
// from (or is null relative to) the requesting org's". These tests assert that
// PrismaConversationStore.get / delete / listActive each pass the requesting
// orgId through to Prisma, so a stale cross-tenant row cannot leak.
// ---------------------------------------------------------------------------

describe("PrismaConversationStore cross-tenant scoping (TI-5/TI-6)", () => {
  it("get(threadId, orgA) does not see a stale row whose organizationId is orgB", async () => {
    const findFirstCalls: unknown[] = [];
    // Simulate the database state: a row exists with threadId="t1" and
    // organizationId="org_b". The store must filter on organizationId — so
    // when org_a queries, Prisma's findFirst returns null and the store
    // surfaces undefined.
    const mockPrisma = {
      conversationState: {
        findFirst: async (args: unknown) => {
          findFirstCalls.push(args);
          const where = (args as { where: { threadId: string; organizationId: string } }).where;
          // The "stored" row is for org_b; only return it when org_b asks.
          if (where.organizationId === "org_b") {
            return {
              id: "conv_b",
              threadId: where.threadId,
              organizationId: "org_b",
              channel: "slack",
              principalId: "user_b",
              status: "active",
              currentIntent: null,
              pendingProposalIds: [],
              pendingApprovalIds: [],
              clarificationQuestion: null,
              messages: [],
              lastActivityAt: new Date(),
              expiresAt: new Date(),
            };
          }
          return null;
        },
      },
    };

    const { PrismaConversationStore } = await import("../conversation/prisma-store.js");
    const store = new PrismaConversationStore(mockPrisma as never);

    const orgA = await store.get("t1", "org_a");
    expect(orgA).toBeUndefined();

    const orgB = await store.get("t1", "org_b");
    expect(orgB).not.toBeUndefined();
    expect(orgB!.organizationId).toBe("org_b");

    // Both calls passed organizationId in the where clause (no
    // bare-threadId leak path).
    expect(findFirstCalls).toHaveLength(2);
    for (const call of findFirstCalls) {
      const where = (call as { where: Record<string, unknown> }).where;
      expect(where["threadId"]).toBe("t1");
      expect(where["organizationId"]).toBeDefined();
    }
  });

  it("get(threadId, orgA) does not see a stale row whose organizationId is null", async () => {
    const mockPrisma = {
      conversationState: {
        findFirst: async (args: unknown) => {
          const where = (args as { where: { organizationId: string | null } }).where;
          // A null-orgId row is invisible to any explicit-org query because
          // Prisma's equality filter on a string never matches null.
          if (where.organizationId === null) return { id: "conv_orphan" };
          return null;
        },
      },
    };

    const { PrismaConversationStore } = await import("../conversation/prisma-store.js");
    const store = new PrismaConversationStore(mockPrisma as never);

    const result = await store.get("t1", "org_a");
    expect(result).toBeUndefined();
  });

  it("delete(threadId, orgA) only deletes rows scoped to orgA", async () => {
    const deleteManyCalls: unknown[] = [];
    const mockPrisma = {
      conversationState: {
        deleteMany: async (args: unknown) => {
          deleteManyCalls.push(args);
          return { count: 0 };
        },
      },
    };

    const { PrismaConversationStore } = await import("../conversation/prisma-store.js");
    const store = new PrismaConversationStore(mockPrisma as never);

    await store.delete("t1", "org_a");
    expect(deleteManyCalls).toHaveLength(1);
    const where = (deleteManyCalls[0] as { where: Record<string, unknown> }).where;
    expect(where["threadId"]).toBe("t1");
    expect(where["organizationId"]).toBe("org_a");
  });

  it("listActive(orgA) returns only orgA's active conversations", async () => {
    const findManyCalls: unknown[] = [];
    const mockPrisma = {
      conversationState: {
        findMany: async (args: unknown) => {
          findManyCalls.push(args);
          // Simulate a tenant-scoped query result — only orgA rows.
          return [
            {
              id: "conv_a1",
              threadId: "t1",
              organizationId: "org_a",
              channel: "slack",
              principalId: "user_a",
              status: "active",
              currentIntent: null,
              pendingProposalIds: [],
              pendingApprovalIds: [],
              clarificationQuestion: null,
              messages: [],
              lastActivityAt: new Date(),
              expiresAt: new Date(),
            },
          ];
        },
      },
    };

    const { PrismaConversationStore } = await import("../conversation/prisma-store.js");
    const store = new PrismaConversationStore(mockPrisma as never);

    const rows = await store.listActive("org_a");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBe("org_a");

    expect(findManyCalls).toHaveLength(1);
    const where = (findManyCalls[0] as { where: Record<string, unknown> }).where;
    expect(where["organizationId"]).toBe("org_a");
    // Active filter still applied
    expect(where["status"]).toEqual({ notIn: ["completed", "expired"] });
  });

  it("listActiveAcrossAllTenants does NOT pass organizationId (recovery-only)", async () => {
    const findManyCalls: unknown[] = [];
    const mockPrisma = {
      conversationState: {
        findMany: async (args: unknown) => {
          findManyCalls.push(args);
          return [];
        },
      },
    };

    const { PrismaConversationStore } = await import("../conversation/prisma-store.js");
    const store = new PrismaConversationStore(mockPrisma as never);

    await store.listActiveAcrossAllTenants();
    expect(findManyCalls).toHaveLength(1);
    const where = (findManyCalls[0] as { where: Record<string, unknown> }).where;
    // No org filter — by design, this is the recovery-orchestrator path.
    expect(where["organizationId"]).toBeUndefined();
    expect(where["status"]).toEqual({ notIn: ["completed", "expired"] });
  });
});
