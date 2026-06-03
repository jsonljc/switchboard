import { describe, it, expect } from "vitest";
import { ModelRouter } from "@switchboard/core";
import {
  SkillExecutorImpl,
  loadSkill,
  AnthropicToolAdapter,
} from "@switchboard/core/skill-runtime";
import type { SkillTool } from "@switchboard/core/skill-runtime";
import { defaultSkillsDir, resolveParameters } from "../run-conversation.js";
import { createMockTools } from "../mock-tools.js";
import type { ConversationFixture } from "../schema.js";

// `ToolCallingLLMAdapter` / `LLMResponse` are not re-exported from
// `@switchboard/core/skill-runtime`; derive the shapes structurally from the
// exported `AnthropicToolAdapter` (same convention as temp0-adapter.ts). An
// object with this one `chatWithTools` method is assignable to the executor's
// private adapter interface.
type ChatWithToolsParams = Parameters<AnthropicToolAdapter["chatWithTools"]>[0];
type ChatWithToolsResult = ReturnType<AnthropicToolAdapter["chatWithTools"]>;
interface RecordingAdapter {
  chatWithTools(params: ChatWithToolsParams): ChatWithToolsResult;
}

/**
 * Router-ON tier visibility (T2.9). The model-tier mis-key lived in
 * `resolveProfile`'s `turnCount - 1 -> messageIndex` mapping — a defect a raw
 * `resolveTier` unit test cannot reach. This drives the FULL `SkillExecutorImpl`
 * with the router ON and a fake recording adapter (offline, deterministic) that
 * captures `params.profile?.model` per LLM call.
 *
 * Before the depth re-key (B1/B2), the deep-neutral case below routed to Haiku
 * (`messageIndex === 0` on every first call). After the re-key it routes to
 * Sonnet — this is the test that catches a silent Haiku downgrade. The fear /
 * objection cases are rescued by `currentStage` and pin the high-stakes path
 * (they pass before and after the re-key).
 */

/** Records the profile.model the executor resolved for each LLM call. */
function recordingAdapter(seen: Array<string | undefined>): RecordingAdapter {
  return {
    async chatWithTools(p: ChatWithToolsParams): Promise<Awaited<ChatWithToolsResult>> {
      seen.push(p.profile?.model);
      return {
        content: [{ type: "text", text: "ok" }],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

/** A minimal medspa fixture whose only role here is to resolve Alex's real, valid
 *  runtime parameters offline (the turns are NOT used — each test supplies its own
 *  `messages`). */
const FIXTURE: ConversationFixture = {
  id: "router-tier",
  vertical: "medspa",
  locale: "sg",
  scenario: "router-tier visibility",
  businessFacts: "operator",
  turns: [
    { role: "lead", content: "hi" },
    { role: "alex", grade: { mustAsk: [], mustDo: [], mustNot: [], shouldDo: [] } },
  ],
};

/** Build a real-Alex executor (router ON) + its resolved parameters, fully offline.
 *  Uses the production skill (real `skill.tools` = the declared ids) and the
 *  harness mock-tool map (same ids + an external_mutation op so `hasHighRiskTools`
 *  is true and `toolCount > 0`). */
async function alexExecutor(seen: Array<string | undefined>): Promise<{
  skill: Awaited<ReturnType<typeof loadSkill>>;
  parameters: Record<string, unknown>;
  exec: SkillExecutorImpl;
  tools: Map<string, SkillTool>;
}> {
  const skill = loadSkill("alex", defaultSkillsDir());
  const parameters = await resolveParameters(skill, FIXTURE);
  const { tools } = createMockTools();
  const exec = new SkillExecutorImpl(recordingAdapter(seen), tools, new ModelRouter(), []);
  return { skill, parameters, exec, tools };
}

/** `count` alternating user/assistant messages; the FINAL user message is
 *  neutral — no price/trust/timing/fear/comparison keyword and no ready-now
 *  phrasing — so `classifyEmotionalSignal` yields no stage. Proves the
 *  conversation-DEPTH re-key (not the stage-raise) routes a deep turn to Sonnet. */
function deepNeutral(count: number): Array<{ role: "user" | "assistant"; content: string }> {
  const msgs: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < count - 1; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: i % 2 === 0 ? "Tell me more about the treatment." : "Here is more detail.",
    });
  }
  msgs.push({ role: "user", content: "ok, and what would the next step look like for me?" });
  return msgs;
}

const BASE = {
  deploymentId: "d",
  orgId: "o",
  trustScore: 100,
  trustLevel: "autonomous" as const,
  sessionId: "s",
};

describe("router-ON tier (T2.9 visibility)", () => {
  it("does NOT silently downgrade a deep neutral sales turn to Haiku", async () => {
    const seen: Array<string | undefined> = [];
    const { skill, parameters, exec } = await alexExecutor(seen);
    await exec.execute({ skill, parameters, messages: deepNeutral(8), ...BASE });
    expect(seen[0]).not.toBe("claude-haiku-4-5-20251001");
    expect(seen[0]).toBe("claude-sonnet-4-6");
  });

  it("routes an explicit fear turn to Opus", async () => {
    const seen: Array<string | undefined> = [];
    const { skill, parameters, exec } = await alexExecutor(seen);
    await exec.execute({
      skill,
      parameters,
      messages: [
        { role: "user", content: "do you do laser hair removal?" },
        { role: "assistant", content: "Yes, we do." },
        { role: "user", content: "honestly i'm a bit nervous, will this hurt at all?" },
      ],
      ...BASE,
    });
    expect(seen[0]).toBe("claude-opus-4-6");
  });

  it("routes an objection turn to Sonnet", async () => {
    const seen: Array<string | undefined> = [];
    const { skill, parameters, exec } = await alexExecutor(seen);
    await exec.execute({
      skill,
      parameters,
      messages: [
        { role: "user", content: "do you do laser hair removal?" },
        { role: "assistant", content: "Yes, we do." },
        { role: "user", content: "this feels expensive compared to the place down the road" },
      ],
      ...BASE,
    });
    expect(seen[0]).toBe("claude-sonnet-4-6");
  });
});
