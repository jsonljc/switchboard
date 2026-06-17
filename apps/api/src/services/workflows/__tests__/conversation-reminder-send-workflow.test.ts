import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildConversationReminderSendWorkflow } from "../conversation-reminder-send-workflow.js";
import type { WhatsAppTemplate } from "@switchboard/core";

const baseWorkUnit = {
  id: "wu_1",
  organizationId: "org_1",
  actor: { id: "system", type: "system" as const },
  intent: "conversation.reminder.send",
  parameters: {
    contactId: "c_1",
    bookingId: "bk_1",
    startsAt: "2026-05-13T02:00:00.000Z",
    timezone: "Asia/Singapore",
    channel: "whatsapp",
    reminderId: "rm_1",
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
  name: "appointment_reminder_sg_v1",
  metaTemplateName: "alex_appointment_reminder_sg_v1",
  intentClass: "appointment-reminder",
  jurisdiction: "SG",
  templateCategory: "utility",
  approvalStatus: "approved",
  body: "Hi {{lead_name}}, reminder for your appointment at {{business_name}} on {{date}} at {{time}}.",
  variables: [
    { name: "lead_name", description: "first name" },
    { name: "business_name", description: "clinic" },
    { name: "date", description: "appointment date" },
    { name: "time", description: "appointment time" },
  ],
};

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    getSendContext: vi.fn().mockResolvedValue({
      consentGrantedAt: "2026-05-01T00:00:00.000Z",
      consentRevokedAt: null,
      pdpaJurisdiction: "SG",
      messagingOptIn: true,
      lastWhatsAppInboundAt: new Date("2026-05-12T12:00:00Z"),
      jurisdiction: "SG",
      leadName: "Mei",
      businessName: "Glow Clinic",
      phone: "+6591234567",
    }),
    allowMarketingTemplate: false,
    selectTemplateFn: () => APPROVED,
    ...over,
  };
}

describe("conversation.reminder.send handler", () => {
  beforeEach(() => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "tok";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "pn_1";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
  });

  it("skips unsupported channel", async () => {
    const wf = buildConversationReminderSendWorkflow(makeDeps());
    const res = await wf.execute(
      { ...baseWorkUnit, parameters: { ...baseWorkUnit.parameters, channel: "sms" } } as never,
      { submitChildWork: vi.fn() },
    );
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: false, skipReason: "unsupported_channel" });
  });

  it("skips when not eligible (e.g. draft template)", async () => {
    const wf = buildConversationReminderSendWorkflow(
      makeDeps({
        selectTemplateFn: () => ({ ...APPROVED, approvalStatus: "draft" }),
      }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: false, skipReason: "template_not_approved" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("missing phone → clean skip (single-attempt; not a retryable failure)", async () => {
    const wf = buildConversationReminderSendWorkflow(
      makeDeps({
        getSendContext: vi.fn().mockResolvedValue({
          consentGrantedAt: "2026-05-01T00:00:00.000Z",
          consentRevokedAt: null,
          pdpaJurisdiction: "SG",
          messagingOptIn: true,
          lastWhatsAppInboundAt: new Date("2026-05-12T12:00:00Z"),
          jurisdiction: "SG",
          leadName: "Mei",
          businessName: "Glow Clinic",
          phone: null,
        }),
      }),
    );
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: false, skipReason: "missing_contact_phone" });
  });

  it("eligible + WA configured → sends 4-var template with tz-rendered date/time", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.X" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationReminderSendWorkflow(makeDeps());
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: true, messageId: "wamid.X" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("graph.facebook.com");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.to).toBe("+6591234567");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("alex_appointment_reminder_sg_v1");
    // startsAt = "2026-05-13T02:00:00.000Z" in Asia/Singapore (UTC+8) = 10:00 AM, 13 May 2026
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "Mei" },
      { type: "text", text: "Glow Clinic" },
      { type: "text", text: "13 May 2026" },
      { type: "text", text: "10:00 AM" },
    ]);
  });

  it("real registry stays blocked when the context carries no approval overlay", async () => {
    // No selectTemplateFn: exercise the REAL registry (every template draft). Without an
    // org-resolvable overlay the send must stay blocked — proves the gate is not all-approved.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationReminderSendWorkflow(
      makeDeps({
        selectTemplateFn: undefined,
        getSendContext: vi.fn().mockResolvedValue({
          consentGrantedAt: "2026-05-01T00:00:00.000Z",
          consentRevokedAt: null,
          pdpaJurisdiction: "SG",
          messagingOptIn: true,
          lastWhatsAppInboundAt: new Date("2026-05-12T12:00:00Z"),
          jurisdiction: "SG",
          leadName: "Mei",
          businessName: "Glow Clinic",
          phone: "+6591234567",
          // approvalOverlay omitted
        }),
      }),
    );
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outputs).toEqual({ sent: false, skipReason: "template_not_approved" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("org-resolvable approval overlay on the context unblocks the real draft registry template", async () => {
    // No selectTemplateFn: the REAL SG appointment-reminder template is draft. The
    // approvalOverlay (sourced per-org by getSendContext) flips it to approved → sends.
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.OVL" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationReminderSendWorkflow(
      makeDeps({
        selectTemplateFn: undefined,
        getSendContext: vi.fn().mockResolvedValue({
          consentGrantedAt: "2026-05-01T00:00:00.000Z",
          consentRevokedAt: null,
          pdpaJurisdiction: "SG",
          messagingOptIn: true,
          lastWhatsAppInboundAt: new Date("2026-05-12T12:00:00Z"),
          jurisdiction: "SG",
          leadName: "Mei",
          businessName: "Glow Clinic",
          phone: "+6591234567",
          approvalOverlay: { alex_appointment_reminder_sg_v1: "approved" },
        }),
      }),
    );
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: true, messageId: "wamid.OVL" });
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body);
    expect(body.template.name).toBe("alex_appointment_reminder_sg_v1");
  });

  it("returns failed when the Graph API call errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: async () => "rate limited" }),
    );
    const wf = buildConversationReminderSendWorkflow(makeDeps());
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outcome).toBe("failed");
    expect(res.error!.code).toBe("WHATSAPP_TEMPLATE_SEND_FAILED");
  });
});
