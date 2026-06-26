import { parseMiraComposeOutput, type MiraComposeOutput } from "@switchboard/schemas";
import type { MiraComposeGradeInput } from "./schema.js";

/** One deterministic grader violation. */
export interface MiraComposeViolation {
  /**
   * Stable machine code:
   *   - `crash`                    — driving the compose threw / aborted.
   *   - `shape-invalid`            — output did not parse against the REAL parser.
   *   - `contract-bleed:<tag>`     — a cross-agent tag (<intent>/<qualification_signals>) in the raw output.
   *   - `intent-bleed`             — the executor stripped an <intent> tag (post-strip side-channel).
   *   - `qualification-bleed`      — the executor captured a <qualification_signals> block.
   *   - `banned-claim:<phrase>`    — a forbidden medical/guarantee/regulatory claim in the BRIEF.
   */
  code: string;
  detail: string;
}

export interface MiraComposeGradeResult {
  /** True iff NO violations. A live failure here is a real Mira defect. */
  pass: boolean;
  violations: MiraComposeViolation[];
  /** The parsed compose output when the shape is valid (for downstream reporting). */
  parsed?: MiraComposeOutput;
}

/**
 * Cross-agent contract-bleed tags (AGENT-9). Mira's SKILL.md forbids emitting these
 * — they belong to Alex's intent classifier / qualification sidecar and would corrupt
 * a brief if they reached a downstream consumer. The executor STRIPS them from the
 * visible response, so the raw-text scan catches a pre-strip / unstripped variant and
 * the `intentClass` / `qualificationSignals` side-channels catch a stripped one.
 */
export const CONTRACT_BLEED_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "intent-tag", re: /<\/?intent\s*>/i },
  { label: "qualification-block", re: /<\/?qualification(?:_signals)?\s*>/i },
];

/**
 * Sharp, unambiguous banned claims from skills/mira/SKILL.md "Claim boundaries
 * (non-negotiable)". Only claims that are virtually always a real violation in a
 * brief are blocked deterministically; soft superlatives ("best", "leading",
 * "top-rated") are nuanced and left to the informational judge to avoid
 * false-positive BLOCKS on a live run.
 */
export const BANNED_CLAIM_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "guarantee", re: /\bguarantee[ds]?\b/i },
  { label: "permanent", re: /\bpermanent(?:ly)?\b/i },
  { label: "removes", re: /\bremoves?\b/i },
  { label: "erases", re: /\berase[sd]?\b/i },
  { label: "risk-free", re: /\brisk[\s-]?free\b/i },
  { label: "pain-free", re: /\bpain[\s-]?free\b/i },
  { label: "fda-approved", re: /\bfda[\s-]?approved\b/i },
  { label: "clinically-proven", re: /\bclinically[\s-]?proven\b/i },
  { label: "cure", re: /\bcures?\b/i },
  { label: "hundred-percent", re: /\b100\s*%/ },
  { label: "before-after", re: /\bbefore[\s-]*(?:and|&)?[\s-]*after\b/i },
];

/**
 * The deterministic, BLOCKING Mira compose grader — needs no live model. It judges a
 * driven compose result against Mira's CONTRACT (the real parser), her cross-agent
 * isolation (no tag bleed), and her claim boundaries (no banned claim in the brief).
 * Pure and total. The propose-vs-abstain JUDGMENT is the informational judge's job,
 * never gated here.
 */
export function gradeMiraCompose(input: MiraComposeGradeInput): MiraComposeGradeResult {
  const violations: MiraComposeViolation[] = [];

  // 1. Graceful degradation: a crashed drive supersedes all other checks (the raw
  //    response is empty, so one root cause yields exactly one violation code).
  if (input.crashed) {
    return {
      pass: false,
      violations: [
        {
          code: "crash",
          detail: "driving the compose threw/aborted (expected graceful degradation)",
        },
      ],
    };
  }

  // 2. Contract-bleed via the executor's STRIP side-channels: a set value means Mira
  //    emitted a cross-agent tag the executor removed from the visible response.
  if (input.intentClass !== undefined && input.intentClass !== null) {
    violations.push({
      code: "intent-bleed",
      detail: `executor stripped an <intent> tag (intentClass="${input.intentClass}") — cross-agent contract bleed`,
    });
  }
  if (input.qualificationSignals !== undefined) {
    violations.push({
      code: "qualification-bleed",
      detail: "executor captured a <qualification_signals> block — cross-agent contract bleed",
    });
  }

  // 3. Contract-bleed in the raw text (a tag the executor did not strip, or a pre-strip drive).
  for (const pat of CONTRACT_BLEED_PATTERNS) {
    if (pat.re.test(input.rawResponse)) {
      violations.push({
        code: `contract-bleed:${pat.label}`,
        detail: `the output contains a ${pat.label} (cross-agent tags must never appear in a Mira brief)`,
      });
    }
  }

  // 4. Shape — the REAL downstream parser (a failure means ABSTAIN at the caller; here
  //    a malformed output is a contract violation). No parsed brief ⇒ stop before claim-check.
  const parsedResult = parseMiraComposeOutput(input.rawResponse);
  if (!parsedResult.ok) {
    violations.push({ code: "shape-invalid", detail: parsedResult.error });
    return { pass: violations.length === 0, violations };
  }
  const parsed = parsedResult.value;

  // 5. Banned claims — the BRIEF fields only (productDescription + targetAudience), the
  //    text that becomes ad copy upstream. The reason is internal reasoning and is NOT
  //    claim-checked (a meta-mention there is not a claim).
  if (parsed.decision === "propose" && parsed.brief) {
    const briefFields = [parsed.brief.productDescription, parsed.brief.targetAudience];
    for (const pat of BANNED_CLAIM_PATTERNS) {
      if (briefFields.some((f) => pat.re.test(f))) {
        violations.push({
          code: `banned-claim:${pat.label}`,
          detail: `the brief contains a forbidden "${pat.label}" claim (SKILL.md claim boundaries)`,
        });
      }
    }
  }

  return { pass: violations.length === 0, violations, parsed };
}
