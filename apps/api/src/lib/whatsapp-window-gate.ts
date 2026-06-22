/**
 * Org-scoped WhatsApp 24h customer-care window gate for the operator/escalation
 * reply paths (A15). Extracted from app.ts so the org-scoping + fail-closed logic
 * is unit-testable with a stub prisma.
 *
 * Source-of-truth decision (A15): the window basis is
 * `ConversationThread.lastWhatsAppInboundAt`, the SAME column the proactive-workflow
 * send paths read (followup / reminder / greeting / Robin recovery in
 * bootstrap/contained-workflows.ts). The prior reply-path source,
 * `ConversationState.lastInboundAt`, is dead in production: the live gateway inbound
 * path (apps/chat/.../gateway-bridge.ts) upserts ConversationState with a NULL
 * organizationId and never sets lastInboundAt, while ConversationThread carries a
 * non-null org and a dedicated `[organizationId, lastWhatsAppInboundAt]` index that
 * the gateway updates on every inbound WhatsApp message. Converging here both closes
 * the cross-tenant leak (P1-2) and makes the gate actually functional.
 *
 * The gate's only customer-identifying input is the destination phone, so it resolves
 * the org's thread by matching the contact's `phoneE164` OR `phone` (formats differ by
 * producer) and takes the freshest WhatsApp inbound — the correct "is this phone in a
 * 24h window with THIS org" semantic even when a phone maps to more than one contact.
 *
 * Fail-closed throughout: no DB, no org, no matching thread, or a null inbound all
 * return false, so the caller (ProactiveSender) throws WhatsAppWindowClosedError
 * rather than letting Meta silently drop a free-form message.
 */
import type { PrismaClient } from "@switchboard/db";
import { isWithinWhatsAppWindow } from "@switchboard/core/notifications";

export async function isRecipientWithinOrgWindow(
  prisma: PrismaClient | null,
  recipient: string,
  organizationId: string | undefined,
): Promise<boolean> {
  // Fail closed: without a DB there is no inbound history to consult, and without a
  // concrete org we must never read across tenants (null-org rows never match).
  if (!prisma || !organizationId) return false;

  const thread = await prisma.conversationThread.findFirst({
    where: {
      organizationId,
      lifecycleContact: { OR: [{ phoneE164: recipient }, { phone: recipient }] },
    },
    orderBy: { lastWhatsAppInboundAt: "desc" },
    select: { lastWhatsAppInboundAt: true },
  });

  return isWithinWhatsAppWindow(thread?.lastWhatsAppInboundAt ?? null);
}
