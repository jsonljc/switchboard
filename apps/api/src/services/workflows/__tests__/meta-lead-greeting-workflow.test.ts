import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryMetrics, setMetrics } from "@switchboard/core";
import { buildMetaLeadGreetingWorkflow } from "../meta-lead-greeting-workflow.js";
import type { GreetingSendContext } from "../meta-lead-greeting-workflow.js";

const baseWorkUnit = {
  id: "wu_greet_1",
  organizationId: "org_1",
  actor: { id: "system", type: "system" as const },
  intent: "meta.lead.greeting.send",
  parameters: {
    contactId: "contact_1",
    phone: "+15550001",
    firstName: "Taylor",
    templateName: "lead_welcome",
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

// A consent context with PDPA jurisdiction, no grant and no inbound — the
// proactive consent gate would BLOCK (consent_pending) unless the CTWA ad-click
// opt-in basis is asserted.
const pendingContext: GreetingSendContext = {
  consentGrantedAt: null,
  consentRevokedAt: null,
  pdpaJurisdiction: "SG",
  ctwaOptIn: false,
};

describe("buildMetaLeadGreetingWorkflow", () => {
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
    // Restore the module-singleton metrics so a spy here does not leak across files.
    setMetrics(createInMemoryMetrics());
  });

  it("does NOT greet a consent-ineligible lead and records the blocked decision", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => pendingContext);
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("consent_pending");
    // Fail-closed: no WhatsApp template was sent.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getSendContext).toHaveBeenCalledWith("org_1", "contact_1");
  });

  it("greets on the CTWA first-touch ad-click opt-in and records a ctwa_optin decision", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      ...pendingContext,
      ctwaOptIn: true,
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(true);
    // The first-touch basis is recorded, not a silent unconditional send.
    expect(result.outputs?.["consentDecision"]).toBe("ctwa_optin");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("NEVER lets a CTWA opt-in override a consent revocation (revocation precedence)", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      consentGrantedAt: null,
      consentRevokedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
      pdpaJurisdiction: "SG",
      ctwaOptIn: true,
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("consent_revoked");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("greets a non-PDPA lead (not_applicable) and records the decision", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      consentGrantedAt: null,
      consentRevokedAt: null,
      pdpaJurisdiction: null,
      ctwaOptIn: false,
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(true);
    expect(result.outputs?.["consentDecision"]).toBe("not_applicable");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("skips the send when the lead has no phone, recording the decision", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      ...pendingContext,
      ctwaOptIn: true,
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(
      { ...baseWorkUnit, parameters: { ...baseWorkUnit.parameters, phone: "" } },
      services,
    );

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("missing_contact_phone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates a WhatsApp send failure after an allow decision", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      ...pendingContext,
      ctwaOptIn: true,
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("WHATSAPP_TEMPLATE_SEND_FAILED");
  });

  it("config-miss after an allow decision: warns + increments whatsappProactiveSendSkipped{reason:config_missing}", async () => {
    // The consent decision allows (CTWA opt-in), so we reach the send config check.
    // With no send token/phone id the greeting silently no-ops org-wide: that infra
    // gap must be loud (warn) + countable on the dark-funnel metric, not a silent skip.
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
    const metrics = createInMemoryMetrics();
    const skipSpy = vi.spyOn(metrics.whatsappProactiveSendSkipped, "inc");
    setMetrics(metrics);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ({
      ...pendingContext,
      ctwaOptIn: true,
    }));
    const workflow = buildMetaLeadGreetingWorkflow({ getSendContext });

    const result = await workflow.execute(baseWorkUnit, services);

    expect(result.outcome).toBe("completed");
    expect(result.outputs?.["sent"]).toBe(false);
    expect(result.outputs?.["skipReason"]).toBe("unsupported_channel");
    // The allow decision still rode in and is recorded alongside the infra skip.
    expect(result.outputs?.["consentDecision"]).toBe("ctwa_optin");
    // Fail-closed: no WhatsApp template was sent.
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

  const ctwaCtx: GreetingSendContext = { ...pendingContext, ctwaOptIn: true };

  it("sends from the resolved ORG's phone id + token, not the global env values", async () => {
    const getSendContext = vi.fn<
      (orgId: string, contactId: string) => Promise<GreetingSendContext>
    >(async () => ctwaCtx);
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
    >(async () => ctwaCtx);
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
    >(async () => ctwaCtx);
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
    >(async () => ctwaCtx);
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
