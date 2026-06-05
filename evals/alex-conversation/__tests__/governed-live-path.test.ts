import { describe, it, expect } from "vitest";
import {
  SkillExecutorImpl,
  DeterministicSafetyGateHook,
  ClaimClassifierHook,
  PdpaConsentGateHook,
  WhatsAppWindowGateHook,
  InMemoryGovernancePostureCache,
} from "@switchboard/core/skill-runtime";
import type { SkillDefinition, SkillExecutionResult } from "@switchboard/core/skill-runtime";
import { buildObserveGovernanceConfig } from "@switchboard/schemas";

// Governance gates act by MUTATING result.response (block/rewrite/handoff), NOT by calling a
// tool — so the alex-conversation oracle (which keys on tool calls) cannot see them. This
// deterministic live-path test drives the REAL executor with the REAL DeterministicSafetyGateHook
// and asserts the gate fires THROUGH the executor's runAfterSkillHooks seam, and (the bite) that
// it does NOT fire when the gate is wired out. This is what reds the eval on a seam regression.

const BANNED_PHRASE = "guaranteed results";

const skill: SkillDefinition = {
  name: "alex-test",
  slug: "alex-test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [],
  tools: [],
  body: "You are Alex.",
  context: [],
};

// Stub adapter: one text reply containing the banned phrase, then end the turn.
function bannedReplyAdapter() {
  return {
    chatWithTools: async () => ({
      content: [{ type: "text" as const, text: `We deliver ${BANNED_PHRASE} for every client.` }],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 10, outputTokens: 8 },
    }),
  };
}

// Real DeterministicSafetyGateHook in ENFORCE mode with a single banned phrase. Stores are
// no-op fakes (we assert on result.response, not persistence). `as never` mirrors the deps
// convention in whatsapp-window-gate.test.ts (the store interfaces are not exported).
function enforceSafetyGate() {
  const deps = {
    governanceConfigResolver: async () => ({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "nonMedical",
        deterministicGate: { mode: "enforce" },
      },
    }),
    bannedPhraseLoader: () => [
      {
        id: "test-guarantee",
        category: "guarantee" as const,
        patterns: [BANNED_PHRASE],
        severity: "block" as const,
      },
    ],
    verdictStore: { save: async () => {} },
    handoffStore: { save: async () => {} },
    conversationStore: { setConversationStatus: async () => {} },
    postureCache: new InMemoryGovernancePostureCache(),
    clock: () => new Date("2026-06-04T00:00:00.000Z"),
  };
  return new DeterministicSafetyGateHook(deps as never);
}

const execParams = {
  skill,
  parameters: {},
  messages: [{ role: "user" as const, content: "Do your treatments work?" }],
  deploymentId: "eval-deployment",
  orgId: "eval-org",
  trustScore: 100,
  trustLevel: "autonomous" as const,
  sessionId: "eval-governed",
};

describe("governed live-path: afterSkill safety gate fires through the executor", () => {
  it("FIRES: with the gate wired, the banned phrase is replaced (handoff)", async () => {
    const executor = new SkillExecutorImpl(bannedReplyAdapter(), new Map(), undefined, [
      enforceSafetyGate(),
    ]);

    const result: SkillExecutionResult = await executor.execute(execParams);

    expect(result.response).not.toContain(BANNED_PHRASE);
  });

  it("BITES: with the gate wired out ([] hooks), the banned phrase survives", async () => {
    const executor = new SkillExecutorImpl(bannedReplyAdapter(), new Map(), undefined, []);

    const result: SkillExecutionResult = await executor.execute(execParams);

    expect(result.response).toContain(BANNED_PHRASE);
  });
});

// ---------- observe posture: all four gates, strictly log-only ----------
//
// Drives the REAL executor with the REAL four gates in production order
// (safety -> claim -> pdpa -> whatsapp) under the CANONICAL seeded posture
// (buildObserveGovernanceConfig, the same factory the medspa pilot seed uses),
// with every gate's trigger condition firing at once. Lead-safety contract:
// the reply must come back byte-identical, with verdicts recorded and zero
// handoffs/status writes. This is the test that reds if any observe path
// regresses into mutating lead-visible state.

const OBSERVE_CONFIG = buildObserveGovernanceConfig({
  jurisdiction: "SG",
  clinicType: "medical",
});

const CLAIM_SENTENCE = "This treatment will cure your acne for good.";
const OBSERVE_REPLY = `We deliver ${BANNED_PHRASE} for every client. ${CLAIM_SENTENCE}`;

function observeReplyAdapter() {
  return {
    chatWithTools: async () => ({
      content: [{ type: "text" as const, text: OBSERVE_REPLY }],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 10, outputTokens: 8 },
    }),
  };
}

type SavedVerdict = { sourceGuard: string; action: string; auditLevel: string };

function buildObserveGates() {
  const verdicts: SavedVerdict[] = [];
  const verdictStore = {
    save: async (v: SavedVerdict) => {
      verdicts.push(v);
      return {};
    },
  };
  const handoffSaves: unknown[] = [];
  const handoffStore = {
    save: async (h: unknown) => {
      handoffSaves.push(h);
    },
  };
  const statusWrites: unknown[] = [];
  const conversationStore = {
    setConversationStatus: async (...args: unknown[]) => {
      statusWrites.push(args);
    },
  };
  const resolver = async () => ({ status: "resolved" as const, config: OBSERVE_CONFIG });
  const clock = () => new Date("2026-06-04T12:00:00.000Z");

  const safety = new DeterministicSafetyGateHook({
    governanceConfigResolver: resolver,
    bannedPhraseLoader: () => [
      {
        id: "test-guarantee",
        category: "guarantee" as const,
        patterns: [BANNED_PHRASE],
        severity: "block" as const,
      },
    ],
    verdictStore,
    handoffStore,
    conversationStore,
    postureCache: new InMemoryGovernancePostureCache(),
    clock,
  } as never);

  const claim = new ClaimClassifierHook({
    governanceConfigResolver: resolver,
    postureCache: new InMemoryGovernancePostureCache(),
    classifier: {
      classify: async ({ sentence, model }: { sentence: string; model: string }) => ({
        result: {
          sentence,
          claimType: sentence === CLAIM_SENTENCE ? ("medical-advice" as const) : ("none" as const),
          confidence: 0.95,
        },
        promptVersion: "claim-classifier@1.0.0",
        promptHash: "0123456789abcdef",
        schemaVersion: "1.0.0",
        model,
      }),
    },
    substantiationResolver: { resolve: async () => ({ status: "missing" as const }) },
    rewriteLoader: () => [],
    verdictStore,
    handoffStore,
    conversationStore,
    splitSentences: (text: string) => text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0),
    clock,
    renderHandoff: () => "handoff",
  } as never);

  const pdpa = new PdpaConsentGateHook({
    governanceConfigResolver: resolver,
    postureCache: new InMemoryGovernancePostureCache(),
    consentService: {
      attachToGovernedInteraction: async () => {},
      recordDisclosureShown: async () => {},
      recordGrant: async () => {},
      recordRevocation: async () => {},
      clearConsent: async () => {},
    },
    contactConsentReader: {
      // Revoked consent: the exact race enforce would block on.
      read: async () => ({
        pdpaJurisdiction: "SG" as const,
        consentGrantedAt: "2026-05-01T00:00:00.000Z",
        consentRevokedAt: "2026-05-20T00:00:00.000Z",
        consentSource: null,
        aiDisclosureVersionShown: null,
        aiDisclosureShownAt: null,
        consentUpdatedBy: null,
        consentNotes: null,
      }),
    },
    sessionContactResolver: async () => "contact-1",
    verdictStore,
    handoffStore,
    conversationStore,
    clock,
  } as never);

  const whatsapp = new WhatsAppWindowGateHook({
    verdictStore,
    handoffStore,
    governanceConfigResolver: resolver,
    postureCache: { lastKnown: () => undefined, remember: () => {} },
    threadStore: {
      // 25h ago: outside the 24h window.
      getLastWhatsAppInboundAt: async () => new Date("2026-06-03T11:00:00.000Z"),
    },
    contactStore: { getMessagingOptInForThread: async () => false },
    channelTypeResolver: { resolve: async () => "whatsapp" },
    clock,
  } as never);

  return { hooks: [safety, claim, pdpa, whatsapp], claim, verdicts, handoffSaves, statusWrites };
}

describe("governed live-path: observe posture is strictly log-only", () => {
  it("returns the reply byte-identical while recording verdicts, with zero handoffs/status writes", async () => {
    const { hooks, claim, verdicts, handoffSaves, statusWrites } = buildObserveGates();
    const executor = new SkillExecutorImpl(observeReplyAdapter(), new Map(), undefined, hooks);

    const result: SkillExecutionResult = await executor.execute({
      ...execParams,
      sessionId: "eval-observe",
    });
    await claim.flushObserveRuns();

    // Lead-safety: byte-identical reply even with every gate's trigger firing.
    expect(result.response).toBe(OBSERVE_REPLY);

    // Telemetry: every gate recorded its would-fire signal.
    const guards = verdicts.map((v) => v.sourceGuard);
    expect(guards).toContain("banned_phrase_scanner");
    expect(guards).toContain("claim_classifier");
    expect(guards).toContain("consent_gate");
    expect(guards).toContain("whatsapp_window");

    // Strictly log-only: nothing escalated, nothing rewritten, nobody handed off.
    expect(handoffSaves).toHaveLength(0);
    expect(statusWrites).toHaveLength(0);
  });
});
