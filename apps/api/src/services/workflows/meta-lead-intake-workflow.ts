import type { WorkflowHandler, WorkflowRuntimeServices } from "@switchboard/core/platform";
import type { InstantFormAdapter, InstantFormLead, LeadData } from "@switchboard/ad-optimizer";

interface PendingLeadRetryCreate {
  organizationId: string;
  leadId: string;
  adId: string;
  formId: string;
  reason: string;
}

interface MetaLeadIntakeDeps {
  /**
   * Required: the adapter that converts Meta Instant Form leads into
   * `lead.intake` submissions through `PlatformIngress`. This is the SINGLE
   * source of truth for IF Contact creation — the workflow no longer talks
   * to `PrismaContactStore` directly.
   */
  instantFormAdapter: InstantFormAdapter;
  prisma?: unknown;
  accessToken?: string;
  parseLeadWebhook?: (payload: unknown) => LeadData[];
  fetchLeadDetail?: (
    leadId: string,
    accessToken: string,
  ) => Promise<{
    field_data?: Array<{ name: string; values: string[] }>;
    campaign_id?: string;
  }>;
  savePendingRetry?: (data: PendingLeadRetryCreate) => Promise<void>;
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

      let savePendingRetry = deps.savePendingRetry;
      if (!savePendingRetry) {
        const prisma = deps.prisma as import("@switchboard/db").PrismaClient | undefined;
        if (!prisma) {
          throw new Error(
            "meta.lead.intake workflow requires either savePendingRetry or prisma in deps",
          );
        }
        savePendingRetry = async (data: PendingLeadRetryCreate) => {
          type PrismaWithRetry = {
            pendingLeadRetry: {
              create: (args: { data: PendingLeadRetryCreate }) => Promise<unknown>;
            };
          };
          await (prisma as unknown as PrismaWithRetry).pendingLeadRetry.create({ data });
        };
      }

      const webhookLeads = parseLeadWebhook(input.payload);

      // Fail loudly when leads arrive but no access token is configured
      if (webhookLeads.length > 0 && !deps.accessToken) {
        for (const lead of webhookLeads) {
          await savePendingRetry({
            organizationId: workUnit.organizationId,
            leadId: lead.leadId,
            adId: lead.adId,
            formId: lead.formId,
            reason: "missing_token",
          });
        }
        return {
          outcome: "failed",
          summary: `${webhookLeads.length} lead(s) queued for retry — Meta Ads access token not configured`,
          outputs: { pendingLeadIds: webhookLeads.map((l) => l.leadId) },
          error: {
            code: "MISSING_ACCESS_TOKEN",
            message:
              "Meta Ads connection required to process leads. Connect Meta Ads in Settings > Channels.",
          },
        };
      }

      let created = 0;
      let duplicates = 0;
      const childFailures: Array<{ intent: string; leadId: string; error: string }> = [];

      for (const lead of webhookLeads) {
        let fieldData: Array<{ name: string; values: string[] }> | undefined;
        let campaignId: string | undefined;

        if (deps.accessToken) {
          try {
            const detail = await fetchDetail(lead.leadId, deps.accessToken);
            fieldData = detail.field_data;
            campaignId = detail.campaign_id;
          } catch {
            await savePendingRetry({
              organizationId: workUnit.organizationId,
              leadId: lead.leadId,
              adId: lead.adId,
              formId: lead.formId,
              reason: "fetch_failed",
            });
            continue;
          }
        }

        if (!fieldData || fieldData.length === 0) continue;

        const phone = fieldData.find((f) => f.name === "phone_number")?.values[0];
        const email = fieldData.find((f) => f.name === "email")?.values[0];
        // The InstantFormAdapter requires email or phone to ingest. Skip otherwise
        // (preserves prior behavior for phone-less leads — IF without phone or
        // email cannot be greeted via WhatsApp anyway).
        if (!phone && !email) continue;

        const intakeLead: InstantFormLead = {
          leadgenId: lead.leadId,
          adId: lead.adId,
          formId: lead.formId,
          ...(campaignId ? { campaignId } : {}),
          organizationId: workUnit.organizationId,
          deploymentId: workUnit.deployment.deploymentId,
          fieldData,
        };

        const ingestResult = await deps.instantFormAdapter.ingest(intakeLead);
        if (!ingestResult) continue;
        if (ingestResult.duplicate) {
          // Existing Contact for this lead — do NOT spawn greeting/inquiry
          // a second time. Idempotency is enforced in LeadIntakeHandler via
          // (organizationId, idempotencyKey=leadgen:<leadgenId>).
          duplicates++;
          continue;
        }

        created++;

        const name = fieldData.find((f) => f.name === "full_name")?.values[0];
        const greetingPhone = phone ?? "";
        const greetingResult = await services.submitChildWork({
          intent: "meta.lead.greeting.send",
          organizationId: workUnit.organizationId,
          actor: workUnit.actor,
          parentWorkUnitId: workUnit.id,
          parameters: {
            contactId: ingestResult.contactId,
            phone: greetingPhone,
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
            contactId: ingestResult.contactId,
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
          duplicates,
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
