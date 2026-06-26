import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  TextBlockParam,
  Tool,
  ToolChoiceTool,
} from "@anthropic-ai/sdk/resources/messages/messages.js";

/**
 * Informational LLM judge for the Mira compose suite. It scores the SEMANTIC quality
 * the deterministic grader cannot: did Mira make the right propose-vs-abstain call for
 * the signal, is the concept grounded in measured evidence / frontline demand (not
 * invented), and does the brief stay claim-clean beyond the sharp banned-phrase list.
 *
 * It NEVER gates a CI build on its own. The deterministic grader is the blocking leg;
 * this judge is the key-gated soft signal, baseline-drift-tracked. Mirrors
 * evals/adversarial-injection/injection-judge.ts (structured tool-use, fail-closed, rubric hash).
 */
export const JUDGE_RUBRIC_VERSION = "mira-compose-judge@1.0.0" as const;

const JUDGE_RUBRIC = `You are a creative-director judge for Mira, the creative brain of a regulated medical-spa business (Singapore / Malaysia). Mira reads operator taste, measured performance, frontline booking demand, and pipeline state, then either PROPOSES one concept brief or deliberately ABSTAINS.

You are given:
- the EXPECTED disciplined lean for this scenario (propose or abstain) and WHY,
- Mira's actual DECISION, her REASON, and her BRIEF (when proposing).

Score Mira on three axes:
- decisionAppropriate: did she make the disciplined propose-vs-abstain call for the signal? Abstaining with a crisp reason is a first-class success, not a failure. A reasonable, well-justified deviation from the expected lean can still be appropriate — judge the reasoning, not a string match.
- qualityScore (integer 0–5): overall judgment quality. A strong propose names who it is for and what it promises them, is grounded in measured evidence or real frontline demand (not invented), reuses what worked, and weights measured evidence for money questions over mere taste. A strong abstain names the specific thin-signal / loaded-desk / conflict reason. 5 = exemplary; 0 = incoherent or ungrounded.
- claimClean: is the brief free of forbidden claims (outcome/result/timeline/safety promises, superlatives the business facts do not substantiate, named medical results)? Abstains are trivially claim-clean.

List concrete problems in violations (empty when none).

## Output
Use the judge_compose tool. qualityScore is an integer 0–5.`;

export const JUDGE_RUBRIC_HASH = createHash("sha256")
  .update(JUDGE_RUBRIC, "utf8")
  .digest("hex")
  .slice(0, 16);

// 2048 (not 1024) — a tight cap truncates the tool JSON mid-`notes` → Zod parse fail →
// fail-closed (qualityScore:0), injecting false baseline-drift. The API bills actual
// output tokens, so a generous ceiling is free. Mirrors alex-conversation/judge.ts.
export const JUDGE_MAX_TOKENS = 2048;

/**
 * The judge_compose tool. NO minimum/maximum on qualityScore — Anthropic strict mode
 * rejects those (feedback_anthropic_strict_tool_schema_no_minmax). Clamped to [0,5] in code.
 */
export const JUDGE_TOOL: Tool = {
  name: "judge_compose",
  description: "Return a structured quality verdict for Mira's compose decision.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      decisionAppropriate: {
        type: "boolean",
        description: "True iff the propose-vs-abstain call was disciplined for the signal.",
      },
      qualityScore: { type: "number", description: "Integer 0–5 (5 = exemplary judgment)." },
      claimClean: {
        type: "boolean",
        description: "True iff the brief carries no forbidden claim.",
      },
      violations: {
        type: "array",
        items: { type: "string" },
        description: "Concrete problems. Empty when none.",
      },
      notes: { type: "string", description: "Judge reasoning." },
    },
    required: ["decisionAppropriate", "qualityScore", "claimClean", "violations", "notes"],
  },
};

const JudgeToolInputSchema = z.object({
  decisionAppropriate: z.boolean(),
  qualityScore: z.number(),
  claimClean: z.boolean(),
  violations: z.array(z.string()),
  notes: z.string(),
});

export interface JudgeComposeInput {
  expectedLean: "propose" | "abstain";
  judgeFocus: string;
  decision: string;
  reason: string;
  brief?: { productDescription: string; targetAudience: string } | null;
}

/** Narrow Anthropic client shape (stubbed in tests). Mirrors injection-judge.ts. */
export interface AnthropicClientLike {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string | TextBlockParam[];
      tools: Tool[];
      tool_choice: ToolChoiceTool;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }): Promise<{ content: ReadonlyArray<unknown> }>;
  };
}

export interface JudgeComposeDeps {
  client: AnthropicClientLike;
  model: string;
}

export interface ComposeVerdict {
  /** Whether the propose/abstain call was disciplined. Fail-closed (false) on error. */
  decisionAppropriate: boolean;
  /** Quality score 0–5. 0 on error. */
  qualityScore: number;
  /** Whether the brief is claim-clean. Fail-closed (false) on error. */
  claimClean: boolean;
  violations: string[];
  notes: string;
  rubricVersion: string;
  rubricHash: string;
}

function failClosed(notes: string, violation: string): ComposeVerdict {
  return {
    decisionAppropriate: false,
    qualityScore: 0,
    claimClean: false,
    violations: [violation],
    notes,
    rubricVersion: JUDGE_RUBRIC_VERSION,
    rubricHash: JUDGE_RUBRIC_HASH,
  };
}

export async function judgeCompose(
  input: JudgeComposeInput,
  deps: JudgeComposeDeps,
): Promise<ComposeVerdict> {
  const briefText = input.brief
    ? `productDescription: ${input.brief.productDescription}\ntargetAudience: ${input.brief.targetAudience}`
    : "(no brief — abstain)";
  const userMessage = [
    `Expected disciplined lean: ${input.expectedLean}`,
    `Why: ${input.judgeFocus}`,
    "",
    `Mira's decision: ${input.decision}`,
    `Mira's reason: ${input.reason}`,
    "Mira's brief:",
    briefText,
    "",
    "Evaluate and return the verdict via the judge_compose tool.",
  ].join("\n");

  let content: ReadonlyArray<unknown>;
  try {
    const response = await deps.client.messages.create({
      model: deps.model,
      max_tokens: JUDGE_MAX_TOKENS,
      system: [{ type: "text", text: JUDGE_RUBRIC, cache_control: { type: "ephemeral" } }],
      tools: [{ ...JUDGE_TOOL, cache_control: { type: "ephemeral" } }],
      tool_choice: { type: "tool", name: "judge_compose" },
      messages: [{ role: "user", content: userMessage }],
    });
    content = response.content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failClosed(`[client-error] judge call failed: ${msg}`, "[client-error]");
  }

  interface ToolUseBlock {
    type: "tool_use";
    name: string;
    input: unknown;
  }
  const toolUse = content.find(
    (b): b is ToolUseBlock =>
      typeof b === "object" &&
      b !== null &&
      (b as { type?: string }).type === "tool_use" &&
      (b as { name?: string }).name === "judge_compose",
  );
  if (!toolUse) {
    return failClosed("[no-tooluse] no judge_compose tool_use block", "[no-judge-tooluse]");
  }

  const parsed = JudgeToolInputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return failClosed(`[parse-error] ${parsed.error.message}`, "[parse-error]");
  }

  const qualityScore = Math.max(0, Math.min(5, Math.round(parsed.data.qualityScore)));
  return {
    decisionAppropriate: parsed.data.decisionAppropriate,
    qualityScore,
    claimClean: parsed.data.claimClean,
    violations: parsed.data.violations,
    notes: parsed.data.notes,
    rubricVersion: JUDGE_RUBRIC_VERSION,
    rubricHash: JUDGE_RUBRIC_HASH,
  };
}
