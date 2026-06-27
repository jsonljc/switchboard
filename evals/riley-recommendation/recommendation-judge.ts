import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  TextBlockParam,
  Tool,
  ToolChoiceTool,
} from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { RileyCase } from "./schema.js";
import type { RileyDecision } from "./decide.js";

/**
 * Informational LLM judge for Riley's recommendation QUALITY (EV-7 / AGENT-7).
 *
 * Riley's decision engine (`decideForCampaign`) is deterministic and model-free, so the
 * blocking `run-eval.ts` lane already drives the REAL engine and pins every case's reduced
 * outcome. What no lane covers is JUDGMENT quality: would an independent reviewer, reading the
 * raw weekly campaign data, consider Riley's kill / scale / abstain call defensible? This judge
 * answers exactly that. It NEVER gates CI — the deterministic engine is the source of truth and
 * this is a key-gated soft signal (no baked baseline). Mirrors evals/adversarial-injection/
 * injection-judge.ts (structured tool-use, fail-closed, rubric hash).
 */
export const JUDGE_RUBRIC_VERSION = "riley-recommendation-judge@1.0.0" as const;

/** The three judgment buckets Riley's richer action vocabulary collapses to for the judge. */
export type RecommendationClass = "kill" | "scale" | "abstain" | "other";

const JUDGE_RUBRIC = `You are an independent media-buying reviewer auditing an automated ad-optimization agent ("Riley") that manages Meta ad campaigns for a medical-spa business in Singapore / Malaysia.

Riley is conservative by design. It:
- KILLS (pauses) a campaign that durably burns spend against its economic target (e.g. spend with no / far-too-few conversions over multiple periods),
- SCALES a proven winner (ROAS clearly above target, out of the learning phase, trustworthy measurement),
- otherwise ABSTAINS (watch / insight / no action) when the signal is thin, the campaign is still LEARNING, measurement is untrusted, or the case is marginal.

You are given the raw weekly campaign data and Riley's decision. Judge whether Riley's PRIMARY action is DEFENSIBLE from the data alone — not whether it is the single optimal move.

Map the data to one of: kill, scale, abstain.
- A conservative ABSTAIN on ambiguous / still-learning / untrusted-measurement data is defensible.
- Mark agreesWithRiley=false ONLY when Riley's action is clearly wrong for the data — e.g. SCALING a campaign burning spend at zero conversions, or KILLING a campaign that is clearly winning.

## Output
Use the judge_recommendation tool. judgedAction is the action YOU consider most defensible (kill / scale / abstain). soundness is an integer 0-5 (5 = Riley's call is clearly sound; 0 = clearly wrong). Put concrete reasoning in notes.`;

export const JUDGE_RUBRIC_HASH = createHash("sha256")
  .update(JUDGE_RUBRIC, "utf8")
  .digest("hex")
  .slice(0, 16);

// 2048 — matches the injection / alex-conversation judges: a tight cap truncates the tool JSON
// mid-notes -> parse fail -> fail-closed, which here would inject false disagreement. Output
// tokens are billed actual, so the generous ceiling is free.
export const JUDGE_MAX_TOKENS = 2048;

/**
 * The judge_recommendation tool. NO enum / minimum / maximum (Anthropic strict mode rejects
 * those — see project memory feedback_anthropic_strict_tool_schema_no_minmax). judgedAction is
 * normalised and soundness is clamped to [0,5] in code.
 */
export const JUDGE_TOOL: Tool = {
  name: "judge_recommendation",
  description: "Return a structured quality verdict on Riley's campaign recommendation.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      agreesWithRiley: {
        type: "boolean",
        description: "True iff Riley's primary action is defensible for the data.",
      },
      judgedAction: {
        type: "string",
        description: "The action you consider most defensible: kill, scale, or abstain.",
      },
      soundness: {
        type: "number",
        description: "Integer 0-5 (5 = Riley's call is clearly sound).",
      },
      notes: { type: "string", description: "Concrete reasoning citing the data." },
    },
    required: ["agreesWithRiley", "judgedAction", "soundness", "notes"],
  },
};

const JudgeToolInputSchema = z.object({
  agreesWithRiley: z.boolean(),
  judgedAction: z.string(),
  soundness: z.number(),
  notes: z.string(),
});

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

export interface JudgeRecommendationDeps {
  client: AnthropicClientLike;
  model: string;
}

export interface RecommendationVerdict {
  /** Whether the judge considers Riley's primary action defensible. False on any error. */
  agreesWithRiley: boolean;
  /** The judge's own most-defensible action bucket, or "error" on a client/parse failure. */
  judgedAction: RecommendationClass | "error";
  /** Soundness 0-5 (0 on error). */
  soundness: number;
  notes: string;
  rubricVersion: string;
  rubricHash: string;
}

/** Collapse Riley's reduced primary label into the judge's three buckets (+ other). */
export function classifyPrimary(primary: string): RecommendationClass {
  if (primary === "pause") return "kill";
  if (primary === "scale") return "scale";
  if (primary === "watch" || primary === "insight" || primary === "none") return "abstain";
  return "other";
}

/** Normalise the judge's free-text action onto a bucket; unknown -> "other". */
function normaliseJudgedAction(raw: string): RecommendationClass {
  const v = raw.trim().toLowerCase();
  if (v === "kill" || v === "pause" || v === "stop") return "kill";
  if (v === "scale" || v === "scale_up" || v === "increase") return "scale";
  if (v === "abstain" || v === "watch" || v === "insight" || v === "none" || v === "hold")
    return "abstain";
  return "other";
}

/**
 * A compact, judge-readable rendering of a fixture's RAW campaign data — the same inputs
 * decideForCampaign sees, never Riley's own labels (so the judge reasons from the data, not from
 * Riley's framing). Previous-period and the optional measurement-trust flag are included when set.
 */
export function buildCampaignSummary(c: RileyCase): string {
  const cur = c.current;
  const lines = [
    `Economic target: ${c.economicTier} tier, effectiveTarget=${c.effectiveTarget}, targetROAS=${c.targetROAS}`,
    `Learning state: ${c.learningState}`,
    `Target breach: ${c.targetBreach.periodsAboveTarget} period(s) above target (${c.targetBreach.granularity})`,
    `This period: spend=${cur.spend}, conversions=${cur.conversions}, revenue=${cur.revenue}, ` +
      `impressions=${cur.impressions}, clicks=${cur.inlineLinkClicks}, frequency=${cur.frequency}`,
  ];
  if (c.previous) {
    lines.push(
      `Previous period: spend=${c.previous.spend}, conversions=${c.previous.conversions}, ` +
        `revenue=${c.previous.revenue}`,
    );
  }
  if (c.measurementTrusted === false) {
    lines.push(`Measurement: UNTRUSTED (suspected conversion-denominator step-change)`);
  }
  return lines.join("\n");
}

function failClosed(notes: string): RecommendationVerdict {
  return {
    agreesWithRiley: false,
    judgedAction: "error",
    soundness: 0,
    notes,
    rubricVersion: JUDGE_RUBRIC_VERSION,
    rubricHash: JUDGE_RUBRIC_HASH,
  };
}

export interface JudgeRecommendationInput {
  campaignSummary: string;
  rileyPrimary: string;
  rileyActions: string[];
  rileyWatches: string[];
}

/** Build the judge input from a fixture case + the REAL engine decision. */
export function toJudgeInput(c: RileyCase, decision: RileyDecision): JudgeRecommendationInput {
  return {
    campaignSummary: buildCampaignSummary(c),
    rileyPrimary: decision.primary,
    rileyActions: decision.actions,
    rileyWatches: decision.watchPatterns,
  };
}

export async function judgeRecommendation(
  input: JudgeRecommendationInput,
  deps: JudgeRecommendationDeps,
): Promise<RecommendationVerdict> {
  const userMessage = [
    "Raw weekly campaign data:",
    input.campaignSummary,
    "",
    `Riley's primary action: ${input.rileyPrimary}`,
    `Riley's recommendation actions: ${input.rileyActions.length ? input.rileyActions.join(", ") : "(none)"}`,
    `Riley's watch patterns: ${input.rileyWatches.length ? input.rileyWatches.join(", ") : "(none)"}`,
    "",
    "Evaluate and return the verdict via the judge_recommendation tool.",
  ].join("\n");

  let content: ReadonlyArray<unknown>;
  try {
    const response = await deps.client.messages.create({
      model: deps.model,
      max_tokens: JUDGE_MAX_TOKENS,
      system: [{ type: "text", text: JUDGE_RUBRIC, cache_control: { type: "ephemeral" } }],
      tools: [{ ...JUDGE_TOOL, cache_control: { type: "ephemeral" } }],
      tool_choice: { type: "tool", name: "judge_recommendation" },
      messages: [{ role: "user", content: userMessage }],
    });
    content = response.content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failClosed(`[client-error] judge call failed: ${msg}`);
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
      (b as { name?: string }).name === "judge_recommendation",
  );
  if (!toolUse) {
    return failClosed("[no-tooluse] no judge_recommendation tool_use block");
  }

  const parsed = JudgeToolInputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return failClosed(`[parse-error] ${parsed.error.message}`);
  }

  const soundness = Math.max(0, Math.min(5, Math.round(parsed.data.soundness)));
  return {
    agreesWithRiley: parsed.data.agreesWithRiley,
    judgedAction: normaliseJudgedAction(parsed.data.judgedAction),
    soundness,
    notes: parsed.data.notes,
    rubricVersion: JUDGE_RUBRIC_VERSION,
    rubricHash: JUDGE_RUBRIC_HASH,
  };
}

/** Canonical SKIPPED message; exported so the runner + tests share the wording. */
export const SKIP_MESSAGE =
  "riley-recommendation judge lane skipped: ANTHROPIC_API_KEY is not available";

/** True on a push to main (where an absent key is a hard error, not a soft skip — idiom a). */
export function isMainPush(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env["GITHUB_EVENT_NAME"] === "push" && env["GITHUB_REF"] === "refs/heads/main";
}
