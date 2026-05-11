/**
 * channel-gateway-deterministic-gate.test.ts
 *
 * Tests for the pre-input deterministic gate (Task 13).
 *
 * Matrix:
 *  1. config missing → submit called, no verdict
 *  2. mode off → submit called, no verdict
 *  3. observe + match → submit called, verdict with action "allow" persisted
 *  4. enforce + match (SG) → submit NOT called, send called with handoff text,
 *     verdict action "escalate", status flipped, handoff saved
 *  5. enforce + no match → submit called, no verdict
 *  6. fail-open on resolver error with cold cache → submit called, no verdict
 *  7. fail-closed: resolver error + cached SG enforce + inbound MATCHES trigger
 *     → submit NOT called, verdict reasonCode matches REASON_CODE_BY_TRIGGER
 *     for the matched category (not bare "governance_unavailable"), jurisdiction "SG",
 *     SG handoff phrasing ("I'll get them")
 *  7b. fail-closed: resolver error + cached SG enforce + inbound CLEAN (no match)
 *      → submit IS called (scan-still-clean path, no block), no verdict, no send
 *  8. fail-closed uses cached MY/nonMedical posture (not hardcoded SG default):
 *     resolver error + cached MY enforce + inbound matches trigger
 *     → submit NOT called, verdict jurisdiction "MY", clinicType "nonMedical",
 *     MY handoff phrasing ("I'll have them")
 *  8b. fail-closed: resolver error + cached MY enforce + inbound CLEAN
 *      → submit IS called, no verdict, no send
 *  9. verdictStore.save throws in enforce → submit still NOT called, send still
 *     called, status still flipped (block applied)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage } from "../types.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import type { EscalationTriggerEntry } from "../../governance/escalation-triggers/types.js";
import type { SaveGovernanceVerdictInput } from "../../governance/governance-verdict-store/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SG_HANDOFF_SUBSTRING = "I'll get them";
const MY_HANDOFF_SUBSTRING = "I'll have them";

/** A phrase that matches the "sensitive_keyword" trigger built into escalation fixtures. */
const TRIGGERING_PHRASE = "pregnant";

/** A clean phrase that does not match any trigger. */
const CLEAN_PHRASE = "hello, I'd like to book an appointment";

// ---------------------------------------------------------------------------
// Minimal SG escalation trigger fixture
// ---------------------------------------------------------------------------

const SG_TRIGGER_ENTRY: EscalationTriggerEntry = {
  id: "test-pg-sg",
  category: "pregnancy_breastfeeding",
  patterns: [/pregnant/i, /breastfeed/i],
};

const MY_TRIGGER_ENTRY: EscalationTriggerEntry = {
  id: "test-pg-my",
  category: "pregnancy_breastfeeding",
  patterns: [/pregnant/i, /breastfeed/i],
};

function makeTriggerLoader(
  sg: ReadonlyArray<EscalationTriggerEntry> = [SG_TRIGGER_ENTRY],
  my: ReadonlyArray<EscalationTriggerEntry> = [MY_TRIGGER_ENTRY],
) {
  return (jurisdiction: "SG" | "MY") => (jurisdiction === "SG" ? sg : my);
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type Spy = ReturnType<typeof vi.fn>;

interface VerdictStoreSpy {
  save: Spy;
  listByConversation: Spy;
  listByDeployment: Spy;
}

interface HandoffStoreSpy {
  save: Spy;
  getById: Spy;
  getBySessionId: Spy;
  updateStatus: Spy;
  listPending: Spy;
}

interface StatusSetterSpy {
  setConversationStatus: Spy;
}

const VERDICT_RECORD = {
  id: "vr-1",
  action: "escalate" as const,
  reasonCode: "medical_safety_trigger" as const,
  jurisdiction: "SG" as const,
  clinicType: "medical" as const,
  sourceGuard: "escalation_trigger" as const,
  auditLevel: "critical" as const,
  decidedAt: "2026-05-10T12:00:00.000Z",
  conversationId: "sess-1",
  deploymentId: "dep-1",
  details: null,
  createdAt: "2026-05-10T12:00:00.000Z",
};

function makeVerdictStore(): VerdictStoreSpy {
  return {
    save: vi.fn().mockResolvedValue(VERDICT_RECORD),
    listByConversation: vi.fn(),
    listByDeployment: vi.fn(),
  };
}

function makeHandoffStore(): HandoffStoreSpy {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn(),
    getBySessionId: vi.fn(),
    updateStatus: vi.fn(),
    listPending: vi.fn(),
  };
}

function makeStatusSetter(): StatusSetterSpy {
  return { setConversationStatus: vi.fn().mockResolvedValue(undefined) };
}

/**
 * Builds a minimal ChannelGatewayConfig with:
 * - governance deps wired (resolver, triggerLoader, verdictStore, postureCache)
 * - handoffStore and conversationStatusSetter wired via overrides
 * - All existing required deps stubbed out
 */
function makeGatewayConfig(
  governanceDeps: {
    resolver: GovernanceConfigResolver;
    verdictStore: VerdictStoreSpy;
    postureCache: InMemoryGovernancePostureCache;
    handoffStore?: HandoffStoreSpy;
    statusSetter?: StatusSetterSpy;
    triggerLoader?: ReturnType<typeof makeTriggerLoader>;
  },
  overrides: Partial<ChannelGatewayConfig> = {},
): ChannelGatewayConfig {
  return {
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        messages: [],
      }),
      addMessage: vi.fn().mockResolvedValue(undefined),
    },
    deploymentResolver: {
      resolveByChannelToken: vi.fn().mockResolvedValue({
        deploymentId: "dep-1",
        listingId: "listing-1",
        organizationId: "org-1",
        skillSlug: "alex",
        trustLevel: "guided",
        trustScore: 50,
        deploymentConfig: {},
      }),
      resolveByDeploymentId: vi.fn(),
      resolveByOrgAndSlug: vi.fn(),
    },
    platformIngress: {
      submit: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          outcome: "completed",
          outputs: { response: "Hello from agent" },
          summary: "Responded to user",
        },
        workUnit: { id: "wu-1", traceId: "trace-1" },
      }),
    },
    approvalStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn().mockResolvedValue(undefined),
      listPending: vi.fn().mockResolvedValue([]),
    },
    governanceConfigResolver: governanceDeps.resolver,
    escalationTriggerLoader: governanceDeps.triggerLoader ?? makeTriggerLoader(),
    verdictStore: governanceDeps.verdictStore,
    postureCache: governanceDeps.postureCache,
    handoffStore: governanceDeps.handoffStore,
    conversationStatusSetter: governanceDeps.statusSetter,
    ...overrides,
  };
}

const MSG_CLEAN: IncomingChannelMessage = {
  channel: "web_widget",
  token: "tok",
  sessionId: "sess-1",
  text: CLEAN_PHRASE,
};

const MSG_TRIGGER: IncomingChannelMessage = {
  channel: "web_widget",
  token: "tok",
  sessionId: "sess-1",
  text: `I am ${TRIGGERING_PHRASE} — can I still get a treatment?`,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChannelGateway — pre-input deterministic gate", () => {
  let postureCache: InMemoryGovernancePostureCache;
  let verdictStore: VerdictStoreSpy;
  let handoffStore: HandoffStoreSpy;
  let statusSetter: StatusSetterSpy;
  let sendSpy: Spy;
  let submitSpy: Spy;

  beforeEach(() => {
    postureCache = new InMemoryGovernancePostureCache();
    verdictStore = makeVerdictStore();
    handoffStore = makeHandoffStore();
    statusSetter = makeStatusSetter();
    sendSpy = vi.fn().mockResolvedValue(undefined);
    submitSpy = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        outcome: "completed",
        outputs: { response: "Hello from agent" },
        summary: "Responded to user",
      },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    });
  });

  // -------------------------------------------------------------------------
  // Test 1: config missing → submit called, no verdict
  // -------------------------------------------------------------------------
  it("1. config missing → submit called, no verdict persisted", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({ status: "missing" });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    expect(submitSpy).toHaveBeenCalled();
    expect(verdictStore.save).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith("Hello from agent"); // normal AI reply
  });

  // -------------------------------------------------------------------------
  // Test 2: mode off → submit called, no verdict
  // -------------------------------------------------------------------------
  it("2. mode off → submit called, no verdict persisted", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "off" },
      },
    });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    expect(submitSpy).toHaveBeenCalled();
    expect(verdictStore.save).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: observe + match → submit called, verdict action "allow" persisted
  // -------------------------------------------------------------------------
  it('3. observe + match → submit called, verdict action "allow" persisted', async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "observe" },
      },
    });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    // Submit still runs in observe mode
    expect(submitSpy).toHaveBeenCalled();

    // Verdict persisted with action "allow"
    expect(verdictStore.save).toHaveBeenCalledOnce();
    const savedVerdict = verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(savedVerdict.action).toBe("allow");
    expect(savedVerdict.auditLevel).toBe("warning");
    expect(savedVerdict.sourceGuard).toBe("escalation_trigger");
    expect(savedVerdict.jurisdiction).toBe("SG");
    expect(savedVerdict.clinicType).toBe("medical");
    expect(savedVerdict.details?.matchCategory).toBe("pregnancy_breastfeeding");

    // Status NOT flipped in observe
    expect(statusSetter.setConversationStatus).not.toHaveBeenCalled();
    // Handoff NOT saved in observe
    expect(handoffStore.save).not.toHaveBeenCalled();
    // Normal AI reply emitted (not handoff text)
    expect(sendSpy).toHaveBeenCalledWith("Hello from agent");
  });

  // -------------------------------------------------------------------------
  // Test 4: enforce + match (SG) → submit NOT called, send handoff, verdict escalate
  // -------------------------------------------------------------------------
  it('4. enforce + match (SG) → submit NOT called, send called with SG handoff, verdict "escalate", status flipped, handoff saved', async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "enforce" },
      },
    });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    // Submit must NOT be called
    expect(submitSpy).not.toHaveBeenCalled();

    // Verdict persisted with action "escalate"
    expect(verdictStore.save).toHaveBeenCalledOnce();
    const savedVerdict = verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(savedVerdict.action).toBe("escalate");
    expect(savedVerdict.auditLevel).toBe("critical");
    expect(savedVerdict.reasonCode).toBe("medical_safety_trigger");
    expect(savedVerdict.jurisdiction).toBe("SG");
    expect(savedVerdict.details?.sentence).toBeDefined();

    // Status flipped
    expect(statusSetter.setConversationStatus).toHaveBeenCalledWith("sess-1", "human_override", {
      channel: "web_widget",
      principalId: "visitor-sess-1",
    });

    // Handoff saved
    expect(handoffStore.save).toHaveBeenCalledOnce();
    const handoffPkg = handoffStore.save.mock.calls[0]![0];
    expect(handoffPkg.reason).toBe("compliance_concern");
    expect(handoffPkg.status).toBe("pending");

    // SG handoff text sent
    expect(sendSpy).toHaveBeenCalledOnce();
    const sentText: string = sendSpy.mock.calls[0]![0];
    expect(sentText).toContain(SG_HANDOFF_SUBSTRING);
  });

  // -------------------------------------------------------------------------
  // Test 5: enforce + no match → submit called, no verdict
  // -------------------------------------------------------------------------
  it("5. enforce + no match → submit called, no verdict persisted", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "enforce" },
      },
    });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    await gw.handleIncoming(MSG_CLEAN, { send: sendSpy });

    expect(submitSpy).toHaveBeenCalled();
    expect(verdictStore.save).not.toHaveBeenCalled();
    expect(statusSetter.setConversationStatus).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: fail-open — resolver error, cold cache → submit called, no verdict
  // -------------------------------------------------------------------------
  it("6. fail-open: resolver error + cold cache → submit called, no verdict", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "error",
      error: new Error("DB timeout"),
    });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    // No posture cached — cold cache
    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    expect(submitSpy).toHaveBeenCalled();
    expect(verdictStore.save).not.toHaveBeenCalled();
    expect(statusSetter.setConversationStatus).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: fail-closed — resolver error, cached SG enforce, inbound MATCHES
  //         trigger → submit NOT called, verdict uses REASON_CODE_BY_TRIGGER
  //         for matched category (natural reason code, not "governance_unavailable"),
  //         SG phrasing
  // -------------------------------------------------------------------------
  it("7. fail-closed: resolver error + cached SG enforce + trigger match → submit NOT called, verdict uses trigger natural reason code, SG phrasing", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "error",
      error: new Error("DB timeout"),
    });

    // Seed posture cache with SG/enforce
    postureCache.remember("dep-1", { mode: "enforce", jurisdiction: "SG", clinicType: "medical" });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    // MSG_TRIGGER contains "pregnant" → matches pregnancy_breastfeeding → medical_safety_trigger
    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    // Submit must NOT be called
    expect(submitSpy).not.toHaveBeenCalled();

    // Verdict persisted with natural trigger reason code (not bare "governance_unavailable")
    expect(verdictStore.save).toHaveBeenCalledOnce();
    const savedVerdict = verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    // pregnancy_breastfeeding → REASON_CODE_BY_TRIGGER → "medical_safety_trigger"
    expect(savedVerdict.reasonCode).toBe("medical_safety_trigger");
    expect(savedVerdict.action).toBe("escalate");
    expect(savedVerdict.auditLevel).toBe("critical");
    expect(savedVerdict.jurisdiction).toBe("SG");
    expect(savedVerdict.clinicType).toBe("medical");
    expect(savedVerdict.details?.matchCategory).toBe("pregnancy_breastfeeding");

    // Status flipped
    expect(statusSetter.setConversationStatus).toHaveBeenCalledWith("sess-1", "human_override", {
      channel: "web_widget",
      principalId: "visitor-sess-1",
    });

    // SG handoff text sent
    expect(sendSpy).toHaveBeenCalledOnce();
    const sentText: string = sendSpy.mock.calls[0]![0];
    expect(sentText).toContain(SG_HANDOFF_SUBSTRING);
    expect(sentText).not.toContain(MY_HANDOFF_SUBSTRING);
  });

  // -------------------------------------------------------------------------
  // Test 7b: fail-closed — resolver error, cached SG enforce, inbound CLEAN
  //          → scan-still-clean: submit IS called, no verdict, no send
  // -------------------------------------------------------------------------
  it("7b. fail-closed: resolver error + cached SG enforce + clean inbound → scan-still-clean, submit called, no verdict, no send", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "error",
      error: new Error("DB timeout"),
    });

    // Seed posture cache with SG/enforce
    postureCache.remember("dep-1", { mode: "enforce", jurisdiction: "SG", clinicType: "medical" });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    // MSG_CLEAN has no trigger match → scan-still-clean path → proceed
    await gw.handleIncoming(MSG_CLEAN, { send: sendSpy });

    // Submit IS called — text is clean
    expect(submitSpy).toHaveBeenCalled();
    // No verdict persisted
    expect(verdictStore.save).not.toHaveBeenCalled();
    // No status flip
    expect(statusSetter.setConversationStatus).not.toHaveBeenCalled();
    // AI reply sent (not handoff text)
    expect(sendSpy).toHaveBeenCalledWith("Hello from agent");
  });

  // -------------------------------------------------------------------------
  // Test 8: fail-closed uses cached MY/nonMedical posture (not hardcoded SG)
  //         inbound MATCHES trigger → submit NOT called, verdict MY/nonMedical
  // -------------------------------------------------------------------------
  it("8. fail-closed: cached MY/nonMedical enforce posture + trigger match → verdict jurisdiction MY, MY phrasing", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "error",
      error: new Error("Config store unavailable"),
    });

    // Seed posture cache with MY/nonMedical/enforce
    postureCache.remember("dep-1", {
      mode: "enforce",
      jurisdiction: "MY",
      clinicType: "nonMedical",
    });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    // Submit must NOT be called
    expect(submitSpy).not.toHaveBeenCalled();

    // Verdict uses MY/nonMedical — never hardcoded SG default
    expect(verdictStore.save).toHaveBeenCalledOnce();
    const savedVerdict = verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
    expect(savedVerdict.jurisdiction).toBe("MY");
    expect(savedVerdict.clinicType).toBe("nonMedical");
    // Natural reason code from matched trigger category
    expect(savedVerdict.reasonCode).toBe("medical_safety_trigger");
    expect(savedVerdict.details?.matchCategory).toBe("pregnancy_breastfeeding");

    // MY handoff text sent
    expect(sendSpy).toHaveBeenCalledOnce();
    const sentText: string = sendSpy.mock.calls[0]![0];
    expect(sentText).toContain(MY_HANDOFF_SUBSTRING);
    expect(sentText).not.toContain(SG_HANDOFF_SUBSTRING);
  });

  // -------------------------------------------------------------------------
  // Test 8b: fail-closed — resolver error, cached MY enforce, inbound CLEAN
  //          → scan-still-clean: submit IS called, no verdict, no send
  // -------------------------------------------------------------------------
  it("8b. fail-closed: resolver error + cached MY/nonMedical enforce + clean inbound → scan-still-clean, submit called, no verdict", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "error",
      error: new Error("Config store unavailable"),
    });

    // Seed posture cache with MY/nonMedical/enforce
    postureCache.remember("dep-1", {
      mode: "enforce",
      jurisdiction: "MY",
      clinicType: "nonMedical",
    });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    // MSG_CLEAN has no trigger match → scan-still-clean path → proceed
    await gw.handleIncoming(MSG_CLEAN, { send: sendSpy });

    // Submit IS called — text is clean
    expect(submitSpy).toHaveBeenCalled();
    // No verdict persisted
    expect(verdictStore.save).not.toHaveBeenCalled();
    // No status flip
    expect(statusSetter.setConversationStatus).not.toHaveBeenCalled();
    // AI reply sent (not handoff text)
    expect(sendSpy).toHaveBeenCalledWith("Hello from agent");
  });

  // -------------------------------------------------------------------------
  // Test 9: verdictStore.save throws in enforce → block still applied
  // -------------------------------------------------------------------------
  it("9. verdictStore.save throws in enforce → submit still NOT called, send still called, status still flipped", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "enforce" },
      },
    });

    const throwingVerdictStore = {
      save: vi.fn().mockRejectedValue(new Error("Verdict store connection lost")),
      listByConversation: vi.fn(),
      listByDeployment: vi.fn(),
    };

    const config = makeGatewayConfig(
      {
        resolver,
        verdictStore: throwingVerdictStore,
        postureCache,
        handoffStore,
        statusSetter,
      },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    // Should NOT throw — errors logged internally
    await expect(gw.handleIncoming(MSG_TRIGGER, { send: sendSpy })).resolves.toBeUndefined();

    // Block still applied
    expect(submitSpy).not.toHaveBeenCalled();
    // Handoff text still sent
    expect(sendSpy).toHaveBeenCalledOnce();
    const sentText: string = sendSpy.mock.calls[0]![0];
    expect(sentText).toContain(SG_HANDOFF_SUBSTRING);
    // Status still flipped
    expect(statusSetter.setConversationStatus).toHaveBeenCalledWith("sess-1", "human_override", {
      channel: "web_widget",
      principalId: "visitor-sess-1",
    });
    // Handoff still saved
    expect(handoffStore.save).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Test 10: first-message enforce upsert — setConversationStatus receives
  //           upsertContext with channel + principalId derived from sessionId
  // -------------------------------------------------------------------------
  it("10. enforce + match on first-message session → setConversationStatus called with upsertContext (channel + visitor-derived principalId)", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "enforce" },
      },
    });

    const config = makeGatewayConfig(
      { resolver, verdictStore, postureCache, handoffStore, statusSetter },
      { platformIngress: { submit: submitSpy } },
    );
    const gw = new ChannelGateway(config);

    // MSG_TRIGGER: channel="web_widget", sessionId="sess-1"
    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    // Submit must NOT be called (gate blocked)
    expect(submitSpy).not.toHaveBeenCalled();

    // setConversationStatus must be called with 3 arguments:
    //   sessionId, "human_override", { channel, principalId }
    // This is the contract the gateway adapter uses to upsert the row.
    expect(statusSetter.setConversationStatus).toHaveBeenCalledOnce();
    const [calledSessionId, calledStatus, calledCtx] = statusSetter.setConversationStatus.mock
      .calls[0] as [string, string, { channel: string; principalId: string } | undefined];
    expect(calledSessionId).toBe("sess-1");
    expect(calledStatus).toBe("human_override");
    // upsertContext must be present and correctly derived
    expect(calledCtx).not.toBeUndefined();
    expect(calledCtx!.channel).toBe("web_widget");
    // principalId must match the visitor derivation from gateway-conversation-store
    expect(calledCtx!.principalId).toBe("visitor-sess-1");
  });

  // -------------------------------------------------------------------------
  // Test 11: second-inbound short-circuit — after status flipped on first
  //           message, second message is suppressed before gate runs.
  //
  //           Simulate two messages in the same session:
  //             1. First message triggers the gate → status set to human_override
  //             2. Second message is benign → getConversationStatus returns
  //                human_override → handleIncoming short-circuits at step 4b
  //                → submit NOT called again.
  // -------------------------------------------------------------------------
  it("11. second inbound short-circuits after first-message enforce flip — submit called exactly once", async () => {
    const resolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "medical",
        deterministicGate: { mode: "enforce" },
      },
    });

    // Track which status is "stored" so the second-message check reflects the flip.
    let storedStatus: string | null = null;
    const trackingStatusSetter: StatusSetterSpy = {
      setConversationStatus: vi.fn().mockImplementation(async (_sid: string, status: string) => {
        storedStatus = status;
      }),
    };

    // conversationStore.getConversationStatus returns storedStatus after the flip.
    const trackingConversationStore = {
      getOrCreateBySession: vi.fn().mockResolvedValue({
        conversationId: "conv-1",
        messages: [],
      }),
      addMessage: vi.fn().mockResolvedValue(undefined),
      getConversationStatus: vi.fn().mockImplementation(async () => storedStatus),
    };

    const config = makeGatewayConfig(
      {
        resolver,
        verdictStore,
        postureCache,
        handoffStore,
        statusSetter: trackingStatusSetter,
      },
      {
        conversationStore: trackingConversationStore,
        platformIngress: { submit: submitSpy },
      },
    );
    const gw = new ChannelGateway(config);

    // First message: triggers the gate → status flipped to human_override
    await gw.handleIncoming(MSG_TRIGGER, { send: sendSpy });

    // Submit must NOT have been called on the first message (gate blocked it)
    expect(submitSpy).not.toHaveBeenCalled();
    // Status was flipped
    expect(trackingStatusSetter.setConversationStatus).toHaveBeenCalledOnce();
    expect(storedStatus).toBe("human_override");

    // Second message: clean, but status is now human_override → short-circuit at 4b
    const sendSpy2 = vi.fn().mockResolvedValue(undefined);
    await gw.handleIncoming(MSG_CLEAN, { send: sendSpy2 });

    // Submit still NOT called — second message suppressed
    expect(submitSpy).not.toHaveBeenCalled();
    // Second send was not called (no reply sent for suppressed message)
    expect(sendSpy2).not.toHaveBeenCalled();
  });
});
