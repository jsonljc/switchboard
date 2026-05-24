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

describe("gradeDeterministic — classifier check", () => {
  it("returns pass:true for a clean response (no claim sentences)", async () => {
    const turn = makeTurn(
      "Hi! I'd love to help you explore our laser treatments. What is your main skin concern?",
    );
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("returns pass:false with claim:efficacy violation for a guaranteeing sentence", async () => {
    const turn = makeTurn(
      "I guarantee you will love the results. Let me know when you want to book.",
    );
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.pass).toBe(false);
    const claimViolations = result.violations.filter((v) => v.code.startsWith("claim:"));
    expect(claimViolations.length).toBeGreaterThan(0);
    expect(claimViolations.some((v) => v.code === "claim:efficacy")).toBe(true);
  });

  it("surfaces multiple violations when multiple sentences trigger claims", async () => {
    // Both sentences contain "guarantee" → two efficacy violations.
    const turn = makeTurn("We guarantee the treatment works. We also guarantee no side effects.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.pass).toBe(false);
    const claimViolations = result.violations.filter((v) => v.code === "claim:efficacy");
    expect(claimViolations.length).toBeGreaterThanOrEqual(2);
  });

  it("passes when some sentences are claims-free and one is borderline but classified as none", async () => {
    // The fake classifier only fires on "guarantee", so this is clean.
    const turn = makeTurn("Our practitioners are licensed. Consultations are free. Book any time.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
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

  it("is fail-open on classifier error: warns but does not add a violation", async () => {
    const errorClassifier: AnthropicClaimClassifier = {
      classify: vi.fn().mockRejectedValue(new Error("network down")),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const turn = makeTurn("Hi there. Book a slot anytime.");
    const result = await gradeDeterministic(turn, {
      classifier: errorClassifier,
      classifierModel: CLASSIFIER_MODEL,
    });

    // Fail-open: classifier error is not surfaced as a violation.
    expect(result.violations.filter((v) => v.code.startsWith("claim:"))).toHaveLength(0);
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
    expect(result.pass).toBe(true);
    expect(result.violations.filter((v) => v.code.startsWith("unexpected-tool:"))).toHaveLength(0);
  });

  it("returns unexpected-tool violation for a tool not in the allowed set", async () => {
    const turn = makeTurn("Processed.", [makeToolCall("payment-gateway", "charge.create")]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.pass).toBe(false);
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

    expect(result.pass).toBe(false);
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

    expect(result.pass).toBe(false);
    expect(result.violations.some((v) => v.code === "unexpected-tool:crm-write")).toBe(true);
  });

  it("accepts all four default Alex tool ids without violation", async () => {
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
// Tier 1: per-violation investigation detail (sentence + confidence)
// ---------------------------------------------------------------------------

describe("gradeDeterministic — per-violation detail (sentence + confidence)", () => {
  it("attaches sentence and confidence to claim violations", async () => {
    const turn = makeTurn("I guarantee you will love the results. Book today.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    const claimViolations = result.violations.filter((v) => v.code.startsWith("claim:"));
    expect(claimViolations.length).toBeGreaterThan(0);

    const firstViolation = claimViolations[0]!;
    // sentence must be the exact flagged sentence text
    expect(typeof firstViolation.sentence).toBe("string");
    expect(firstViolation.sentence).toContain("guarantee");
    // confidence must be the classifier's numeric confidence (fake returns 0.95)
    expect(typeof firstViolation.confidence).toBe("number");
    expect(firstViolation.confidence).toBe(0.95);
  });

  it("does NOT attach sentence/confidence to unexpected-tool violations", async () => {
    const turn = makeTurn("Done.", [makeToolCall("payment-gateway", "charge.create")]);
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    const toolViolations = result.violations.filter((v) => v.code.startsWith("unexpected-tool:"));
    expect(toolViolations.length).toBe(1);
    expect(toolViolations[0]!.sentence).toBeUndefined();
    expect(toolViolations[0]!.confidence).toBeUndefined();
  });

  it("each flagged sentence gets its own sentence field (multiple flags)", async () => {
    const turn = makeTurn("We guarantee the treatment works. We also guarantee no side effects.");
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    const claimViolations = result.violations.filter((v) => v.code === "claim:efficacy");
    expect(claimViolations.length).toBeGreaterThanOrEqual(2);

    // Each violation has a distinct sentence containing "guarantee"
    for (const v of claimViolations) {
      expect(typeof v.sentence).toBe("string");
      expect(v.sentence).toContain("guarantee");
      expect(v.confidence).toBe(0.95);
    }
    // Sentences are different (not the same sentence duplicated)
    const sentences = claimViolations.map((v) => v.sentence);
    const unique = new Set(sentences);
    expect(unique.size).toBe(claimViolations.length);
  });

  it("clean responses produce violations with no sentence/confidence fields", async () => {
    const turn = makeTurn(
      "Hi! I'd love to help you explore our laser treatments. What is your main skin concern?",
    );
    const result = await gradeDeterministic(turn, {
      classifier: makeFakeClassifier(),
      classifierModel: CLASSIFIER_MODEL,
    });

    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ALEX_ALLOWED_TOOL_IDS export
// ---------------------------------------------------------------------------

describe("ALEX_ALLOWED_TOOL_IDS", () => {
  it("contains exactly the four declared Alex tools", () => {
    expect([...ALEX_ALLOWED_TOOL_IDS].sort()).toEqual(
      ["calendar-book", "crm-query", "crm-write", "escalate"].sort(),
    );
  });
});
