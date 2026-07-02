import type { Baseline } from "./schema.js";
import type { ClaimWarning } from "./grade.js";

// ---------------------------------------------------------------------------
// ScenarioResult
// ---------------------------------------------------------------------------

/**
 * Aggregated per-scenario outcome combining deterministic (Tier 1) and
 * judge (Tier 2/3) results into a single record for baseline comparison.
 */
export interface ScenarioResult {
  /** Matches the fixture / baseline scenario id. */
  id: string;
  /** True iff Tier 1 (deterministic) grading found no HARD violations (tool/sidecar). */
  deterministicPass: boolean;
  /** Tier-3 soft quality score 0–5. */
  judgeScore: number;
  /** Tier-1 + Tier-2 required behaviors that were satisfied. */
  requiredBehaviorsMet: string[];
  /** Hard violations (unexpected-tool codes + semantic strings). Does NOT include claim flags. */
  violations: string[];
  /**
   * Tier-2 semantic hard-rule pass flag.
   * Optional: absent when the judge was not run for this scenario.
   */
  semanticHardRulePass?: boolean;
  /**
   * Advisory claim warnings collected from the per-sentence classifier across
   * all turns. These are informational only — they do NOT gate `deterministicPass`
   * or the regression check. Printed in the investigation block for human triage.
   *
   * The claim classifier over-flags conversational deferrals; the judge's
   * `semanticHardRulePass` is the correct claim gate.
   */
  claimWarnings?: ClaimWarning[];
}

// ---------------------------------------------------------------------------
// TaggedRegression
// ---------------------------------------------------------------------------

/**
 * Which enforcement tier produced a regression:
 *  - "deterministic": Rule 1 (deterministicPass flipped true → false). Backed
 *    by the unexpected-tool + trajectory oracle checks, which are fully
 *    deterministic and safe to gate a blocking CI job on.
 *  - "judge-hard-rule": Rule 2 (semanticHardRulePass === false). Backed by the
 *    nondeterministic LLM judge's hard-rule verdict.
 *  - "judge-score": Rule 3 (judgeScore dropped beyond tolerance). Backed by
 *    the nondeterministic LLM judge's soft score.
 */
export type RegressionKind = "deterministic" | "judge-hard-rule" | "judge-score";

/**
 * A single regression, tagged by kind so callers can separate the
 * deterministic signal from the judge signal. See `deterministicRegressions`
 * and `judgeRegressions` below.
 */
export interface TaggedRegression {
  /** The scenario id the regression was detected on. */
  scenarioId: string;
  /** Which rule/tier produced this regression. */
  kind: RegressionKind;
  /** Human-readable detail (same text as in `regressions`, minus the id prefix). */
  detail: string;
}

// ---------------------------------------------------------------------------
// compareAgainstBaseline
// ---------------------------------------------------------------------------

export interface BaselineComparisonResult {
  /** True when NO regressions were detected. */
  passed: boolean;
  /** One string per regression, each prefixed with the scenario id. */
  regressions: string[];
  /**
   * Every regression, tagged by kind. Does NOT include the `[info]`
   * new-scenario note (that is not a regression). `passed` is derived from
   * this array being empty.
   */
  taggedRegressions: TaggedRegression[];
}

/**
 * Compare a set of current scenario results against a persisted baseline.
 *
 * Regression rules (any one is enough to flag a scenario):
 *   1. `deterministicPass` flipped from true (baseline) → false (current):
 *      a deterministic safety or trajectory failure has appeared.
 *   2. `semanticHardRulePass === false` in the current result: a Tier-2 hard
 *      rule violation is present, regardless of the baseline value.
 *   3. `judgeScore` dropped by more than `baseline.judgeScoreTolerance` vs
 *      the scenario's baseline judgeScore.
 *
 * Scenarios present in `current` but absent from the baseline are skipped
 * (they are new — they cannot regress from something that was never measured).
 * A note is still recorded in `regressions` for visibility, but it does NOT
 * cause `passed` to be false.
 *
 * Each regression is recorded twice: as a human-readable string in
 * `regressions` (back-compat) and as a `TaggedRegression` in
 * `taggedRegressions`, tagged with which rule produced it (Rule 1 tags
 * "deterministic"; Rules 2 and 3 tag "judge-hard-rule" and "judge-score").
 * `passed` is derived from `taggedRegressions` being empty, which is
 * equivalent to the old "no `[regression]`-prefixed string" check because
 * every `[regression]` string has exactly one corresponding
 * `TaggedRegression` pushed alongside it.
 */
export function compareAgainstBaseline(
  current: ScenarioResult[],
  baseline: Baseline,
): BaselineComparisonResult {
  const regressions: string[] = [];
  const taggedRegressions: TaggedRegression[] = [];

  // Index baseline scenarios by id for O(1) lookup.
  const baselineMap = new Map(baseline.scenarios.map((s) => [s.id, s]));

  for (const result of current) {
    const baselineScenario = baselineMap.get(result.id);

    if (!baselineScenario) {
      // New scenario — not a regression, but note it for observability.
      regressions.push(
        `[info] scenario "${result.id}" has no baseline entry — skipped from regression check`,
      );
      continue;
    }

    // Rule 1: deterministic pass flipped true → false.
    if (baselineScenario.deterministicPass === true && result.deterministicPass === false) {
      const detail =
        `deterministicPass flipped true → false` +
        (result.violations.length > 0 ? ` (violations: ${result.violations.join(", ")})` : "");
      regressions.push(`[regression] scenario "${result.id}": ${detail}`);
      taggedRegressions.push({ scenarioId: result.id, kind: "deterministic", detail });
    }

    // Rule 2: semantic hard-rule violation appeared.
    if (result.semanticHardRulePass === false) {
      const detail =
        `semanticHardRulePass is false` +
        (result.violations.length > 0 ? ` (violations: ${result.violations.join(", ")})` : "");
      regressions.push(`[regression] scenario "${result.id}": ${detail}`);
      taggedRegressions.push({ scenarioId: result.id, kind: "judge-hard-rule", detail });
    }

    // Rule 3: judge score dropped beyond tolerance.
    const scoreDrop = baselineScenario.judgeScore - result.judgeScore;
    if (scoreDrop > baseline.judgeScoreTolerance) {
      const detail =
        `judgeScore dropped from ${baselineScenario.judgeScore} → ${result.judgeScore} ` +
        `(drop ${scoreDrop.toFixed(2)} exceeds tolerance ${baseline.judgeScoreTolerance})`;
      regressions.push(`[regression] scenario "${result.id}": ${detail}`);
      taggedRegressions.push({ scenarioId: result.id, kind: "judge-score", detail });
    }
  }

  return {
    passed: taggedRegressions.length === 0,
    regressions,
    taggedRegressions,
  };
}

// ---------------------------------------------------------------------------
// deterministicRegressions / judgeRegressions
// ---------------------------------------------------------------------------

/**
 * Narrow a comparison result down to the deterministic-only regressions
 * (Rule 1). These come from the unexpected-tool + trajectory oracle checks,
 * not the LLM judge, so this subset is safe to gate a blocking CI job on
 * without inheriting judge flakiness.
 */
export function deterministicRegressions(result: BaselineComparisonResult): TaggedRegression[] {
  return result.taggedRegressions.filter((r) => r.kind === "deterministic");
}

/**
 * Narrow a comparison result down to the judge-driven regressions (Rules 2
 * and 3: hard-rule violation or score drop). Both are produced by the
 * nondeterministic LLM judge, so this subset should not gate a blocking CI
 * job without accepting judge flakiness.
 */
export function judgeRegressions(result: BaselineComparisonResult): TaggedRegression[] {
  return result.taggedRegressions.filter(
    (r) => r.kind === "judge-hard-rule" || r.kind === "judge-score",
  );
}

// ---------------------------------------------------------------------------
// summarizeResults (optional — convenience for human-readable output)
// ---------------------------------------------------------------------------

/**
 * Return a compact table string for logging. Each row is one scenario.
 * Columns: id | det | judge | hard | violations
 */
export function summarizeResults(current: ScenarioResult[]): string {
  if (current.length === 0) return "(no results)";

  const header = ["id", "det", "judge", "hard", "violations"].join(" | ");
  const divider = header.replace(/[^|]/g, "-").replace(/\|/g, "+");

  const rows = current.map((r) => {
    const det = r.deterministicPass ? "pass" : "FAIL";
    const judge = r.judgeScore.toFixed(1);
    const hard =
      r.semanticHardRulePass === undefined ? "n/a" : r.semanticHardRulePass ? "pass" : "FAIL";
    const violations = r.violations.length > 0 ? r.violations.join("; ") : "(none)";
    return [r.id, det, judge, hard, violations].join(" | ");
  });

  return [header, divider, ...rows].join("\n");
}
