import type { WorkflowHandler, WorkflowRuntimeServices } from "@switchboard/core/platform";

interface MetaLeadIntakeDeps {
  prisma: unknown;
  parseLeadWebhook?: (payload: unknown) => Array<{
    leadId: string;
    adId: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
  }>;
  findExistingContact?: (orgId: string, phone: string) => Promise<{ attribution: unknown } | null>;
  createContact?: (data: Record<string, unknown>) => Promise<{ id: string }>;
}

export function buildMetaLeadIntakeWorkflow(deps: MetaLeadIntakeDeps): WorkflowHandler {
  return {
    async execute(workUnit, services: WorkflowRuntimeServices) {
      const input = workUnit.parameters as {
        payload: unknown;
        greetingTemplateName: string;
      };

      let parseLeadWebhook = deps.parseLeadWebhook;
      if (!parseLeadWebhook) {
        const mod = await import("@switchboard/ad-optimizer");
        parseLeadWebhook = mod.parseLeadWebhook;
      }

      let findExistingContact = deps.findExistingContact;
      let createContact = deps.createContact;
      if (!findExistingContact || !createContact) {
        const { PrismaContactStore } = await import("@switchboard/db");
        const prisma = deps.prisma as import("@switchboard/db").PrismaClient;
        const contactStore = new PrismaContactStore(prisma);
        findExistingContact = findExistingContact ?? contactStore.findByPhone.bind(contactStore);
        createContact =
          createContact ?? (contactStore.create.bind(contactStore) as typeof createContact);
      }

      const leads = parseLeadWebhook(input.payload);
      let created = 0;

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
            fbclid: null,
            gclid: null,
            ttclid: null,
            sourceCampaignId: null,
            utmSource: null,
            utmMedium: null,
            utmCampaign: null,
          },
        });
        created++;

        await services.submitChildWork({
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

        await services.submitChildWork({
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
      }

      return {
        outcome: "completed",
        summary: `Processed ${leads.length} leads`,
        outputs: { received: leads.length, created },
      };
    },
  };
}
