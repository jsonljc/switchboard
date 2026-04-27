import { describe, expect, it, vi } from "vitest";
import { executeLeadRetry } from "../lead-retry.js";
import type { LeadRetryCronDeps, StepTools } from "../lead-retry.js";
import type { InstantFormAdapter } from "@switchboard/ad-optimizer";

function makeStep(): StepTools {
  return {
    run: async <T>(_name: string, fn: () => T | Promise<T>): Promise<T> => fn(),
  };
}

interface PendingLead {
  id: string;
  organizationId: string;
  leadId: string;
  adId: string;
  formId: string;
  reason: string;
  attempts: number;
  maxAttempts: number;
}

function makeLead(overrides: Partial<PendingLead> = {}): PendingLead {
  return {
    id: "retry_1",
    organizationId: "org_1",
    leadId: "lead_1",
    adId: "ad_1",
    formId: "form_1",
    reason: "missing_token",
    attempts: 0,
    maxAttempts: 5,
    ...overrides,
  };
}

const buildAdapter = (ingest: ReturnType<typeof vi.fn>): InstantFormAdapter =>
  ({ ingest }) as unknown as InstantFormAdapter;

describe("executeLeadRetry", () => {
  it("routes resolved retries through InstantFormAdapter (no direct contact write)", async () => {
    const markResolved = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn().mockResolvedValue({ contactId: "contact_1", duplicate: false });

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead()]),
      getOrgAccessToken: vi.fn().mockResolvedValue("test-token"),
      fetchLeadDetail: vi.fn().mockResolvedValue({
        field_data: [
          { name: "full_name", values: ["Test User"] },
          { name: "phone_number", values: ["+15550001"] },
          { name: "email", values: ["test@example.com"] },
        ],
        campaign_id: "campaign_1",
      }),
      extractFieldValue: vi.fn(
        (fields: Array<{ name: string; values: string[] }> | undefined, name: string) => {
          const f = fields?.find((x) => x.name === name);
          return f?.values?.[0];
        },
      ),
      resolveDeploymentId: vi.fn().mockResolvedValue("dep_1"),
      instantFormAdapter: buildAdapter(ingest),
      markResolved,
      incrementAttempt: vi.fn(),
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.resolved).toBe(1);
    expect(result.processed).toBe(1);
    expect(ingest).toHaveBeenCalledOnce();
    const ingestArgs = ingest.mock.calls[0]!;
    expect(ingestArgs[0]).toMatchObject({
      leadgenId: "lead_1",
      adId: "ad_1",
      formId: "form_1",
      campaignId: "campaign_1",
      organizationId: "org_1",
      deploymentId: "dep_1",
    });
    // Cron-initiated work units are legitimate trace roots — no parent.
    expect(ingestArgs[1]).toBeUndefined();
    expect(markResolved).toHaveBeenCalledWith("retry_1");
  });

  it("treats adapter duplicate=true as resolved (no double processing)", async () => {
    const markResolved = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn().mockResolvedValue({ contactId: "contact_1", duplicate: true });

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead()]),
      getOrgAccessToken: vi.fn().mockResolvedValue("test-token"),
      fetchLeadDetail: vi.fn().mockResolvedValue({
        field_data: [{ name: "phone_number", values: ["+15550001"] }],
      }),
      extractFieldValue: vi.fn(
        (fields: Array<{ name: string; values: string[] }> | undefined, name: string) => {
          const f = fields?.find((x) => x.name === name);
          return f?.values?.[0];
        },
      ),
      resolveDeploymentId: vi.fn().mockResolvedValue("dep_1"),
      instantFormAdapter: buildAdapter(ingest),
      markResolved,
      incrementAttempt: vi.fn(),
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.resolved).toBe(1);
    expect(markResolved).toHaveBeenCalledWith("retry_1");
  });

  it("increments attempt when token still unavailable", async () => {
    const incrementAttempt = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn();

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead({ attempts: 1 })]),
      getOrgAccessToken: vi.fn().mockResolvedValue(null),
      fetchLeadDetail: vi.fn(),
      extractFieldValue: vi.fn(),
      resolveDeploymentId: vi.fn(),
      instantFormAdapter: buildAdapter(ingest),
      markResolved: vi.fn(),
      incrementAttempt,
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.retried).toBe(1);
    expect(ingest).not.toHaveBeenCalled();
    expect(incrementAttempt).toHaveBeenCalledOnce();
    const nextRetry = incrementAttempt.mock.calls[0]![1] as Date;
    // Backoff: 15min * 2^1 = 30min
    expect(nextRetry.getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000);
  });

  it("retries with backoff when no active deployment for org", async () => {
    const incrementAttempt = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn();

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead()]),
      getOrgAccessToken: vi.fn().mockResolvedValue("test-token"),
      fetchLeadDetail: vi.fn().mockResolvedValue({
        field_data: [{ name: "phone_number", values: ["+15550001"] }],
      }),
      extractFieldValue: vi.fn(
        (fields: Array<{ name: string; values: string[] }> | undefined, name: string) => {
          const f = fields?.find((x) => x.name === name);
          return f?.values?.[0];
        },
      ),
      resolveDeploymentId: vi.fn().mockResolvedValue(null),
      instantFormAdapter: buildAdapter(ingest),
      markResolved: vi.fn(),
      incrementAttempt,
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.retried).toBe(1);
    expect(ingest).not.toHaveBeenCalled();
    expect(incrementAttempt).toHaveBeenCalledOnce();
  });

  it("marks exhausted when attempts >= maxAttempts", async () => {
    const markExhausted = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn();

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead({ attempts: 5, maxAttempts: 5 })]),
      getOrgAccessToken: vi.fn(),
      fetchLeadDetail: vi.fn(),
      extractFieldValue: vi.fn(),
      resolveDeploymentId: vi.fn(),
      instantFormAdapter: buildAdapter(ingest),
      markResolved: vi.fn(),
      incrementAttempt: vi.fn(),
      markExhausted,
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.exhausted).toBe(1);
    expect(markExhausted).toHaveBeenCalledWith("retry_1");
  });

  it("increments attempt on fetch failure", async () => {
    const incrementAttempt = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn();

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead()]),
      getOrgAccessToken: vi.fn().mockResolvedValue("test-token"),
      fetchLeadDetail: vi.fn().mockRejectedValue(new Error("API error")),
      extractFieldValue: vi.fn(),
      resolveDeploymentId: vi.fn(),
      instantFormAdapter: buildAdapter(ingest),
      markResolved: vi.fn(),
      incrementAttempt,
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.retried).toBe(1);
    expect(incrementAttempt).toHaveBeenCalledOnce();
    expect(ingest).not.toHaveBeenCalled();
  });

  it("resolves without invoking adapter if neither phone nor email present", async () => {
    const markResolved = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn();

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead()]),
      getOrgAccessToken: vi.fn().mockResolvedValue("test-token"),
      fetchLeadDetail: vi.fn().mockResolvedValue({
        field_data: [{ name: "full_name", values: ["No Phone"] }],
      }),
      extractFieldValue: vi.fn(
        (fields: Array<{ name: string; values: string[] }> | undefined, name: string) => {
          const f = fields?.find((x) => x.name === name);
          return f?.values?.[0];
        },
      ),
      resolveDeploymentId: vi.fn(),
      instantFormAdapter: buildAdapter(ingest),
      markResolved,
      incrementAttempt: vi.fn(),
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.resolved).toBe(1);
    expect(ingest).not.toHaveBeenCalled();
    expect(markResolved).toHaveBeenCalledWith("retry_1");
  });

  it("returns zeros when no pending leads", async () => {
    const ingest = vi.fn();
    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([]),
      getOrgAccessToken: vi.fn(),
      fetchLeadDetail: vi.fn(),
      extractFieldValue: vi.fn(),
      resolveDeploymentId: vi.fn(),
      instantFormAdapter: buildAdapter(ingest),
      markResolved: vi.fn(),
      incrementAttempt: vi.fn(),
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result).toEqual({ processed: 0, resolved: 0, retried: 0, exhausted: 0 });
  });
});
