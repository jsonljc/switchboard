#!/usr/bin/env tsx
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures } from "./load-fixtures.js";
import { invokeOne, type InvocationResult } from "./invoke-classifier.js";
import { scoreResults, compareAgainstBaseline } from "./score.js";
import { BaselineSchema, ClaimTypeEnum, type Baseline } from "./schema.js";
import {
  isMainPush,
  comparePromptHash,
  appendStepSummary,
  SKIP_MESSAGE,
} from "./eval-preflight.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const BASELINE_PATH = join(__dirname, "baseline.json");

async function main() {
  const writeBaseline = process.argv.includes("--write-baseline");
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    if (isMainPush(process.env)) {
      console.error("claim-classifier eval failed: ANTHROPIC_API_KEY is required on main push");
      process.exit(2);
    }
    console.log(SKIP_MESSAGE);
    appendStepSummary(SKIP_MESSAGE);
    process.exit(0);
  }
  const client = new Anthropic({ apiKey });
  const fixtures = loadFixtures(FIXTURES_DIR);
  console.log(`Loaded ${fixtures.length} fixtures from ${FIXTURES_DIR}`);

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  const results: InvocationResult[] = [];
  for (const fx of fixtures) {
    try {
      const r = await invokeOne(client, fx, controller.signal);
      results.push(r);
      process.stdout.write(r.matched ? "." : "x");
    } catch (e) {
      console.error(`\nFixture ${fx.id} failed: ${(e as Error).message}`);
      process.exit(3);
    }
  }
  process.stdout.write("\n");

  const report = scoreResults(results);
  printReport(report);

  if (writeBaseline) {
    const promptHash = results[0]?.promptHash ?? "unknown";
    const promptVersion = results[0]?.promptVersion ?? "unknown";
    const baseline: Baseline = {
      version: 1,
      generatedAt: new Date().toISOString(),
      classifierPromptHash: promptHash,
      classifierPromptVersion: promptVersion,
      totalFixtures: report.totalFixtures,
      overallAccuracy: report.overallAccuracy,
      perClaimTypeAccuracy: report.perClaimTypeAccuracy,
      toleranceBps: 200,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`Baseline written to ${BASELINE_PATH}`);
    return;
  }

  if (existsSync(BASELINE_PATH)) {
    const baseline = BaselineSchema.parse(JSON.parse(readFileSync(BASELINE_PATH, "utf-8")));
    const currentHash = results[0]?.promptHash ?? "unknown";
    const hashCheck = comparePromptHash(currentHash, baseline.classifierPromptHash);
    if (!hashCheck.ok) {
      console.error(
        `\nFAIL: classifier prompt hash changed from baseline\n  baseline: ${hashCheck.baselineHash}\n  current:  ${hashCheck.currentHash}\n  Run \`pnpm eval:classifier --write-baseline\` to lock the new prompt.`,
      );
      process.exit(1);
    }
    const comparison = compareAgainstBaseline(report, baseline);
    if (!comparison.passed) {
      console.error("\nREGRESSIONS:");
      for (const r of comparison.regressions) console.error(`  - ${r}`);
      process.exit(1);
    }
    console.log("\nNo regressions against baseline.");
  } else {
    console.log("\nNo baseline.json present — skipping regression check.");
  }
}

function printReport(report: ReturnType<typeof scoreResults>) {
  console.log("\nPer-claim-type accuracy:");
  for (const type of ClaimTypeEnum.options) {
    const t = report.perClaimTypeAccuracy[type];
    const pct = t.total === 0 ? "—" : `${(t.accuracy * 100).toFixed(1)}%`;
    console.log(`  ${type.padEnd(16)} ${t.correct}/${t.total}  ${pct}`);
  }
  console.log(
    `\nOverall: ${(report.overallAccuracy * 100).toFixed(1)}% (${report.totalFixtures} fixtures)`,
  );
  console.log(`Mean latency: ${report.meanLatencyMs.toFixed(0)}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
