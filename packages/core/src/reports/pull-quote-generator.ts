import { z } from "zod";
import type { ReportDataV1, ReportWindow } from "@switchboard/schemas";
import type { LLMClient, PullQuoteGenerator } from "./interfaces.js";
import type { RollupContext } from "./types.js";
import { formatCurrencyUSD } from "./period-helpers.js";
import { PULL_QUOTE_SYSTEM_PROMPT, buildUserPrompt } from "./prompts/pull-quote-prompt.js";
import type { PullQuoteFacts } from "./prompts/pull-quote-prompt.js";

const LLMOutputSchema = z.object({
  pre: z.string().min(1).max(80),
  mid: z.string().min(1).max(80),
  post: z.string().min(1).max(80),
});

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

    const raw = await deps.llm.complete(PULL_QUOTE_SYSTEM_PROMPT, buildUserPrompt(facts));
    const parsed = JSON.parse(raw.trim());
    const validated = LLMOutputSchema.parse(parsed);

    return {
      pre: validated.pre,
      value,
      mid: validated.mid,
      cost,
      post: validated.post,
    };
  };
}
