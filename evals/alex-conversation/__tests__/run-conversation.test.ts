import { describe, it, expect } from "vitest";
import type { SkillExecutionParams, SkillExecutionResult } from "@switchboard/core/skill-runtime";
import { runConversation, type ExecutorLike } from "../run-conversation.js";
import { createStubContextStore } from "../stub-context-store.js";
import { createTemp0AdapterFromInner, type Temp0Adapter } from "../temp0-adapter.js";
import type { ConversationFixture } from "../schema.js";

function makeResult(response: string): SkillExecutionResult {
  return {
    response,
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    trace: {
      durationMs: 0,
      turnCount: 1,
      status: "success",
      responseSummary: response.slice(0, 500),
      writeCount: 0,
      governanceDecisions: [],
      qualificationSignals: null,
    },
  };
}

const EMPTY_GRADE = { mustAsk: [], mustDo: [], mustNot: [], shouldDo: [] };

const TWO_TURN_FIXTURE: ConversationFixture = {
  id: "drive-test",
  vertical: "medspa",
  locale: "sg",
  scenario: "two alex turns",
  businessFacts: "operator",
  turns: [
    { role: "lead", content: "hi, do you do laser?" },
    { role: "alex", grade: EMPTY_GRADE },
    { role: "lead", content: "next week works" },
    { role: "alex", grade: EMPTY_GRADE },
  ],
};

describe("runConversation drive logic", () => {
  it("captures one turn per alex turn and carries Alex's prior reply forward", async () => {
    const seenMessages: Array<SkillExecutionParams["messages"]> = [];

    // Fake executor: reply derived from the count of user messages it sees, so we
    // can prove the conversation grows turn-over-turn. Records the messages it
    // received each call to assert carry-forward.
    const fakeExecutor: ExecutorLike = {
      execute: async (params: SkillExecutionParams): Promise<SkillExecutionResult> => {
        seenMessages.push(params.messages);
        const userCount = params.messages.filter((m) => m.role === "user").length;
        return makeResult(`reply-${userCount}`);
      },
    };

    const out = await runConversation(TWO_TURN_FIXTURE, { executor: fakeExecutor });

    // Two alex turns -> two captured turns, with the right grade indices (1, 3).
    expect(out.alexTurns).toHaveLength(2);
    expect(out.alexTurns.map((t) => t.gradeIndex)).toEqual([1, 3]);
    expect(out.alexTurns.map((t) => t.alexResponse)).toEqual(["reply-1", "reply-2"]);

    // First execute saw exactly the first lead message.
    expect(seenMessages[0]).toEqual([{ role: "user", content: "hi, do you do laser?" }]);

    // Second execute saw: lead-1, Alex's carried reply, lead-2 — in order.
    expect(seenMessages[1]).toEqual([
      { role: "user", content: "hi, do you do laser?" },
      { role: "assistant", content: "reply-1" },
      { role: "user", content: "next week works" },
    ]);
  });

  it("snapshots messages per call (later mutation does not retroactively change a captured turn)", async () => {
    // Guards the `[...messages]` copy: the executor must receive an independent
    // array each turn, not a shared reference mutated after the call.
    const fakeExecutor: ExecutorLike = {
      execute: async (params: SkillExecutionParams): Promise<SkillExecutionResult> =>
        makeResult(`len-${params.messages.length}`),
    };
    const out = await runConversation(TWO_TURN_FIXTURE, { executor: fakeExecutor });
    // First turn: 1 message. Second turn: 3 messages (lead, assistant, lead).
    expect(out.alexTurns.map((t) => t.alexResponse)).toEqual(["len-1", "len-3"]);
  });
});

describe("createStubContextStore.findActive", () => {
  it("returns frontmatter-free real content for the three skill-pack scopes", async () => {
    const store = createStubContextStore();
    const rows = await store.findActive("eval-org", [
      { kind: "playbook", scope: "objection-handling" },
      { kind: "playbook", scope: "qualification-framework" },
      { kind: "policy", scope: "claim-boundaries" },
    ]);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // Frontmatter stripped: no leading --- and no YAML keys from the block.
      expect(row.content.startsWith("---")).toBe(false);
      expect(row.content).not.toMatch(/jurisdiction:/);
      expect(row.content).not.toMatch(/lastReviewedAt:/);
      expect(row.content.length).toBeGreaterThan(0);
    }

    const byScope = new Map(rows.map((r) => [r.scope, r.content]));
    expect(byScope.get("objection-handling")).toMatch(/Objection handling/i);
    expect(byScope.get("qualification-framework")).toMatch(/Qualification framework/i);
    expect(byScope.get("claim-boundaries")).toMatch(/Claim boundaries/i);
  });

  it("returns a benign stub row for the required non-pack scope policy/messaging-rules", async () => {
    const store = createStubContextStore();
    const rows = await store.findActive("eval-org", [{ kind: "policy", scope: "messaging-rules" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toMatch(/Messaging rules/i);
    expect(rows[0]!.content.startsWith("---")).toBe(false);
  });

  it("omits unknown scopes (resolver surfaces a missing required scope loudly)", async () => {
    const store = createStubContextStore();
    const rows = await store.findActive("eval-org", [
      { kind: "playbook", scope: "does-not-exist" },
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("createTemp0Adapter", () => {
  it("forces temperature:0 (plus model + maxTokens) onto the inner adapter call", async () => {
    let captured: Parameters<Temp0Adapter["chatWithTools"]>[0] | undefined;
    const fakeInner: Temp0Adapter = {
      chatWithTools: async (params) => {
        captured = params;
        return { content: [], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };

    const adapter = createTemp0AdapterFromInner(fakeInner, "test-model", 256, 12_345);
    await adapter.chatWithTools({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      // Executor would normally pass profile: undefined here; even if it passed
      // a profile, the wrapper must override it.
      profile: { model: "WRONG", maxTokens: 1, temperature: 0.9, timeoutMs: 1 },
    });

    expect(captured?.profile).toEqual({
      model: "test-model",
      maxTokens: 256,
      temperature: 0,
      timeoutMs: 12_345,
    });
    // Non-profile fields pass through untouched.
    expect(captured?.system).toBe("sys");
    expect(captured?.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
