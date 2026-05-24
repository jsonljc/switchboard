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
// compareAgainstBaseline
// ---------------------------------------------------------------------------

export interface BaselineComparisonResult {
  /** True when NO regressions were detected. */
  passed: boolean;
  /** One string per regression, each prefixed with the scenario id. */
  regressions: string[];
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
 */
export function compareAgainstBaseline(
  current: ScenarioResult[],
  baseline: Baseline,
): BaselineComparisonResult {
  const regressions: string[] = [];

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
      regressions.push(
        `[regression] scenario "${result.id}": deterministicPass flipped true → false` +
          (result.violations.length > 0 ? ` (violations: ${result.violations.join(", ")})` : ""),
      );
    }

    // Rule 2: semantic hard-rule violation appeared.
    if (result.semanticHardRulePass === false) {
      regressions.push(
        `[regression] scenario "${result.id}": semanticHardRulePass is false` +
          (result.violations.length > 0 ? ` (violations: ${result.violations.join(", ")})` : ""),
      );
    }

    // Rule 3: judge score dropped beyond tolerance.
    const scoreDrop = baselineScenario.judgeScore - result.judgeScore;
    if (scoreDrop > baseline.judgeScoreTolerance) {
      regressions.push(
        `[regression] scenario "${result.id}": judgeScore dropped from ` +
          `${baselineScenario.judgeScore} → ${result.judgeScore} ` +
          `(drop ${scoreDrop.toFixed(2)} exceeds tolerance ${baseline.judgeScoreTolerance})`,
      );
    }
  }

  // A run passes iff there are no actual regressions (info notes don't count).
  const actualRegressions = regressions.filter((r) => r.startsWith("[regression]"));

  return {
    passed: actualRegressions.length === 0,
    regressions,
  };
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
