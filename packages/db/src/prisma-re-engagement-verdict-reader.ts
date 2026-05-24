import type { Prisma, PrismaClient } from "@prisma/client";
import type { ReEngagementVerdictReader } from "@switchboard/core";

/**
 * Safely reads a string field from a Prisma `Json` column. Guards against null,
 * non-object (primitive/array), and missing/non-string values — replacing the
 * untyped `as any` access on `agentContext` / `details`.
 */
function readJsonStringField(
  json: Prisma.JsonValue | null | undefined,
  key: string,
): string | undefined {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const value = (json as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

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
    // the correct fallback (also when agentContext is null/non-object).
    const sessionId = readJsonStringField(thread.agentContext, "sessionId");
    const conversationId: string = sessionId && sessionId.length > 0 ? sessionId : threadId;

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
    return {
      verdictId: row.id,
      templateName: readJsonStringField(row.details, "metaTemplateName") ?? "",
      decidedAt: row.decidedAt,
    };
  }
}
