import { Inngest } from "inngest";
import type { InstantFormAdapter } from "@switchboard/ad-optimizer";

const inngestClient = new Inngest({ id: "switchboard" });

const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours
const BASE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

interface PendingLeadRecord {
  id: string;
  organizationId: string;
  leadId: string;
  adId: string;
  formId: string;
  reason: string;
  attempts: number;
  maxAttempts: number;
}

interface LeadDetail {
  field_data?: Array<{ name: string; values: string[] }>;
  campaign_id?: string;
}

export interface LeadRetryCronDeps {
  findPendingLeads: () => Promise<PendingLeadRecord[]>;
  getOrgAccessToken: (orgId: string) => Promise<string | null>;
  fetchLeadDetail: (leadId: string, accessToken: string) => Promise<LeadDetail>;
  extractFieldValue: (
    fields: Array<{ name: string; values: string[] }> | undefined,
    name: string,
  ) => string | undefined;
  /**
   * Optional org→deployment lookup. Required by the InstantFormAdapter (LeadIntake
   * payloads must carry a deploymentId). Implementations should return the active
   * Meta-connected deployment for the org. When absent the lead remains pending.
   */
  resolveDeploymentId: (orgId: string) => Promise<string | null>;
  /**
   * Shared InstantFormAdapter — the SAME instance used by the meta.lead.intake
   * workflow. Cron-triggered work units are legitimate trace roots so this path
   * does NOT pass parentWorkUnitId.
   */
  instantFormAdapter: InstantFormAdapter;
  markResolved: (id: string) => Promise<void>;
  incrementAttempt: (id: string, nextRetryAt: Date) => Promise<void>;
  markExhausted: (id: string) => Promise<void>;
}

export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export async function executeLeadRetry(
  step: StepTools,
  deps: LeadRetryCronDeps,
): Promise<{ processed: number; resolved: number; retried: number; exhausted: number }> {
  const pending = await step.run("find-pending-leads", () => deps.findPendingLeads());

  let resolved = 0;
  let retried = 0;
  let exhausted = 0;

  for (const lead of pending) {
    await step.run(`retry-${lead.id}`, async () => {
      if (lead.attempts >= lead.maxAttempts) {
        await deps.markExhausted(lead.id);
        exhausted++;
        return;
      }

      const token = await deps.getOrgAccessToken(lead.organizationId);
      if (!token) {
        const nextRetryAt = computeNextRetry(lead.attempts);
        await deps.incrementAttempt(lead.id, nextRetryAt);
        retried++;
        return;
      }

      try {
        const detail = await deps.fetchLeadDetail(lead.leadId, token);
        const phone = deps.extractFieldValue(detail.field_data, "phone_number");
        const email = deps.extractFieldValue(detail.field_data, "email");

        if (!phone && !email) {
          // No primary identifier — adapter would skip anyway. Resolve to stop retrying.
          await deps.markResolved(lead.id);
          resolved++;
          return;
        }

        const deploymentId = await deps.resolveDeploymentId(lead.organizationId);
        if (!deploymentId) {
          // Org no longer has an active Meta deployment — keep retrying via backoff.
          const nextRetryAt = computeNextRetry(lead.attempts);
          await deps.incrementAttempt(lead.id, nextRetryAt);
          retried++;
          return;
        }

        // Route through the SAME InstantFormAdapter used by the webhook workflow.
        // No parentWorkUnitId — cron-initiated work units are legitimate trace roots.
        const ingestResult = await deps.instantFormAdapter.ingest({
          leadgenId: lead.leadId,
          adId: lead.adId,
          formId: lead.formId,
          ...(detail.campaign_id ? { campaignId: detail.campaign_id } : {}),
          organizationId: lead.organizationId,
          deploymentId,
          fieldData: detail.field_data ?? [],
        });

        // ingestResult is null only when neither phone nor email was present
        // (already handled above) or the handler did not return a contactId.
        // In both cases the retry has done its job — mark resolved.
        if (!ingestResult) {
          await deps.markResolved(lead.id);
          resolved++;
          return;
        }

        // Duplicate or fresh — both indicate the Contact now exists for this org.
        await deps.markResolved(lead.id);
        resolved++;
      } catch {
        const nextRetryAt = computeNextRetry(lead.attempts);
        await deps.incrementAttempt(lead.id, nextRetryAt);
        retried++;
      }
    });
  }

  return { processed: pending.length, resolved, retried, exhausted };
}

function computeNextRetry(currentAttempts: number): Date {
  const backoffMs = Math.min(BASE_INTERVAL_MS * Math.pow(2, currentAttempts), MAX_BACKOFF_MS);
  return new Date(Date.now() + backoffMs);
}

export function createLeadRetryCron(deps: LeadRetryCronDeps) {
  return inngestClient.createFunction(
    {
      id: "lead-retry",
      name: "Lead Retry Processor",
      retries: 2,
      triggers: [{ cron: "*/15 * * * *" }],
    },
    async ({ step }) => {
      return executeLeadRetry(step as unknown as StepTools, deps);
    },
  );
}
