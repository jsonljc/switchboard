import { describe, expect, it, vi } from "vitest";
import { PrismaConversationLifecycleTransitionStore } from "../prisma-conversation-lifecycle-transition-store.js";

describe("PrismaConversationLifecycleTransitionStore.appendInTransaction", () => {
  it("creates a transition row on the transaction client", async () => {
    const createOnTx = vi.fn();
    const tx = { conversationLifecycleTransition: { create: createOnTx } };
    const createOnRoot = vi.fn();
    const prisma = { conversationLifecycleTransition: { create: createOnRoot } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleTransitionStore(prisma as any);
    await store.appendInTransaction(tx, {
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      fromState: "active",
      toState: "stalled",
      trigger: "timer_24h_no_inbound",
      evidence: { hours_since_outbound: 25 },
      actor: "system",
      workTraceId: null,
      occurredAt: new Date(),
    });
    expect(createOnTx).toHaveBeenCalledTimes(1);
    // The data passed to create() must NOT include id — Prisma generates it.
    const callArg = createOnTx.mock.calls[0]?.[0] as { data: { id?: string } };
    expect(callArg.data.id).toBeUndefined();
    // Root client should NOT be called in transaction context.
    expect(createOnRoot).not.toHaveBeenCalled();
  });
});

describe("PrismaConversationLifecycleTransitionStore.listForThread", () => {
  it("returns transitions ordered by occurredAt asc", async () => {
    const prisma = {
      conversationLifecycleTransition: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "t-1",
            organizationId: "org-1",
            conversationThreadId: "thread-1",
            contactId: "contact-1",
            fromState: null,
            toState: "active",
            trigger: "qualification_checklist_failed",
            evidence: {},
            actor: "system",
            workTraceId: null,
            occurredAt: new Date(),
          },
        ]),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleTransitionStore(prisma as any);
    const rows = await store.listForThread("thread-1");
    expect(rows).toHaveLength(1);
    expect(prisma.conversationLifecycleTransition.findMany).toHaveBeenCalledWith({
      where: { conversationThreadId: "thread-1" },
      orderBy: { occurredAt: "asc" },
    });
  });
});

describe("PrismaConversationLifecycleTransitionStore.findLatestProposal", () => {
  it("queries with trigger=system_proposed_disqualification ordered by occurredAt desc", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { conversationLifecycleTransition: { findFirst } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleTransitionStore(prisma as any);
    await store.findLatestProposal("thread-42");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        conversationThreadId: "thread-42",
        trigger: "system_proposed_disqualification",
      },
      orderBy: { occurredAt: "desc" },
    });
  });

  it("returns null when no proposal row exists", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { conversationLifecycleTransition: { findFirst } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleTransitionStore(prisma as any);
    const result = await store.findLatestProposal("thread-no-proposal");
    expect(result).toBeNull();
  });

  it("returns a parsed transition when a proposal row exists", async () => {
    const now = new Date();
    const row = {
      id: "trans-proposal-1",
      organizationId: "org-1",
      conversationThreadId: "thread-1",
      contactId: "contact-1",
      fromState: "active",
      toState: "active",
      trigger: "system_proposed_disqualification",
      evidence: { reason: "price_sensitivity" },
      actor: "system",
      workTraceId: null,
      occurredAt: now,
    };
    const findFirst = vi.fn().mockResolvedValue(row);
    const prisma = { conversationLifecycleTransition: { findFirst } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = new PrismaConversationLifecycleTransitionStore(prisma as any);
    const result = await store.findLatestProposal("thread-1");
    expect(result?.id).toBe("trans-proposal-1");
    expect(result?.trigger).toBe("system_proposed_disqualification");
    expect(result?.evidence).toEqual({ reason: "price_sensitivity" });
  });
});
