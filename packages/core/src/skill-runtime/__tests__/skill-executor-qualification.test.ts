// Reuses createMockAdapter() + SkillExecutorImpl from skill-executor.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { describe, it, expect, vi } from "vitest";
import { SkillExecutorImpl } from "../skill-executor.js";
import type { ToolCallingLLMAdapter } from "../llm-types.js";
import type { SkillDefinition } from "../types.js";

const mockSkill: SkillDefinition = {
  name: "alex-medspa",
  slug: "alex-medspa",
  version: "1.0.0",
  description: "medspa qualification skill",
  author: "test",
  parameters: [],
  tools: [],
  body: "You are Alex.",
  context: [],
};

const validJson = JSON.stringify({
  treatmentInterest: "HIFU",
  preferredTimeWindow: null,
  serviceableMarket: "SG",
  buyingIntent: "strong",
  budgetAcknowledged: null,
  explicitDecline: false,
  disqualifierCandidates: [],
});

function createMockAdapter(
  responses: Array<{
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    stop_reason: string;
  }>,
): ToolCallingLLMAdapter {
  let callIndex = 0;
  return {
    chatWithTools: vi.fn().mockImplementation(() => {
      const resp = responses[callIndex]!;
      callIndex++;
      return Promise.resolve({
        content: resp.content,
        stopReason: resp.stop_reason,
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    }),
  };
}

const BASE_EXECUTE_PARAMS = {
  skill: mockSkill,
  parameters: {},
  messages: [{ role: "user" as const, content: "Tell me about HIFU" }],
  deploymentId: "d1",
  orgId: "org1",
  trustScore: 50,
  trustLevel: "guided" as const,
};

describe("SkillExecutorImpl — qualification sidecar (Phase 3b)", () => {
  it("valid sidecar → strips block, sets result.qualificationSignals, trace.qualificationSignals=ok", async () => {
    const rawLlm = `Sure!\n\n<qualification_signals>${validJson}</qualification_signals>`;
    const adapter = createMockAdapter([
      { content: [{ type: "text", text: rawLlm }], stop_reason: "end_turn" },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map());
    const result = await executor.execute(BASE_EXECUTE_PARAMS);

    expect(result.response).toBe("Sure!");
    expect(result.qualificationSignals?.treatmentInterest).toBe("HIFU");
    expect(result.trace.qualificationSignals).not.toBeNull();
    expect(result.trace.qualificationSignals?.validationStatus).toBe("ok");
    if (result.trace.qualificationSignals?.validationStatus === "ok") {
      expect(result.trace.qualificationSignals.payload.treatmentInterest).toBe("HIFU");
      expect(result.trace.qualificationSignals.payload.buyingIntent).toBe("strong");
    }
  });

  it("malformed sidecar → strips block, result.qualificationSignals undefined, trace=malformed_json", async () => {
    const rawLlm = `Sure!\n\n<qualification_signals>{not-valid-json}</qualification_signals>`;
    const adapter = createMockAdapter([
      { content: [{ type: "text", text: rawLlm }], stop_reason: "end_turn" },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map());
    const result = await executor.execute(BASE_EXECUTE_PARAMS);

    expect(result.response).toBe("Sure!");
    expect(result.qualificationSignals).toBeUndefined();
    expect(result.trace.qualificationSignals?.validationStatus).toBe("malformed_json");
    if (result.trace.qualificationSignals?.validationStatus === "malformed_json") {
      expect(result.trace.qualificationSignals.raw).toContain("not-valid-json");
    }
  });

  it("no sidecar → response unchanged, result.qualificationSignals undefined, trace.qualificationSignals=null", async () => {
    const rawLlm = "Sure, weekday evenings work.";
    const adapter = createMockAdapter([
      { content: [{ type: "text", text: rawLlm }], stop_reason: "end_turn" },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map());
    const result = await executor.execute(BASE_EXECUTE_PARAMS);

    expect(result.response).toBe("Sure, weekday evenings work.");
    expect(result.qualificationSignals).toBeUndefined();
    expect(result.trace.qualificationSignals).toBeNull();
  });

  it("always-on (no qualification config): valid sidecar is stripped + trace is non-null", async () => {
    // Spec §7.1 — parse + strip + persist ALWAYS run regardless of lifecycle config.
    // This executor is constructed with NO hooks, NO lifecycle config — and sidecar
    // must still be stripped from result.response and trace must be non-null.
    const rawLlm = `Hello!\n\n<qualification_signals>${validJson}</qualification_signals>`;
    const adapter = createMockAdapter([
      { content: [{ type: "text", text: rawLlm }], stop_reason: "end_turn" },
    ]);

    const executor = new SkillExecutorImpl(adapter, new Map());
    const result = await executor.execute(BASE_EXECUTE_PARAMS);

    // Block must be stripped — no tag leakage to contact.
    expect(result.response).not.toContain("<qualification_signals>");
    expect(result.response).not.toContain("</qualification_signals>");
    // Trace must carry persisted sidecar even without qualification config.
    expect(result.trace.qualificationSignals).not.toBeNull();
    expect(result.trace.qualificationSignals?.validationStatus).toBe("ok");
  });
});
