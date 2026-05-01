import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaConversationStateStore } from "../prisma-conversation-state-store.js";

const TEST_URL = process.env["DATABASE_URL"] ?? process.env["POSTGRES_TEST_URL"];

describe.skipIf(!TEST_URL)("PrismaConversationStateStore.replyTimeStats (integration)", () => {
  let prisma: PrismaClient;
  let store: PrismaConversationStateStore;
  const orgId = `org-replytime-int-${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: TEST_URL });
    store = new PrismaConversationStateStore(prisma, {} as never);
  });

  afterAll(async () => {
    await prisma.conversationState.deleteMany({ where: { organizationId: orgId } });
    await prisma.$disconnect();
  });

  it("returns median latency for today's eligible conversations against real Postgres", async () => {
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);

    await prisma.conversationState.createMany({
      data: [
        {
          id: `int-A-${Date.now()}`,
          threadId: `int-tA-${Date.now()}`,
          channel: "x",
          principalId: "p",
          organizationId: orgId,
          status: "active",
          pendingProposalIds: [],
          pendingApprovalIds: [],
          messages: [],
          lastActivityAt: now,
          expiresAt: new Date(today.getTime() + 86_400_000),
          createdAt: new Date(today.getTime() + 9 * 3600_000),
          firstReplyAt: new Date(today.getTime() + 9 * 3600_000 + 10_000),
        },
        {
          id: `int-B-${Date.now() + 1}`,
          threadId: `int-tB-${Date.now() + 1}`,
          channel: "x",
          principalId: "p",
          organizationId: orgId,
          status: "active",
          pendingProposalIds: [],
          pendingApprovalIds: [],
          messages: [],
          lastActivityAt: now,
          expiresAt: new Date(today.getTime() + 86_400_000),
          createdAt: new Date(today.getTime() + 10 * 3600_000),
          firstReplyAt: new Date(today.getTime() + 10 * 3600_000 + 30_000),
        },
      ],
    });

    const stats = await store.replyTimeStats(orgId, today);
    expect(stats.sampleSize).toBe(2);
    expect(stats.medianSeconds).toBe(20);
  });
});
