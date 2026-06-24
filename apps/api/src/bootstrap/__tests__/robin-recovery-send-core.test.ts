import { describe, it, expect, vi } from "vitest";
import type { RobinRecoverySendStore, ProactiveSendEligibility } from "@switchboard/core";
import {
  computeRecoveryNextRetry,
  dispatchRecoveryRow,
  isOrgConfigSkip,
  resolveEffectiveSendCreds,
  type RecoverySendContext,
  type RecoveryTemplateSendResult,
} from "../robin-recovery-send-core.js";

const BASE_MS = 15 * 60 * 1000; // ROBIN_RECOVERY_RETRY_BASE_MS

const NOW = new Date("2026-06-21T12:00:00.000Z");

function baseCtx(over: Partial<RecoverySendContext> = {}): RecoverySendContext {
  return {
    consentGrantedAt: null,
    consentRevokedAt: null,
    pdpaJurisdiction: null,
    messagingOptIn: true,
    lastWhatsAppInboundAt: null,
    jurisdiction: "SG",
    leadName: "Ada",
    businessName: "Glow Clinic",
    phone: "+6591234567",
    ...over,
  };
}

const eligibleTemplate: ProactiveSendEligibility = {
  eligible: true,
  template: {
    intentClass: "re-engagement-offer",
    jurisdiction: "SG",
    metaTemplateName: "alex_reengage_sg_v1",
    approvalStatus: "approved",
    templateCategory: "marketing",
    bodyText: "Hi {{1}}, come back to {{2}}",
  } as ProactiveSendEligibility extends { eligible: true; template: infer T } ? T : never,
};

function makeStore(): RobinRecoverySendStore & {
  create: ReturnType<typeof vi.fn>;
  markSent: ReturnType<typeof vi.fn>;
  markSkipped: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  findDue: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    markSent: vi.fn().mockResolvedValue(undefined),
    markSkipped: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    findDue: vi.fn(),
  };
}

describe("computeRecoveryNextRetry", () => {
  it("attempts=0 with random()=>0.5 returns now + 7.5min (full jitter of BASE)", () => {
    const next = computeRecoveryNextRetry(0, NOW, () => 0.5);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(NOW.getTime() + BASE_MS / 2);
  });

  it("attempts=0 with random()=>0 returns now (immediate, floor of 0)", () => {
    const next = computeRecoveryNextRetry(0, NOW, () => 0);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBe(NOW.getTime());
  });

  it("attempts=1 with random()=>0.999 lands within now + 30min (capped-exponential window)", () => {
    const next = computeRecoveryNextRetry(1, NOW, () => 0.999);
    expect(next).not.toBeNull();
    const delta = next!.getTime() - NOW.getTime();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(2 * BASE_MS); // < 30min
  });

  it("attempts=2 (MAX-1) is terminal: returns null regardless of random", () => {
    expect(computeRecoveryNextRetry(2, NOW, () => 0)).toBeNull();
    expect(computeRecoveryNextRetry(2, NOW, () => 0.999)).toBeNull();
  });

  it("attempts=NaN returns null (non-finite guard)", () => {
    expect(computeRecoveryNextRetry(Number.NaN, NOW, () => 0.5)).toBeNull();
  });
});

describe("isOrgConfigSkip", () => {
  it("is true for template_not_approved and no_template, false otherwise", () => {
    expect(isOrgConfigSkip({ eligible: false, reason: "template_not_approved" })).toBe(true);
    expect(isOrgConfigSkip({ eligible: false, reason: "no_template" })).toBe(true);
    expect(isOrgConfigSkip({ eligible: false, reason: "consent_revoked" })).toBe(false);
    expect(isOrgConfigSkip(eligibleTemplate)).toBe(false);
  });
});

describe("resolveEffectiveSendCreds (multi-tenant fail-closed)", () => {
  it("no per-org connection (null) + both globals -> the global pilot pair", () => {
    expect(resolveEffectiveSendCreds(null, "GT", "GP")).toEqual({
      ok: true,
      accessToken: "GT",
      phoneNumberId: "GP",
    });
  });

  it("no per-org connection + missing global token -> config_missing", () => {
    expect(resolveEffectiveSendCreds(null, undefined, "GP")).toEqual({
      ok: false,
      reason: "config_missing",
    });
  });

  it("no per-org connection + missing global phone id -> config_missing", () => {
    expect(resolveEffectiveSendCreds(null, "GT", undefined)).toEqual({
      ok: false,
      reason: "config_missing",
    });
  });

  it("per-org connection with BOTH fields -> the org's own creds, ignoring the globals", () => {
    expect(resolveEffectiveSendCreds({ token: "T2", phoneNumberId: "P2" }, "GT", "GP")).toEqual({
      ok: true,
      accessToken: "T2",
      phoneNumberId: "P2",
    });
  });

  it("per-org phone present + org token absent -> org phone + GLOBAL token (Tech Provider fallback)", () => {
    // The token is not the isolation boundary: a per-org WABA number under one shared system-user
    // token is the documented Meta Tech Provider model, so the token may fall back to the global.
    expect(resolveEffectiveSendCreds({ token: null, phoneNumberId: "P2" }, "GT", "GP")).toEqual({
      ok: true,
      accessToken: "GT",
      phoneNumberId: "P2",
    });
  });

  it("HEADLINE: per-org token present + org PHONE ABSENT -> FAIL CLOSED (never a global number)", () => {
    // The cross-tenant leak: tenant #2's patient must never be messaged FROM the global/pilot
    // number. A connection exists but has no phone id -> no safe send -> org_phone_missing.
    expect(resolveEffectiveSendCreds({ token: "T2", phoneNumberId: null }, "GT", "GP")).toEqual({
      ok: false,
      reason: "org_phone_missing",
    });
  });

  it("per-org connection with NEITHER field -> fail closed on the phone id first (org_phone_missing)", () => {
    expect(resolveEffectiveSendCreds({ token: null, phoneNumberId: null }, "GT", "GP")).toEqual({
      ok: false,
      reason: "org_phone_missing",
    });
  });

  it("per-org phone present but token resolvable from neither org nor global -> config_missing", () => {
    expect(
      resolveEffectiveSendCreds({ token: null, phoneNumberId: "P2" }, undefined, "GP"),
    ).toEqual({ ok: false, reason: "config_missing" });
  });
});

describe("dispatchRecoveryRow", () => {
  function deps(
    store: ReturnType<typeof makeStore>,
    sendTemplate: (args: unknown) => Promise<RecoveryTemplateSendResult>,
    onDeadLetter?: (reason: string) => void,
  ) {
    return {
      store,
      sendTemplate: sendTemplate as never,
      now: () => NOW,
      random: () => 0.5,
      onDeadLetter,
    };
  }

  it("rebooked: markSkipped(already_rebooked), no send, skipped", async () => {
    const store = makeStore();
    const sendTemplate = vi.fn();
    const res = await dispatchRecoveryRow(
      {
        rowId: "r1",
        attempts: 0,
        ctx: baseCtx(),
        eligibility: eligibleTemplate,
        rebooked: true,
        accessToken: "tok",
        phoneNumberId: "pn1",
      },
      deps(store, sendTemplate as never),
    );
    expect(store.markSkipped).toHaveBeenCalledWith("r1", "already_rebooked");
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(res).toEqual({ outcome: "skipped", deadLettered: false });
  });

  it("ineligible (consent_revoked): markSkipped(consent_revoked), no send", async () => {
    const store = makeStore();
    const sendTemplate = vi.fn();
    const res = await dispatchRecoveryRow(
      {
        rowId: "r1",
        attempts: 0,
        ctx: baseCtx(),
        eligibility: { eligible: false, reason: "consent_revoked" },
        rebooked: false,
        accessToken: "tok",
        phoneNumberId: "pn1",
      },
      deps(store, sendTemplate as never),
    );
    expect(store.markSkipped).toHaveBeenCalledWith("r1", "consent_revoked");
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(res).toEqual({ outcome: "skipped", deadLettered: false });
  });

  it("eligible but no phone: markSkipped(missing_contact_phone), no send", async () => {
    const store = makeStore();
    const sendTemplate = vi.fn();
    const res = await dispatchRecoveryRow(
      {
        rowId: "r1",
        attempts: 0,
        ctx: baseCtx({ phone: null }),
        eligibility: eligibleTemplate,
        rebooked: false,
        accessToken: "tok",
        phoneNumberId: "pn1",
      },
      deps(store, sendTemplate as never),
    );
    expect(store.markSkipped).toHaveBeenCalledWith("r1", "missing_contact_phone");
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(res).toEqual({ outcome: "skipped", deadLettered: false });
  });

  it("eligible + send ok: markSent(messageId), sent", async () => {
    const store = makeStore();
    const sendTemplate = vi.fn().mockResolvedValue({ ok: true, messageId: "m1" });
    const res = await dispatchRecoveryRow(
      {
        rowId: "r1",
        attempts: 0,
        ctx: baseCtx(),
        eligibility: eligibleTemplate,
        rebooked: false,
        accessToken: "tok",
        phoneNumberId: "pn1",
      },
      deps(store, sendTemplate as never),
    );
    expect(sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "tok",
        phoneNumberId: "pn1",
        to: "+6591234567",
        metaTemplateName: "alex_reengage_sg_v1",
        leadName: "Ada",
        businessName: "Glow Clinic",
      }),
    );
    expect(store.markSent).toHaveBeenCalledWith("r1", "m1");
    expect(res).toEqual({ outcome: "sent", deadLettered: false });
  });

  it("send !ok at attempts=0: markFailed with a non-null nextRetryAt, onDeadLetter NOT called, deadLettered:false", async () => {
    const store = makeStore();
    const sendTemplate = vi.fn().mockResolvedValue({ ok: false, error: "500" });
    const onDeadLetter = vi.fn();
    const res = await dispatchRecoveryRow(
      {
        rowId: "r1",
        attempts: 0,
        ctx: baseCtx(),
        eligibility: eligibleTemplate,
        rebooked: false,
        accessToken: "tok",
        phoneNumberId: "pn1",
      },
      deps(store, sendTemplate as never, onDeadLetter),
    );
    expect(store.markFailed).toHaveBeenCalledTimes(1);
    const [id, err, nextRetryAt] = store.markFailed.mock.calls[0]!;
    expect(id).toBe("r1");
    expect(err).toBe("500");
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect(onDeadLetter).not.toHaveBeenCalled();
    expect(res).toEqual({ outcome: "failed", deadLettered: false });
  });

  it("send !ok at attempts=2 (MAX-1): markFailed null, onDeadLetter(max_retries_exhausted), deadLettered:true", async () => {
    const store = makeStore();
    const sendTemplate = vi.fn().mockResolvedValue({ ok: false, error: "500" });
    const onDeadLetter = vi.fn();
    const res = await dispatchRecoveryRow(
      {
        rowId: "r1",
        attempts: 2,
        ctx: baseCtx(),
        eligibility: eligibleTemplate,
        rebooked: false,
        accessToken: "tok",
        phoneNumberId: "pn1",
      },
      deps(store, sendTemplate as never, onDeadLetter),
    );
    const [id, , nextRetryAt] = store.markFailed.mock.calls[0]!;
    expect(id).toBe("r1");
    expect(nextRetryAt).toBeNull();
    expect(onDeadLetter).toHaveBeenCalledWith("max_retries_exhausted");
    expect(res).toEqual({ outcome: "failed", deadLettered: true });
  });

  it("send throws: markFailed with the error message and a computed nextRetryAt", async () => {
    const store = makeStore();
    const sendTemplate = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const res = await dispatchRecoveryRow(
      {
        rowId: "r1",
        attempts: 0,
        ctx: baseCtx(),
        eligibility: eligibleTemplate,
        rebooked: false,
        accessToken: "tok",
        phoneNumberId: "pn1",
      },
      deps(store, sendTemplate as never),
    );
    const [id, err, nextRetryAt] = store.markFailed.mock.calls[0]!;
    expect(id).toBe("r1");
    expect(err).toBe("ECONNRESET");
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect(res).toEqual({ outcome: "failed", deadLettered: false });
  });
});
