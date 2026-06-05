import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildConversationFollowUpSendWorkflow } from "../conversation-followup-send-workflow.js";
import type { WhatsAppTemplate } from "@switchboard/core";

const baseWorkUnit = {
  id: "wu_1",
  organizationId: "org_1",
  actor: { id: "system:scheduled-follow-up", type: "system" as const },
  intent: "conversation.followup.send",
  parameters: {
    contactId: "contact_1",
    conversationThreadId: "thread_1",
    channel: "whatsapp",
    templateIntentClass: "re-engagement-offer",
    reason: "went_quiet",
    followUpId: "fu_1",
  },
  deployment: {
    deploymentId: "dep_1",
    skillSlug: "alex",
    trustLevel: "guided" as const,
    trustScore: 0,
  },
  resolvedMode: "workflow" as const,
  traceId: "trace_1",
  trigger: "schedule" as const,
  priority: "normal" as const,
};

const APPROVED: WhatsAppTemplate = {
  name: "re_engagement_offer_sg_v1",
  metaTemplateName: "alex_re_engagement_offer_sg_v1",
  intentClass: "re-engagement-offer",
  jurisdiction: "SG",
  templateCategory: "marketing",
  approvalStatus: "approved",
  body: "Hi {{lead_name}} ...",
  variables: [
    { name: "lead_name", description: "first name" },
    { name: "business_name", description: "clinic" },
  ],
};

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    getSendContext: vi.fn().mockResolvedValue({
      consentGrantedAt: "2026-05-01T00:00:00.000Z",
      consentRevokedAt: null,
      pdpaJurisdiction: "SG",
      messagingOptIn: true,
      lastWhatsAppInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      jurisdiction: "SG",
      leadName: "Jane",
      businessName: "Glow Clinic",
      phone: "+6591234567",
    }),
    allowMarketingTemplate: true,
    selectTemplateFn: () => APPROVED,
    ...over,
  };
}

describe("conversation.followup.send handler", () => {
  beforeEach(() => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "tok";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "pnid";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
  });

  it("skips (completed, sent:false) for an unsupported channel", async () => {
    const wf = buildConversationFollowUpSendWorkflow(makeDeps());
    const r = await wf.execute(
      { ...baseWorkUnit, parameters: { ...baseWorkUnit.parameters, channel: "telegram" } } as never,
      { submitChildWork: vi.fn() },
    );
    expect(r.outcome).toBe("completed");
    expect(r.outputs).toEqual({ sent: false, skipReason: "unsupported_channel" });
  });

  it("skips (completed, sent:false) with the gate's reason when not eligible", async () => {
    const deps = makeDeps({
      getSendContext: vi.fn().mockResolvedValue({
        consentGrantedAt: null,
        consentRevokedAt: null,
        pdpaJurisdiction: "SG",
        messagingOptIn: true,
        lastWhatsAppInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        jurisdiction: "SG",
        leadName: "Jane",
        businessName: "Glow Clinic",
        phone: "+6591234567",
      }),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationFollowUpSendWorkflow(deps);
    const r = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("completed");
    expect(r.outputs).toEqual({ sent: false, skipReason: "consent_pending" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the approved template to the contact phone and returns sent:true when eligible", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid_1" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationFollowUpSendWorkflow(makeDeps());
    const r = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("completed");
    expect(r.outputs!.sent).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("graph.facebook.com");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.to).toBe("+6591234567");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("alex_re_engagement_offer_sg_v1");
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "Jane" },
      { type: "text", text: "Glow Clinic" },
    ]);
  });

  it("returns failed when the Graph API call errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: async () => "rate limited" }),
    );
    const wf = buildConversationFollowUpSendWorkflow(makeDeps());
    const r = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("failed");
    expect(r.error!.code).toBe("WHATSAPP_TEMPLATE_SEND_FAILED");
  });
});
