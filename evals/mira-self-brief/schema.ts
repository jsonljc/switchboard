import { z } from "zod";

/**
 * EV-6 — Mira real-generation eval schemas (INFRA-3 Mira + AGENT-8 + AGENT-9).
 *
 * The harness drives Mira's REAL compose generation (the real skills/mira/SKILL.md
 * body rendered with golden parameters through the real SkillExecutorImpl) and grades
 * the output through the REAL downstream parser (`parseMiraComposeOutput`, @switchboard/schemas).
 */

/**
 * The eight prompt parameters skills/mira/SKILL.md declares and miraBuilder supplies.
 * The faithfulness test (scenarios.test.ts) pins this list against the real skill's
 * declared parameters, so a renamed/added parameter reds the corpus instead of
 * silently rendering a literal {{TOKEN}} at runtime.
 */
export const MIRA_PARAM_KEYS = [
  "BUSINESS_NAME",
  "BUSINESS_FACTS",
  "TASTE_CONTEXT",
  "FRONTLINE_CONVERSION_CONTEXT",
  "PERFORMANCE_CONTEXT",
  "PIPELINE_STATE",
  "TRIGGER_CONTEXT",
  "CURRENT_DATETIME",
] as const;

/**
 * Golden scenario parameters. Required-true skill params (BUSINESS_NAME,
 * PERFORMANCE_CONTEXT, PIPELINE_STATE, TRIGGER_CONTEXT, CURRENT_DATETIME) must be
 * non-empty; required-false context params (BUSINESS_FACTS, TASTE_CONTEXT,
 * FRONTLINE_CONVERSION_CONTEXT) may be empty to model an org with no signal yet.
 * `.strict()` forbids any key outside the declared eight.
 */
export const MiraScenarioParamsSchema = z
  .object({
    BUSINESS_NAME: z.string().min(1),
    BUSINESS_FACTS: z.string(),
    TASTE_CONTEXT: z.string(),
    FRONTLINE_CONVERSION_CONTEXT: z.string(),
    PERFORMANCE_CONTEXT: z.string().min(1),
    PIPELINE_STATE: z.string().min(1),
    TRIGGER_CONTEXT: z.string().min(1),
    CURRENT_DATETIME: z.string().min(1),
  })
  .strict();
export type MiraScenarioParams = z.infer<typeof MiraScenarioParamsSchema>;

/** The expected judgment LEAN — informational (judge-graded), NEVER a deterministic block. */
export const MiraExpectedLeanSchema = z.enum(["propose", "abstain"]);
export type MiraExpectedLean = z.infer<typeof MiraExpectedLeanSchema>;

/**
 * One golden scenario. `expectedLean` documents the disciplined call and is scored
 * by the informational judge only — the deterministic blocking leg never fails a
 * run for proposing-vs-abstaining (that is a judgment, not a contract violation).
 */
export const MiraScenarioSchema = z
  .object({
    id: z.string().min(1),
    expectedLean: MiraExpectedLeanSchema,
    /** What the judge should weight for this scenario. */
    judgeFocus: z.string().min(1),
    note: z.string().min(1),
    params: MiraScenarioParamsSchema,
  })
  .strict();
export type MiraScenario = z.infer<typeof MiraScenarioSchema>;

/**
 * The deterministic grader's input: a driven Mira compose result. `rawResponse` is
 * `SkillExecutionResult.response` (post intent/sidecar stripping by the executor).
 * `intentClass` / `qualificationSignals` are the executor's STRIP SIDE-CHANNELS: a
 * set value means Mira emitted an <intent> tag / qualification block that the
 * executor stripped — a contract bleed the raw text no longer shows (AGENT-9).
 */
export interface MiraComposeGradeInput {
  rawResponse: string;
  /** Set iff the executor stripped an <intent> tag from Mira's output. */
  intentClass?: string | null;
  /** Set iff the executor captured a valid <qualification_signals> block. */
  qualificationSignals?: unknown;
  /** True iff driving the compose threw/aborted (graceful-degradation gate). */
  crashed?: boolean;
}

// ---------------------------------------------------------------------------
// Baseline (judge soft-score drift gate). A deterministic violation is a HARD
// fail handled by the runner independent of the baseline — you never
// baseline-accept a bled tag or a banned claim on a live run.
// ---------------------------------------------------------------------------

export const MiraScenarioBaselineSchema = z.object({
  id: z.string(),
  /** True on a clean run. A baseline entry MUST be true — a false here is a defect. */
  deterministicPass: z.boolean(),
  /** Mira's actual decision on the baseline run (propose | abstain). */
  decision: z.enum(["propose", "abstain"]),
  /** Informational judge quality score 0–5. */
  judgeScore: z.number().min(0).max(5),
  /** Deterministic violation codes observed (empty on a clean run). */
  violations: z.array(z.string()),
});
export type MiraScenarioBaseline = z.infer<typeof MiraScenarioBaselineSchema>;

export const MiraBaselineSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  /** SHA-256 (truncated) of the scenario corpus, for stale-baseline visibility. */
  corpusHash: z.string().min(1),
  judgeRubricVersion: z.string().min(1),
  judgeScoreTolerance: z.number().min(0).max(5),
  scenarios: z.array(MiraScenarioBaselineSchema),
});
export type MiraBaseline = z.infer<typeof MiraBaselineSchema>;
