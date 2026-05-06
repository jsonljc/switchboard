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
