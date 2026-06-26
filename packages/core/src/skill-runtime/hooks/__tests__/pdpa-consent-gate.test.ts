import { describe, it, expect, vi } from "vitest";
import { PdpaConsentGateHook } from "../pdpa-consent-gate.js";
import { InMemoryGovernancePostureCache } from "../../../governance/posture-cache.js";
import type { GovernanceConfigResolver } from "../../../governance/governance-config-resolver.js";
import type { GovernanceVerdictStore } from "../../../governance/governance-verdict-store/types.js";
import type { HandoffStore } from "../../../handoff/types.js";
import type { ConsentService } from "../../../consent/consent-service.js";
import type {
  ContactConsentReader,
  ContactConsentRead,
} from "../../../consent/contact-consent-reader.js";
import { DISCLOSURE_COPY } from "../../../consent/disclosure-copy.js";
import type { ConversationStatusSetter } from "../deterministic-safety-gate.js";

const SG_CFG = {
  jurisdiction: "SG" as const,
  clinicType: "medical" as const,
  deterministicGate: { mode: "off" as const },
  consentState: { mode: "enforce" as const },
};

const buildDeps = (
  overrides: Partial<{
    resolution: Awaited<ReturnType<GovernanceConfigResolver>>;
    consent: ContactConsentRead;
    contactId: string | null;
  }> = {},
) => {
  const resolution = overrides.resolution ?? ({ status: "resolved", config: SG_CFG } as const);
  const consent: ContactConsentRead = overrides.consent ?? {
    pdpaJurisdiction: "SG",
    phoneE164: null,
    consentGrantedAt: null,
    consentRevokedAt: null,
    consentSource: null,
    aiDisclosureVersionShown: null,
    aiDisclosureShownAt: null,
    consentUpdatedBy: null,
    consentNotes: null,
  };

  const governanceConfigResolver: GovernanceConfigResolver = vi.fn().mockResolvedValue(resolution);
  const postureCache = new InMemoryGovernancePostureCache();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const verdictStore: GovernanceVerdictStore = { save: vi.fn().mockResolvedValue({}) } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handoffStore: HandoffStore = {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
    getBySessionId: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    listPending: vi.fn().mockResolvedValue([]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const conversationStore: ConversationStatusSetter = {
    setConversationStatus: vi.fn().mockResolvedValue(undefined),
  };
  const consentService: ConsentService = {
    attachToGovernedInteraction: vi.fn().mockResolvedValue(undefined),
    recordDisclosureShown: vi.fn().mockResolvedValue(undefined),
    recordGrant: vi.fn().mockResolvedValue(undefined),
    recordRevocation: vi.fn().mockResolvedValue(undefined),
    clearConsent: vi.fn().mockResolvedValue(undefined),
  };
  const contactConsentReader: ContactConsentReader = {
    read: vi.fn().mockResolvedValue(consent),
  };
  const sessionContactResolver = vi
    .fn()
    .mockResolvedValue(overrides.contactId === undefined ? "c1" : overrides.contactId);

  return {
    deps: {
      governanceConfigResolver,
      postureCache,
      consentService,
      contactConsentReader,
      sessionContactResolver,
      verdictStore,
      handoffStore,
      conversationStore,
      clock: () => new Date("2026-05-11T10:00:00Z"),
    },
    verdictStore,
    consentService,
    handoffStore,
    conversationStore,
  };
};

// Correction A: trustLevel uses real enum values (not "observe")
const ctx = {
  deploymentId: "d1",
  orgId: "org1",
  skillSlug: "alex",
  skillVersion: "1.0.0",
  sessionId: "sess1",
  trustLevel: "supervised" as const,
  trustScore: 0.5,
};

const SG_DISCLOSURE_TEXT =
  "Hi, I'm Alex — the clinic's AI assistant. I can help with bookings and general questions, and a clinic team member will step in for anything medical.";

describe("PdpaConsentGateHook", () => {
  it("passes through when resolution.status === missing", async () => {
    const { deps, verdictStore, consentService } = buildDeps({
      resolution: { status: "missing" },
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "anything", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("anything");
    expect(consentService.attachToGovernedInteraction).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictStore.save as any).mock.calls.length).toBe(0);
  });

  it("passes through when consentState.mode === off", async () => {
    const { deps } = buildDeps({
      resolution: {
        status: "resolved",
        config: { ...SG_CFG, consentState: { mode: "off" } },
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "x", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("x");
  });

  it("passes through when sessionContactResolver returns null", async () => {
    const { deps, consentService } = buildDeps({ contactId: null });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "x", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(consentService.attachToGovernedInteraction).not.toHaveBeenCalled();
  });

  it("stamps jurisdiction via attachToGovernedInteraction", async () => {
    const { deps, consentService } = buildDeps();
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "x", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    // Threads the real tenant (ctx.orgId), not the constructor-bound placeholder.
    expect(consentService.attachToGovernedInteraction).toHaveBeenCalledWith("c1", "SG", "org1");
  });

  it("stamps the per-lead jurisdiction from a +60 phone (MY) at an SG-default org", async () => {
    const { deps, consentService } = buildDeps({
      consent: {
        pdpaJurisdiction: null,
        phoneE164: "+60123456789",
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        aiDisclosureVersionShown: null,
        aiDisclosureShownAt: null,
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "x", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    // The lead's own +60 phone governs their PDPA regime, not the SG org default.
    expect(consentService.attachToGovernedInteraction).toHaveBeenCalledWith("c1", "MY", "org1");
  });

  it("re-stamps an already-MY contact as MY (precedence) — never a spurious mismatch at an SG org", async () => {
    const { deps, consentService } = buildDeps({
      consent: {
        pdpaJurisdiction: "MY",
        phoneE164: "+60123456789",
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        aiDisclosureVersionShown: null,
        aiDisclosureShownAt: null,
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "x", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    // The stamped value wins over the SG org default, so the re-stamp is a no-op
    // and ConsentService never sees a mismatching SG write.
    expect(consentService.attachToGovernedInteraction).toHaveBeenCalledWith("c1", "MY", "org1");
  });

  it("records the disclosure under the per-lead jurisdiction (MY) for a +60 lead", async () => {
    const { deps, consentService } = buildDeps({
      consent: {
        pdpaJurisdiction: null,
        phoneE164: "+60123456789",
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        aiDisclosureVersionShown: null,
        aiDisclosureShownAt: null,
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = {
      response: DISCLOSURE_COPY.MY.text + " How can I help?",
      toolCalls: [],
      tokenUsage: {},
      trace: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await hook.afterSkill(ctx, result);
    // Disclosure recording must match the stamped (per-lead) jurisdiction, else
    // ConsentService.recordDisclosureShown throws ConsentJurisdictionMismatch.
    expect(consentService.recordDisclosureShown).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c1",
        jurisdiction: "MY",
        version: DISCLOSURE_COPY.MY.version,
      }),
    );
  });

  it("emits jurisdiction_mismatch critical verdict but does NOT block", async () => {
    const { deps, verdictStore } = buildDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (deps.consentService.attachToGovernedInteraction as any).mockRejectedValueOnce(
      Object.assign(new Error("mismatch"), {
        name: "ConsentJurisdictionMismatch",
        contactId: "c1",
        stamped: "MY",
        provided: "SG",
      }),
    );
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "untouched", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("untouched");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.reasonCode).toBe("jurisdiction_mismatch");
    expect(saved.auditLevel).toBe("critical");
    expect(saved.action).toBe("allow");
  });

  it("on revoked status — defense-in-depth block (replaces response with handoff, flips status)", async () => {
    const { deps, conversationStore, handoffStore, verdictStore } = buildDeps({
      consent: {
        pdpaJurisdiction: "SG",
        phoneE164: null,
        consentGrantedAt: null,
        consentRevokedAt: "2026-05-10T00:00:00.000Z",
        consentSource: "inbound_keyword_revocation",
        aiDisclosureVersionShown: null,
        aiDisclosureShownAt: null,
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = {
      response: "would have replied",
      toolCalls: [],
      tokenUsage: {},
      trace: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).not.toBe("would have replied");
    // Correction C: 2-arg call (upsertContext is optional)
    expect(conversationStore.setConversationStatus).toHaveBeenCalledWith("sess1", "human_override");
    expect(handoffStore.save).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0].reasonCode === "consent_revoked",
    );
    expect(saved).toBeDefined();
    expect(saved![0].action).toBe("block");
    expect(saved![0].auditLevel).toBe("critical");
    expect(saved![0].details.event).toBe("defense_in_depth_revoked_race");
  });

  it("disclosure shown for the first time → recordDisclosureShown called", async () => {
    const { deps, consentService } = buildDeps();
    const hook = new PdpaConsentGateHook(deps);
    const result = {
      response: SG_DISCLOSURE_TEXT + " Happy to help — what brings you in?",
      toolCalls: [],
      tokenUsage: {},
      trace: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await hook.afterSkill(ctx, result);
    expect(consentService.recordDisclosureShown).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c1",
        jurisdiction: "SG",
        version: "sg-disclosure@1.0.0",
        actor: "system:skill_runtime",
      }),
    );
  });

  it("disclosure expected but missing in enforce → observe-level warning verdict, NO block", async () => {
    const { deps, verdictStore } = buildDeps();
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "hi there!", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("hi there!"); // unchanged — disclosure never blocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0].reasonCode === "disclosure_not_shown",
    );
    expect(saved).toBeDefined();
    expect(saved![0].auditLevel).toBe("warning");
    expect(saved![0].action).toBe("allow");
  });

  it("disclosure already shown at current version → no recordDisclosureShown, no warning", async () => {
    const { deps, consentService, verdictStore } = buildDeps({
      consent: {
        pdpaJurisdiction: "SG",
        phoneE164: null,
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        aiDisclosureVersionShown: "sg-disclosure@1.0.0",
        aiDisclosureShownAt: "2026-05-10T00:00:00.000Z",
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "follow-up reply", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(consentService.recordDisclosureShown).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const warnings = (verdictStore.save as any).mock.calls.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0].reasonCode === "disclosure_not_shown",
    );
    expect(warnings.length).toBe(0);
  });

  it("disclosure stale (version outdated) and not present → disclosure_version_outdated warning", async () => {
    const { deps, verdictStore } = buildDeps({
      consent: {
        pdpaJurisdiction: "SG",
        phoneE164: null,
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        aiDisclosureVersionShown: "sg-disclosure@0.9.0",
        aiDisclosureShownAt: "2026-04-01T00:00:00.000Z",
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "hi again!", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0].reasonCode === "disclosure_version_outdated",
    );
    expect(saved).toBeDefined();
    expect(saved![0].auditLevel).toBe("warning");
  });

  it("resolver-error + cold cache → fail open (no verdict)", async () => {
    const { deps, verdictStore } = buildDeps({
      resolution: { status: "error", error: new Error("db down") },
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "anything", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    expect(result.response).toBe("anything");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((verdictStore.save as any).mock.calls.length).toBe(0);
  });

  it("resolver-error + cached enforce posture → governance_unavailable critical verdict (no block in 1c)", async () => {
    const { deps, verdictStore } = buildDeps({
      resolution: { status: "error", error: new Error("db down") },
    });
    // Warm the cache as if a prior turn resolved enforce on SG/medical.
    deps.postureCache.remember("d1", {
      mode: "enforce",
      jurisdiction: "SG",
      clinicType: "medical",
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "anything", toolCalls: [], tokenUsage: {}, trace: [] } as any;
    await hook.afterSkill(ctx, result);
    // No block in 1c (operational only blocks on revoked, which we don't know on resolver error).
    expect(result.response).toBe("anything");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls[0][0];
    expect(saved.reasonCode).toBe("governance_unavailable");
    expect(saved.auditLevel).toBe("critical");
    expect(saved.jurisdiction).toBe("SG");
    expect(saved.clinicType).toBe("medical");
  });

  it("observe mode logs the revoked-race instead of blocking", async () => {
    const { deps, verdictStore, handoffStore, conversationStore } = buildDeps({
      resolution: {
        status: "resolved",
        config: { ...SG_CFG, consentState: { mode: "observe" } },
      },
      consent: {
        pdpaJurisdiction: "SG",
        phoneE164: null,
        consentGrantedAt: null,
        consentRevokedAt: "2026-05-10T00:00:00.000Z",
        consentSource: "inbound_keyword_revocation",
        aiDisclosureVersionShown: null,
        aiDisclosureShownAt: null,
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    const result = {
      response: "original reply",
      toolCalls: [],
      tokenUsage: {},
      trace: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await hook.afterSkill(ctx, result);

    // Strictly log-only: nothing lead-visible changes in observe.
    expect(result.response).toBe("original reply");
    expect(conversationStore.setConversationStatus).not.toHaveBeenCalled();
    expect(handoffStore.save).not.toHaveBeenCalled();
    expect(verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "allow",
        auditLevel: "warning",
        reasonCode: "consent_revoked",
        details: expect.objectContaining({
          event: "defense_in_depth_revoked_race",
          wouldBlock: true,
        }),
      }),
    );
  });

  it("observe mode persists the disclosure_not_shown verdict", async () => {
    const { deps, verdictStore } = buildDeps({
      resolution: {
        status: "resolved",
        config: { ...SG_CFG, consentState: { mode: "observe" } },
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    // Response WITHOUT the SG disclosure text; consent fixture defaults to never-disclosed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "hi there!", toolCalls: [], tokenUsage: {}, trace: [] } as any;

    await hook.afterSkill(ctx, result);

    expect(result.response).toBe("hi there!");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0].reasonCode === "disclosure_not_shown",
    );
    expect(saved).toBeDefined();
    expect(saved![0].action).toBe("allow");
    expect(saved![0].auditLevel).toBe("warning");
  });

  it("observe mode persists the disclosure_version_outdated verdict", async () => {
    const { deps, verdictStore } = buildDeps({
      resolution: {
        status: "resolved",
        config: { ...SG_CFG, consentState: { mode: "observe" } },
      },
      consent: {
        pdpaJurisdiction: "SG",
        phoneE164: null,
        consentGrantedAt: null,
        consentRevokedAt: null,
        consentSource: null,
        aiDisclosureVersionShown: "sg-disclosure@0.9.0",
        aiDisclosureShownAt: "2026-05-01T00:00:00.000Z",
        consentUpdatedBy: null,
        consentNotes: null,
      },
    });
    const hook = new PdpaConsentGateHook(deps);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = { response: "hi there!", toolCalls: [], tokenUsage: {}, trace: [] } as any;

    await hook.afterSkill(ctx, result);

    expect(result.response).toBe("hi there!");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saved = (verdictStore.save as any).mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[0].reasonCode === "disclosure_version_outdated",
    );
    expect(saved).toBeDefined();
    expect(saved![0].action).toBe("allow");
    expect(saved![0].auditLevel).toBe("warning");
  });
});
