import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildConversationReminderSendWorkflow } from "../conversation-reminder-send-workflow.js";
import type { WhatsAppTemplate } from "@switchboard/core";
import { setMetrics, createInMemoryMetrics } from "@switchboard/core";

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
    vi.restoreAllMocks();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
    // Restore the module-singleton metrics so a spy here does not leak across files.
    setMetrics(createInMemoryMetrics());
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

  it("resolves the send token under the legacy WHATSAPP_TOKEN name", async () => {
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    process.env["WHATSAPP_TOKEN"] = "legacy_tok";
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.X" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildConversationReminderSendWorkflow(makeDeps());
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: true, messageId: "wamid.X" });
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

    const wf = buildConversationReminderSendWorkflow(makeDeps());
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });

    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: false, skipReason: "unsupported_channel" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledWith({
      intent: "conversation.reminder.send",
      reason: "config_missing",
    });
  });

  it("benign per-contact skip (missing phone) does NOT touch the config-miss metric", async () => {
    const metrics = createInMemoryMetrics();
    const skipSpy = vi.spyOn(metrics.whatsappProactiveSendSkipped, "inc");
    setMetrics(metrics);
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
    expect(res.outputs).toEqual({ sent: false, skipReason: "missing_contact_phone" });
    expect(skipSpy).not.toHaveBeenCalled();
  });
});
