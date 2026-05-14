import { describe, it, expect } from "vitest";
import {
  PULL_QUOTE_SYSTEM_PROMPT,
  buildUserPrompt,
  type PullQuoteFacts,
} from "./pull-quote-prompt.js";

describe("PULL_QUOTE_SYSTEM_PROMPT", () => {
  it("instructs the model to output JSON with exactly pre/mid/post keys", () => {
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/JSON/);
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/"pre"/);
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/"mid"/);
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/"post"/);
  });

  it("forbids the model from emitting digits, currency symbols, or metric names", () => {
    expect(PULL_QUOTE_SYSTEM_PROMPT.toLowerCase()).toMatch(
      /no.*(digits|numbers)|do not.*(digits|numbers)/,
    );
    expect(PULL_QUOTE_SYSTEM_PROMPT).toMatch(/\$/);
    expect(PULL_QUOTE_SYSTEM_PROMPT.toLowerCase()).toMatch(/roas|cpc|metric/);
  });
});

describe("buildUserPrompt", () => {
  const FACTS: PullQuoteFacts = {
    periodLabel: "this month",
    revenueUsd: 18432.5,
    costUsd: 499,
    savingsUsd: 7501,
  };

  it("includes the period label verbatim", () => {
    expect(buildUserPrompt(FACTS)).toContain("this month");
  });

  it("includes the formatted revenue, cost, and savings as SGD strings", () => {
    const prompt = buildUserPrompt(FACTS);
    expect(prompt).toContain("S$18,433"); // formatCurrencySGD rounds >=1000
    expect(prompt).toContain("S$499");
    expect(prompt).toContain("S$7,501");
  });

  it("does not throw on zero values", () => {
    expect(() =>
      buildUserPrompt({ periodLabel: "this week", revenueUsd: 0, costUsd: 0, savingsUsd: 0 }),
    ).not.toThrow();
  });

  it("does not throw on negative savings", () => {
    expect(() =>
      buildUserPrompt({
        periodLabel: "this quarter",
        revenueUsd: 100,
        costUsd: 999,
        savingsUsd: -200,
      }),
    ).not.toThrow();
  });
});
