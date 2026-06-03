import { describe, it, expect } from "vitest";
import {
  SkillExecutorImpl,
  DeterministicSafetyGateHook,
  InMemoryGovernancePostureCache,
} from "@switchboard/core/skill-runtime";
import type { SkillDefinition, SkillExecutionResult } from "@switchboard/core/skill-runtime";

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
