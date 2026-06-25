import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { buildRobinRecoverySendRetryExecutor } from "../robin-recovery-executor.js";
import { ROBIN_RECOVERY_RETRY_INTENT } from "../../services/workflows/robin-recovery-request.js";
import type { WhatsAppTemplate } from "@switchboard/core";
import { setMetrics, createInMemoryMetrics, getMetrics } from "@switchboard/core";

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
    markSendInFlight: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    markSkipped: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    findDue: vi.fn().mockResolvedValue([]),
  };
}

describe("buildRobinRecoverySendRetryExecutor", () => {
  beforeEach(() => {
    setMetrics(createInMemoryMetrics());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setMetrics(createInMemoryMetrics());
  });

  function makeRetryWorkUnit(over: Record<string, unknown> = {}) {
    return {
      id: "wu_retry",
      organizationId: "org_1",
      actor: { id: "system", type: "system" as const },
      intent: ROBIN_RECOVERY_RETRY_INTENT,
      parameters: {
        rowId: "rs_1",
        contactId: "c_1",
        bookingId: "bk_1",
        campaignKind: "no_show",
        attempts: 1,
        ...over,
      },
      resolvedMode: "workflow" as const,
      traceId: "t1",
      trigger: "schedule" as const,
      priority: "normal" as const,
    };
  }

  function makeRetryDeps(over: Record<string, unknown> = {}) {
    return {
      store: makeStore(),
      getSendContext: vi.fn().mockResolvedValue(eligibleCtx()),
      sendTemplate: vi.fn().mockResolvedValue({ ok: true, messageId: "wamid.r1" }),
      selectTemplateFn: () => APPROVED,
      resolveSendToken: () => "tok",
      resolvePhoneNumberId: () => "pn_1",
      findFutureBookingContactIds: vi.fn().mockResolvedValue(new Set<string>()),
      now: () => new Date("2026-06-21T12:00:00.000Z"),
      random: () => 0.5,
      ...over,
    };
  }

  it("registers under the retry intent", () => {
    expect(buildRobinRecoverySendRetryExecutor(makeRetryDeps() as never).intent).toBe(
      ROBIN_RECOVERY_RETRY_INTENT,
    );
  });

  it("single-row reclaim: NEVER calls store.create on the success path", async () => {
    const deps = makeRetryDeps();
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    await handler.execute(makeRetryWorkUnit() as never, {} as never);
    expect(deps.store.create).not.toHaveBeenCalled();
  });

  it("success: eligible + send ok -> markSent, outputs {outcome:sent, deadLettered:false}", async () => {
    const deps = makeRetryDeps();
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit() as never, {} as never);
    expect(deps.store.markSent).toHaveBeenCalledWith("rs_1", "wamid.r1");
    expect(deps.store.create).not.toHaveBeenCalled();
    expect(res.outcome).toBe("completed");
    expect(res.outputs).toEqual({ outcome: "sent", deadLettered: false });
  });

  it("retry-below-cap: attempts=1 + send !ok -> markFailed non-null, deadLettered:false, NO metric", async () => {
    const deps = makeRetryDeps({
      sendTemplate: vi.fn().mockResolvedValue({ ok: false, error: "rate limited" }),
    });
    const incSpy = vi.spyOn(getMetrics().robinRecoverySendFailed, "inc");
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit({ attempts: 1 }) as never, {} as never);
    const call = deps.store.markFailed.mock.calls[0]!;
    expect(call[0]).toBe("rs_1");
    expect(call[2]).toBeInstanceOf(Date);
    expect(call[2]).not.toBeNull();
    expect(res.outputs).toEqual({ outcome: "failed", deadLettered: false });
    expect(incSpy).not.toHaveBeenCalled();
    expect(deps.store.create).not.toHaveBeenCalled();
  });

  it("terminal-at-cap: attempts=2 + send !ok -> markFailed null, robinRecoverySendFailed inc'd, deadLettered:true", async () => {
    const deps = makeRetryDeps({
      sendTemplate: vi.fn().mockResolvedValue({ ok: false, error: "still down" }),
    });
    const incSpy = vi.spyOn(getMetrics().robinRecoverySendFailed, "inc");
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit({ attempts: 2 }) as never, {} as never);
    const call = deps.store.markFailed.mock.calls[0]!;
    expect(call[0]).toBe("rs_1");
    expect(call[2]).toBeNull();
    expect(incSpy).toHaveBeenCalledWith({
      intent: ROBIN_RECOVERY_RETRY_INTENT,
      reason: "max_retries_exhausted",
    });
    expect(res.outputs).toEqual({ outcome: "failed", deadLettered: true });
  });

  it("consent re-validation: getSendContext returns consentRevokedAt -> markSkipped(consent_revoked), NO send", async () => {
    const deps = makeRetryDeps({
      getSendContext: vi
        .fn()
        .mockResolvedValue(eligibleCtx({ consentRevokedAt: "2026-06-20T00:00:00.000Z" })),
    });
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit() as never, {} as never);
    expect(deps.store.markSkipped).toHaveBeenCalledWith("rs_1", "consent_revoked");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(res.outputs).toEqual({ outcome: "skipped", deadLettered: false });
  });

  it("template re-validation: overlay leaves the template unapproved -> markSkipped(template_not_approved), NO send", async () => {
    // Real registry (re-engagement template ships draft) + no approval overlay -> org-config skip.
    const deps = makeRetryDeps({
      selectTemplateFn: undefined,
      getSendContext: vi.fn().mockResolvedValue(eligibleCtx()),
    });
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit() as never, {} as never);
    expect(deps.store.markSkipped).toHaveBeenCalledWith("rs_1", "template_not_approved");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(res.outputs).toEqual({ outcome: "skipped", deadLettered: false });
  });

  it("rebooked re-check: findFutureBookingContactIds returns the contact -> markSkipped(already_rebooked), NO send", async () => {
    const findFutureBookingContactIds = vi.fn().mockResolvedValue(new Set(["c_1"]));
    const deps = makeRetryDeps({ findFutureBookingContactIds });
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit() as never, {} as never);
    expect(findFutureBookingContactIds).toHaveBeenCalledWith("org_1", ["c_1"], expect.any(Date));
    expect(deps.store.markSkipped).toHaveBeenCalledWith("rs_1", "already_rebooked");
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(res.outputs).toEqual({ outcome: "skipped", deadLettered: false });
  });

  it("config_missing (no creds): markFailed transient (below cap), NO send", async () => {
    const deps = makeRetryDeps({
      resolveSendToken: () => undefined,
      resolvePhoneNumberId: () => undefined,
    });
    const incSpy = vi.spyOn(getMetrics().robinRecoverySendFailed, "inc");
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit({ attempts: 1 }) as never, {} as never);
    const call = deps.store.markFailed.mock.calls[0]!;
    expect(call[0]).toBe("rs_1");
    expect(call[1]).toBe("config_missing");
    expect(call[2]).toBeInstanceOf(Date);
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(incSpy).not.toHaveBeenCalled(); // below cap -> metric-if-terminal NOT fired
    expect(res.outputs).toEqual({ outcome: "failed", deadLettered: false });
  });

  it("config_missing at cap (attempts=2): markFailed null + robinRecoverySendFailed(config_missing)", async () => {
    const deps = makeRetryDeps({
      resolveSendToken: () => undefined,
      resolvePhoneNumberId: () => undefined,
    });
    const incSpy = vi.spyOn(getMetrics().robinRecoverySendFailed, "inc");
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit({ attempts: 2 }) as never, {} as never);
    expect(deps.store.markFailed.mock.calls[0]![2]).toBeNull();
    expect(incSpy).toHaveBeenCalledWith({
      intent: ROBIN_RECOVERY_RETRY_INTENT,
      reason: "config_missing",
    });
    expect(res.outputs).toEqual({ outcome: "failed", deadLettered: true });
  });

  it("fail-closed: org phone missing -> markFailed(org_phone_missing) transient, NO send (never the global number)", async () => {
    // Retry path mirror of the cohort fail-closed: a per-org connection without a phone id must not
    // re-send from the global number; it re-queues as a transient org-config gap.
    const resolveOrgSendCreds = vi.fn().mockResolvedValue({ token: "T2", phoneNumberId: null });
    const deps = makeRetryDeps({
      resolveOrgSendCreds,
      resolveSendToken: () => "GLOBAL_TOK",
      resolvePhoneNumberId: () => "GLOBAL_PN",
    });
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit({ attempts: 1 }) as never, {} as never);
    const call = deps.store.markFailed.mock.calls[0]!;
    expect(call[1]).toBe("org_phone_missing");
    expect(call[2]).toBeInstanceOf(Date);
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(res.outputs).toEqual({ outcome: "failed", deadLettered: false });
  });

  it("context resolve throw: markFailed(context_resolve_failed) transient, NO send", async () => {
    const deps = makeRetryDeps({
      getSendContext: vi.fn().mockRejectedValue(new Error("db blip")),
    });
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(makeRetryWorkUnit({ attempts: 1 }) as never, {} as never);
    const call = deps.store.markFailed.mock.calls[0]!;
    expect(call[0]).toBe("rs_1");
    expect(call[1]).toBe("context_resolve_failed");
    expect(call[2]).toBeInstanceOf(Date);
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(res.outputs).toEqual({ outcome: "failed", deadLettered: false });
  });

  it("malformed params: {} -> outcome failed, store untouched", async () => {
    const deps = makeRetryDeps();
    const { handler } = buildRobinRecoverySendRetryExecutor(deps as never);
    const res = await handler.execute(
      { id: "wu", organizationId: "org_1", parameters: {} } as never,
      {} as never,
    );
    expect(res.outcome).toBe("failed");
    expect(deps.store.create).not.toHaveBeenCalled();
    expect(deps.store.markSent).not.toHaveBeenCalled();
    expect(deps.store.markSkipped).not.toHaveBeenCalled();
    expect(deps.store.markFailed).not.toHaveBeenCalled();
    expect(deps.sendTemplate).not.toHaveBeenCalled();
  });
});
