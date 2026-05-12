import { describe, expect, it, vi } from "vitest";
import { PrismaConversationLifecycleSnapshotStore } from "../prisma-conversation-lifecycle-snapshot-store.js";

describe("PrismaConversationLifecycleSnapshotStore.read", () => {
  it("returns null when no row exists", async () => {
    const prisma = {
      conversationLifecycleSnapshot: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    expect(await store.read("thread-1")).toBeNull();
  });

  it("returns a parsed snapshot when row exists", async () => {
    const now = new Date();
    const prisma = {
      conversationLifecycleSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          conversationThreadId: "thread-1",
          organizationId: "org-1",
          contactId: "contact-1",
          currentState: "stalled",
          qualificationStatus: "unknown",
          bookingStatus: "not_booked",
          dropoffReason: null,
          lastTransitionAt: now,
          lastEvaluatedAt: now,
          updatedAt: now,
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    const snap = await store.read("thread-1");
    expect(snap?.currentState).toBe("stalled");
    expect(snap?.qualificationStatus).toBe("unknown");
  });
});

describe("PrismaConversationLifecycleSnapshotStore.readInTransaction", () => {
  it("uses the transaction client, not the root client", async () => {
    const findOnRoot = vi.fn();
    const findOnTx = vi.fn().mockResolvedValue(null);
    const prisma = { conversationLifecycleSnapshot: { findUnique: findOnRoot } };
    const tx = { conversationLifecycleSnapshot: { findUnique: findOnTx } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    await store.readInTransaction(tx, "thread-1");
    expect(findOnTx).toHaveBeenCalledTimes(1);
    expect(findOnRoot).not.toHaveBeenCalled();
  });
});

describe("PrismaConversationLifecycleSnapshotStore.upsertInTransaction", () => {
  it("calls upsert on the transaction client, not the root client", async () => {
    const upsertOnRoot = vi.fn();
    const upsertOnTx = vi.fn();
    const prisma = {
      conversationLifecycleSnapshot: { upsert: upsertOnRoot },
    };
    const tx = {
      conversationLifecycleSnapshot: { upsert: upsertOnTx },
    };
    const now = new Date();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    await store.upsertInTransaction(tx, {
      conversationThreadId: "thread-1",
      organizationId: "org-1",
      contactId: "contact-1",
      currentState: "stalled",
      qualificationStatus: "unknown",
      bookingStatus: "not_booked",
      dropoffReason: null,
      lastTransitionAt: now,
      lastEvaluatedAt: now,
      updatedAt: now,
    });
    expect(upsertOnTx).toHaveBeenCalledTimes(1);
    expect(upsertOnRoot).not.toHaveBeenCalled();
  });
});

describe("PrismaConversationLifecycleSnapshotStore.listPendingDisqualifications", () => {
  it("queries with the §8.1 doctrine predicate (proposed_disqualified + not disqualified)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { conversationLifecycleSnapshot: { findMany } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    await store.listPendingDisqualifications("org-abc");
    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-abc",
        qualificationStatus: "proposed_disqualified",
        currentState: { not: "disqualified" },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  });

  it("returns parsed snapshots from the result rows", async () => {
    const now = new Date();
    const findMany = vi.fn().mockResolvedValue([
      {
        conversationThreadId: "thread-1",
        organizationId: "org-1",
        contactId: "contact-1",
        currentState: "active",
        qualificationStatus: "proposed_disqualified",
        bookingStatus: "not_booked",
        dropoffReason: null,
        lastTransitionAt: now,
        lastEvaluatedAt: now,
        updatedAt: now,
      },
    ]);
    const prisma = { conversationLifecycleSnapshot: { findMany } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleSnapshotStore(prisma as any);
    const results = await store.listPendingDisqualifications("org-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.conversationThreadId).toBe("thread-1");
    expect(results[0]?.qualificationStatus).toBe("proposed_disqualified");
  });
});
