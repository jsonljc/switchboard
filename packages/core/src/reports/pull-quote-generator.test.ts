import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPullQuoteGenerator,
  createAnthropicReportLLMClient,
} from "./pull-quote-generator.js";
import type { ReportDataV1 } from "@switchboard/schemas";
import type { RollupContext } from "./types.js";

const STUB_ATTRIBUTION: ReportDataV1["attribution"] = {
  total: 18432.5,
  delta: { kind: "pos", text: "" },
  riley: { value: 12000, caption: "" },
  alex: { value: 6432.5, caption: "" },
};

const STUB_COST: ReportDataV1["cost"] = {
  paid: 499,
  alt: 8000,
  saving: 7501,
};

const STUB_FUNNEL_NARRATIVE: ReportDataV1["funnelNarrative"] = {
  marker: "",
  text: "",
};

function makeCtx(
  window: "THIS WEEK" | "THIS MONTH" | "THIS QUARTER" = "THIS MONTH",
): RollupContext {
  return {
    orgId: "org-1",
    current: {
      start: new Date("2026-04-01T00:00:00Z"),
      end: new Date("2026-05-01T00:00:00Z"),
      window,
    },
    prior: {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-04-01T00:00:00Z"),
      window: null,
    },
    computedAt: new Date("2026-04-15T00:00:00Z"),
  };
}

function makeInput(window: "THIS WEEK" | "THIS MONTH" | "THIS QUARTER" = "THIS MONTH") {
  return {
    ctx: makeCtx(window),
    attribution: STUB_ATTRIBUTION,
    cost: STUB_COST,
    funnelNarrative: STUB_FUNNEL_NARRATIVE,
  };
}

describe("createPullQuoteGenerator — null client path", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the deterministic template when llm is null", async () => {
    const generator = createPullQuoteGenerator({ llm: null });
    const result = await generator(makeInput("THIS MONTH"));

    expect(result).toEqual({
      pre: "This month, your team generated",
      value: "S$18,433",
      mid: "in revenue, with Switchboard costing",
      cost: "S$499",
      post: "versus a traditional stack.",
    });
  });

  it("does NOT warn when llm is null (expected unconfigured state)", async () => {
    const generator = createPullQuoteGenerator({ llm: null });
    await generator(makeInput());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("uses the right period label for each window value", async () => {
    const generator = createPullQuoteGenerator({ llm: null });

    const week = await generator(makeInput("THIS WEEK"));
    const month = await generator(makeInput("THIS MONTH"));
    const quarter = await generator(makeInput("THIS QUARTER"));

    expect(week.pre).toBe("This week, your team generated");
    expect(month.pre).toBe("This month, your team generated");
    expect(quarter.pre).toBe("This quarter, your team generated");
  });

  it("template output is deterministic (idempotent)", async () => {
    const generator = createPullQuoteGenerator({ llm: null });
    const a = await generator(makeInput());
    const b = await generator(makeInput());
    expect(a).toEqual(b);
  });
});

function makeMockLLM(reply: string) {
  return { complete: vi.fn(async () => reply) };
}

// Used by Task 5 for testing error/fallback paths
function makeRejectingLLM(error: Error) {
  return {
    complete: vi.fn(async () => {
      throw error;
    }),
  };
}

describe("createPullQuoteGenerator — LLM happy path", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns LLM-written prose connectors merged with deterministic value/cost", async () => {
    const llm = makeMockLLM(
      '{"pre": "In April, the team converted leads", "mid": "in revenue against a Switchboard fee of", "post": "well below traditional staffing costs."}',
    );

    const generator = createPullQuoteGenerator({ llm });
    const result = await generator(makeInput());

    expect(result).toEqual({
      pre: "In April, the team converted leads",
      value: "S$18,433",
      mid: "in revenue against a Switchboard fee of",
      cost: "S$499",
      post: "well below traditional staffing costs.",
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("calls LLMClient.complete with the system prompt and a user prompt containing the period label", async () => {
    const completeSpy = vi.fn(async () => '{"pre": "ok pre", "mid": "ok mid", "post": "ok post."}');
    const generator = createPullQuoteGenerator({ llm: { complete: completeSpy } });

    await generator(makeInput("THIS QUARTER"));

    expect(completeSpy).toHaveBeenCalledTimes(1);
    const call = completeSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [system, user] = call as unknown as [string, string];
    expect(system).toMatch(/JSON/);
    expect(user).toContain("this quarter");
    expect(user).toContain("S$18,433");
    expect(user).toContain("S$499");
  });
});

describe("createPullQuoteGenerator — fallback paths", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("falls back to template + warns when the LLM throws", async () => {
    const llm = makeRejectingLLM(new Error("network down"));
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month, your team generated");
    expect(result.value).toBe("S$18,433");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: "llm-error",
      periodLabel: "this month",
    });
  });

  it("falls back to template + warns when the LLM returns malformed JSON", async () => {
    const llm = makeMockLLM("not json at all");
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month, your team generated");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: "parse-failure",
      periodLabel: "this month",
    });
  });

  it("falls back to template + warns when JSON is valid but missing required fields", async () => {
    const llm = makeMockLLM('{"pre": "x"}');
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month, your team generated");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
      kind: "schema-failure",
      periodLabel: "this month",
    });
  });

  it("falls back to template + warns when a slot exceeds the 80-char limit", async () => {
    const longString = "a".repeat(81);
    const llm = makeMockLLM(`{"pre": "${longString}", "mid": "ok mid", "post": "ok post."}`);
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month, your team generated");
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({ kind: "schema-failure" });
  });
});

describe("createPullQuoteGenerator — content guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const TRIGGERS: Array<{ name: string; mid: string }> = [
    { name: "ascii digit", mid: "in revenue with ROAS up 23 points" },
    { name: "dollar sign", mid: "in revenue, well above $0 baselines" },
    { name: "percent sign", mid: "in revenue, with 5% gain quarter-over-quarter" },
    { name: "metric token roas", mid: "in revenue with strong ROAS performance" },
    { name: "metric token cpc", mid: "in revenue with healthy cpc levels" },
    { name: "metric token roi", mid: "in revenue with above-average roi outcomes" },
  ];

  for (const { name, mid } of TRIGGERS) {
    it(`rejects LLM output containing ${name} and falls back to template`, async () => {
      const llm = makeMockLLM(
        `{"pre": "This month the team closed", "mid": "${mid}", "post": "vs a traditional stack."}`,
      );
      const generator = createPullQuoteGenerator({ llm });

      const result = await generator(makeInput());

      expect(result.pre).toBe("This month, your team generated");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({
        kind: "content-guard",
        periodLabel: "this month",
      });
    });
  }

  it("accepts clean prose (no digits, no currency, no metrics)", async () => {
    const llm = makeMockLLM(
      '{"pre": "This month the team turned conversations", "mid": "into revenue, against a Switchboard fee of", "post": "well below conventional staffing costs."}',
    );
    const generator = createPullQuoteGenerator({ llm });

    const result = await generator(makeInput());

    expect(result.pre).toBe("This month the team turned conversations");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("createAnthropicReportLLMClient", () => {
  it("re-prepends the prefilled '{' so the returned string starts with '{'", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: '"pre": "In April, the team converted leads", "mid": "in revenue against a fee of", "post": "well below traditional costs."}',
        },
      ],
    });
    const FakeAnthropic = vi.fn().mockImplementation(() => ({
      messages: { create },
    }));

    const client = createAnthropicReportLLMClient("test-key", {
      AnthropicCtor: FakeAnthropic,
    });
    const out = await client.complete("system here", "user here");

    expect(out.startsWith("{")).toBe(true);
    expect(FakeAnthropic).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0]?.[0];
    expect(call?.system).toBe("system here");
    expect(call?.model).toBe("claude-haiku-4-5-20251001");
    expect(call?.messages).toEqual([
      { role: "user", content: "user here" },
      { role: "assistant", content: "{" },
    ]);
  });

  it("uses the real Anthropic constructor by default", () => {
    // Smoke check — constructing the client with the real SDK constructor must not throw.
    // We do not invoke .complete() (would hit the network); we only verify wiring.
    const client = createAnthropicReportLLMClient("test-key");
    expect(typeof client.complete).toBe("function");
  });
});
