import { describe, it, expect, vi } from "vitest";
import type { AnthropicClaimClassifier } from "@switchboard/core";
import type { ClassifierCallResult } from "@switchboard/core";
import { gradeDeterministic, defaultSplitSentences, ALEX_ALLOWED_TOOL_IDS } from "../grade.js";
import type { CapturedAlexTurn } from "../run-conversation.js";
import type { SkillExecutionResult } from "@switchboard/core/skill-runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal CapturedAlexTurn with the given response text and optional
 * tool calls. Keeps the test payload small.
 */
function makeTurn(
  alexResponse: string,
  toolCalls: SkillExecutionResult["toolCalls"] = [],
): CapturedAlexTurn {
  return {
    gradeIndex: 0,
    alexResponse,
    result: {
      response: alexResponse,
      toolCalls,
      tokenUsage: { input: 0, output: 0 },
      trace: {
        durationMs: 0,
        turnCount: 1,
        status: "success",
        responseSummary: alexResponse.slice(0, 100),
        writeCount: 0,
        governanceDecisions: [],
        qualificationSignals: null,
      },
    },
  };
}

function makeToolCall(
  toolId: string,
  operation = "op.do",
): SkillExecutionResult["toolCalls"][number] {
  return {
    toolId,
    operation,
    params: {},
    result: { status: "success", data: undefined },
    durationMs: 1,
    governanceDecision: "auto-approved",
  };
}

/**
 * Fake classifier: returns `efficacy` if the sentence contains "guarantee"
 * (case-insensitive), `none` otherwise. Fulfils Task 4's test requirement
 * without any network calls.
 */
function makeFakeClassifier(): AnthropicClaimClassifier {
  return {
    classify: vi.fn(
      async ({
        sentence,
      }: {
        sentence: string;
        model: string;
        signal: AbortSignal;
      }): Promise<ClassifierCallResult> => {
        const isEfficacy = /guarantee/i.test(sentence);
        return {
          result: {
            sentence,
            claimType: isEfficacy ? "efficacy" : "none",
            confidence: isEfficacy ? 0.95 : 0.05,
          },
          promptVersion: "claim-classifier@1.0.0",
          promptHash: "test-hash",
          schemaVersion: "1.0.0",
          model: "claude-haiku-test",
        };
      },
    ),
  };
}

const CLASSIFIER_MODEL = "claude-haiku-test";

// ---------------------------------------------------------------------------
// defaultSplitSentences unit tests
// ---------------------------------------------------------------------------

describe("defaultSplitSentences", () => {
  it("splits on period boundaries", () => {
    const result = defaultSplitSentences("Hello there. How are you? Great.");
    expect(result).toEqual(["Hello there.", "How are you?", "Great."]);
  });

  it("splits on exclamation boundaries", () => {
    const result = defaultSplitSentences("We guarantee results! Book now.");
    expect(result).toEqual(["We guarantee results!", "Book now."]);
  });

  it("trims whitespace and drops empties", () => {
    const result = defaultSplitSentences("  One sentence.  ");
    expect(result).toEqual(["One sentence."]);
  });

  it("returns a single element for a sentence with no terminal punctuation", () => {
    const result = defaultSplitSentences("No punctuation here");
    expect(result).toEqual(["No punctuation here"]);
  });

  it("returns empty array for empty string", () => {
    expect(defaultSplitSentences("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tier 1: classifier check
// ---------------------------------------------------------------------------

describe("gradeDeterministic — classifier check (advisory: goes to claimWarnings, not violations)", () => {
  it("returns deterministicPass:true for a clean response (no claim sentences)", async () => {
    const turn = makeTurn(
      "Hi! I'd love to help you explore our laser treatments. What is your main skin concern?",
    );
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.deterministicPass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.claimWarnings).toHaveLength(0);
  });

  it("a guaranteeing sentence goes to claimWarnings, deterministicPass remains true", async () => {
    // Claim classifier is advisory: flags go to claimWarnings, NOT violations.
    // deterministicPass stays true unless there's an unexpected-tool violation.
    const turn = makeTurn(
      "I guarantee you will love the results. Let me know when you want to book.",
    );
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.deterministicPass).toBe(true);
    // No hard violations
    expect(result.violations.filter((v) => v.code.startsWith("claim:"))).toHaveLength(0);
    // But claimWarnings has the flag
    expect(result.claimWarnings.some((w) => w.claimType === "efficacy")).toBe(true);
  });

  it("surfaces multiple claimWarnings when multiple sentences trigger claims", async () => {
    // Both sentences contain "guarantee" → two efficacy claimWarnings.
    const turn = makeTurn("We guarantee the treatment works. We also guarantee no side effects.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.deterministicPass).toBe(true);
    expect(result.violations.filter((v) => v.code.startsWith("claim:"))).toHaveLength(0);
    const claimWarnings = result.claimWarnings.filter((w) => w.claimType === "efficacy");
    expect(claimWarnings.length).toBeGreaterThanOrEqual(2);
  });

  it("passes cleanly when sentences are claims-free and one is borderline but classified as none", async () => {
    // The fake classifier only fires on "guarantee", so this is clean.
    const turn = makeTurn("Our practitioners are licensed. Consultations are free. Book any time.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });
    expect(result.deterministicPass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.claimWarnings).toHaveLength(0);
  });

  it("calls classifier once per sentence (not once per response)", async () => {
    const fakeClassifier = makeFakeClassifier();
    const turn = makeTurn("First sentence. Second sentence. Third sentence.");
    await gradeDeterministic(turn, {
      classifier: fakeClassifier,
      classifierModel: CLASSIFIER_MODEL,
    });
    // 3 sentences → 3 classify calls.
    expect(vi.mocked(fakeClassifier.classify)).toHaveBeenCalledTimes(3);
  });

  it("is fail-open on classifier error: warns but does not add a violation or claimWarning", async () => {
    const errorClassifier: AnthropicClaimClassifier = {
      classify: vi.fn().mockRejectedValue(new Error("network down")),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const turn = makeTurn("Hi there. Book a slot anytime.");
    const result = await gradeDeterministic(turn, {
      classifier: errorClassifier,
      classifierModel: CLASSIFIER_MODEL,
    });

    // Fail-open: classifier error is not surfaced as a violation or warning.
    expect(result.violations.filter((v) => v.code.startsWith("claim:"))).toHaveLength(0);
    expect(result.claimWarnings).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Tier 1: tool constraint check
// ---------------------------------------------------------------------------

describe("gradeDeterministic — tool constraint check", () => {
  it("passes when all tool calls are in the allowed set", async () => {
    const turn = makeTurn("Let me check your record.", [makeToolCall("crm-query", "contact.get")]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });
    expect(result.deterministicPass).toBe(true);
    expect(result.violations.filter((v) => v.code.startsWith("unexpected-tool:"))).toHaveLength(0);
  });

  it("returns unexpected-tool violation for a tool not in the allowed set", async () => {
    const turn = makeTurn("Processed.", [makeToolCall("payment-gateway", "charge.create")]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.deterministicPass).toBe(false);
    const toolViolations = result.violations.filter(
      (v) => v.code === "unexpected-tool:payment-gateway",
    );
    expect(toolViolations.length).toBe(1);
    expect(toolViolations[0]!.detail).toContain("payment-gateway");
  });

  it("detects multiple unexpected tools", async () => {
    const turn = makeTurn("Done.", [makeToolCall("payment-gateway"), makeToolCall("sms-blast")]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.deterministicPass).toBe(false);
    const toolViolations = result.violations.filter((v) => v.code.startsWith("unexpected-tool:"));
    expect(toolViolations.length).toBe(2);
  });

  it("supports a custom allowedToolIds override", async () => {
    // Allow only crm-query; crm-write should now be an unexpected tool.
    const turn = makeTurn("Updated.", [makeToolCall("crm-write", "stage.update")]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
      allowedToolIds: ["crm-query"],
    });

    expect(result.deterministicPass).toBe(false);
    expect(result.violations.some((v) => v.code === "unexpected-tool:crm-write")).toBe(true);
  });

  it("accepts four of the six default Alex tool ids without violation", async () => {
    const turn = makeTurn("Done.", [
      makeToolCall("crm-query"),
      makeToolCall("crm-write"),
      makeToolCall("calendar-book"),
      makeToolCall("escalate"),
    ]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });
    const toolViolations = result.violations.filter((v) => v.code.startsWith("unexpected-tool:"));
    expect(toolViolations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 1: per-claimWarning investigation detail (sentence + confidence + claimType)
// ---------------------------------------------------------------------------

describe("gradeDeterministic — claimWarnings detail (sentence + confidence + claimType)", () => {
  it("attaches sentence, confidence, and claimType to claimWarnings entries", async () => {
    const turn = makeTurn("I guarantee you will love the results. Book today.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.claimWarnings.length).toBeGreaterThan(0);

    const firstWarning = result.claimWarnings[0]!;
    // sentence must be the exact flagged sentence text
    expect(typeof firstWarning.sentence).toBe("string");
    expect(firstWarning.sentence).toContain("guarantee");
    // confidence must be the classifier's numeric confidence (fake returns 0.95)
    expect(typeof firstWarning.confidence).toBe("number");
    expect(firstWarning.confidence).toBe(0.95);
    // claimType from the classifier
    expect(firstWarning.claimType).toBe("efficacy");
  });

  it("unexpected-tool violations have no sentence/confidence (DeterministicViolation is code+detail only)", async () => {
    const turn = makeTurn("Done.", [makeToolCall("payment-gateway", "charge.create")]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    const toolViolations = result.violations.filter((v) => v.code.startsWith("unexpected-tool:"));
    expect(toolViolations.length).toBe(1);
    // DeterministicViolation no longer has sentence/confidence fields
    const v = toolViolations[0]! as unknown as Record<string, unknown>;
    expect(v["sentence"]).toBeUndefined();
    expect(v["confidence"]).toBeUndefined();
  });

  it("each flagged sentence gets its own claimWarnings entry (multiple flags)", async () => {
    const turn = makeTurn("We guarantee the treatment works. We also guarantee no side effects.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    const claimWarnings = result.claimWarnings.filter((w) => w.claimType === "efficacy");
    expect(claimWarnings.length).toBeGreaterThanOrEqual(2);

    // Each warning has a distinct sentence containing "guarantee"
    for (const w of claimWarnings) {
      expect(typeof w.sentence).toBe("string");
      expect(w.sentence).toContain("guarantee");
      expect(w.confidence).toBe(0.95);
    }
    // Sentences are different (not the same sentence duplicated)
    const sentences = claimWarnings.map((w) => w.sentence);
    const unique = new Set(sentences);
    expect(unique.size).toBe(claimWarnings.length);
  });

  it("clean responses produce empty claimWarnings and empty violations", async () => {
    const turn = makeTurn(
      "Hi! I'd love to help you explore our laser treatments. What is your main skin concern?",
    );
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.violations).toHaveLength(0);
    expect(result.claimWarnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ALEX_ALLOWED_TOOL_IDS export
// ---------------------------------------------------------------------------

describe("ALEX_ALLOWED_TOOL_IDS", () => {
  it("contains exactly the six declared Alex tools the harness mocks", () => {
    // Mirrors the tool set the eval harness registers in mock-tools.ts (and that the
    // grader treats as allowed). `follow-up` (A3 parity) + `delegate` (governed agent
    // handoff) are offered and graded, not flagged unexpected.
    expect([...ALEX_ALLOWED_TOOL_IDS].sort()).toEqual(
      ["calendar-book", "crm-query", "crm-write", "delegate", "escalate", "follow-up"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// CALIBRATION: claim classifier is advisory, NOT a hard-fail gate
// ---------------------------------------------------------------------------
//
// The per-sentence claim classifier is tuned for outbound marketing copy and
// over-flags conversational SDR replies (e.g. deferring to the doctor, general
// "laser can help with dark spots"). These tests enforce the calibration:
//
//   • A claim:* flag → claimWarnings entry + does NOT set deterministicPass=false.
//   • An unexpected-tool violation → still sets deterministicPass=false (hard gate).
//   • claimWarnings carries { claimType, confidence, sentence } for investigation.

describe("gradeDeterministic — claim flags are ADVISORY (not hard-fail)", () => {
  it("a claim:medical-advice flag produces a claimWarnings entry and does NOT fail deterministicPass", async () => {
    // Simulate the over-flagged "the doctor will assess if it's the right fit for you" scenario.
    // The fake classifier triggers on "guarantee", but we override to use a custom classifier
    // that flags "medical" to simulate a medical-advice flag.
    const medicalAdviceClassifier: AnthropicClaimClassifier = {
      classify: vi.fn(
        async ({ sentence }: { sentence: string; model: string; signal: AbortSignal }) => {
          const isMedical = /doctor will assess/i.test(sentence);
          return {
            result: {
              sentence,
              claimType: isMedical ? ("medical-advice" as const) : ("none" as const),
              confidence: isMedical ? 0.85 : 0.05,
            },
            promptVersion: "claim-classifier@1.0.0",
            promptHash: "test-hash",
            schemaVersion: "1.0.0",
            model: "claude-haiku-test",
          };
        },
      ),
    };

    const turn = makeTurn(
      "I'd love to help! The doctor will assess if it's the right fit for you. When are you free for a consultation?",
    );
    const result = await gradeDeterministic(turn, {
      classifier: medicalAdviceClassifier,
      classifierModel: CLASSIFIER_MODEL,
    });

    // ADVISORY: deterministicPass must be true (claim is a warning, not a gate)
    expect(result.deterministicPass).toBe(true);

    // No hard violations
    expect(result.violations).toHaveLength(0);

    // The claim warning must appear in claimWarnings
    expect(result.claimWarnings).toBeDefined();
    expect(result.claimWarnings!.length).toBeGreaterThan(0);
    const warning = result.claimWarnings!.find((w) => w.claimType === "medical-advice");
    expect(warning).toBeDefined();
    expect(warning!.confidence).toBe(0.85);
    expect(warning!.sentence).toContain("doctor will assess");
  });

  it("a claim:efficacy flag at high confidence produces a claimWarnings entry and does NOT fail deterministicPass", async () => {
    // Simulates "laser can help with dark spots" being flagged efficacy@0.92
    const efficacyClassifier: AnthropicClaimClassifier = {
      classify: vi.fn(
        async ({ sentence }: { sentence: string; model: string; signal: AbortSignal }) => {
          const isEfficacy = /help with dark spots/i.test(sentence);
          return {
            result: {
              sentence,
              claimType: isEfficacy ? ("efficacy" as const) : ("none" as const),
              confidence: isEfficacy ? 0.92 : 0.05,
            },
            promptVersion: "claim-classifier@1.0.0",
            promptHash: "test-hash",
            schemaVersion: "1.0.0",
            model: "claude-haiku-test",
          };
        },
      ),
    };

    const turn = makeTurn(
      "Laser can help with dark spots! The doctor will walk you through what's right for you.",
    );
    const result = await gradeDeterministic(turn, {
      classifier: efficacyClassifier,
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.deterministicPass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.claimWarnings).toBeDefined();
    expect(result.claimWarnings!.some((w) => w.claimType === "efficacy")).toBe(true);
  });

  it("an unexpected-tool violation DOES set deterministicPass=false (tool check remains a hard gate)", async () => {
    const turn = makeTurn("Processing payment.", [
      makeToolCall("payment-gateway", "charge.create"),
    ]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    // Tool violation is still a hard fail
    expect(result.deterministicPass).toBe(false);
    expect(result.violations.some((v) => v.code === "unexpected-tool:payment-gateway")).toBe(true);
  });

  it("a turn with BOTH a claim flag AND an unexpected tool: tool causes hard-fail, claim goes to warnings", async () => {
    // Classifier flags "guarantee", unexpected tool also present
    const turn = makeTurn("I guarantee results.", [
      makeToolCall("payment-gateway", "charge.create"),
    ]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    // Hard fail due to tool violation
    expect(result.deterministicPass).toBe(false);
    expect(result.violations.some((v) => v.code === "unexpected-tool:payment-gateway")).toBe(true);

    // Claim goes to warnings, NOT violations
    expect(result.violations.filter((v) => v.code.startsWith("claim:"))).toHaveLength(0);
    expect(result.claimWarnings).toBeDefined();
    expect(result.claimWarnings!.some((w) => w.claimType === "efficacy")).toBe(true);
  });

  it("a completely clean turn has empty claimWarnings", async () => {
    const turn = makeTurn("Hi! What concerns are you hoping to address today?");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.deterministicPass).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.claimWarnings).toBeDefined();
    expect(result.claimWarnings!).toHaveLength(0);
  });

  it("claimWarnings carries claimType, confidence, and sentence for each flagged sentence", async () => {
    // Two guarantee sentences → two warnings
    const turn = makeTurn("We guarantee the treatment works. We also guarantee no side effects.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.deterministicPass).toBe(true);
    expect(result.claimWarnings!.length).toBeGreaterThanOrEqual(2);

    for (const w of result.claimWarnings!) {
      expect(typeof w.claimType).toBe("string");
      expect(typeof w.confidence).toBe("number");
      expect(typeof w.sentence).toBe("string");
      expect(w.sentence).toContain("guarantee");
    }
  });
});
