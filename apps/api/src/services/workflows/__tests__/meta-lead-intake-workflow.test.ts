import { describe, expect, it, vi } from "vitest";
import { buildMetaLeadIntakeWorkflow } from "../meta-lead-intake-workflow.js";

describe("buildMetaLeadIntakeWorkflow", () => {
  it("fetches lead detail via API and creates contacts", async () => {
    const createContact = vi.fn().mockResolvedValue({ id: "contact_1" });
    const fetchLeadDetail = vi.fn().mockResolvedValue({
      field_data: [
        { name: "full_name", values: ["Taylor Test"] },
        { name: "email", values: ["test@example.com"] },
        { name: "phone_number", values: ["+15550001"] },
      ],
      campaign_id: "campaign_1",
    });
    const extractFieldValue = vi.fn(
      (fields: Array<{ name: string; values: string[] }> | undefined, name: string) => {
        const f = fields?.find((x) => x.name === name);
        return f?.values?.[0];
      },
    );

    const workflow = buildMetaLeadIntakeWorkflow({
      prisma: {} as never,
      accessToken: "test-token",
      parseLeadWebhook: () => [{ leadId: "lead_1", adId: "ad_1", formId: "form_1" }],
      fetchLeadDetail,
      extractFieldValue,
      findExistingContact: vi.fn().mockResolvedValue(null),
      createContact,
    });

    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: { workUnitId: "child_1", outcome: "completed", summary: "ok", outputs: {} },
      workUnit: {} as never,
    });

    const result = await workflow.execute(
      {
        id: "wu_1",
        requestedAt: new Date().toISOString(),
        organizationId: "org_1",
        actor: { id: "meta:page_1", type: "service" },
        intent: "meta.lead.intake",
        parameters: { payload: { entry: [] }, greetingTemplateName: "lead_welcome" },
        deployment: {
          deploymentId: "api-direct",
          skillSlug: "meta",
          trustLevel: "guided",
          trustScore: 0,
        },
        resolvedMode: "workflow",
        traceId: "trace_1",
        trigger: "internal",
        priority: "normal",
      },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(createContact).toHaveBeenCalledOnce();
    expect(fetchLeadDetail).toHaveBeenCalledWith("lead_1", "test-token");
    const contactArg = createContact.mock.calls[0]![0] as Record<string, unknown>;
    const attribution = contactArg.attribution as Record<string, unknown>;
    expect(attribution.sourceCampaignId).toBe("campaign_1");
    expect(submitChildWork).toHaveBeenCalledTimes(2);
  });

  it("skips leads when no phone in API response", async () => {
    const createContact = vi.fn();
    const workflow = buildMetaLeadIntakeWorkflow({
      prisma: {} as never,
      accessToken: "test-token",
      parseLeadWebhook: () => [{ leadId: "lead_1", adId: "ad_1", formId: "form_1" }],
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
      createContact,
    });

    const submitChildWork = vi.fn();
    const result = await workflow.execute(
      {
        id: "wu_1",
        requestedAt: new Date().toISOString(),
        organizationId: "org_1",
        actor: { id: "meta:page_1", type: "service" },
        intent: "meta.lead.intake",
        parameters: { payload: {}, greetingTemplateName: "lead_welcome" },
        deployment: {
          deploymentId: "api-direct",
          skillSlug: "meta",
          trustLevel: "guided",
          trustScore: 0,
        },
        resolvedMode: "workflow",
        traceId: "trace_1",
        trigger: "internal",
        priority: "normal",
      },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(result.outputs!.created).toBe(0);
    expect(createContact).not.toHaveBeenCalled();
  });

  it("works without accessToken (no API detail fetch)", async () => {
    const createContact = vi.fn();
    const workflow = buildMetaLeadIntakeWorkflow({
      prisma: {} as never,
      parseLeadWebhook: () => [{ leadId: "lead_1", adId: "ad_1", formId: "form_1" }],
      findExistingContact: vi.fn(),
      createContact,
    });

    const submitChildWork = vi.fn();
    const result = await workflow.execute(
      {
        id: "wu_1",
        requestedAt: new Date().toISOString(),
        organizationId: "org_1",
        actor: { id: "meta:page_1", type: "service" },
        intent: "meta.lead.intake",
        parameters: { payload: {}, greetingTemplateName: "lead_welcome" },
        deployment: {
          deploymentId: "api-direct",
          skillSlug: "meta",
          trustLevel: "guided",
          trustScore: 0,
        },
        resolvedMode: "workflow",
        traceId: "trace_1",
        trigger: "internal",
        priority: "normal",
      },
      { submitChildWork },
    );

    expect(result.outcome).toBe("completed");
    expect(result.outputs!.created).toBe(0);
  });
});
