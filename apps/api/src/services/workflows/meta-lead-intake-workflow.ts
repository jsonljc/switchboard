import type { WorkflowHandler, WorkflowRuntimeServices } from "@switchboard/core/platform";
import type { LeadData } from "@switchboard/ad-optimizer";

interface MetaLeadIntakeDeps {
  prisma: unknown;
  accessToken?: string;
  parseLeadWebhook?: (payload: unknown) => LeadData[];
  fetchLeadDetail?: (
    leadId: string,
    accessToken: string,
  ) => Promise<{
    field_data?: Array<{ name: string; values: string[] }>;
    campaign_id?: string;
  }>;
  extractFieldValue?: (
    fields: Array<{ name: string; values: string[] }> | undefined,
    name: string,
  ) => string | undefined;
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

      const adOptimizer = await import("@switchboard/ad-optimizer");
      const parseLeadWebhook = deps.parseLeadWebhook ?? adOptimizer.parseLeadWebhook;
      const fetchDetail = deps.fetchLeadDetail ?? adOptimizer.fetchLeadDetail;
      const extractField = deps.extractFieldValue ?? adOptimizer.extractFieldValue;

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

      const webhookLeads = parseLeadWebhook(input.payload);
      let created = 0;
      const childFailures: Array<{ intent: string; leadId: string; error: string }> = [];

      for (const lead of webhookLeads) {
        let name: string | undefined;
        let email: string | undefined;
        let phone: string | undefined;
        let campaignId: string | undefined;

        if (deps.accessToken) {
          try {
            const detail = await fetchDetail(lead.leadId, deps.accessToken);
            name = extractField(detail.field_data, "full_name");
            email = extractField(detail.field_data, "email");
            phone = extractField(detail.field_data, "phone_number");
            campaignId = detail.campaign_id;
          } catch {
            console.warn(`[meta-lead-intake] Failed to fetch detail for lead ${lead.leadId}`);
          }
        }

        if (!phone) continue;

        const existing = await findExistingContact!(workUnit.organizationId, phone);
        const existingAdId = (existing?.attribution as Record<string, unknown> | null)?.sourceAdId;
        if (existing && existingAdId === lead.adId) continue;

        await createContact!({
          organizationId: workUnit.organizationId,
          name: name ?? null,
          phone,
          email: email ?? null,
          primaryChannel: "whatsapp",
          source: "meta-instant-form",
          attribution: {
            sourceAdId: lead.adId,
            sourceCampaignId: campaignId ?? null,
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
            phone,
            firstName: name?.split(" ")[0] ?? "there",
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
          ? `Processed ${webhookLeads.length} leads (${childFailures.length} child failures)`
          : `Processed ${webhookLeads.length} leads`,
        outputs: {
          received: webhookLeads.length,
          created,
          ...(hasFailures ? { childFailures } : {}),
        },
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
