import type { ReportDataV1, ReportWindow } from "@switchboard/schemas";
import type { LLMClient, PullQuoteGenerator } from "./interfaces.js";
import type { RollupContext } from "./types.js";
import { formatCurrencyUSD } from "./period-helpers.js";
import type { PullQuoteFacts } from "./prompts/pull-quote-prompt.js";

function windowToLabel(window: ReportWindow): string {
  switch (window) {
    case "THIS WEEK":
      return "this week";
    case "THIS MONTH":
      return "this month";
    case "THIS QUARTER":
      return "this quarter";
    default: {
      const _exhaustive: never = window;
      return _exhaustive;
    }
  }
}

function buildFacts(input: {
  ctx: RollupContext;
  attribution: ReportDataV1["attribution"];
  cost: ReportDataV1["cost"];
}): PullQuoteFacts {
  if (!input.ctx.current.window) {
    // PullQuoteGenerator is only invoked from period-rollup, which already throws on null window.
    // This branch is defensive only.
    throw new Error("pull-quote-generator: ctx.current.window is required");
  }
  return {
    periodLabel: windowToLabel(input.ctx.current.window),
    revenueUsd: input.attribution.total,
    costUsd: input.cost.paid,
    savingsUsd: input.cost.saving,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildTemplate(
  facts: PullQuoteFacts,
  value: string,
  cost: string,
): ReportDataV1["pullquote"] {
  return {
    pre: `${capitalize(facts.periodLabel)}, your team generated`,
    value,
    mid: "in revenue, with Switchboard costing",
    cost,
    post: "versus a traditional stack.",
  };
}

export function createPullQuoteGenerator(deps: { llm: LLMClient | null }): PullQuoteGenerator {
  return async (input) => {
    const facts = buildFacts(input);
    const value = formatCurrencyUSD(facts.revenueUsd);
    const cost = formatCurrencyUSD(facts.costUsd);

    if (deps.llm == null) {
      return buildTemplate(facts, value, cost);
    }

    // LLM path is added in subsequent tasks. For now, fall through to template.
    return buildTemplate(facts, value, cost);
  };
}
