import { describe, expect, it, vi } from "vitest";
import { buildMetaLeadIntakeWorkflow } from "../meta-lead-intake-workflow.js";

describe("buildMetaLeadIntakeWorkflow", () => {
  it("creates contacts and emits child work for greeting and inquiry recording", async () => {
    const createContact = vi.fn().mockResolvedValue({ id: "contact_1" });
    const workflow = buildMetaLeadIntakeWorkflow({
      prisma: {} as never,
      parseLeadWebhook: () => [
        {
          leadId: "lead_1",
          adId: "ad_1",
          name: "Taylor Test",
          phone: "+15550001",
          email: "test@example.com",
        },
      ],
      findExistingContact: vi.fn().mockResolvedValue(null),
      createContact,
    });

    const submitChildWork = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        workUnitId: "child_1",
        outcome: "completed",
        summary: "ok",
        outputs: {},
        mode: "workflow",
        durationMs: 1,
        traceId: "trace_child",
      },
      workUnit: {} as never,
    });

    const result = await workflow.execute(
      {
        id: "wu_1",
        requestedAt: new Date().toISOString(),
        organizationId: "org_1",
        actor: { id: "meta:page_1", type: "service" },
        intent: "meta.lead.intake",
        parameters: {
          payload: { entry: [{ id: "page_1" }] },
          greetingTemplateName: "lead_welcome",
        },
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
    expect(submitChildWork).toHaveBeenCalledTimes(2);
    expect(submitChildWork.mock.calls[0]?.[0].intent).toBe("meta.lead.greeting.send");
    expect(submitChildWork.mock.calls[1]?.[0].intent).toBe("meta.lead.inquiry.record");
  });

  it("skips leads without phone numbers", async () => {
    const createContact = vi.fn();
    const workflow = buildMetaLeadIntakeWorkflow({
      prisma: {} as never,
      parseLeadWebhook: () => [
        { leadId: "lead_1", adId: "ad_1", name: "No Phone", phone: undefined, email: undefined },
      ],
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
    expect(submitChildWork).not.toHaveBeenCalled();
  });

  it("deduplicates leads by phone + adId", async () => {
    const createContact = vi.fn();
    const workflow = buildMetaLeadIntakeWorkflow({
      prisma: {} as never,
      parseLeadWebhook: () => [
        { leadId: "lead_1", adId: "ad_1", name: "Dupe", phone: "+15550001", email: undefined },
      ],
      findExistingContact: vi.fn().mockResolvedValue({ attribution: { sourceAdId: "ad_1" } }),
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

    expect(result.outputs!.created).toBe(0);
    expect(createContact).not.toHaveBeenCalled();
    expect(submitChildWork).not.toHaveBeenCalled();
  });
});
