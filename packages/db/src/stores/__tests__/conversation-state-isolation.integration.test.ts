import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setConversationStatusScoped } from "../set-conversation-status-scoped.js";

// Cross-tenant isolation for ConversationState (adversarial audit #2). Two orgs
// share one phone (sessionId === threadId). Org A's human_override must NOT leak
// into org B's gateway, and org B's status write must NOT clobber org A's row.
//
// `readStatus` below is the exact query the chat gateway read issues —
// PrismaGatewayConversationStore.getConversationStatus does
// findFirst({ where: { threadId, organizationId }, select: { status } }) — whose
// shape is pinned by apps/chat/src/gateway/__tests__/gateway-conversation-store.test.ts.
//
// Before the fix (threadId globally @unique + org-blind writes), the second write
// collided on the single global row (clobber) and the read was org-blind (leak).
describe.skipIf(!process.env["DATABASE_URL"])(
  "ConversationState tenant isolation (integration)",
  () => {
    async function readStatus(
      prisma: PrismaClient,
      threadId: string,
      organizationId: string,
    ): Promise<string | null> {
      const row = await prisma.conversationState.findFirst({
        where: { threadId, organizationId },
        select: { status: true },
      });
      return row?.status ?? null;
    }

    it("isolates human_override across two orgs sharing one phone", async () => {
      const prisma = new PrismaClient();
      const phone = `+6590000${Math.floor(Math.random() * 1e6)}`;
      const orgA = `orgA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const orgB = `orgB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        // Org A pauses (human_override) on the shared phone.
        await setConversationStatusScoped(prisma, {
          sessionId: phone,
          organizationId: orgA,
          status: "human_override",
          upsertContext: { channel: "whatsapp", principalId: phone },
        });

        // Org B's gateway read for the same phone → null: org A's pause does NOT
        // suppress org B's bot.
        expect(await readStatus(prisma, phone, orgB)).toBeNull();

        // Org B writes its own status → creates a distinct row, does NOT clobber A.
        await setConversationStatusScoped(prisma, {
          sessionId: phone,
          organizationId: orgB,
          status: "active",
          upsertContext: { channel: "whatsapp", principalId: phone },
        });

        // Org A still paused; org B active; two distinct rows for one phone.
        expect(await readStatus(prisma, phone, orgA)).toBe("human_override");
        expect(await readStatus(prisma, phone, orgB)).toBe("active");
        const rows = await prisma.conversationState.findMany({ where: { threadId: phone } });
        expect(rows).toHaveLength(2);
      } finally {
        await prisma.conversationState.deleteMany({ where: { threadId: phone } }).catch(() => {});
        await prisma.$disconnect();
      }
    });
  },
);
