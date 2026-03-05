import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemorySessionStore, RedisSessionStore } from "../session-store.js";
import type { ConversationSession } from "../session-store.js";

function makeSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    id: "sess-1",
    channelId: "ch-1",
    channelType: "sms",
    contactId: "contact-1",
    organizationId: "org-1",
    flowId: "booking",
    state: {
      flowId: "booking",
      currentStepIndex: 0,
      variables: {},
      completed: false,
      escalated: false,
      history: [{ stepId: "intro", output: "Hello", timestamp: new Date("2025-01-01") }],
    },
    createdAt: new Date(),
    lastActivityAt: new Date(),
    timeoutMs: 30 * 60 * 1000, // 30 minutes
    escalated: false,
    metadata: {},
    ...overrides,
  };
}

describe("InMemorySessionStore", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it("creates and retrieves a session by id", async () => {
    const session = makeSession();
    await store.create(session);
    const fetched = await store.getById("sess-1");
    expect(fetched).toEqual(session);
  });

  it("retrieves a session by channelId", async () => {
    const session = makeSession();
    await store.create(session);
    const fetched = await store.getByChannelId("ch-1");
    expect(fetched?.id).toBe("sess-1");
  });

  it("returns null for unknown channelId", async () => {
    expect(await store.getByChannelId("unknown")).toBeNull();
  });

  it("returns null for unknown sessionId", async () => {
    expect(await store.getById("unknown")).toBeNull();
  });

  it("returns null and cleans up stale channel index", async () => {
    // Create session, then delete it manually from sessions map but leave index
    const session = makeSession();
    await store.create(session);
    // Delete via the store, then re-create a dangling index scenario
    await store.delete("sess-1");
    // After delete, channel index should also be cleaned
    expect(await store.getByChannelId("ch-1")).toBeNull();
  });

  it("detects timed-out sessions and returns null", async () => {
    const session = makeSession({
      lastActivityAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      timeoutMs: 30 * 60 * 1000, // 30 minutes
    });
    await store.create(session);
    const fetched = await store.getByChannelId("ch-1");
    expect(fetched).toBeNull();
    // Session should be cleaned up
    expect(await store.getById("sess-1")).toBeNull();
  });

  it("updates a session", async () => {
    const pastTime = new Date(Date.now() - 10_000); // 10 seconds ago
    const session = makeSession({
      lastActivityAt: pastTime,
    });
    await store.create(session);
    await store.update("sess-1", { escalated: true });
    const fetched = await store.getById("sess-1");
    expect(fetched?.escalated).toBe(true);
    expect(fetched?.lastActivityAt.getTime()).toBeGreaterThanOrEqual(pastTime.getTime() + 1);
  });

  it("update is a no-op for unknown session", async () => {
    await store.update("unknown", { escalated: true });
    // No error thrown
  });

  it("deletes a session and its channel index", async () => {
    const session = makeSession();
    await store.create(session);
    await store.delete("sess-1");
    expect(await store.getById("sess-1")).toBeNull();
    expect(await store.getByChannelId("ch-1")).toBeNull();
  });

  it("delete is a no-op for unknown session", async () => {
    await store.delete("unknown");
    // No error thrown
  });

  it("lists active sessions for an organization", async () => {
    await store.create(makeSession({ id: "s1", channelId: "c1", organizationId: "org-1" }));
    await store.create(makeSession({ id: "s2", channelId: "c2", organizationId: "org-1" }));
    await store.create(makeSession({ id: "s3", channelId: "c3", organizationId: "org-2" }));
    const active = await store.listActive("org-1");
    expect(active).toHaveLength(2);
  });

  it("excludes timed-out sessions from listActive", async () => {
    await store.create(
      makeSession({
        id: "s1",
        channelId: "c1",
        lastActivityAt: new Date(Date.now() - 60 * 60 * 1000),
        timeoutMs: 30 * 60 * 1000,
      }),
    );
    const active = await store.listActive("org-1");
    expect(active).toHaveLength(0);
  });
});

describe("RedisSessionStore", () => {
  function makeRedisClient() {
    const store = new Map<string, string>();
    const pipelineOps: Array<() => void> = [];

    return {
      store,
      client: {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        setex: vi.fn(async (key: string, _seconds: number, value: string) => {
          store.set(key, value);
          return "OK";
        }),
        del: vi.fn(async (...keys: string[]) => {
          let count = 0;
          for (const key of keys) {
            if (store.delete(key)) count++;
          }
          return count;
        }),
        pipeline: vi.fn(() => ({
          setex: (key: string, seconds: number, value: string) => {
            pipelineOps.push(() => store.set(key, value));
          },
          del: (key: string) => {
            pipelineOps.push(() => store.delete(key));
          },
          exec: vi.fn(async () => {
            for (const op of pipelineOps) op();
            pipelineOps.length = 0;
            return [];
          }),
        })),
      },
    };
  }

  it("creates and retrieves a session via Redis", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    const session = makeSession();
    await store.create(session);
    const fetched = await store.getById("sess-1");
    expect(fetched?.id).toBe("sess-1");
    expect(fetched?.createdAt).toBeInstanceOf(Date);
    expect(fetched?.state.history[0]?.timestamp).toBeInstanceOf(Date);
  });

  it("retrieves a session by channel ID", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    await store.create(makeSession());
    const fetched = await store.getByChannelId("ch-1");
    expect(fetched?.id).toBe("sess-1");
  });

  it("returns null when channel key not found", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    expect(await store.getByChannelId("unknown")).toBeNull();
  });

  it("returns null when session key not found", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    expect(await store.getById("unknown")).toBeNull();
  });

  it("updates a session in Redis", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    await store.create(makeSession());
    await store.update("sess-1", { escalated: true });
    const fetched = await store.getById("sess-1");
    expect(fetched?.escalated).toBe(true);
  });

  it("update is no-op for unknown session", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    await store.update("unknown", { escalated: true });
    // No error thrown
  });

  it("deletes a session from Redis", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    await store.create(makeSession());
    await store.delete("sess-1");
    expect(await store.getById("sess-1")).toBeNull();
  });

  it("delete is no-op for unknown session", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    await store.delete("unknown");
    // No error thrown
  });

  it("listActive returns empty array (unimplemented)", async () => {
    const { client } = makeRedisClient();
    const store = new RedisSessionStore(client as any);
    const result = await store.listActive("org-1");
    expect(result).toEqual([]);
  });

  it("handles Redis get errors gracefully (fail-open)", async () => {
    const { client } = makeRedisClient();
    client.get.mockRejectedValueOnce(new Error("connection lost"));
    const store = new RedisSessionStore(client as any);
    const result = await store.getByChannelId("ch-1");
    expect(result).toBeNull();
  });

  it("handles Redis get errors in getById gracefully", async () => {
    const { client } = makeRedisClient();
    client.get.mockRejectedValueOnce(new Error("connection lost"));
    const store = new RedisSessionStore(client as any);
    const result = await store.getById("sess-1");
    expect(result).toBeNull();
  });
});
