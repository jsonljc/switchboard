import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import type { ReportDataV1, ReportWindow } from "@switchboard/schemas";
import type { LLMClient, PullQuoteGenerator } from "./interfaces.js";
import type { RollupContext } from "./types.js";
import { formatCurrencySGD } from "./period-helpers.js";
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

type FailureKind = "llm-error" | "parse-failure" | "schema-failure" | "content-guard";

function warnFallback(kind: FailureKind, periodLabel: string): void {
  console.warn({ kind, periodLabel });
}

const CONTENT_GUARD = /[$0-9%]|roas|cpc|ctr|cac|cpa|roi/i;

function violatesContentGuard(slots: { pre: string; mid: string; post: string }): boolean {
  return (
    CONTENT_GUARD.test(slots.pre) || CONTENT_GUARD.test(slots.mid) || CONTENT_GUARD.test(slots.post)
  );
}

export function createPullQuoteGenerator(deps: { llm: LLMClient | null }): PullQuoteGenerator {
  return async (input) => {
    const facts = buildFacts(input);
    const value = formatCurrencySGD(facts.revenueUsd);
    const cost = formatCurrencySGD(facts.costUsd);
    const template = buildTemplate(facts, value, cost);

    if (deps.llm == null) {
      return template;
    }

    let raw: string;
    try {
      raw = await deps.llm.complete(PULL_QUOTE_SYSTEM_PROMPT, buildUserPrompt(facts));
    } catch {
      warnFallback("llm-error", facts.periodLabel);
      return template;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      warnFallback("parse-failure", facts.periodLabel);
      return template;
    }

    const validated = LLMOutputSchema.safeParse(parsed);
    if (!validated.success) {
      warnFallback("schema-failure", facts.periodLabel);
      return template;
    }

    if (violatesContentGuard(validated.data)) {
      warnFallback("content-guard", facts.periodLabel);
      return template;
    }

    return {
      pre: validated.data.pre,
      value,
      mid: validated.data.mid,
      cost,
      post: validated.data.post,
    };
  };
}

const REPORT_LLM_MODEL = "claude-haiku-4-5-20251001";
const REPORT_LLM_MAX_TOKENS = 256;
const REPORT_LLM_TEMPERATURE = 0.4;

/**
 * Narrow constructor type used by the test seam — captures only the surface this
 * file actually consumes (the real SDK class is structurally compatible). Avoids
 * a brittle `as unknown as typeof import("@anthropic-ai/sdk").default` cast at
 * call sites.
 */
type AnthropicLikeCtor = new (args: { apiKey: string }) => {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      temperature: number;
      system: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }): Promise<{ content: Array<{ type: string; text: string }> }>;
  };
};

export function createAnthropicReportLLMClient(
  apiKey: string,
  options?: { AnthropicCtor?: AnthropicLikeCtor },
): LLMClient {
  const Ctor: AnthropicLikeCtor =
    options?.AnthropicCtor ?? (Anthropic as unknown as AnthropicLikeCtor);
  const client = new Ctor({ apiKey });
  return {
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await client.messages.create({
        model: REPORT_LLM_MODEL,
        max_tokens: REPORT_LLM_MAX_TOKENS,
        temperature: REPORT_LLM_TEMPERATURE,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt },
          { role: "assistant", content: "{" },
        ],
      });
      const block = response.content[0];
      const text = block && block.type === "text" ? block.text : "";
      // Re-prepend the prefilled '{' since the SDK strips it from the response.
      return `{${text}`;
    },
  };
}
