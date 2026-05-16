import { describe, expect, it, vi } from "vitest";
import { runConsentEnforcementGate } from "./consent-enforcement-gate.js";
import type { ConsentEnforcementGateConfig } from "./consent-enforcement-gate.js";

const FIXED_DATE = new Date("2026-05-16T12:00:00Z");

function makeStubs(
  overrides: Partial<{
    revokedAt: Date | null;
    jurisdiction: "SG" | "MY";
    consentMode: "off" | "observe" | "enforce";
    resolverStatus: "resolved" | "missing" | "error";
    cachedPostureMode: "observe" | "enforce" | null;
  }> = {},
) {
  const verdictSave = vi.fn().mockResolvedValue(undefined);
  const postureRemember = vi.fn();
  const sessionContactResolver = vi.fn().mockResolvedValue("contact-123");
  const consentStoreReadOrNull = vi.fn().mockResolvedValue({
    consentRevokedAt: overrides.revokedAt ?? null,
    pdpaJurisdiction: overrides.jurisdiction ?? "SG",
  });

  const cfg: ConsentEnforcementGateConfig = {
    governanceConfigResolver: vi.fn().mockResolvedValue(
      overrides.resolverStatus === "missing"
        ? { status: "missing" }
        : overrides.resolverStatus === "error"
          ? { status: "error" }
          : {
              status: "resolved",
              config: {
                jurisdiction: overrides.jurisdiction ?? "SG",
                clinicType: "medical",
                consentState: { mode: overrides.consentMode ?? "enforce" },
              },
            },
    ),
    consentStore: { readOrNull: consentStoreReadOrNull } as any,
    postureCache: {
      remember: postureRemember,
      lastKnown: vi.fn().mockReturnValue(
        overrides.cachedPostureMode
          ? {
              mode: overrides.cachedPostureMode,
              jurisdiction: overrides.jurisdiction ?? "SG",
              clinicType: "medical",
            }
          : null,
      ),
    } as any,
    verdictStore: { save: verdictSave } as any,
    sessionContactResolver,
    clock: () => FIXED_DATE,
  };

  return { cfg, verdictSave, postureRemember, sessionContactResolver, consentStoreReadOrNull };
}

describe("runConsentEnforcementGate", () => {
  it("allows when consent is active", async () => {
    const { cfg, verdictSave } = makeStubs({ revokedAt: null });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi there",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).not.toHaveBeenCalled();
  });

  it("blocks when consentRevokedAt is set (enforce mode)", async () => {
    const { cfg, verdictSave } = makeStubs({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      consentMode: "enforce",
    });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi there",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "telegram",
    });
    expect(result).toBe("blocked");
    expect(verdictSave).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verdict = (verdictSave as any).mock.calls[0][0];
    expect(verdict.sourceGuard).toBe("consent_gate");
    expect(verdict.action).toBe("block");
    expect(verdict.reasonCode).toBe("consent_revoked");
    expect(verdict.details.channel).toBe("telegram");
    expect(verdict.details.contactId).toBe("contact-123");
    expect(verdict.auditLevel).toBe("critical");
    expect(verdict.details.outboundLength).toBe("Hi there".length);
  });

  it("allows but records verdict in observe mode", async () => {
    const { cfg, verdictSave } = makeStubs({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      consentMode: "observe",
    });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictSave as any).mock.calls[0][0].action).toBe("allow");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictSave as any).mock.calls[0][0].details.observe).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictSave as any).mock.calls[0][0].auditLevel).toBe("warning");
  });

  it("passes through when consent mode is off", async () => {
    const { cfg, verdictSave } = makeStubs({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      consentMode: "off",
    });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).not.toHaveBeenCalled();
  });

  it("passes through when governance config is missing", async () => {
    const { cfg, verdictSave } = makeStubs({ resolverStatus: "missing" });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).not.toHaveBeenCalled();
  });

  it("on resolver error with NO cached posture, allows and emits no verdict", async () => {
    const { cfg, verdictSave } = makeStubs({
      resolverStatus: "error",
      cachedPostureMode: null,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("resolver error; no cached enforce posture"),
    );
    errorSpy.mockRestore();
  });

  it("on resolver error with cached enforce posture, records audit + fails open", async () => {
    const { cfg, verdictSave } = makeStubs({
      resolverStatus: "error",
      cachedPostureMode: "enforce",
    });
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictSave as any).mock.calls[0][0].reasonCode).toBe("governance_unavailable");
  });

  it("allows when contact cannot be resolved AND records visibility verdict", async () => {
    // Correction (post-review): no-contact must emit a verdict so resolver
    // mapping breakage never silently fails open.
    const { cfg, verdictSave, sessionContactResolver } = makeStubs({});
    sessionContactResolver.mockResolvedValueOnce(null);
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "System error reply",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("allowed");
    expect(verdictSave).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verdict = (verdictSave as any).mock.calls[0][0];
    expect(verdict.reasonCode).toBe("contact_resolution_missing");
    expect(verdict.action).toBe("allow");
    expect(verdict.auditLevel).toBe("warning");
    expect(verdict.details.event).toBe("egress_contact_resolution_missing");
    expect(verdict.details.channel).toBe("whatsapp");
  });

  it("does not throw when verdict persistence fails", async () => {
    // Correction (post-review): emission integrity > persistence completeness.
    // Mirror the inbound gate's behavior on verdict-store errors.
    const { cfg, verdictSave } = makeStubs({
      revokedAt: new Date("2026-05-15T00:00:00Z"),
      consentMode: "enforce",
    });
    verdictSave.mockRejectedValueOnce(new Error("verdict store down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runConsentEnforcementGate({
      cfg,
      outboundText: "Hi",
      sessionId: "s-1",
      deploymentId: "d-1",
      channel: "whatsapp",
    });
    expect(result).toBe("blocked");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
