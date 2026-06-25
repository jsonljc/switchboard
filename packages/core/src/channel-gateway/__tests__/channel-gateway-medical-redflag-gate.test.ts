/**
 * Medical red-flag slice 2: real-taxonomy tests for the pre-input gate.
 *
 * Unlike channel-gateway-deterministic-gate.test.ts (hand-built fixture
 * triggers), this suite drives ChannelGateway.handleIncoming with:
 *   - the REAL merged trigger taxonomy via loadEscalationTriggers, and
 *   - the REAL seeded pilot posture via buildObserveGovernanceConfig (the
 *     exact factory call packages/db/src/seed/medspa-governance-config.ts
 *     pins via its producer-parity test), so what is observed here is what
 *     the seed deploys.
 *
 * Acceptance proof: under the seeded observe posture the three new red-flag
 * categories are log-only (verdict allow/warning; submit proceeds with the
 * unchanged text; no handoff, no status flip, normal AI reply), and under a
 * future enforce posture they block with handoff reason "medical_safety".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildObserveGovernanceConfig } from "@switchboard/schemas";
import { ChannelGateway } from "../channel-gateway.js";
import type { ChannelGatewayConfig, IncomingChannelMessage } from "../types.js";
import { InMemoryGovernancePostureCache } from "../../governance/posture-cache.js";
import type { GovernanceConfigResolver } from "../../governance/governance-config-resolver.js";
import {
  loadEscalationTriggers,
  _resetEscalationTriggerCache,
} from "../../governance/escalation-triggers/index.js";
import type { SaveGovernanceVerdictInput } from "../../governance/governance-verdict-store/types.js";

const SG_HANDOFF_SUBSTRING = "I'll get them";

/**
 * The real seeded pilot posture (see packages/db/src/seed/medspa-governance-config.ts).
 * The SG/medical ARGUMENTS are themselves load-bearing: they mirror the seed's
 * arguments, and this suite (not the db parity test) is what reds if the two
 * ever diverge in jurisdiction/clinicType.
 */
const OBSERVE_PILOT_CONFIG = buildObserveGovernanceConfig({
  jurisdiction: "SG",
  clinicType: "medical",
});

const RED_FLAGS = [
  {
    name: "anticoagulant_use",
    text: "I'm on blood thinners, can I still get filler?",
  },
  {
    name: "suspicious_lesion",
    text: "I have a mole that's been getting darker, can laser remove it?",
  },
  {
    name: "recent_procedure",
    text: "I just had a facelift, is HIFU ok?",
  },
] as const;

function makeMessage(text: string): IncomingChannelMessage {
  return { channel: "web_widget", token: "tok", sessionId: "sess-1", text };
}

function makeDeps() {
  return {
    verdictStore: {
      save: vi.fn().mockResolvedValue({ id: "vr-1" }),
      listByConversation: vi.fn(),
      listByDeployment: vi.fn(),
      countByDeploymentAndClaim: vi.fn(),
      summarizeByDeployment: vi.fn(),
    },
    handoffStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn(),
      getBySessionId: vi.fn(),
      updateStatus: vi.fn(),
      listPending: vi.fn(),
    },
    statusSetter: { setConversationStatus: vi.fn().mockResolvedValue(undefined) },
    postureCache: new InMemoryGovernancePostureCache(),
    sendSpy: vi.fn().mockResolvedValue(undefined),
    submitSpy: vi.fn().mockResolvedValue({
      ok: true,
      result: { outcome: "completed", outputs: { response: "Hello from agent" }, summary: "ok" },
      workUnit: { id: "wu-1", traceId: "trace-1" },
    }),
  };
}

type Deps = ReturnType<typeof makeDeps>;

function makeConfig(resolver: GovernanceConfigResolver, deps: Deps): ChannelGatewayConfig {
  return {
    conversationStore: {
      getOrCreateBySession: vi.fn().mockResolvedValue({ conversationId: "conv-1", messages: [] }),
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
        inputConfig: {},
      }),
      resolveByDeploymentId: vi.fn(),
      resolveByOrgAndSlug: vi.fn(),
    },
    platformIngress: { submit: deps.submitSpy },
    approvalStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      updateState: vi.fn().mockResolvedValue(undefined),
      listPending: vi.fn().mockResolvedValue([]),
    },
    governanceConfigResolver: resolver,
    escalationTriggerLoader: (j: "SG" | "MY") => loadEscalationTriggers(j),
    verdictStore: deps.verdictStore,
    postureCache: deps.postureCache,
    handoffStore: deps.handoffStore,
    conversationStatusSetter: deps.statusSetter,
  };
}

function observeResolver(): GovernanceConfigResolver {
  return vi.fn().mockResolvedValue({ status: "resolved", config: OBSERVE_PILOT_CONFIG });
}

function enforceResolver(): GovernanceConfigResolver {
  return vi.fn().mockResolvedValue({
    status: "resolved",
    config: {
      ...OBSERVE_PILOT_CONFIG,
      deterministicGate: { mode: "enforce" },
    },
  });
}

describe("medical red-flag triggers through the real gate (seeded observe posture)", () => {
  let deps: Deps;

  beforeEach(() => {
    _resetEscalationTriggerCache();
    deps = makeDeps();
  });

  for (const flag of RED_FLAGS) {
    it(`${flag.name}: observe is log-only and lead-invisible`, async () => {
      const gw = new ChannelGateway(makeConfig(observeResolver(), deps));

      await gw.handleIncoming(makeMessage(flag.text), { send: deps.sendSpy });

      // Submit proceeds with the UNCHANGED inbound text (the gateway submits
      // the raw text as parameters.message, channel-gateway.ts step 7).
      expect(deps.submitSpy).toHaveBeenCalledOnce();
      const submitted = deps.submitSpy.mock.calls[0]![0];
      expect(submitted.parameters.message).toBe(flag.text);

      // Normal AI reply reaches the lead; no handoff text.
      expect(deps.sendSpy).toHaveBeenCalledWith("Hello from agent");

      // Verdict persisted log-only: allow/warning with the medical reason.
      expect(deps.verdictStore.save).toHaveBeenCalledOnce();
      const v = deps.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
      expect(v.action).toBe("allow");
      expect(v.auditLevel).toBe("warning");
      expect(v.reasonCode).toBe("medical_safety_trigger");
      expect(v.sourceGuard).toBe("escalation_trigger");
      expect(v.jurisdiction).toBe("SG");
      expect(v.details?.matchCategory).toBe(flag.name);

      // No handoff, no status flip: byte-identical lead experience.
      expect(deps.handoffStore.save).not.toHaveBeenCalled();
      expect(deps.statusSetter.setConversationStatus).not.toHaveBeenCalled();
    });
  }

  it("clean booking message under observe: no verdict at all", async () => {
    const gw = new ChannelGateway(makeConfig(observeResolver(), deps));
    await gw.handleIncoming(makeMessage("hello, I'd like to book an appointment"), {
      send: deps.sendSpy,
    });
    expect(deps.submitSpy).toHaveBeenCalledOnce();
    expect(deps.verdictStore.save).not.toHaveBeenCalled();
  });

  it("negated disclosure under observe: no verdict (real-taxonomy negation proof)", async () => {
    const gw = new ChannelGateway(makeConfig(observeResolver(), deps));
    await gw.handleIncoming(makeMessage("I'm not on blood thinners, just vitamins"), {
      send: deps.sendSpy,
    });
    expect(deps.submitSpy).toHaveBeenCalledOnce();
    expect(deps.verdictStore.save).not.toHaveBeenCalled();
  });
});

describe("medical red-flag triggers through the real gate (future enforce posture)", () => {
  let deps: Deps;

  beforeEach(() => {
    _resetEscalationTriggerCache();
    deps = makeDeps();
  });

  for (const flag of RED_FLAGS) {
    it(`${flag.name}: enforce blocks submit and hands off with reason medical_safety`, async () => {
      const gw = new ChannelGateway(makeConfig(enforceResolver(), deps));

      await gw.handleIncoming(makeMessage(flag.text), { send: deps.sendSpy });

      expect(deps.submitSpy).not.toHaveBeenCalled();
      // principalId is the bare sessionId (deliverable address), matching the
      // normal inbound path, not a "visitor-" prefix that would fail channel sends.
      expect(deps.statusSetter.setConversationStatus).toHaveBeenCalledWith(
        "sess-1",
        "human_override",
        { channel: "web_widget", principalId: "sess-1" },
      );
      expect(deps.handoffStore.save).toHaveBeenCalledOnce();
      expect(deps.handoffStore.save.mock.calls[0]![0].reason).toBe("medical_safety");
      expect(deps.sendSpy.mock.calls[0]![0]).toContain(SG_HANDOFF_SUBSTRING);

      const v = deps.verdictStore.save.mock.calls[0]![0] as SaveGovernanceVerdictInput;
      expect(v.action).toBe("escalate");
      expect(v.auditLevel).toBe("critical");
      expect(v.reasonCode).toBe("medical_safety_trigger");
    });
  }

  it("fail-closed cached-enforce path carries the medical handoff reason too", async () => {
    const erroringResolver: GovernanceConfigResolver = vi.fn().mockResolvedValue({
      status: "error",
      error: new Error("DB timeout"),
    });
    deps.postureCache.remember("dep-1", {
      mode: "enforce",
      jurisdiction: "SG",
      clinicType: "medical",
    });
    const gw = new ChannelGateway(makeConfig(erroringResolver, deps));

    await gw.handleIncoming(makeMessage(RED_FLAGS[0].text), { send: deps.sendSpy });

    expect(deps.submitSpy).not.toHaveBeenCalled();
    expect(deps.handoffStore.save).toHaveBeenCalledOnce();
    expect(deps.handoffStore.save.mock.calls[0]![0].reason).toBe("medical_safety");
  });
});
