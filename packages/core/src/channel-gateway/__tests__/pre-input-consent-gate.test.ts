import { describe, it, expect, vi } from "vitest";
import { runConsentRevocationGate } from "../consent-revocation-gate.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";
import { loadRevocationKeywords } from "../../consent/revocation-keywords/loader.js";
import type { GovernanceConfigResolution } from "../../governance/governance-config-resolver.js";

const SG_ENFORCE = {
  status: "resolved" as const,
  config: {
    jurisdiction: "SG" as const,
    clinicType: "medical" as const,
    deterministicGate: { mode: "off" as const },
    consentState: { mode: "enforce" as const },
  },
};

const buildDeps = (resolution: GovernanceConfigResolution = SG_ENFORCE) => {
  const governanceConfigResolver = vi.fn().mockResolvedValue(resolution);
  const consentService = {
    attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
    recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
    recordGrant: vi.fn().mockResolvedValue(undefined),
    recordRevocation: vi.fn().mockResolvedValue(undefined),
    clearConsent: vi.fn().mockResolvedValue(undefined),
  };
  const verdictStore = { save: vi.fn().mockResolvedValue({}) };
  const postureCache = new InMemoryGovernancePostureCache();
  const sessionContactResolver = vi.fn().mockResolvedValue("c1");
  const replySink = { send: vi.fn().mockResolvedValue(undefined) };
  return {
    cfg: {
      governanceConfigResolver,
      consentService,
      postureCache,
      revocationKeywordLoader: loadRevocationKeywords,
      sessionContactResolver,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      verdictStore: verdictStore as any,
      clock: () => new Date("2026-05-11T10:00:00Z"),
    },
    replySink,
    consentService,
    verdictStore,
  };
};

describe("runConsentRevocationGate", () => {
  it("returns 'proceed' when no keyword match", async () => {
    const { cfg, replySink } = buildDeps();
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "Hi looking to book a facial next Tue",
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("proceed");
  });

  it("returns 'revoked' on STOP match in enforce mode", async () => {
    const { cfg, replySink, consentService } = buildDeps();
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "STOP messaging me",
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("revoked");
    expect(consentService.recordRevocation).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c1",
        source: "inbound_keyword_revocation",
        openConversationSessionId: "sess1",
      }),
    );
    expect(replySink.send).toHaveBeenCalled();
  });

  it("observe mode — emits warning verdict but does NOT mutate state or send ack", async () => {
    const obs = {
      status: "resolved" as const,
      config: {
        jurisdiction: "MY" as const,
        clinicType: "nonMedical" as const,
        deterministicGate: { mode: "off" as const },
        consentState: { mode: "observe" as const },
      },
    };
    const { cfg, replySink, consentService, verdictStore } = buildDeps(obs);
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "berhenti hantar pesanan",
      sessionId: "sess2",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("proceed");
    expect(consentService.recordRevocation).not.toHaveBeenCalled();
    expect(replySink.send).not.toHaveBeenCalled();
    expect((verdictStore.save as any).mock.calls[0][0].auditLevel).toBe("warning");
  });

  it("mode=off — pure pass-through", async () => {
    const off = {
      status: "resolved" as const,
      config: {
        jurisdiction: "SG" as const,
        clinicType: "medical" as const,
        deterministicGate: { mode: "off" as const },
        consentState: { mode: "off" as const },
      },
    };
    const { cfg, replySink, consentService, verdictStore } = buildDeps(off);
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "STOP",
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("proceed");
    expect(consentService.recordRevocation).not.toHaveBeenCalled();
    expect((verdictStore.save as any).mock.calls.length).toBe(0);
  });

  it("pre-contact (sessionContactResolver returns null) → proceed", async () => {
    const { cfg, replySink, consentService } = buildDeps();
    (cfg.sessionContactResolver as any).mockResolvedValue(null);
    const out = await runConsentRevocationGate({
      cfg,
      inboundText: "STOP",
      sessionId: "sess1",
      deploymentId: "d1",
      organizationId: "org1",
      replySink: replySink as any,
    });
    expect(out).toBe("proceed");
    expect(consentService.recordRevocation).not.toHaveBeenCalled();
  });
});
