import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildConversationFollowUpSendWorkflow } from "../conversation-followup-send-workflow.js";
import type { WhatsAppTemplate } from "@switchboard/core";
import { setMetrics, createInMemoryMetrics } from "@switchboard/core";

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
    vi.restoreAllMocks();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
    setMetrics(createInMemoryMetrics());
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

// Send-token / config-miss reliability cases live in their OWN describe block,
// appended at end-of-file rather than threaded into the eligibility describe above,
// so they never collide with a sibling change that inserts its own cases into that
// same describe (e.g. the template-approval-overlay work).
describe("conversation.followup.send handler — send token + config-miss", () => {
  beforeEach(() => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "tok";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "pnid";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
    setMetrics(createInMemoryMetrics());
  });

  it("resolves the send token under the legacy WHATSAPP_TOKEN name", async () => {
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    process.env["WHATSAPP_TOKEN"] = "legacy_tok";
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid_1" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationFollowUpSendWorkflow(makeDeps());
    const r = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("completed");
    expect(r.outputs!.sent).toBe(true);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer legacy_tok",
    );
  });

  it("config-miss: warns + increments whatsappProactiveSendSkipped{reason:config_missing}", async () => {
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    const metrics = createInMemoryMetrics();
    const skipSpy = vi.spyOn(metrics.whatsappProactiveSendSkipped, "inc");
    setMetrics(metrics);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const wf = buildConversationFollowUpSendWorkflow(makeDeps());
    const r = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });

    expect(r.outcome).toBe("completed");
    expect(r.outputs).toEqual({ sent: false, skipReason: "unsupported_channel" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledWith({
      intent: "conversation.followup.send",
      reason: "config_missing",
    });
  });
});

// Multi-tenant per-org send-credential resolution. Its OWN describe (appended at
// end-of-file) so it never collides with a sibling change inserting cases above.
describe("conversation.followup.send handler - per-org send creds (multi-tenant)", () => {
  beforeEach(() => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "ENV_TOK";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "ENV_PN";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
    setMetrics(createInMemoryMetrics());
  });

  it("sends from the resolved ORG's phone id + token, not the global env values", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid_1" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const resolveOrgSendCreds = vi.fn().mockResolvedValue({ token: "T2", phoneNumberId: "P2" });
    const wf = buildConversationFollowUpSendWorkflow(makeDeps({ resolveOrgSendCreds }));
    const r = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("completed");
    expect(resolveOrgSendCreds).toHaveBeenCalledWith("org_1");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/P2/messages");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer T2");
  });

  it("falls back to the global env phone id + token when the org resolver returns null", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid_1" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const resolveOrgSendCreds = vi.fn().mockResolvedValue(null);
    const wf = buildConversationFollowUpSendWorkflow(makeDeps({ resolveOrgSendCreds }));
    const r = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(r.outcome).toBe("completed");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/ENV_PN/messages");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer ENV_TOK",
    );
  });

  it("applies PER-FIELD fallback: org phone id + env token when the org omits token", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid_1" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const resolveOrgSendCreds = vi.fn().mockResolvedValue({ token: null, phoneNumberId: "P2" });
    const wf = buildConversationFollowUpSendWorkflow(makeDeps({ resolveOrgSendCreds }));
    await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/P2/messages");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer ENV_TOK",
    );
  });

  it("HEADLINE: two different orgs resolve two different phone numbers end-to-end", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid_1" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const resolveOrgSendCreds = vi.fn(async (orgId: string) =>
      orgId === "orgA"
        ? { token: "T_A", phoneNumberId: "P_A" }
        : { token: "T_B", phoneNumberId: "P_B" },
    );
    const wf = buildConversationFollowUpSendWorkflow(makeDeps({ resolveOrgSendCreds }));
    await wf.execute({ ...baseWorkUnit, organizationId: "orgA" } as never, {
      submitChildWork: vi.fn(),
    });
    await wf.execute({ ...baseWorkUnit, organizationId: "orgB" } as never, {
      submitChildWork: vi.fn(),
    });
    const [urlA, initA] = fetchSpy.mock.calls[0]!;
    const [urlB, initB] = fetchSpy.mock.calls[1]!;
    expect(urlA).toBe("https://graph.facebook.com/v21.0/P_A/messages");
    expect(urlB).toBe("https://graph.facebook.com/v21.0/P_B/messages");
    expect((initA as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer T_A");
    expect((initB as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer T_B");
  });
});
