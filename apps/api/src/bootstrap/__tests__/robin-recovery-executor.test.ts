import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRobinRecoverySendExecutor } from "../robin-recovery-executor.js";
import { ROBIN_RECOVERY_SEND_INTENT } from "../../services/workflows/robin-recovery-request.js";
import type { WhatsAppTemplate } from "@switchboard/core";
import { setMetrics, createInMemoryMetrics } from "@switchboard/core";

const APPROVED: WhatsAppTemplate = {
  name: "re_engagement_offer_sg_v1",
  metaTemplateName: "alex_re_engagement_offer_sg_v1",
  intentClass: "re-engagement-offer",
  jurisdiction: "SG",
  templateCategory: "marketing",
  approvalStatus: "approved",
  body: "Hi {{lead_name}}, it has been a while ... {{business_name}}.",
  variables: [
    { name: "lead_name", description: "first name" },
    { name: "business_name", description: "clinic" },
  ],
};

function eligibleCtx(over: Record<string, unknown> = {}) {
  return {
    consentGrantedAt: "2026-05-01T00:00:00.000Z",
    consentRevokedAt: null,
    pdpaJurisdiction: "SG",
    messagingOptIn: true,
    lastWhatsAppInboundAt: new Date("2026-06-04T12:00:00Z"),
    jurisdiction: "SG",
    leadName: "Mei",
    businessName: "Glow Clinic",
    phone: "+6591234567",
    ...over,
  };
}

function makeStore() {
  return {
    create: vi.fn().mockResolvedValue({ id: "rs_1" }),
    markSent: vi.fn().mockResolvedValue(undefined),
    markSkipped: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}

function makeWorkUnit(candidates: Array<Record<string, unknown>>) {
  return {
    id: "wu_camp",
    organizationId: "org_1",
    actor: { id: "system", type: "system" as const },
    intent: ROBIN_RECOVERY_SEND_INTENT,
    parameters: {
      windowFrom: "2026-06-01T00:00:00.000Z",
      windowTo: "2026-06-15T00:00:00.000Z",
      candidates,
      recipientCount: candidates.length,
    },
    resolvedMode: "workflow" as const,
    traceId: "t1",
    trigger: "schedule" as const,
    priority: "normal" as const,
  };
}

const C1 = {
  bookingId: "bk_1",
  contactId: "c_1",
  service: "Botox",
  startsAt: "2026-06-03T09:00:00.000Z",
  attendeeName: "Mei",
};
const C2 = { ...C1, bookingId: "bk_2", contactId: "c_2", attendeeName: "Sam" };
const C3 = { ...C1, bookingId: "bk_3", contactId: "c_3", attendeeName: "Lee" };

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    store: makeStore(),
    getSendContext: vi.fn().mockResolvedValue(eligibleCtx()),
    sendTemplate: vi.fn().mockResolvedValue({ ok: true, messageId: "wamid.1" }),
    selectTemplateFn: () => APPROVED,
    resolveSendToken: () => "tok",
    resolvePhoneNumberId: () => "pn_1",
    ...over,
  };
}

describe("buildRobinRecoverySendExecutor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setMetrics(createInMemoryMetrics());
  });

  it("registers under the recovery intent", () => {
    expect(buildRobinRecoverySendExecutor(makeDeps() as never).intent).toBe(
      ROBIN_RECOVERY_SEND_INTENT,
    );
  });

  it("malformed cohort -> failed, no claim, no send", async () => {
    const deps = makeDeps();
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(
      { id: "wu", organizationId: "org_1", parameters: { candidates: [] } } as never,
      {} as never,
    );
    expect(res.outcome).toBe("failed");
    expect(res.error?.code).toBe("ROBIN_RECOVERY_INVALID_COHORT");
    expect(deps.store.create).not.toHaveBeenCalled();
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });

  it("missing WhatsApp creds -> completed, all skipped config_missing, NO claim, NO send, warns + metric", async () => {
    const metrics = createInMemoryMetrics();
    const skipSpy = vi.spyOn(metrics.whatsappProactiveSendSkipped, "inc");
    setMetrics(metrics);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps({ resolveSendToken: () => undefined });
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(makeWorkUnit([C1, C2]) as never, {} as never);
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({
      sent: 0,
      skipped: 2,
      failed: 0,
      total: 2,
      skipReason: "config_missing",
    });
    expect(deps.store.create).not.toHaveBeenCalled();
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(skipSpy).toHaveBeenCalledWith({
      intent: ROBIN_RECOVERY_SEND_INTENT,
      reason: "config_missing",
    });
  });

  it("happy path: claims + sends the 2-var re-engagement template per recipient", async () => {
    const deps = makeDeps();
    deps.store.create.mockResolvedValueOnce({ id: "rs_1" }).mockResolvedValueOnce({ id: "rs_2" });
    deps.getSendContext
      .mockResolvedValueOnce(eligibleCtx({ leadName: "Mei", phone: "+6591111111" }))
      .mockResolvedValueOnce(eligibleCtx({ leadName: "Sam", phone: "+6592222222" }));
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(makeWorkUnit([C1, C2]) as never, {} as never);
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: 2, skipped: 0, failed: 0, total: 2 });
    // org-scoped per-recipient context resolution
    expect(deps.getSendContext).toHaveBeenNthCalledWith(1, "org_1", "c_1");
    expect(deps.getSendContext).toHaveBeenNthCalledWith(2, "org_1", "c_2");
    // claim-first per recipient, deterministic dedupe key
    expect(deps.store.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: "org_1",
        bookingId: "bk_1",
        contactId: "c_1",
        campaignKind: "no_show",
        campaignWorkUnitId: "wu_camp",
        dedupeKey: "recovery:no_show:org_1:bk_1",
      }),
    );
    // 2-var template send (NOT 4) with the re-engagement metaTemplateName
    expect(deps.sendTemplate).toHaveBeenNthCalledWith(1, {
      accessToken: "tok",
      phoneNumberId: "pn_1",
      to: "+6591111111",
      metaTemplateName: "alex_re_engagement_offer_sg_v1",
      leadName: "Mei",
      businessName: "Glow Clinic",
    });
    expect(deps.store.markSent).toHaveBeenCalledWith("rs_1", "wamid.1");
  });

  it("consent ineligible (draft template) -> claim + markSkipped(reason), no send", async () => {
    const deps = makeDeps({ selectTemplateFn: () => ({ ...APPROVED, approvalStatus: "draft" }) });
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(deps.store.create).toHaveBeenCalledTimes(1);
    expect(deps.store.markSkipped).toHaveBeenCalledWith("rs_1", "template_not_approved");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(res.outputs).toEqual({ sent: 0, skipped: 1, failed: 0, total: 1 });
  });

  it("consent revoked -> claim + markSkipped(consent_revoked), no send", async () => {
    const deps = makeDeps({
      getSendContext: vi
        .fn()
        .mockResolvedValue(eligibleCtx({ consentRevokedAt: "2026-06-01T00:00:00.000Z" })),
    });
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(deps.store.markSkipped).toHaveBeenCalledWith("rs_1", "consent_revoked");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });

  it("missing phone -> claim + markSkipped(missing_contact_phone), no send", async () => {
    const deps = makeDeps({
      getSendContext: vi.fn().mockResolvedValue(eligibleCtx({ phone: null })),
    });
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(deps.store.markSkipped).toHaveBeenCalledWith("rs_1", "missing_contact_phone");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });

  it("dedup hit (P2002 on claim) -> skip, no context read, no send (no double-send)", async () => {
    const deps = makeDeps();
    deps.store.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(deps.getSendContext).not.toHaveBeenCalled();
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(res.outputs).toEqual({ sent: 0, skipped: 1, failed: 0, total: 1 });
  });

  it("non-P2002 store error rethrows (fail loud)", async () => {
    const deps = makeDeps();
    deps.store.create.mockRejectedValueOnce(new Error("db down"));
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    await expect(handler.execute(makeWorkUnit([C1]) as never, {} as never)).rejects.toThrow(
      "db down",
    );
  });

  it("Graph send failure -> markFailed, counted failed, campaign still completed", async () => {
    const deps = makeDeps({
      sendTemplate: vi.fn().mockResolvedValue({ ok: false, error: "rate limited" }),
    });
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(deps.store.markFailed).toHaveBeenCalledWith("rs_1", "rate limited");
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: 0, skipped: 0, failed: 1, total: 1 });
  });

  it("idempotent under retried dispatch: a second run claims P2002 for all -> 0 sends", async () => {
    const deps = makeDeps();
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    await handler.execute(makeWorkUnit([C1]) as never, {} as never); // first run sends
    deps.store.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    deps.sendTemplate.mockClear();
    const res2 = await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(res2.outputs).toEqual({ sent: 0, skipped: 1, failed: 0, total: 1 });
  });

  it("isolates a mid-batch transient error (getSendContext throws): that recipient -> failed, others still send, batch completes", async () => {
    const deps = makeDeps();
    deps.store.create
      .mockResolvedValueOnce({ id: "rs_1" })
      .mockResolvedValueOnce({ id: "rs_2" })
      .mockResolvedValueOnce({ id: "rs_3" });
    deps.getSendContext
      .mockResolvedValueOnce(eligibleCtx({ phone: "+6591111111" }))
      .mockRejectedValueOnce(new Error("db blip"))
      .mockResolvedValueOnce(eligibleCtx({ phone: "+6593333333" }));
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(makeWorkUnit([C1, C2, C3]) as never, {} as never);
    // The whole batch must NOT throw; the one error is isolated to its recipient.
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: 2, skipped: 0, failed: 1, total: 3 });
    // The claimed row for the failed recipient is marked failed (never left orphaned pending).
    expect(deps.store.markFailed).toHaveBeenCalledWith("rs_2", "db blip");
    // Recipients 1 and 3 still sent.
    expect(deps.sendTemplate).toHaveBeenCalledTimes(2);
    expect(deps.store.markSent).toHaveBeenCalledWith("rs_1", "wamid.1");
    expect(deps.store.markSent).toHaveBeenCalledWith("rs_3", "wamid.1");
  });

  it("isolates a sendTemplate network rejection (not just !ok) -> markFailed, no batch throw", async () => {
    const deps = makeDeps({ sendTemplate: vi.fn().mockRejectedValue(new Error("ECONNRESET")) });
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ sent: 0, skipped: 0, failed: 1, total: 1 });
    expect(deps.store.markFailed).toHaveBeenCalledWith("rs_1", "ECONNRESET");
  });

  it("real registry stays blocked without an approval overlay (fail-closed default)", async () => {
    // No selectTemplateFn: exercise the REAL registry (re-engagement template ships draft).
    const deps = makeDeps({
      selectTemplateFn: undefined,
      getSendContext: vi.fn().mockResolvedValue(eligibleCtx()),
    });
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(deps.store.markSkipped).toHaveBeenCalledWith("rs_1", "template_not_approved");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });

  it("real registry + org approval overlay unblocks the marketing re-engagement template", async () => {
    // Proves the producer is populated: the marketing template is NOT blocked (recovery sets
    // allowMarketingTemplate true) and the org overlay flips the draft default to approved -> sends.
    const deps = makeDeps({
      selectTemplateFn: undefined,
      getSendContext: vi
        .fn()
        .mockResolvedValue(
          eligibleCtx({ approvalOverlay: { alex_re_engagement_offer_sg_v1: "approved" } }),
        ),
    });
    const { handler } = buildRobinRecoverySendExecutor(deps as never);
    const res = await handler.execute(makeWorkUnit([C1]) as never, {} as never);
    expect(res.outputs).toEqual({ sent: 1, skipped: 0, failed: 0, total: 1 });
    expect(deps.sendTemplate).toHaveBeenCalledTimes(1);
    expect(deps.sendTemplate.mock.calls[0]![0].metaTemplateName).toBe(
      "alex_re_engagement_offer_sg_v1",
    );
  });

  // Multi-tenant per-org send-credential resolution.
  describe("per-org send creds (multi-tenant)", () => {
    it("sends from the campaign ORG's phone id + token, not the global token/env phone id", async () => {
      const resolveOrgSendCreds = vi.fn().mockResolvedValue({ token: "T2", phoneNumberId: "P2" });
      // Global resolvers return values that MUST NOT be used when the org resolves.
      const deps = makeDeps({
        resolveOrgSendCreds,
        resolveSendToken: () => "GLOBAL_TOK",
        resolvePhoneNumberId: () => "GLOBAL_PN",
      });
      const { handler } = buildRobinRecoverySendExecutor(deps as never);
      const res = await handler.execute(makeWorkUnit([C1]) as never, {} as never);
      expect(res.outputs).toEqual({ sent: 1, skipped: 0, failed: 0, total: 1 });
      expect(resolveOrgSendCreds).toHaveBeenCalledWith("org_1");
      expect(deps.sendTemplate.mock.calls[0]![0]).toMatchObject({
        accessToken: "T2",
        phoneNumberId: "P2",
      });
    });

    it("falls back to the global token + env/phone resolvers when the org resolver returns null", async () => {
      const resolveOrgSendCreds = vi.fn().mockResolvedValue(null);
      const deps = makeDeps({
        resolveOrgSendCreds,
        resolveSendToken: () => "GLOBAL_TOK",
        resolvePhoneNumberId: () => "GLOBAL_PN",
      });
      const { handler } = buildRobinRecoverySendExecutor(deps as never);
      const res = await handler.execute(makeWorkUnit([C1]) as never, {} as never);
      expect(res.outputs).toEqual({ sent: 1, skipped: 0, failed: 0, total: 1 });
      expect(deps.sendTemplate.mock.calls[0]![0]).toMatchObject({
        accessToken: "GLOBAL_TOK",
        phoneNumberId: "GLOBAL_PN",
      });
    });

    it("applies PER-FIELD fallback: org phone id + global token when the org omits token", async () => {
      const resolveOrgSendCreds = vi.fn().mockResolvedValue({ token: null, phoneNumberId: "P2" });
      const deps = makeDeps({
        resolveOrgSendCreds,
        resolveSendToken: () => "GLOBAL_TOK",
        resolvePhoneNumberId: () => "GLOBAL_PN",
      });
      const { handler } = buildRobinRecoverySendExecutor(deps as never);
      await handler.execute(makeWorkUnit([C1]) as never, {} as never);
      expect(deps.sendTemplate.mock.calls[0]![0]).toMatchObject({
        accessToken: "GLOBAL_TOK",
        phoneNumberId: "P2",
      });
    });

    it("HEADLINE: two different campaign orgs send from two different phone numbers", async () => {
      const resolveOrgSendCreds = vi.fn(async (orgId: string) =>
        orgId === "orgA"
          ? { token: "T_A", phoneNumberId: "P_A" }
          : { token: "T_B", phoneNumberId: "P_B" },
      );
      const deps = makeDeps({ resolveOrgSendCreds });
      const { handler } = buildRobinRecoverySendExecutor(deps as never);
      await handler.execute(
        { ...makeWorkUnit([C1]), organizationId: "orgA" } as never,
        {} as never,
      );
      await handler.execute(
        { ...makeWorkUnit([C1]), organizationId: "orgB" } as never,
        {} as never,
      );
      expect(deps.sendTemplate.mock.calls[0]![0]).toMatchObject({
        accessToken: "T_A",
        phoneNumberId: "P_A",
      });
      expect(deps.sendTemplate.mock.calls[1]![0]).toMatchObject({
        accessToken: "T_B",
        phoneNumberId: "P_B",
      });
    });
  });
});
