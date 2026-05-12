import type { PrismaClient } from "@prisma/client";
import type { ReEngagementVerdictReader } from "@switchboard/core";

export class PrismaReEngagementVerdictReader implements ReEngagementVerdictReader {
  constructor(private readonly prisma: PrismaClient) {}

  async findReEngagementVerdict(threadId: string, inboundAt: Date, windowDays: number) {
    const thread = await this.prisma.conversationThread.findUnique({
      where: { id: threadId },
      select: { agentContext: true },
    });
    if (!thread) return null;

    // GovernanceVerdict.conversationId === ctx.sessionId, not ConversationThread.id.
    // For managed-gateway paths sessionId lives on agentContext; for single-tenant
    // Telegram (apps/chat/src/main.ts:299) sessionId === threadId, so threadId is
    // the correct fallback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = thread.agentContext as any;
    const conversationId: string =
      typeof ctx?.sessionId === "string" && ctx.sessionId.length > 0 ? ctx.sessionId : threadId;

    const earliest = new Date(inboundAt.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const row = await this.prisma.governanceVerdict.findFirst({
      where: {
        conversationId,
        sourceGuard: "whatsapp_window",
        action: "substitute",
        decidedAt: { gte: earliest, lte: inboundAt },
        details: { path: ["intentClass"], equals: "re-engagement-offer" },
      },
      orderBy: { decidedAt: "desc" },
      select: { id: true, decidedAt: true, details: true },
    });
    if (!row) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const details = row.details as any;
    return {
      verdictId: row.id,
      templateName: typeof details?.metaTemplateName === "string" ? details.metaTemplateName : "",
      decidedAt: row.decidedAt,
    };
  }
}
