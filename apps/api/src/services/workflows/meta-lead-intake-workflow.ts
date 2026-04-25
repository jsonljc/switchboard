import type { WorkflowHandler, WorkflowRuntimeServices } from "@switchboard/core/platform";

interface MetaLeadIntakeDeps {
  prisma: unknown;
  parseLeadWebhook?: (payload: unknown) => Array<{
    leadId: string;
    adId: string;
    campaignId?: string;
    name?: string;
    phone?: string;
    email?: string;
  }>;
  findExistingContact?: (orgId: string, phone: string) => Promise<{ attribution?: unknown } | null>;
  createContact?: (data: Record<string, unknown>) => Promise<{ id: string }>;
}

export function buildMetaLeadIntakeWorkflow(deps: MetaLeadIntakeDeps): WorkflowHandler {
  return {
    async execute(workUnit, services: WorkflowRuntimeServices) {
      const input = workUnit.parameters as {
        payload: unknown;
        greetingTemplateName: string;
      };

      const parseLeadWebhook =
        deps.parseLeadWebhook ?? (await import("@switchboard/ad-optimizer")).parseLeadWebhook;

      let findExistingContact = deps.findExistingContact;
      let createContact = deps.createContact;
      if (!findExistingContact || !createContact) {
        const { PrismaContactStore } = await import("@switchboard/db");
        const prisma = deps.prisma as import("@switchboard/db").PrismaClient;
        const contactStore = new PrismaContactStore(prisma);
        findExistingContact = findExistingContact ?? contactStore.findByPhone.bind(contactStore);
        createContact =
          createContact ??
          (contactStore.create.bind(contactStore) as unknown as (
            data: Record<string, unknown>,
          ) => Promise<{ id: string }>);
      }

      const leads = parseLeadWebhook(input.payload);
      let created = 0;
      const childFailures: Array<{ intent: string; leadId: string; error: string }> = [];

      for (const lead of leads) {
        if (!lead.phone) continue;

        const existing = await findExistingContact!(workUnit.organizationId, lead.phone);
        const existingAdId = (existing?.attribution as Record<string, unknown> | null)?.sourceAdId;
        if (existing && existingAdId === lead.adId) continue;

        await createContact!({
          organizationId: workUnit.organizationId,
          name: lead.name ?? null,
          phone: lead.phone,
          email: lead.email ?? null,
          primaryChannel: "whatsapp",
          source: "meta-instant-form",
          attribution: {
            sourceAdId: lead.adId,
            sourceCampaignId: lead.campaignId ?? null,
            fbclid: null,
            gclid: null,
            ttclid: null,
            utmSource: null,
            utmMedium: null,
            utmCampaign: null,
          },
        });
        created++;

        const greetingResult = await services.submitChildWork({
          intent: "meta.lead.greeting.send",
          organizationId: workUnit.organizationId,
          actor: workUnit.actor,
          parentWorkUnitId: workUnit.id,
          parameters: {
            phone: lead.phone,
            firstName: lead.name?.split(" ")[0] ?? "there",
            templateName: input.greetingTemplateName,
          },
        });
        if (!greetingResult.ok) {
          childFailures.push({
            intent: "meta.lead.greeting.send",
            leadId: lead.leadId,
            error: greetingResult.error.message,
          });
        }

        const inquiryResult = await services.submitChildWork({
          intent: "meta.lead.inquiry.record",
          organizationId: workUnit.organizationId,
          actor: workUnit.actor,
          parentWorkUnitId: workUnit.id,
          parameters: {
            leadId: lead.leadId,
            organizationId: workUnit.organizationId,
            adId: lead.adId ?? null,
          },
        });
        if (!inquiryResult.ok) {
          childFailures.push({
            intent: "meta.lead.inquiry.record",
            leadId: lead.leadId,
            error: inquiryResult.error.message,
          });
        }
      }

      const hasFailures = childFailures.length > 0;
      return {
        outcome: hasFailures ? "failed" : "completed",
        summary: hasFailures
          ? `Processed ${leads.length} leads (${childFailures.length} child failures)`
          : `Processed ${leads.length} leads`,
        outputs: { received: leads.length, created, ...(hasFailures ? { childFailures } : {}) },
        ...(hasFailures
          ? {
              error: {
                code: "PARTIAL_CHILD_FAILURE",
                message: `${childFailures.length} child work items failed`,
              },
            }
          : {}),
      };
    },
  };
}
