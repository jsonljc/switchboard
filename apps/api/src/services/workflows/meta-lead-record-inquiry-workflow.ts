import type { WorkflowHandler } from "@switchboard/core/platform";

export function buildMetaLeadRecordInquiryWorkflow(_prisma: unknown): WorkflowHandler {
  return {
    async execute(workUnit) {
      const input = workUnit.parameters as {
        leadId: string;
        organizationId: string;
        adId: string | null;
      };

      const { PrismaOutboxStore } = await import("@switchboard/db");
      const prisma = _prisma as import("@switchboard/db").PrismaClient;
      const outboxStore = new PrismaOutboxStore(prisma);
      await outboxStore.write(`evt_lead_${input.leadId}`, "inquiry", {
        type: "inquiry",
        contactId: input.leadId,
        organizationId: input.organizationId,
        value: 0,
        sourceAdId: input.adId,
        occurredAt: new Date().toISOString(),
        source: "meta-webhook",
        metadata: {},
      });

      return { outcome: "completed", summary: "Inquiry recorded", outputs: {} };
    },
  };
}
