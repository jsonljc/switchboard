import { describe, it, expect, vi } from "vitest";
import { judgeTurn, JUDGE_RUBRIC_VERSION, JUDGE_RUBRIC_HASH, JUDGE_TOOL } from "../judge.js";
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

const GOOD_TOOL_INPUT = {
  semanticHardRulePass: true,
  semanticViolations: [],
  softScore: 4,
  notes: "Alex asked both qualifying questions and positioned consultation well.",
};

const FAILING_TOOL_INPUT = {
  semanticHardRulePass: false,
  semanticViolations: ["Guaranteed results without qualification", "Applied booking pressure"],
  softScore: 1,
  notes: "Response made strong outcome guarantees and pressured lead to book.",
};

/**
 * Build a fake Anthropic client that returns a canned tool_use block.
 * This mirrors how the real Anthropic API responds when tool_choice forces a
 * specific tool call.
 */
function makeToolUseClient(toolInput: Record<string, unknown>): AnthropicClientLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: "tool_use",
            name: "judge_turn",
            input: toolInput,
          },
        ],
      }),
    },
  };
}

/**
 * Build a fake client that returns no tool_use block (only text).
 */
function makeNoToolUseClient(
  responseText = "I cannot evaluate this right now.",
): AnthropicClientLike {
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
// Happy path — tool_use block parsing
// ---------------------------------------------------------------------------

describe("judgeTurn — happy path (tool_use structured output)", () => {
  it("parses a passing verdict from tool_use block correctly", async () => {
    const deps = makeDeps(makeToolUseClient(GOOD_TOOL_INPUT));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(true);
    expect(verdict.semanticViolations).toEqual([]);
    expect(verdict.softScore).toBe(4);
    expect(verdict.notes).toContain("Alex asked both qualifying questions");
  });

  it("parses a failing verdict with violations from tool_use block", async () => {
    const deps = makeDeps(makeToolUseClient(FAILING_TOOL_INPUT));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.semanticViolations).toHaveLength(2);
    expect(verdict.semanticViolations).toContain("Guaranteed results without qualification");
    expect(verdict.softScore).toBe(1);
  });

  it("stamps rubricVersion and rubricHash onto every verdict", async () => {
    const deps = makeDeps(makeToolUseClient(GOOD_TOOL_INPUT));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.rubricVersion).toBe(JUDGE_RUBRIC_VERSION);
    expect(verdict.rubricHash).toBe(JUDGE_RUBRIC_HASH);
  });

  it("passes model, tools, and tool_choice to the client call", async () => {
    const fakeClient = makeToolUseClient(GOOD_TOOL_INPUT);
    const deps: JudgeTurnDeps = { client: fakeClient, model: "claude-opus-test" };
    await judgeTurn(CLEAN_TURN_INPUT, deps);

    const call = vi.mocked(fakeClient.messages.create).mock.calls[0]![0];
    expect(call.model).toBe("claude-opus-test");
    expect(call.tool_choice).toEqual({ type: "tool", name: "judge_turn" });
    expect(call.tools).toHaveLength(1);
    expect((call.tools[0] as { name: string }).name).toBe("judge_turn");
  });

  it("clamps softScore to 0–5 range (e.g. 7 → 5)", async () => {
    const deps = makeDeps(
      makeToolUseClient({
        semanticHardRulePass: true,
        semanticViolations: [],
        softScore: 7,
        notes: "Inflated score from model.",
      }),
    );
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);
    expect(verdict.softScore).toBe(5);
  });

  it("clamps softScore below 0 to 0", async () => {
    const deps = makeDeps(
      makeToolUseClient({
        semanticHardRulePass: false,
        semanticViolations: ["something"],
        softScore: -2,
        notes: "Negative score from model.",
      }),
    );
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);
    expect(verdict.softScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: no tool_use block returned
// ---------------------------------------------------------------------------

describe("judgeTurn — fail-closed when no tool_use block", () => {
  it("returns fail-closed verdict when response contains no tool_use block", async () => {
    const deps = makeDeps(makeNoToolUseClient("I cannot evaluate this right now."));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.semanticViolations[0]).toMatch(/no-judge-tooluse/i);
    expect(verdict.softScore).toBe(0);
  });

  it("returns fail-closed verdict when response is empty content array", async () => {
    const emptyClient: AnthropicClientLike = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [] }),
      },
    };
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, makeDeps(emptyClient));

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.semanticViolations[0]).toMatch(/no-judge-tooluse/i);
    expect(verdict.softScore).toBe(0);
  });

  it("returns fail-closed verdict when tool_use has wrong name", async () => {
    const wrongToolClient: AnthropicClientLike = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "tool_use", name: "some_other_tool", input: GOOD_TOOL_INPUT }],
        }),
      },
    };
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, makeDeps(wrongToolClient));

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.semanticViolations[0]).toMatch(/no-judge-tooluse/i);
  });

  it("returns fail-closed verdict when tool input doesn't match schema", async () => {
    const deps = makeDeps(makeToolUseClient({ someOtherField: "oops" }));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.semanticHardRulePass).toBe(false);
    expect(verdict.semanticViolations[0]).toMatch(/parse-error/i);
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

  it("still stamps rubricVersion/hash on a fail-closed verdict", async () => {
    const deps = makeDeps(makeNoToolUseClient("garbage response"));
    const verdict = await judgeTurn(CLEAN_TURN_INPUT, deps);

    expect(verdict.rubricVersion).toBe(JUDGE_RUBRIC_VERSION);
    expect(verdict.rubricHash).toBe(JUDGE_RUBRIC_HASH);
  });
});

// ---------------------------------------------------------------------------
// Tool schema: assert no min/max on number fields (Anthropic strict-mode safety)
// ---------------------------------------------------------------------------

describe("JUDGE_TOOL schema — no min/max on number types", () => {
  it("JUDGE_TOOL has no minimum or maximum keys anywhere in input_schema", () => {
    const schemaStr = JSON.stringify(JUDGE_TOOL.input_schema);
    expect(schemaStr).not.toContain('"minimum"');
    expect(schemaStr).not.toContain('"maximum"');
  });

  it("softScore property has type number with no min/max constraints", () => {
    // input_schema.properties is typed as `unknown` in the SDK Tool type; cast to inspect it.
    const props = JUDGE_TOOL.input_schema.properties as Record<string, Record<string, unknown>>;
    const softScoreProp = props["softScore"]!;
    expect(softScoreProp["type"]).toBe("number");
    expect(softScoreProp).not.toHaveProperty("minimum");
    expect(softScoreProp).not.toHaveProperty("maximum");
  });

  it("JUDGE_TOOL is strict with additionalProperties: false", () => {
    expect(JUDGE_TOOL.strict).toBe(true);
    expect(JUDGE_TOOL.input_schema.additionalProperties).toBe(false);
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
    const v1 = JUDGE_RUBRIC_VERSION;
    const h1 = JUDGE_RUBRIC_HASH;
    expect(v1).toBe(JUDGE_RUBRIC_VERSION);
    expect(h1).toBe(JUDGE_RUBRIC_HASH);
  });

  it("JUDGE_RUBRIC_HASH is not trivially empty or zero-hash", () => {
    expect(JUDGE_RUBRIC_HASH).not.toBe("0000000000000000");
    expect(JUDGE_RUBRIC_HASH).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Grade spec hints are included in the user message
// ---------------------------------------------------------------------------

describe("judgeTurn — grade spec forwarding", () => {
  it("sends a request containing the alexResponse text", async () => {
    const fakeClient = makeToolUseClient(GOOD_TOOL_INPUT);
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
    const fakeClient = makeToolUseClient(GOOD_TOOL_INPUT);
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
