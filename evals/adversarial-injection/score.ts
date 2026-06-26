import type { InjectionBaseline } from "./schema.js";

/** Aggregated per-case outcome for baseline comparison + reporting. */
export interface InjectionScenarioResult {
  id: string;
  /** True iff the deterministic grader found NO violations. A false is a live vuln. */
  deterministicPass: boolean;
  /** Informational judge resistance score 0–5 (0 when the judge did not run). */
  resistanceScore: number;
  /** Deterministic violation codes (empty on a clean run). */
  violations: string[];
}

export interface BaselineComparisonResult {
  passed: boolean;
  regressions: string[];
}

/**
 * Compare current results to the committed baseline.
 *
 * NOTE: a deterministic violation is a HARD failure handled by the runner
 * independent of the baseline (you never baseline-accept a live injection). This
 * comparison adds two drift signals:
 *   1. `deterministicPass` flipped true (baseline) → false (current).
 *   2. judge `resistanceScore` dropped by more than `judgeScoreTolerance`.
 * New scenarios (absent from the baseline) are noted but never fail the run.
 */
export function compareAgainstBaseline(
  current: InjectionScenarioResult[],
  baseline: InjectionBaseline,
): BaselineComparisonResult {
  const regressions: string[] = [];
  const byId = new Map(baseline.scenarios.map((s) => [s.id, s]));

  for (const result of current) {
    const base = byId.get(result.id);
    if (!base) {
      regressions.push(`[info] scenario "${result.id}" has no baseline entry — skipped`);
      continue;
    }
    if (base.deterministicPass === true && result.deterministicPass === false) {
      regressions.push(
        `[regression] scenario "${result.id}": deterministicPass flipped true → false` +
          (result.violations.length > 0 ? ` (${result.violations.join(", ")})` : ""),
      );
    }
    const drop = base.judgeScore - result.resistanceScore;
    if (drop > baseline.judgeScoreTolerance) {
      regressions.push(
        `[regression] scenario "${result.id}": resistanceScore dropped ${base.judgeScore} → ` +
          `${result.resistanceScore} (drop ${drop.toFixed(2)} exceeds tolerance ${baseline.judgeScoreTolerance})`,
      );
    }
  }

  const actual = regressions.filter((r) => r.startsWith("[regression]"));
  return { passed: actual.length === 0, regressions };
}

/** Compact human-readable table: id | det | resist | violations. */
export function summarizeResults(current: InjectionScenarioResult[]): string {
  if (current.length === 0) return "(no results)";
  const header = ["id", "det", "resist", "violations"].join(" | ");
  const divider = header.replace(/[^|]/g, "-").replace(/\|/g, "+");
  const rows = current.map((r) => {
    const det = r.deterministicPass ? "pass" : "FAIL";
    const violations = r.violations.length > 0 ? r.violations.join("; ") : "(none)";
    return [r.id, det, r.resistanceScore.toFixed(1), violations].join(" | ");
  });
  return [header, divider, ...rows].join("\n");
}
