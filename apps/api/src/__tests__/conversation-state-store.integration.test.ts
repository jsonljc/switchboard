import { describe, it, expect } from "vitest";
import { PrismaClient, PrismaConversationStateStore, PrismaWorkTraceStore } from "@switchboard/db";

// Integration coverage for the ConversationStateStore persistence boundary.
// Asserts that setOverride writes both the conversationState mutation and the
// operator-mutation WorkTrace row, that the post-tx finalize transitions the
// trace to outcome="completed" with lockedAt stamped, and that the integrity
// metadata (ingressPath, hashInputVersion, mode, intent, contentHash) matches
// what the route layer relies on.
describe.skipIf(!process.env["DATABASE_URL"])("PrismaConversationStateStore (integration)", () => {
  it("setOverride writes a ConversationState mutation and a finalized WorkTrace row", async () => {
    const prisma = new PrismaClient();
    try {
      const seed = await prisma.conversationState.create({
        data: {
          threadId: `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          channel: "telegram",
          principalId: "p_int_test",
          organizationId: "org_int_test",
          status: "active",
          messages: [],
          firstReplyAt: null,
          lastActivityAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const workTraceStore = new PrismaWorkTraceStore(prisma, {
        auditLedger: { record: async () => undefined } as never,
        operatorAlerter: { alert: async () => undefined } as never,
      });
      const store = new PrismaConversationStateStore(prisma, workTraceStore);

      let workTraceId: string | undefined;
      try {
        const result = await store.setOverride({
          organizationId: seed.organizationId!,
          threadId: seed.threadId,
          override: true,
          operator: { type: "user", id: "user_op_int" },
        });
        workTraceId = result.workTraceId;

        const after = await prisma.conversationState.findUnique({ where: { id: seed.id } });
        const traceRow = await prisma.workTrace.findUnique({
          where: { workUnitId: result.workTraceId },
        });

        expect(after?.status).toBe("human_override");
        expect(traceRow).not.toBeNull();
        expect(traceRow?.ingressPath).toBe("store_recorded_operator_mutation");
        expect(traceRow?.mode).toBe("operator_mutation");
        expect(traceRow?.intent).toBe("conversation.override.set");
        expect(traceRow?.hashInputVersion).toBe(2);
        expect(traceRow?.contentHash).toBeTruthy();
        expect(traceRow?.outcome).toBe("completed");
        expect(traceRow?.lockedAt).not.toBeNull();
        expect(traceRow?.executionStartedAt).not.toBeNull();
        expect(traceRow?.completedAt).not.toBeNull();
        expect(traceRow?.actorType).toBe("user");
        expect(traceRow?.actorId).toBe("user_op_int");
        expect(traceRow?.trigger).toBe("api");
      } finally {
        if (workTraceId) {
          await prisma.workTrace.delete({ where: { workUnitId: workTraceId } }).catch(() => {});
        }
        await prisma.conversationState.delete({ where: { id: seed.id } }).catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
