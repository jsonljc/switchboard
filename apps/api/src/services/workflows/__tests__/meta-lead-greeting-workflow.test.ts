import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryMetrics, setMetrics } from "@switchboard/core";
import { buildMetaLeadGreetingWorkflow } from "../meta-lead-greeting-workflow.js";
import type { GreetingSendContext } from "../meta-lead-greeting-workflow.js";

const GREETING_TEMPLATE_SG = "alex_first_touch_greeting_sg_v1";

const baseWorkUnit = {
  id: "wu_greet_1",
  organizationId: "org_1",
  actor: { id: "system", type: "system" as const },
  intent: "meta.lead.greeting.send",
  parameters: {
    contactId: "contact_1",
    // An SG number: the first-touch template jurisdiction falls back to the lead's
    // phone country code (+65 -> SG) when the contact has no stamped pdpaJurisdiction.
    phone: "+6591234567",
    firstName: "Taylor",
  },
  deployment: {
    deploymentId: "api-direct",
    skillSlug: "meta",
    trustLevel: "guided" as const,
    trustScore: 0,
  },
  resolvedMode: "workflow" as const,
  traceId: "trace_greet_1",
  trigger: "internal" as const,
  priority: "normal" as const,
  requestedAt: new Date().toISOString(),
};

const services = {
  submitChildWork: vi.fn(),
} as never;

// A brand-new Instant-Form lead: no stamped PDPA grant yet (pending/not_applicable), the
// ad-form messagingOptIn IS the source-aware opt-in basis, no inbound (so the 24h window is
// closed), and the org has approved its first-touch template. This is the operative happy path.
const eligibleInstantFormContext: GreetingSendContext = {
  consentGrantedAt: null,
  consentRevokedAt: null,
  pdpaJurisdiction: null,
  messagingOptIn: true,
  lastWhatsAppInboundAt: null,
  jurisdiction: null,
  businessName: "Glow Clinic",
  approvalOverlay: { [GREETING_TEMPLATE_SG]: "approved" },
};

describe("buildMetaLeadGreetingWorkflow — first-touch eligibility gate (D2)", () => {
  let fetchSpy: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<Response>>>;

  beforeEach(() => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "test-token";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "phone_1";
    fetchSpy = vi
      .fn<(...args: unknown[]) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
    setMetrics(createInMemoryMetrics());
  });

  it("HAPPY PATH: greets an Instant-Form lead on the ad-form opt-in + approved template", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(true);
    expect(getSendContext).toHaveBeenCalledWith("org_1", "contact_1");
    expect(fetchSpy).toHaveBeenCalledOnce();
    // Sends the registry's APPROVED first-touch template with sender identity (business name)
    // in the body, not a raw caller-supplied template name.
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body) as {
      template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> };
    };
    expect(body.template.name).toBe(GREETING_TEMPLATE_SG);
    expect(body.template.components[0]!.parameters.map((p) => p.text)).toEqual([
      "Taylor",
      "Glow Clinic",
    ]);
  });

  it("BLOCKS a draft/unapproved greeting template (template_not_approved), never sends", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({ ...eligibleInstantFormContext, approvalOverlay: {} }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("template_not_approved");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("BLOCKS when there is no source-aware opt-in basis (no opt-in, no inbound window) → no_optin", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      ...eligibleInstantFormContext,
      messagingOptIn: false,
      lastWhatsAppInboundAt: null,
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("no_optin");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("greets a genuine CTWA lead riding the free-entry-point window (inbound within 24h, no opt-in)", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      ...eligibleInstantFormContext,
      messagingOptIn: false,
      lastWhatsAppInboundAt: new Date(Date.now() - 60 * 60 * 1000),
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outputs?.["sent"]).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("relaxes consent_pending for a stamped-jurisdiction first-touch lead with an opt-in basis", async () => {
    // A first-touch lead WITH a stamped jurisdiction (pending: no grant yet) is greeted on the
    // opt-in basis via the firstTouch relaxation; revocation would still win (next test).
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      ...eligibleInstantFormContext,
      pdpaJurisdiction: "SG",
      jurisdiction: "SG",
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outputs?.["sent"]).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("NEVER lets an opt-in basis override a consent revocation (revocation precedence)", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      ...eligibleInstantFormContext,
      pdpaJurisdiction: "SG",
      jurisdiction: "SG",
      consentRevokedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("consent_revoked");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes a bare-digit SG phone so jurisdiction + send resolve (no activation dark-hole)", async () => {
    // The greeting receives the raw Meta IF phone field. A bare SG mobile (no +65) must still
    // pick the SG template and send to a normalized E.164 number, not block at no_template.
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(
      { ...baseWorkUnit, parameters: { ...baseWorkUnit.parameters, phone: "91234567" } },
      services,
    );

    expect(result.outputs?.["sent"]).toBe(true);
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body) as {
      to: string;
      template: { name: string };
    };
    expect(body.to).toBe("+6591234567");
    expect(body.template.name).toBe(GREETING_TEMPLATE_SG);
  });

  it("BLOCKS when no jurisdiction-matched template exists (foreign phone) → no_template", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    // A US phone: neither stamped jurisdiction nor a +65/+60 country code → no template.
    const result = await workflow.execute(
      { ...baseWorkUnit, parameters: { ...baseWorkUnit.parameters, phone: "+14155551234" } },
      services,
    );

    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("no_template");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips the send when the lead has no phone (before any send-context read)", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(
      { ...baseWorkUnit, parameters: { ...baseWorkUnit.parameters, phone: "" } },
      services,
    );

    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("missing_contact_phone");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getSendContext).not.toHaveBeenCalled();
  });

  it("propagates a WhatsApp send failure after an eligible decision", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("WHATSAPP_TEMPLATE_SEND_FAILED");
  });

  it("config-miss after an eligible decision: warns + increments whatsappProactiveSendSkipped{reason:config_missing}", async () => {
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
    const metrics = createInMemoryMetrics();
    const skipSpy = vi.spyOn(metrics.whatsappProactiveSendSkipped, "inc");
    setMetrics(metrics);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("unsupported_channel");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledWith({
      intent: "meta.lead.greeting.send",
      reason: "config_missing",
    });
  });
});

// Multi-tenant per-org send-credential resolution. Its OWN describe so it never
// collides with a sibling change inserting cases into the block above.
describe("buildMetaLeadGreetingWorkflow - per-org send creds (multi-tenant)", () => {
  let fetchSpy: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<Response>>>;

  beforeEach(() => {
    process.env["WHATSAPP_ACCESS_TOKEN"] = "ENV_TOK";
    process.env["WHATSAPP_PHONE_NUMBER_ID"] = "ENV_PN";
    fetchSpy = vi
      .fn<(...args: unknown[]) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchSpy);
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
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const resolveOrgSendCreds = vi.fn().mockResolvedValue({ token: "T2", phoneNumberId: "P2" });
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext, resolveOrgSendCreds });
    const result = await workflow.execute(baseWorkUnit, services);
    expect(result.outputs?.["sent"]).toBe(true);
    expect(resolveOrgSendCreds).toHaveBeenCalledWith("org_1");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/P2/messages");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer T2");
  });

  it("falls back to the global env phone id + token when the org resolver returns null", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const resolveOrgSendCreds = vi.fn().mockResolvedValue(null);
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext, resolveOrgSendCreds });
    const result = await workflow.execute(baseWorkUnit, services);
    expect(result.outputs?.["sent"]).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/ENV_PN/messages");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer ENV_TOK",
    );
  });

  it("applies PER-FIELD fallback: org token + env phone id when the org omits phoneNumberId", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const resolveOrgSendCreds = vi.fn().mockResolvedValue({ token: "T2", phoneNumberId: null });
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext, resolveOrgSendCreds });
    await workflow.execute(baseWorkUnit, services);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/ENV_PN/messages");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer T2");
  });

  it("HEADLINE: two different orgs resolve two different phone numbers end-to-end", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => eligibleInstantFormContext);
    const resolveOrgSendCreds = vi.fn(async (orgId: string) =>
      orgId === "orgA"
        ? { token: "T_A", phoneNumberId: "P_A" }
        : { token: "T_B", phoneNumberId: "P_B" },
    );
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext, resolveOrgSendCreds });
    await workflow.execute({ ...baseWorkUnit, organizationId: "orgA" }, services);
    await workflow.execute({ ...baseWorkUnit, organizationId: "orgB" }, services);
    const [urlA, initA] = fetchSpy.mock.calls[0]!;
    const [urlB, initB] = fetchSpy.mock.calls[1]!;
    expect(urlA).toBe("https://graph.facebook.com/v21.0/P_A/messages");
    expect(urlB).toBe("https://graph.facebook.com/v21.0/P_B/messages");
    expect((initA as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer T_A");
    expect((initB as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer T_B");
  });
});
