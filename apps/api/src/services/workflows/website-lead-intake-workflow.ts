import type { WorkflowHandler, WorkflowRuntimeServices } from "@switchboard/core/platform";

interface WebsiteLeadParams {
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  source: string;
  sourceDetail?: string;
  metadata: {
    page?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    fbclid?: string;
    fbp?: string;
    extra?: Record<string, unknown>;
  };
  greetingTemplateName: string;
}

interface WebsiteLeadIntakeDeps {
  prisma: unknown;
  findExistingContact?: (
    orgId: string,
    phone: string,
  ) => Promise<{ id: string; attribution?: unknown } | null>;
  createContact?: (data: Record<string, unknown>) => Promise<{ id: string }>;
}

export function buildWebsiteLeadIntakeWorkflow(deps: WebsiteLeadIntakeDeps): WorkflowHandler {
  return {
    async execute(workUnit, services: WorkflowRuntimeServices) {
      const params = workUnit.parameters as WebsiteLeadParams;
      const orgId = workUnit.organizationId;

      if (!params.phone && !params.email) {
        return {
          outcome: "failed",
          summary: "missing phone and email",
          outputs: {},
          error: { code: "MISSING_CONTACT", message: "phone or email required" },
        };
      }

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

      let contactId: string;
      if (params.phone) {
        const existing = await findExistingContact!(orgId, params.phone);
        if (existing) {
          contactId = existing.id;
        } else {
          const created = await createContact!({
            organizationId: orgId,
            name: params.name ?? null,
            phone: params.phone,
            email: params.email ?? null,
            primaryChannel: "whatsapp",
            source: params.source,
            attribution: {
              sourceDetail: params.sourceDetail ?? null,
              fbclid: params.metadata.fbclid ?? null,
              fbp: params.metadata.fbp ?? null,
              gclid: null,
              ttclid: null,
              utmSource: params.metadata.utmSource ?? null,
              utmMedium: params.metadata.utmMedium ?? null,
              utmCampaign: params.metadata.utmCampaign ?? null,
              page: params.metadata.page ?? null,
            },
          });
          contactId = created.id;
        }
      } else {
        // email-only path: create without phone, no greeting (we can't WhatsApp without a phone)
        const created = await createContact!({
          organizationId: orgId,
          name: params.name ?? null,
          phone: null,
          email: params.email!,
          primaryChannel: "email",
          source: params.source,
          attribution: {
            sourceDetail: params.sourceDetail ?? null,
            fbclid: params.metadata.fbclid ?? null,
            utmSource: params.metadata.utmSource ?? null,
            page: params.metadata.page ?? null,
          },
        });
        return {
          outcome: "completed",
          summary: "contact created (email-only, no greeting)",
          outputs: { contactId: created.id },
        };
      }

      const greetingResult = await services.submitChildWork({
        intent: "meta.lead.greeting.send",
        organizationId: orgId,
        actor: workUnit.actor,
        parentWorkUnitId: workUnit.id,
        parameters: {
          phone: params.phone,
          firstName: (params.name ?? "there").split(" ")[0],
          templateName: params.greetingTemplateName,
        },
      });

      return {
        outcome: "completed",
        summary: "website lead intake complete",
        outputs: {
          contactId,
          greetingSubmitted: greetingResult.ok,
        },
      };
    },
  };
}
