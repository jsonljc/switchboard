import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildMetaLeadGreetingWorkflow } from "../meta-lead-greeting-workflow.js";
import { setMetrics, createInMemoryMetrics } from "@switchboard/core";

const baseWorkUnit = {
  id: "wu_1",
  organizationId: "org_1",
  actor: { id: "system", type: "system" as const },
  intent: "meta.lead.greeting.send",
  parameters: {
    phone: "+6591234567",
    firstName: "Mei",
    templateName: "alex_lead_greeting_sg_v1",
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

describe("meta.lead.greeting.send handler", () => {
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
    setMetrics(createInMemoryMetrics());
  });

  it("sends the greeting template and returns completed", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.X" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildMetaLeadGreetingWorkflow();
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outcome).toBe("completed");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("graph.facebook.com");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.to).toBe("+6591234567");
    expect(body.template.name).toBe("alex_lead_greeting_sg_v1");
  });

  it("resolves the send token under the legacy WHATSAPP_TOKEN name", async () => {
    delete process.env["WHATSAPP_ACCESS_TOKEN"];
    process.env["WHATSAPP_TOKEN"] = "legacy_tok";
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.X" }] }) });
    vi.stubGlobal("fetch", fetchSpy);
    const wf = buildMetaLeadGreetingWorkflow();
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });
    expect(res.outcome).toBe("completed");
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

    const wf = buildMetaLeadGreetingWorkflow();
    const res = await wf.execute(baseWorkUnit as never, { submitChildWork: vi.fn() });

    expect(res.outcome).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledWith({
      intent: "meta.lead.greeting.send",
      reason: "config_missing",
    });
  });
});
