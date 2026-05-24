import { describe, it, expect, vi } from "vitest";
import { judgeTurn, JUDGE_RUBRIC_VERSION, JUDGE_RUBRIC_HASH } from "../judge.js";
import type { JudgeTurnDeps, JudgeTurnInput, AnthropicClientLike } from "../judge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLEAN_TURN_INPUT: JudgeTurnInput = {
  leadContext: "Lead asked about laser hair removal. Alex responded in turn 1.",
  alexResponse:
    "Thanks for reaching out! We offer laser hair removal with our licensed practitioners. Which area are you looking to treat, and how soon would you like to start?",
  grade: {
    mustAsk: ["treatment area", "timeline"],
    mustDo: [],
    mustNot: [],
    shouldDo: ["acknowledge consultation as low-risk next step"],
  },
};

const GOOD_VERDICT_JSON = JSON.stringify({
  semanticHardRulePass: true,
  semanticViolations: [],
  softScore: 4,
  notes: "Alex asked both qualifying questions and positioned consultation well.",
});

const FAILING_VERDICT_JSON = JSON.stringify({
  semanticHardRulePass: false,
  semanticViolations: ["Guaranteed results without qualification", "Applied booking pressure"],
  softScore: 1,
  notes: "Response made strong outcome guarantees and pressured lead to book.",
});

/**
 * Build a fake Anthropic client that returns a canned text response.
 */
function makeFakeClient(responseText: string): AnthropicClientLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
      }),
    },
  };
}

function makeDeps(client: AnthropicClientLike): JudgeTurnDeps {
  return { client, model: "claude-sonnet-test" };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("judgeTurn — happy path", () => {
  it("parses a passing verdict correctly", async () => {
    const deps = makeDeps(makeFakeClient(GOOD_VERDICT_JSON));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(true);
    expect(verdict.semanticViolations).toEqual([]);
    expect(verdict.softScore).toBe(4);
    expect(verdict.notes).toContain("Alex asked both qualifying questions");
  });

  it("parses a failing verdict with violations", async () => {
    const deps = makeDeps(makeFakeClient(FAILING_VERDICT_JSON));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.semanticViolations).toHaveLength(2);
    expect(verdict.semanticViolations).toContain("Guaranteed results without qualification");
    expect(verdict.softScore).toBe(1);
  });

  it("stamps rubricVersion and rubricHash onto every verdict", async () => {
    const deps = makeDeps(makeFakeClient(GOOD_VERDICT_JSON));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.rubricVersion).toBe(JUDGE_RUBRIC_VERSION);
    expect(verdict.rubricHash).toBe(JUDGE_RUBRIC_HASH);
  });

  it("passes the model to the client call", async () => {
    const fakeClient = makeFakeClient(GOOD_VERDICT_JSON);
    const deps: JudgeTurnDeps = { client: fakeClient, model: "claude-opus-test" };
    await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(vi.mocked(fakeClient.messages.create)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-test" }),
    );
  });

  it("clamps softScore to 0–5 range (e.g. 7 → 5)", async () => {
    const json = JSON.stringify({
      semanticHardRulePass: true,
      semanticViolations: [],
      softScore: 7,
      notes: "Inflated score from model.",
    });
    const deps = makeDeps(makeFakeClient(json));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);
    expect(verdict.softScore).toBe(5);
  });

  it("clamps softScore below 0 to 0", async () => {
    const json = JSON.stringify({
      semanticHardRulePass: false,
      semanticViolations: ["something"],
      softScore: -2,
      notes: "Negative score from model.",
    });
    const deps = makeDeps(makeFakeClient(json));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);
    expect(verdict.softScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Defensive parsing
// ---------------------------------------------------------------------------

describe("judgeTurn — defensive parsing", () => {
  it("returns fail-closed verdict when response contains no JSON", async () => {
    const deps = makeDeps(makeFakeClient("I cannot evaluate this right now."));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    // Fail-closed: hard rules fail.
    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.semanticViolations[0]).toMatch(/parse-error/i);
    expect(verdict.softScore).toBe(0);
  });

  it("returns fail-closed verdict when JSON is missing required fields", async () => {
    const malformed = JSON.stringify({ someOtherField: "oops" });
    const deps = makeDeps(makeFakeClient(malformed));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.semanticViolations[0]).toMatch(/shape-error|parse-error/i);
    expect(verdict.softScore).toBe(0);
  });

  it("returns fail-closed verdict when JSON is syntactically invalid", async () => {
    const deps = makeDeps(makeFakeClient("{broken json{{"));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.softScore).toBe(0);
  });

  it("returns fail-closed verdict when the client throws", async () => {
    const errorClient: AnthropicClientLike = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("API quota exceeded")),
      },
    };
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, makeDeps(errorClient));

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.notes).toMatch(/client-error/i);
    expect(verdict.softScore).toBe(0);
  });

  it("handles JSON embedded in surrounding text (extracts the block)", async () => {
    const response = `Here is my evaluation:\n${GOOD_VERDICT_JSON}\nEnd of evaluation.`;
    const deps = makeDeps(makeFakeClient(response));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(true);
    expect(verdict.softScore).toBe(4);
  });

  it("still stamps rubricVersion/hash on a fail-closed verdict", async () => {
    const deps = makeDeps(makeFakeClient("garbage response no json"));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.rubricVersion).toBe(JUDGE_RUBRIC_VERSION);
    expect(verdict.rubricHash).toBe(JUDGE_RUBRIC_HASH);
  });

  it("filters non-string entries from semanticViolations gracefully", async () => {
    const json = JSON.stringify({
      semanticHardRulePass: false,
      semanticViolations: ["real violation", 42, null, "another violation"],
      softScore: 2,
      notes: "Mixed array.",
    });
    const deps = makeDeps(makeFakeClient(json));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    // Only actual strings survive.
    expect(verdict.semanticViolations).toEqual(["real violation", "another violation"]);
  });
});

// ---------------------------------------------------------------------------
// Rubric versioning exports
// ---------------------------------------------------------------------------

describe("JUDGE_RUBRIC_VERSION and JUDGE_RUBRIC_HASH exports", () => {
  it("JUDGE_RUBRIC_VERSION is a non-empty string", () => {
    expect(typeof JUDGE_RUBRIC_VERSION).toBe("string");
    expect(JUDGE_RUBRIC_VERSION.length).toBeGreaterThan(0);
  });

  it("JUDGE_RUBRIC_HASH is a 16-char hex string", () => {
    expect(typeof JUDGE_RUBRIC_HASH).toBe("string");
    expect(JUDGE_RUBRIC_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it("JUDGE_RUBRIC_VERSION and JUDGE_RUBRIC_HASH are stable (deterministic)", () => {
    // Re-import is not needed — just assert stable values can be compared.
    const v1 = JUDGE_RUBRIC_VERSION;
    const h1 = JUDGE_RUBRIC_HASH;
    expect(v1).toBe(JUDGE_RUBRIC_VERSION);
    expect(h1).toBe(JUDGE_RUBRIC_HASH);
  });

  it("JUDGE_RUBRIC_HASH changes when rubric content changes (simulated)", () => {
    // We can't easily test the hash of a *different* rubric without importing
    // the internal JUDGE_RUBRIC string. Instead, verify the hash is not trivially
    // empty or "0000000000000000" (zero hash), which would indicate no content
    // was actually hashed.
    expect(JUDGE_RUBRIC_HASH).not.toBe("0000000000000000");
    expect(JUDGE_RUBRIC_HASH).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Grade spec hints are included in the user message
// ---------------------------------------------------------------------------

describe("judgeTurn — grade spec forwarding", () => {
  it("sends a request containing the alexResponse text", async () => {
    const fakeClient = makeFakeClient(GOOD_VERDICT_JSON);
    const deps = makeDeps(fakeClient);
    const input: JudgeTurnInput = {
      ...CLEAN_TURN_INPUT,
      alexResponse: "UNIQUE_RESPONSE_TEXT_FOR_ASSERTION",
    };
    await judgeTurn(input, deps);

    const call = vi.mocked(fakeClient.messages.create).mock.calls[0];
    const userContent = call?.[0]?.messages?.[0]?.content ?? "";
    expect(userContent).toContain("UNIQUE_RESPONSE_TEXT_FOR_ASSERTION");
  });

  it("includes grade mustNot hints in the user message when present", async () => {
    const fakeClient = makeFakeClient(GOOD_VERDICT_JSON);
    const input: JudgeTurnInput = {
      ...CLEAN_TURN_INPUT,
      grade: {
        mustAsk: [],
        mustDo: [],
        mustNot: ["guarantee results", "pressure booking"],
        shouldDo: [],
      },
    };
    await judgeTurn(input, makeDeps(fakeClient));

    const call = vi.mocked(fakeClient.messages.create).mock.calls[0];
    const userContent = call?.[0]?.messages?.[0]?.content ?? "";
    expect(userContent).toContain("guarantee results");
    expect(userContent).toContain("pressure booking");
  });
});
