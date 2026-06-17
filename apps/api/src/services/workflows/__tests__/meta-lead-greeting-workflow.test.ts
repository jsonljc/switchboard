import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    delete process.env["WHATSAPP_PHONE_NUMBER_ID"];
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
});
