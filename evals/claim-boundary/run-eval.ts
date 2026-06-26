#!/usr/bin/env tsx
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClaimClassifier, type AnthropicClaimClassifier } from "@switchboard/core";
import { CORPUS, CONTROLS } from "./corpus.js";
import { gradeClaim } from "./grade-claim.js";
import { runClaimCaseOff } from "./seam-alex.js";
import { runClaimEnforceGate } from "./enforce-gate.js";
import { isMainPush, appendStepSummary, SKIP_MESSAGE } from "./eval-preflight.js";

// Alex's live model — production wires no router, so the adapter default applies.
const ALEX_MODEL = "claude-sonnet-4-6";

// Escalate-only claim types: the ENFORCE gate routes these to a human rather than
// rewriting them (mirrors ESCALATE_ONLY + credentials in the production hook).
const ESCALATE_TYPES = new Set(["testimonial", "medical-advice", "diagnosis", "credentials"]);

interface CaseResult {
  id: string;
  mode: "off" | "enforce" | "control";
  pass: boolean;
  detail: string;
}

function codes(violations: { code: string }[]): string {
  return violations.map((v) => v.code).join(", ");
}

function summarize(results: CaseResult[]): string {
  const header = ["mode", "id", "result", "detail"].join(" | ");
  const divider = header.replace(/[^|]/g, "-").replace(/\|/g, "+");
  const rows = results.map((r) => [r.mode, r.id, r.pass ? "pass" : "FAIL", r.detail].join(" | "));
  return [header, divider, ...rows].join("\n");
}

/**
 * Mode 1 — classifier OFF (prompt-only). Drive REAL Alex over each claim-bait
 * payload with NO governance hooks and assert the reply asserts no prohibited
 * claim. A violation here is a real claim-boundary breach by the prompt alone.
 */
async function runOffLeg(client: Anthropic, results: CaseResult[]): Promise<void> {
  console.log(
    `\n[classifier OFF] driving ${CORPUS.length} claim-bait case(s) through real Alex...`,
  );
  for (const c of CORPUS) {
    process.stdout.write(`  ${c.id} `);
    const output = await runClaimCaseOff(c.payload, c.id, {
      anthropicClient: client,
      model: ALEX_MODEL,
    });
    const grade = gradeClaim(output, c.expect);
    results.push({
      id: c.id,
      mode: "off",
      pass: grade.pass,
      detail: grade.pass ? "no prohibited claim" : codes(grade.violations),
    });
    process.stdout.write(grade.pass ? "ok\n" : `FAIL (${codes(grade.violations)})\n`);
  }
}

/**
 * Mode 2 — classifier ENFORCE. Drive the REAL claim gate (real Haiku classifier)
 * over each case's canned prohibited sentence and assert the gate ACTED and
 * NEUTRALIZED the claim: rewriteable -> rewrite, escalate-only/credentials ->
 * escalate, and the post-gate reply passes the grader.
 */
async function runEnforceLeg(
  classifier: AnthropicClaimClassifier,
  results: CaseResult[],
): Promise<void> {
  console.log(
    `\n[classifier ENFORCE] driving ${CORPUS.length} prohibited sentence(s) through the real gate...`,
  );
  for (const c of CORPUS) {
    process.stdout.write(`  ${c.id} `);
    const outcome = await runClaimEnforceGate({ response: c.prohibitedSentence, classifier });
    const postGrade = gradeClaim({ responseText: outcome.finalResponse, crashed: false });
    const expectEscalate = ESCALATE_TYPES.has(c.claimType);
    const actedCorrectly =
      outcome.action !== "none" && (expectEscalate ? outcome.escalated : outcome.rewritten);
    const pass = actedCorrectly && postGrade.pass;
    results.push({
      id: c.id,
      mode: "enforce",
      pass,
      detail: pass
        ? `${outcome.action} (neutralized)`
        : `action=${outcome.action} expected=${expectEscalate ? "escalate" : "rewrite"} postGrade=${postGrade.pass ? "pass" : codes(postGrade.violations)}`,
    });
    process.stdout.write(pass ? `ok (${outcome.action})\n` : "FAIL\n");
  }
}

/**
 * Controls — drive REAL Alex over benign inbounds and assert the grader does NOT
 * flag an ordinary reply (a false positive is a grader-precision defect).
 */
async function runControlLeg(client: Anthropic, results: CaseResult[]): Promise<void> {
  console.log(`\n[control] driving ${CONTROLS.length} benign case(s) through real Alex...`);
  for (const c of CONTROLS) {
    process.stdout.write(`  ${c.id} `);
    const output = await runClaimCaseOff(c.payload, c.id, {
      anthropicClient: client,
      model: ALEX_MODEL,
    });
    const grade = gradeClaim(output);
    results.push({
      id: c.id,
      mode: "control",
      pass: grade.pass,
      detail: grade.pass ? "no false positive" : `false-positive: ${codes(grade.violations)}`,
    });
    process.stdout.write(grade.pass ? "ok\n" : `FAIL (${codes(grade.violations)})\n`);
  }
}

async function main(): Promise<void> {
  // ------------------------------------------------------------------
  // API-key preflight: skip on a non-main run, hard-fail on main push.
  // ------------------------------------------------------------------
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    if (isMainPush(process.env)) {
      console.error("claim-boundary eval failed: ANTHROPIC_API_KEY is required on main push");
      process.exit(2);
    }
    console.log(SKIP_MESSAGE);
    appendStepSummary(SKIP_MESSAGE);
    process.exit(0);
  }

  const client = new Anthropic({ apiKey });
  const classifier = createAnthropicClaimClassifier(client);
  const results: CaseResult[] = [];

  await runOffLeg(client, results);
  await runEnforceLeg(classifier, results);
  await runControlLeg(client, results);

  console.log("\n" + summarize(results));

  // ------------------------------------------------------------------
  // HARD GATE: any failure on a live run is a real finding — a prompt-only
  // claim-boundary breach (OFF), a gate that failed to neutralize a prohibited
  // claim (ENFORCE), or a grader false positive (control). Fail loudly + SURFACE.
  // ------------------------------------------------------------------
  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.error(`\n⚠️  CLAIM-BOUNDARY FINDING — ${failures.length} case(s) failed:`);
    for (const f of failures) console.error(`  - [${f.mode}] ${f.id}: ${f.detail}`);
    appendStepSummary(
      `claim-boundary: ${failures.length} FINDING(s) — ${failures.map((f) => `${f.mode}:${f.id}`).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(
    "\nAll claim-boundary cases passed (OFF refused/hedged, ENFORCE neutralized, controls clean).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
