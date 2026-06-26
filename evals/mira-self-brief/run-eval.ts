#!/usr/bin/env tsx
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, corpusHash } from "./scenarios.js";
import { runMiraCompose } from "./run-mira-compose.js";
import { gradeMiraCompose } from "./grade-compose.js";
import { judgeCompose, JUDGE_RUBRIC_VERSION } from "./compose-judge.js";
import { compareAgainstBaseline, summarizeResults, type MiraScenarioResult } from "./score.js";
import { MiraBaselineSchema, type MiraBaseline } from "./schema.js";
import { isMainPush, appendStepSummary, SKIP_MESSAGE } from "./eval-preflight.js";

// Mira's live compose model — production wires no router, so the adapter default applies.
const MIRA_MODEL = "claude-sonnet-4-6";
// Judge model — same tier as Mira; matches the alex-conversation / injection judges.
const JUDGE_MODEL = "claude-sonnet-4-6";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dirname, "baseline.json");
const JUDGE_SCORE_TOLERANCE = 1.0;

/** Drive one scenario live: deterministic grade (blocking semantics) + informational judge. */
async function driveScenario(
  scenario: (typeof SCENARIOS)[number],
  client: Anthropic,
): Promise<MiraScenarioResult> {
  const out = await runMiraCompose(scenario, { anthropicClient: client, model: MIRA_MODEL });
  const grade = gradeMiraCompose(out);
  // A parse failure means the caller ABSTAINS (parseMiraComposeOutput semantics).
  const decision = grade.parsed?.decision ?? "abstain";

  let judgeScore = 0;
  if (grade.parsed) {
    try {
      const verdict = await judgeCompose(
        {
          expectedLean: scenario.expectedLean,
          judgeFocus: scenario.judgeFocus,
          decision: grade.parsed.decision,
          reason: grade.parsed.reason,
          brief: grade.parsed.brief ?? null,
        },
        { client, model: JUDGE_MODEL },
      );
      judgeScore = verdict.qualityScore;
    } catch (err) {
      console.warn(`\n  [judge-error] ${scenario.id}: ${(err as Error).message}`);
    }
  }

  return {
    id: scenario.id,
    deterministicPass: grade.pass,
    decision,
    judgeScore,
    violations: grade.violations.map((v) => v.code),
  };
}

/** Compare to the committed baseline (judge-score drift). Absent baseline ⇒ informational only. */
function checkRegressionsOrExit(results: MiraScenarioResult[]): void {
  if (!existsSync(BASELINE_PATH)) {
    console.log(
      "\nNo baseline.json present — skipping regression check " +
        "(generate with `pnpm eval:mira-self-brief --write-baseline` once ANTHROPIC_API_KEY is restored).",
    );
    return;
  }

  let baseline: MiraBaseline;
  try {
    baseline = MiraBaselineSchema.parse(JSON.parse(readFileSync(BASELINE_PATH, "utf-8")));
  } catch (err) {
    console.error(`\nFailed to parse baseline.json: ${(err as Error).message}`);
    process.exit(1);
  }

  const cmp = compareAgainstBaseline(results, baseline);
  if (!cmp.passed) {
    console.error("\nREGRESSIONS:");
    for (const r of cmp.regressions.filter((x) => x.startsWith("[regression]"))) {
      console.error(`  ${r}`);
    }
    process.exit(1);
  }
  console.log("\nNo regressions against baseline.");
}

async function main(): Promise<void> {
  const writeBaseline = process.argv.includes("--write-baseline");

  // ------------------------------------------------------------------
  // API-key preflight (idiom a): skip on a non-main run, hard-fail on main.
  // ------------------------------------------------------------------
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    if (isMainPush(process.env)) {
      console.error("mira-self-brief eval failed: ANTHROPIC_API_KEY is required on main push");
      process.exit(2);
    }
    console.log(SKIP_MESSAGE);
    appendStepSummary(SKIP_MESSAGE);
    process.exit(0);
  }

  const client = new Anthropic({ apiKey });
  console.log(`Driving ${SCENARIOS.length} Mira compose scenario(s) live...\n`);

  const results: MiraScenarioResult[] = [];
  for (const s of SCENARIOS) {
    process.stdout.write(`  ${s.id} `);
    const r = await driveScenario(s, client);
    results.push(r);
    process.stdout.write(
      r.deterministicPass
        ? `ok (${r.decision}, judge ${r.judgeScore})\n`
        : `FAIL (${r.violations.join(", ")})\n`,
    );
  }
  const defects = results.filter((r) => !r.deterministicPass);

  console.log("\n" + summarizeResults(results));

  // ------------------------------------------------------------------
  // Write-baseline mode (run once ANTHROPIC_API_KEY is restored — INFRA-1).
  // ------------------------------------------------------------------
  if (writeBaseline) {
    const baseline: MiraBaseline = {
      version: 1,
      generatedAt: new Date().toISOString(),
      corpusHash: corpusHash(),
      judgeRubricVersion: JUDGE_RUBRIC_VERSION,
      judgeScoreTolerance: JUDGE_SCORE_TOLERANCE,
      scenarios: results.map((r) => ({
        id: r.id,
        deterministicPass: r.deterministicPass,
        decision: r.decision,
        judgeScore: r.judgeScore,
        violations: r.violations,
      })),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`\nBaseline written to ${BASELINE_PATH}`);
  }

  // ------------------------------------------------------------------
  // HARD GATE: a deterministic violation on a LIVE run is a real Mira defect —
  // fail loudly regardless of the baseline (never baseline-accept a contract bleed,
  // a banned claim, a malformed verdict, or a crash). This is the SURFACE signal.
  // ------------------------------------------------------------------
  if (defects.length > 0) {
    console.error(
      "\n⚠️  MIRA COMPOSE DEFECT — a live compose produced a contract/claim/bleed/shape violation:",
    );
    for (const d of defects) console.error(`  - ${d.id}: ${d.violations.join(", ")}`);
    appendStepSummary(
      `mira-self-brief: ${defects.length} DEFECT(s) — ${defects.map((d) => d.id).join(", ")}`,
    );
    process.exit(1);
  }

  if (writeBaseline) return;

  // Regression check (judge-score drift) — informational until a baseline is baked.
  checkRegressionsOrExit(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
