import { parseTemplateApprovalOverlay } from "@switchboard/core";
import type { PrismaClient } from "@switchboard/db";

/**
 * The shared per-recipient proactive WhatsApp send context: consent state, the opt-in
 * basis (messagingOptIn + the WhatsApp 24h-window timestamp), the per-org template-approval
 * overlay, and sender identity. Resolved org-scoped from Prisma and consumed by
 * `evaluateProactiveSendEligibility` (and its Robin wrapper `evaluateRecoveryEligibility`).
 *
 * All four proactive send sites (follow-up, reminder, first-touch greeting, Robin recovery)
 * assemble this same shape; the ONLY difference between callers is how the 24h-window
 * timestamp (`lastWhatsAppInboundAt`) is looked up, so each caller resolves that and passes
 * it in. Extracted from bootstrap/contained-workflows.ts (behaviour-identical) so the recovery
 * thread-read → eligibility chain is drivable by Robin's behavioural eval lane (EV-7) without
 * standing up the whole bootstrap.
 */
export type WhatsAppSendContext = {
  consentGrantedAt: Date | string | null;
  consentRevokedAt: Date | string | null;
  pdpaJurisdiction: "SG" | "MY" | null;
  messagingOptIn: boolean;
  lastWhatsAppInboundAt: Date | null;
  jurisdiction: "SG" | "MY" | null;
  leadName: string;
  businessName: string;
  phone: string | null;
  approvalOverlay: ReturnType<typeof parseTemplateApprovalOverlay>;
};

/**
 * Assemble the shared proactive send context from the contact + org rows. The caller
 * supplies the already-resolved `lastWhatsAppInboundAt` (the only per-site difference).
 */
export async function buildWhatsAppSendContext(
  prisma: PrismaClient,
  orgId: string,
  contactId: string,
  lastWhatsAppInboundAt: Date | null,
): Promise<WhatsAppSendContext> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: orgId },
    select: {
      name: true,
      phone: true,
      messagingOptIn: true,
      pdpaJurisdiction: true,
      consentGrantedAt: true,
      consentRevokedAt: true,
    },
  });
  const org = await prisma.organizationConfig.findUnique({
    where: { id: orgId },
    select: { name: true, runtimeConfig: true },
  });
  // Org-resolvable template-approval source: an operator/config-driven map persisted
  // under runtimeConfig.whatsappTemplateApprovals (metaTemplateName -> status). Parsed
  // defensively; absent/malformed → empty overlay → the static registry default (draft)
  // keeps proactive sends blocked. No new schema column.
  const runtimeConfig = (org?.runtimeConfig ?? {}) as { whatsappTemplateApprovals?: unknown };
  const approvalOverlay = parseTemplateApprovalOverlay(runtimeConfig.whatsappTemplateApprovals);
  return {
    consentGrantedAt: contact?.consentGrantedAt ?? null,
    consentRevokedAt: contact?.consentRevokedAt ?? null,
    pdpaJurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
    messagingOptIn: contact?.messagingOptIn ?? false,
    lastWhatsAppInboundAt,
    jurisdiction: (contact?.pdpaJurisdiction as "SG" | "MY" | null) ?? null,
    leadName: contact?.name ?? "there",
    businessName: org?.name ?? "our clinic",
    phone: contact?.phone ?? null,
    approvalOverlay,
  };
}

/**
 * The Robin recovery send-context resolver (shared by the cohort executor and the bounded-retry
 * executor). Reads the WhatsApp 24h-window timestamp by the contactId+org compound key, then
 * assembles the shared send context. A contact with no thread yet (a CTWA-only / web-form lead)
 * resolves a null `lastWhatsAppInboundAt`, which `canSendWhatsAppTemplate` treats as OUTSIDE the
 * window (fail closed) — so a contact without `messagingOptIn` and without a fresh inbound lands
 * on `no_optin` downstream. This is the exact thread-read → eligibility seam Robin's eval drives.
 */
export async function getRecoverySendContext(
  prisma: PrismaClient,
  orgId: string,
  contactId: string,
): Promise<WhatsAppSendContext> {
  const thread = await prisma.conversationThread.findUnique({
    where: { contactId_organizationId: { contactId, organizationId: orgId } },
    select: { lastWhatsAppInboundAt: true },
  });
  return buildWhatsAppSendContext(prisma, orgId, contactId, thread?.lastWhatsAppInboundAt ?? null);
}
