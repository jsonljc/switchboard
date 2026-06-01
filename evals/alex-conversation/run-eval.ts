#!/usr/bin/env tsx
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConversationFixtures } from "./load-fixtures.js";
import { runConversation } from "./run-conversation.js";
import { gradeDeterministic } from "./grade.js";
import { judgeTurn, JUDGE_RUBRIC_VERSION } from "./judge.js";
import type { ScenarioResult } from "./score.js";
import { compareAgainstBaseline, summarizeResults } from "./score.js";
import { evaluateOracle } from "./oracle.js";
import { BaselineSchema } from "./schema.js";
import type { Baseline } from "./schema.js";
import { createAnthropicClaimClassifier } from "@switchboard/core";
import {
  isMainPush,
  appendStepSummary,
  SKIP_MESSAGE,
  assertSkillPackContentPresent,
} from "./eval-preflight.js";

// ---------------------------------------------------------------------------
// Model pins
// ---------------------------------------------------------------------------

/** Alex's live model — production wires no router, so the adapter default applies. */
const ALEX_MODEL = "claude-sonnet-4-6";

/** Claim-classifier checker model — matches the production classifier (Haiku). */
const CLASSIFIER_MODEL = "claude-haiku-4-5-20251001";

/** Judge model — stronger model for grading reliability. */
const SONNET = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "fixtures");
const BASELINE_PATH = join(__dirname, "baseline.json");

// The three medspa skill-pack files whose content we hash to detect skill drift.
// Mirrors SKILL_PACK_SCOPES in stub-context-store.ts.
const SKILL_PACK_FILES = [
  join(__dirname, "..", "..", "skills", "alex", "references", "medspa", "objection-handling.md"),
  join(
    __dirname,
    "..",
    "..",
    "skills",
    "alex",
    "references",
    "medspa",
    "qualification-framework.md",
  ),
  join(__dirname, "..", "..", "skills", "alex", "references", "medspa", "claim-boundaries.md"),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Locate the repo root by walking up from the given start directory until
 * pnpm-workspace.yaml is found.
 */
function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== parse(dir).root) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`run-eval: could not locate repo root from ${start}`);
}

/**
 * Compute a SHA-256 hash of the three medspa skill-pack markdown files.
 * Any change to the skill content will change this hash, flagging that the
 * baseline may need to be re-locked.
 */
function computeSkillContentHash(): string {
  const repoRoot = findRepoRoot(__dirname);
  const h = createHash("sha256");
  for (const relPath of SKILL_PACK_FILES) {
    // Resolve relative to repo root if the path starts with ".." relative steps
    const absPath = existsSync(relPath)
      ? relPath
      : join(repoRoot, "skills", "alex", "references", "medspa", relPath.split(/[\\/]/).pop()!);
    h.update(readFileSync(absPath, "utf-8"), "utf-8");
  }
  return h.digest("hex").slice(0, 16);
}

/**
 * Aggregate per-turn deterministic + judge results into a single ScenarioResult.
 *
 * Turn-score aggregation:
 *   - `deterministicPass`: ALL turns must pass (logical AND). A single hard
 *     violation (unexpected-tool) in any turn fails the scenario.
 *   - `judgeScore`: MEAN of per-turn softScores, rounded to one decimal place.
 *     Mean is more representative than min for multi-turn scenarios where one
 *     awkward turn should not catastrophically sink the overall score.
 *   - `semanticHardRulePass`: ALL turns must pass the judge's hard rules (AND).
 *   - `violations`: union of hard violation codes (unexpected-tool) + semantic
 *     violation strings across all turns, deduplicated. Does NOT include claim flags.
 *   - `claimWarnings`: union of all advisory claim warnings across turns.
 *   - `requiredBehaviorsMet`: union of fixture mustDo/mustAsk satisfied across
 *     turns (we record fixture-level; the judge's notes surface specifics).
 */
function aggregateScenarioResult(
  id: string,
  turnResults: Array<{
    deterministicPass: boolean;
    violations: string[];
    claimWarnings?: import("./grade.js").ClaimWarning[];
    semanticHardRulePass: boolean;
    semanticViolations: string[];
    softScore: number;
    requiredBehaviorsMet: string[];
  }>,
): ScenarioResult {
  const deterministicPass = turnResults.every((t) => t.deterministicPass);
  const semanticHardRulePass = turnResults.every((t) => t.semanticHardRulePass);

  const meanScore =
    turnResults.length === 0
      ? 0
      : turnResults.reduce((sum, t) => sum + t.softScore, 0) / turnResults.length;
  const judgeScore = Math.round(meanScore * 10) / 10;

  const violationSet = new Set<string>();
  for (const t of turnResults) {
    for (const v of t.violations) violationSet.add(v);
    for (const v of t.semanticViolations) violationSet.add(v);
  }

  const behaviorSet = new Set<string>();
  for (const t of turnResults) {
    for (const b of t.requiredBehaviorsMet) behaviorSet.add(b);
  }

  // Collect advisory claim warnings (union across all turns, deduplicated by sentence).
  const claimWarningSentences = new Set<string>();
  const claimWarnings: import("./grade.js").ClaimWarning[] = [];
  for (const t of turnResults) {
    for (const w of t.claimWarnings ?? []) {
      if (!claimWarningSentences.has(w.sentence)) {
        claimWarningSentences.add(w.sentence);
        claimWarnings.push(w);
      }
    }
  }

  return {
    id,
    deterministicPass,
    judgeScore,
    semanticHardRulePass,
    requiredBehaviorsMet: Array.from(behaviorSet),
    violations: Array.from(violationSet),
    claimWarnings,
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const writeBaseline = process.argv.includes("--write-baseline");

  // ------------------------------------------------------------------
  // API key preflight: skip on non-main pushes, hard-fail on main.
  // ------------------------------------------------------------------
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    if (isMainPush(process.env)) {
      console.error("alex-conversation eval failed: ANTHROPIC_API_KEY is required on main push");
      process.exit(2);
    }
    console.log(SKIP_MESSAGE);
    appendStepSummary(SKIP_MESSAGE);
    process.exit(0);
  }

  // ------------------------------------------------------------------
  // Skill-pack content preflight (offline): refuse to grade Alex with an empty pack.
  // ------------------------------------------------------------------
  await assertSkillPackContentPresent();

  // ------------------------------------------------------------------
  // Build shared API clients
  // ------------------------------------------------------------------
  const anthropicClient = new Anthropic({ apiKey });
  const classifier = createAnthropicClaimClassifier(anthropicClient);

  // ------------------------------------------------------------------
  // Load fixtures
  // ------------------------------------------------------------------
  const fixtures = loadConversationFixtures(FIXTURES_DIR);
  console.log(`Loaded ${fixtures.length} fixtures from ${FIXTURES_DIR}`);

  // ------------------------------------------------------------------
  // Run each fixture through the full eval pipeline
  // ------------------------------------------------------------------
  const scenarioResults: ScenarioResult[] = [];

  for (const fixture of fixtures) {
    process.stdout.write(`\nRunning scenario: ${fixture.id} ...`);

    let outcome: Awaited<ReturnType<typeof runConversation>>;
    try {
      outcome = await runConversation(fixture, {
        anthropicClient,
        model: ALEX_MODEL,
      });
    } catch (err) {
      console.error(`\nFixture ${fixture.id} run failed: ${(err as Error).message}`);
      process.exit(3);
    }

    // Grade each captured Alex turn (deterministic + judge).
    const turnResults: Array<{
      deterministicPass: boolean;
      violations: string[];
      claimWarnings: import("./grade.js").ClaimWarning[];
      semanticHardRulePass: boolean;
      semanticViolations: string[];
      softScore: number;
      requiredBehaviorsMet: string[];
    }> = [];

    // Investigation evidence: per-turn flag details for post-run triage.
    const investigationTurns: Array<{
      turnIndex: number;
      claimFlags: Array<{ claimType: string; confidence: number; sentence: string }>;
      semanticHardRulePass: boolean;
      softScore: number;
    }> = [];

    const alexTurnSpecs = fixture.turns.filter((t) => t.role === "alex");

    for (let i = 0; i < outcome.alexTurns.length; i++) {
      const capturedTurn = outcome.alexTurns[i]!;
      const gradeSpec = alexTurnSpecs[i]!;
      if (gradeSpec.role !== "alex") continue;

      // Tier 1: deterministic grading
      let deterministicResult: Awaited<ReturnType<typeof gradeDeterministic>>;
      try {
        deterministicResult = await gradeDeterministic(capturedTurn, {
          classifier,
          classifierModel: CLASSIFIER_MODEL,
        });
      } catch (err) {
        console.error(`\nFixture ${fixture.id} turn ${i} grade failed: ${(err as Error).message}`);
        process.exit(3);
      }

      // Build lead context summary for the judge
      const leadContext = `Scenario: ${fixture.scenario} (locale: ${fixture.locale}). Turn ${i + 1} of ${outcome.alexTurns.length}.`;

      // Tier 2+3: judge grading
      let verdict: Awaited<ReturnType<typeof judgeTurn>>;
      try {
        verdict = await judgeTurn(
          {
            leadContext,
            alexResponse: capturedTurn.alexResponse,
            grade: gradeSpec.grade,
          },
          {
            client: anthropicClient,
            model: SONNET,
          },
        );
      } catch (err) {
        console.error(`\nFixture ${fixture.id} turn ${i} judge failed: ${(err as Error).message}`);
        process.exit(3);
      }

      // Collect which required behaviors were met based on fixture grade hints
      const requiredBehaviorsMet: string[] = [];
      if (deterministicResult.deterministicPass && gradeSpec.grade.mustNot.length > 0) {
        requiredBehaviorsMet.push(`no-violations:${gradeSpec.grade.mustNot.join(",")}`);
      }
      if (verdict.semanticHardRulePass && gradeSpec.grade.mustDo.length > 0) {
        requiredBehaviorsMet.push(`mustDo-met:${gradeSpec.grade.mustDo.join(",")}`);
      }

      turnResults.push({
        deterministicPass: deterministicResult.deterministicPass,
        violations: deterministicResult.violations.map((v) => v.code),
        claimWarnings: deterministicResult.claimWarnings,
        semanticHardRulePass: verdict.semanticHardRulePass,
        semanticViolations: verdict.semanticViolations,
        softScore: verdict.softScore,
        requiredBehaviorsMet,
      });

      // Collect claim flags (advisory) for investigation output.
      // These come from claimWarnings — they no longer appear in violations.
      const claimFlags = deterministicResult.claimWarnings.map((w) => ({
        claimType: w.claimType,
        confidence: w.confidence,
        sentence: w.sentence,
      }));
      investigationTurns.push({
        turnIndex: i,
        claimFlags,
        semanticHardRulePass: verdict.semanticHardRulePass,
        softScore: verdict.softScore,
      });

      process.stdout.write(
        deterministicResult.deterministicPass && verdict.semanticHardRulePass ? "." : "x",
      );
    }

    const scenarioResult = aggregateScenarioResult(fixture.id, turnResults);

    // Optional trajectory oracle (conversation-level): fold violations into the
    // deterministic gate. Scenarios without an `oracle` block are unaffected, so
    // this is fully backward compatible with the original 8 fixtures.
    if (fixture.oracle) {
      const oracleResult = evaluateOracle(outcome.toolCalls, fixture.oracle);
      if (!oracleResult.pass) {
        scenarioResult.deterministicPass = false;
        scenarioResult.violations = [
          ...scenarioResult.violations,
          ...oracleResult.violations.map((v) => `oracle:${v.code}`),
        ];
      }
    }

    scenarioResults.push(scenarioResult);

    // Print investigation block for this scenario if any turn had claim flags.
    const anyFlags = investigationTurns.some((t) => t.claimFlags.length > 0);
    if (anyFlags) {
      console.log(`\n[investigation] ${fixture.id} (${fixture.scenario})`);
      for (const t of investigationTurns) {
        if (t.claimFlags.length === 0) continue;
        console.log(`  Turn ${t.turnIndex + 1}:`);
        for (const flag of t.claimFlags) {
          console.log(`    claimType: ${flag.claimType}`);
          console.log(`    confidence: ${flag.confidence.toFixed(3)}`);
          console.log(`    flagged: "${flag.sentence}"`);
        }
        const judgeStatus = t.semanticHardRulePass
          ? `pass (softScore=${t.softScore})`
          : `FAIL (softScore=${t.softScore})`;
        console.log(`    judge: ${judgeStatus}`);
      }
    }
  }

  process.stdout.write("\n");

  // ------------------------------------------------------------------
  // Print results table
  // ------------------------------------------------------------------
  console.log("\n" + summarizeResults(scenarioResults));

  // ------------------------------------------------------------------
  // Write-baseline mode
  // ------------------------------------------------------------------
  if (writeBaseline) {
    const skillContentHash = computeSkillContentHash();
    const baseline: Baseline = {
      version: 1,
      generatedAt: new Date().toISOString(),
      skillContentHash,
      judgeRubricVersion: JUDGE_RUBRIC_VERSION,
      judgeScoreTolerance: 1.0,
      scenarios: scenarioResults.map((r) => ({
        id: r.id,
        deterministicPass: r.deterministicPass,
        judgeScore: r.judgeScore,
        requiredBehaviorsMet: r.requiredBehaviorsMet,
        violations: r.violations,
        claimWarnings: r.claimWarnings,
      })),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`\nBaseline written to ${BASELINE_PATH}`);
    return;
  }

  // ------------------------------------------------------------------
  // Regression check mode
  // ------------------------------------------------------------------
  if (!existsSync(BASELINE_PATH)) {
    console.log("\nNo baseline.json present — skipping regression check.");
    return;
  }

  let baseline: Baseline;
  try {
    baseline = BaselineSchema.parse(JSON.parse(readFileSync(BASELINE_PATH, "utf-8")));
  } catch (err) {
    console.error(`\nFailed to parse baseline.json: ${(err as Error).message}`);
    process.exit(1);
  }

  const comparison = compareAgainstBaseline(scenarioResults, baseline);
  if (!comparison.passed) {
    console.error("\nREGRESSIONS:");
    for (const r of comparison.regressions) console.error(`  - ${r}`);
    process.exit(1);
  }

  if (comparison.regressions.length > 0) {
    // Info notes only (new scenarios etc.)
    for (const r of comparison.regressions) console.log(`  ${r}`);
  }
  console.log("\nNo regressions against baseline.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
