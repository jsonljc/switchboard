import type { PrismaClient } from "@prisma/client";

// 30-day TTL for upsert-created rows — matches the gateway conversation TTL
// convention. The row only carries human_override status until an operator
// clears it; the exact value is not load-bearing.
const STATUS_ROW_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SetConversationStatusScopedParams {
  /** Channel session key (WhatsApp: the bare MSISDN) — the ConversationState.threadId. */
  sessionId: string;
  /** Owning org. Scopes the per-org compound unique (organizationId, threadId). */
  organizationId: string;
  status: string;
  /**
   * When provided (chat gateway path), the row is upserted so a brand-new
   * session gets a ConversationState row immediately. When omitted (api
   * afterSkill hook path), the write is an org-scoped update-only — the row is
   * guaranteed to exist before skill execution (the chat lifecycle store wrote
   * it). Shape mirrors core's ConversationStatusUpsertContext.
   */
  upsertContext?: { channel: string; principalId: string };
}

/**
 * Tenant-scoped conversation-status write (adversarial audit #2).
 *
 * Every write keys on the per-org compound unique (organizationId, threadId) so
 * a phone shared across two orgs never collides on a single global row. The two
 * app-side adapters — chat `gateway-bridge` and api `skill-mode` — delegate here
 * so the compound-key shape lives in exactly one place and stays consistent.
 */
export async function setConversationStatusScoped(
  prisma: PrismaClient,
  params: SetConversationStatusScopedParams,
): Promise<void> {
  const { sessionId, organizationId, status, upsertContext } = params;

  if (upsertContext) {
    await prisma.conversationState.upsert({
      where: { organizationId_threadId: { organizationId, threadId: sessionId } },
      update: { status },
      create: {
        threadId: sessionId,
        organizationId,
        channel: upsertContext.channel,
        principalId: upsertContext.principalId,
        status,
        expiresAt: new Date(Date.now() + STATUS_ROW_TTL_MS),
      },
    });
    return;
  }

  // Update-only fallback (api-side hook path). Org-scoped so a shared-phone row
  // owned by another tenant is never touched. count===0 (no row yet) is a safe
  // no-op — the block that triggered this write still holds.
  await prisma.conversationState.updateMany({
    where: { threadId: sessionId, organizationId },
    data: { status },
  });
}
