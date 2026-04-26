import { describe, expect, it, vi } from "vitest";
import { buildMetaLeadIntakeWorkflow } from "../meta-lead-intake-workflow.js";
import type { InstantFormAdapter } from "@switchboard/ad-optimizer";

const baseWorkUnit = {
  id: "wu_1",
  organizationId: "org_1",
  actor: { id: "meta:page_1", type: "service" as const },
  intent: "meta.lead.intake",
  parameters: { payload: {}, greetingTemplateName: "lead_welcome" },
  deployment: {
    deploymentId: "api-direct",
    skillSlug: "meta",
    trustLevel: "guided" as const,
    trustScore: 0,
  },
  resolvedMode: "workflow" as const,
  traceId: "trace_1",
  trigger: "internal" as const,
  priority: "normal" as const,
};

const buildAdapter = (ingest: ReturnType<typeof vi.fn>): InstantFormAdapter =>
  ({ ingest }) as unknown as InstantFormAdapter;

const fieldExtractor = (
  fields: Array<{ name: string; values: string[] }> | undefined,
  name: string,
) => fields?.find((f) => f.name === name)?.values?.[0];

describe("buildMetaLeadIntakeWorkflow", () => {
  it("delegates Contact creation to InstantFormAdapter and dispatches child work", async () => {
    const ingest = vi.fn().mockResolvedValue({ contactId: "contact_1", duplicate: false });
    const fetchLeadDetail = vi.fn().mockResolvedValue({
      field_data: [
        { name: "full_name", values: ["Taylor Test"] },
        { name: "email", values: ["test@example.com"] },
        { name: "phone_number", values: ["+15550001"] },
      ],
      campaign_id: "campaign_1",
    });

    const workflow = buildMetaLeadIntakeWorkflow({
      instantFormAdapter: buildAdapter(ingest),
      accessToken: "test-token",
      parseLeadWebhook: () => [{ leadId: "lead_1", adId: "ad_1", formId: "form_1" }],
      fetchLeadDetail,
      savePendingRetry: vi.fn(),
    });

    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { workUnitId: "child_1", outcome: "completed", summary: "ok", outputs: {} },
      workUnit: {} as never,
    });

    const result = await workflow.execute(
      { ...baseWorkUnit, requestedAt: new Date().toISOString() },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(result.outputs!.created).toBe(1);
    expect(result.outputs!.duplicates).toBe(0);
    expect(fetchLeadDetail).toHaveBeenCalledWith("lead_1", "test-token");

    // The adapter is the SINGLE Contact-creation path.
    expect(ingest).toHaveBeenCalledOnce();
    const lead = ingest.mock.calls[0]![0];
    const ingestOpts = ingest.mock.calls[0]![1];
    expect(ingestOpts).toEqual({ parentWorkUnitId: "wu_1" });
    expect(lead.leadgenId).toBe("lead_1");
    expect(lead.adId).toBe("ad_1");
    expect(lead.campaignId).toBe("campaign_1");
    expect(lead.organizationId).toBe("org_1");
    expect(lead.deploymentId).toBe("api-direct");
    expect(fieldExtractor(lead.fieldData, "phone_number")).toBe("+15550001");

    // Child work units fire with the contactId returned by the adapter.
    expect(submitChildWork).toHaveBeenCalledTimes(2);
    const greetingCall = submitChildWork.mock.calls[0]![0];
    expect(greetingCall.intent).toBe("meta.lead.greeting.send");
    expect(greetingCall.parameters.contactId).toBe("contact_1");
    expect(greetingCall.parameters.firstName).toBe("Taylor");
    const inquiryCall = submitChildWork.mock.calls[1]![0];
    expect(inquiryCall.intent).toBe("meta.lead.inquiry.record");
    expect(inquiryCall.parameters.contactId).toBe("contact_1");
  });

  it("treats adapter duplicate=true as a no-op (no double greeting)", async () => {
    const ingest = vi.fn().mockResolvedValue({ contactId: "contact_existing", duplicate: true });
    const fetchLeadDetail = vi.fn().mockResolvedValue({
      field_data: [
        { name: "full_name", values: ["Repeat Lead"] },
        { name: "phone_number", values: ["+15550001"] },
      ],
    });

    const workflow = buildMetaLeadIntakeWorkflow({
      instantFormAdapter: buildAdapter(ingest),
      accessToken: "test-token",
      parseLeadWebhook: () => [{ leadId: "lead_dup", adId: "ad_1", formId: "form_1" }],
      fetchLeadDetail,
      savePendingRetry: vi.fn(),
    });

    const submitChildWork = vi.fn();
    const result = await workflow.execute(
      { ...baseWorkUnit, requestedAt: new Date().toISOString() },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(result.outputs!.created).toBe(0);
    expect(result.outputs!.duplicates).toBe(1);
    expect(ingest).toHaveBeenCalledOnce();
    expect(submitChildWork).not.toHaveBeenCalled();
  });

  it("skips leads when no phone or email in API response", async () => {
    const ingest = vi.fn();
    const workflow = buildMetaLeadIntakeWorkflow({
      instantFormAdapter: buildAdapter(ingest),
      accessToken: "test-token",
      parseLeadWebhook: () => [{ leadId: "lead_1", adId: "ad_1", formId: "form_1" }],
      fetchLeadDetail: vi.fn().mockResolvedValue({
        field_data: [{ name: "full_name", values: ["No Phone"] }],
      }),
      savePendingRetry: vi.fn(),
    });

    const submitChildWork = vi.fn();
    const result = await workflow.execute(
      { ...baseWorkUnit, requestedAt: new Date().toISOString() },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(result.outputs!.created).toBe(0);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("fails loudly and saves pending retries when no accessToken", async () => {
    const ingest = vi.fn();
    const savePendingRetry = vi.fn().mockResolvedValue(undefined);
    const workflow = buildMetaLeadIntakeWorkflow({
      instantFormAdapter: buildAdapter(ingest),
      parseLeadWebhook: () => [
        { leadId: "lead_1", adId: "ad_1", formId: "form_1" },
        { leadId: "lead_2", adId: "ad_2", formId: "form_2" },
      ],
      savePendingRetry,
    });

    const submitChildWork = vi.fn();
    const result = await workflow.execute(
      { ...baseWorkUnit, requestedAt: new Date().toISOString() },
      { submitChildWork },
    );

    expect(result.outcome).toBe("failed");
    expect(result.error!.code).toBe("MISSING_ACCESS_TOKEN");
    expect(result.outputs!.pendingLeadIds).toEqual(["lead_1", "lead_2"]);
    expect(savePendingRetry).toHaveBeenCalledTimes(2);
    expect(savePendingRetry).toHaveBeenCalledWith({
      organizationId: "org_1",
      leadId: "lead_1",
      adId: "ad_1",
      formId: "form_1",
      reason: "missing_token",
    });
    expect(ingest).not.toHaveBeenCalled();
    expect(submitChildWork).not.toHaveBeenCalled();
  });

  it("completes with 0 when no leads and no accessToken", async () => {
    const ingest = vi.fn();
    const workflow = buildMetaLeadIntakeWorkflow({
      instantFormAdapter: buildAdapter(ingest),
      parseLeadWebhook: () => [],
      savePendingRetry: vi.fn(),
    });

    const submitChildWork = vi.fn();
    const result = await workflow.execute(
      { ...baseWorkUnit, requestedAt: new Date().toISOString() },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("saves pending retry on Graph fetch failure and continues to next lead", async () => {
    const ingest = vi.fn().mockResolvedValue({ contactId: "contact_ok", duplicate: false });
    const savePendingRetry = vi.fn().mockResolvedValue(undefined);
    const fetchLeadDetail = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        field_data: [
          { name: "full_name", values: ["Good Lead"] },
          { name: "phone_number", values: ["+15550002"] },
        ],
      });

    const workflow = buildMetaLeadIntakeWorkflow({
      instantFormAdapter: buildAdapter(ingest),
      accessToken: "test-token",
      parseLeadWebhook: () => [
        { leadId: "lead_fail", adId: "ad_1", formId: "form_1" },
        { leadId: "lead_ok", adId: "ad_2", formId: "form_2" },
      ],
      fetchLeadDetail,
      savePendingRetry,
    });

    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { workUnitId: "child_1", outcome: "completed", summary: "ok", outputs: {} },
      workUnit: {} as never,
    });

    const result = await workflow.execute(
      { ...baseWorkUnit, requestedAt: new Date().toISOString() },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(result.outputs!.created).toBe(1);
    expect(savePendingRetry).toHaveBeenCalledOnce();
    expect(savePendingRetry).toHaveBeenCalledWith({
      organizationId: "org_1",
      leadId: "lead_fail",
      adId: "ad_1",
      formId: "form_1",
      reason: "fetch_failed",
    });
    expect(ingest).toHaveBeenCalledOnce();
  });

  it("skips child work dispatch when adapter returns null (no email/phone)", async () => {
    const ingest = vi.fn().mockResolvedValue(null);
    const fetchLeadDetail = vi.fn().mockResolvedValue({
      field_data: [
        { name: "full_name", values: ["No Phone Either"] },
        { name: "phone_number", values: ["+15550003"] },
      ],
    });

    const workflow = buildMetaLeadIntakeWorkflow({
      instantFormAdapter: buildAdapter(ingest),
      accessToken: "test-token",
      parseLeadWebhook: () => [{ leadId: "lead_x", adId: "ad_x", formId: "form_x" }],
      fetchLeadDetail,
      savePendingRetry: vi.fn(),
    });

    const submitChildWork = vi.fn();
    const result = await workflow.execute(
      { ...baseWorkUnit, requestedAt: new Date().toISOString() },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(result.outputs!.created).toBe(0);
    expect(submitChildWork).not.toHaveBeenCalled();
  });
});
