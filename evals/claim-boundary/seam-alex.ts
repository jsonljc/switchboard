import type Anthropic from "@anthropic-ai/sdk";
import { runConversation, type ExecutorLike } from "../alex-conversation/run-conversation.js";
import type { ConversationFixture } from "../alex-conversation/schema.js";
import type { AgentClaimOutput } from "./grade-claim.js";

/**
 * The classifier-OFF leg (today's production reality: the claim classifier ships
 * `off`/`observe`, so the PROMPT alone is the claim boundary). The bait payload IS
 * the inbound customer message; we build a single-turn Alex `ConversationFixture`
 * and drive the REAL Alex conversation loop with NO governance hooks — exactly the
 * ungoverned path a lead hits today. The grader then asserts Alex's reply did not
 * assert a prohibited claim (it refused / hedged / deferred to the doctor).
 */
export function buildClaimFixture(payload: string, id: string): ConversationFixture {
  return {
    id: `claim-${id}`,
    vertical: "medspa",
    locale: "sg",
    scenario: "claim-boundary:off",
    businessFacts: "operator",
    turns: [
      { role: "lead", content: payload },
      { role: "alex", grade: { mustAsk: [], mustDo: [], mustNot: [], shouldDo: [] } },
    ],
  };
}

export interface RunClaimCaseDeps {
  /** Live Anthropic client (the key-gated live OFF leg). */
  anthropicClient?: Anthropic;
  /** Model id for the live leg. Defaults to the harness default (claude-sonnet-4-6). */
  model?: string;
  /** Injected fake executor (offline teeth path; no Anthropic client, no hooks). */
  executor?: ExecutorLike;
}

/**
 * Drive Alex over one claim-bait payload (classifier OFF) and normalize for the
 * grader. Any throw is captured as `crashed: true` rather than aborting the run —
 * a crash on a claim-bait input is itself a grader violation (graceful
 * degradation). NO hooks are wired: this is the ungoverned, prompt-only path.
 */
export async function runClaimCaseOff(
  payload: string,
  id: string,
  deps: RunClaimCaseDeps,
): Promise<AgentClaimOutput> {
  const fixture = buildClaimFixture(payload, id);
  try {
    const outcome = await runConversation(fixture, {
      executor: deps.executor,
      anthropicClient: deps.anthropicClient,
      model: deps.model,
    });
    const responseText = outcome.alexTurns
      .map((t) => t.alexResponse)
      .join("\n")
      .trim();
    return { responseText, crashed: false };
  } catch {
    return { responseText: "", crashed: true };
  }
}
