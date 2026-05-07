import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPullQuoteGenerator } from "./pull-quote-generator.js";
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
      value: "$18,433",
      mid: "in revenue, with Switchboard costing",
      cost: "$499",
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

// Suppress unused function warning — used by Task 5
void makeRejectingLLM;

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
      value: "$18,433",
      mid: "in revenue against a Switchboard fee of",
      cost: "$499",
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
    expect(user).toContain("$18,433");
    expect(user).toContain("$499");
  });
});
