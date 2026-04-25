import { Inngest } from "inngest";

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
  findExistingContact: (orgId: string, phone: string) => Promise<{ attribution?: unknown } | null>;
  createContact: (data: Record<string, unknown>) => Promise<{ id: string }>;
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

        if (!phone) {
          await deps.markResolved(lead.id);
          resolved++;
          return;
        }

        const existing = await deps.findExistingContact(lead.organizationId, phone);
        const existingAdId = (existing?.attribution as Record<string, unknown> | null)?.sourceAdId;

        if (existing && existingAdId === lead.adId) {
          await deps.markResolved(lead.id);
          resolved++;
          return;
        }

        const name = deps.extractFieldValue(detail.field_data, "full_name");
        const email = deps.extractFieldValue(detail.field_data, "email");
        const campaignId = detail.campaign_id;

        await deps.createContact({
          organizationId: lead.organizationId,
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
