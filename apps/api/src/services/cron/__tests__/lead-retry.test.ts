import { describe, expect, it, vi } from "vitest";
import { executeLeadRetry } from "../lead-retry.js";
import type { LeadRetryCronDeps, StepTools } from "../lead-retry.js";

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

describe("executeLeadRetry", () => {
  it("resolves a lead when token becomes available", async () => {
    const markResolved = vi.fn().mockResolvedValue(undefined);
    const createContact = vi.fn().mockResolvedValue({ id: "contact_1" });

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
      findExistingContact: vi.fn().mockResolvedValue(null),
      createContact,
      markResolved,
      incrementAttempt: vi.fn(),
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.resolved).toBe(1);
    expect(result.processed).toBe(1);
    expect(createContact).toHaveBeenCalledOnce();
    expect(markResolved).toHaveBeenCalledWith("retry_1");
  });

  it("increments attempt when token still unavailable", async () => {
    const incrementAttempt = vi.fn().mockResolvedValue(undefined);

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead({ attempts: 1 })]),
      getOrgAccessToken: vi.fn().mockResolvedValue(null),
      fetchLeadDetail: vi.fn(),
      extractFieldValue: vi.fn(),
      findExistingContact: vi.fn(),
      createContact: vi.fn(),
      markResolved: vi.fn(),
      incrementAttempt,
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.retried).toBe(1);
    expect(incrementAttempt).toHaveBeenCalledOnce();
    const nextRetry = incrementAttempt.mock.calls[0]![1] as Date;
    // Backoff: 15min * 2^1 = 30min
    expect(nextRetry.getTime()).toBeGreaterThan(Date.now() + 25 * 60 * 1000);
  });

  it("marks exhausted when attempts >= maxAttempts", async () => {
    const markExhausted = vi.fn().mockResolvedValue(undefined);

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead({ attempts: 5, maxAttempts: 5 })]),
      getOrgAccessToken: vi.fn(),
      fetchLeadDetail: vi.fn(),
      extractFieldValue: vi.fn(),
      findExistingContact: vi.fn(),
      createContact: vi.fn(),
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

    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([makeLead()]),
      getOrgAccessToken: vi.fn().mockResolvedValue("test-token"),
      fetchLeadDetail: vi.fn().mockRejectedValue(new Error("API error")),
      extractFieldValue: vi.fn(),
      findExistingContact: vi.fn(),
      createContact: vi.fn(),
      markResolved: vi.fn(),
      incrementAttempt,
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.retried).toBe(1);
    expect(incrementAttempt).toHaveBeenCalledOnce();
  });

  it("resolves without creating contact if phone missing", async () => {
    const markResolved = vi.fn().mockResolvedValue(undefined);

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
      findExistingContact: vi.fn(),
      createContact: vi.fn(),
      markResolved,
      incrementAttempt: vi.fn(),
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result.resolved).toBe(1);
    expect(deps.createContact).not.toHaveBeenCalled();
    expect(markResolved).toHaveBeenCalledWith("retry_1");
  });

  it("returns zeros when no pending leads", async () => {
    const deps: LeadRetryCronDeps = {
      findPendingLeads: vi.fn().mockResolvedValue([]),
      getOrgAccessToken: vi.fn(),
      fetchLeadDetail: vi.fn(),
      extractFieldValue: vi.fn(),
      findExistingContact: vi.fn(),
      createContact: vi.fn(),
      markResolved: vi.fn(),
      incrementAttempt: vi.fn(),
      markExhausted: vi.fn(),
    };

    const result = await executeLeadRetry(makeStep(), deps);

    expect(result).toEqual({ processed: 0, resolved: 0, retried: 0, exhausted: 0 });
  });
});
