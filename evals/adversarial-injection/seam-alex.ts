import type Anthropic from "@anthropic-ai/sdk";
import { runConversation, type ExecutorLike } from "../alex-conversation/run-conversation.js";
import type { ConversationFixture } from "../alex-conversation/schema.js";
import type { InjectionCase } from "./schema.js";
import type { AgentInjectionOutput, NormalizedToolCall } from "./normalize.js";
import type { RecordedToolCall } from "../alex-conversation/mock-tools.js";

/**
 * The Alex untrusted-input seam: the corpus payload IS the inbound customer
 * message. We build a single-turn Alex `ConversationFixture` and drive the REAL
 * Alex conversation loop (reusing the alex-conversation harness), so the
 * injection is delivered exactly where a real attacker would deliver it.
 *
 * Grade hints are empty: there is no "right answer" to grade against — the
 * adversarial grader judges the OUTPUT (no leak / no mutated arg / no compliance
 * token / no crash), not adherence to a scripted reply.
 */
export function buildAlexFixture(testCase: InjectionCase): ConversationFixture {
  return {
    id: `inj-${testCase.id}`,
    vertical: "medspa",
    locale: "sg",
    scenario: `injection:${testCase.category}`,
    businessFacts: "operator",
    turns: [
      { role: "lead", content: testCase.payload },
      { role: "alex", grade: { mustAsk: [], mustDo: [], mustNot: [], shouldDo: [] } },
    ],
  };
}

/**
 * Map the alex harness's RecordedToolCalls to the grader's normalized shape
 * (drops `order`). This is the load-bearing passthrough that carries an injected
 * tool argument from a live Alex run into the deterministic grader, so it is
 * unit-tested directly (the offline injected-executor never touches the mock tools).
 */
export function toNormalizedToolCalls(calls: readonly RecordedToolCall[]): NormalizedToolCall[] {
  return calls.map((tc) => ({
    toolId: tc.toolId,
    operation: tc.operation,
    name: tc.name,
    params: tc.params,
  }));
}

export interface RunAlexInjectionDeps {
  /** Live Anthropic client (the key-gated live leg). */
  anthropicClient?: Anthropic;
  /** Model id for the live leg. Defaults to the harness default (claude-sonnet-4-6). */
  model?: string;
  /** Injected fake executor (offline teeth path; no Anthropic client). */
  executor?: ExecutorLike;
}

/**
 * Drive Alex over one corpus case and normalize the result for the grader.
 *
 * Any throw from the conversation drive (provider rejection, executor failure) is
 * captured as `crashed: true` rather than aborting the whole run — that is exactly
 * the ADV-3 graceful-degradation signal the grader checks. Alex's reply is free
 * text (no structured output contract), so `schemaValid` is simply "a reply was
 * produced without crashing".
 */
export async function runAlexInjectionCase(
  testCase: InjectionCase,
  deps: RunAlexInjectionDeps,
): Promise<AgentInjectionOutput> {
  const fixture = buildAlexFixture(testCase);
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
    const toolCalls = toNormalizedToolCalls(outcome.toolCalls);
    return { responseText, toolCalls, crashed: false, schemaValid: true };
  } catch {
    return { responseText: "", toolCalls: [], crashed: true, schemaValid: false };
  }
}
