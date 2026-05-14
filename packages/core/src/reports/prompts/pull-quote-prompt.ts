import { formatCurrencySGD } from "../period-helpers.js";

/**
 * Internal type — the narrow fact set the LLM actually needs.
 * Built by pull-quote-generator from the rich PullQuoteGenerator input.
 */
export interface PullQuoteFacts {
  periodLabel: string; // lowercase, e.g. "this month"
  revenueUsd: number;
  costUsd: number;
  savingsUsd: number;
}

export const PULL_QUOTE_SYSTEM_PROMPT = `You write the prose connectors for a one-sentence pull-quote on a B2B revenue report.

The full sentence has five slots: { pre, value, mid, cost, post }. The "value" and "cost" slots
are filled with formatted dollar numbers by deterministic code — you DO NOT write those.

Your job: write three short prose connectors — pre, mid, post — that read as natural English
when concatenated as: "<pre> <value> <mid> <cost> <post>".

Constraints:
- Output a single JSON object with exactly these three keys: "pre", "mid", "post".
- Each value must be a non-empty string, ≤ 80 characters.
- Voice: operator deep-dive register — concise, fact-led, third-person describing the customer's team.
- Do NOT include any digits (0-9), the dollar sign ($), the percent sign (%), or any metric names
  (ROAS, CPC, CTR, CAC, CPA, ROI). All numbers belong to the deterministic value/cost slots.
- Do NOT make claims you cannot verify from the inputs. Do NOT invent stats.

Example shape (illustrative — your wording will differ based on the period):
{"pre": "This month, your team converted leads", "mid": "in revenue against a Switchboard fee of", "post": "well below traditional staffing costs."}`;

export function buildUserPrompt(facts: PullQuoteFacts): string {
  const revenue = formatCurrencySGD(facts.revenueUsd);
  const cost = formatCurrencySGD(facts.costUsd);
  const savings = formatCurrencySGD(facts.savingsUsd);
  return `Period: ${facts.periodLabel}
Revenue this period: ${revenue}
Switchboard cost this period: ${cost}
Estimated savings vs traditional stack: ${savings}

Write the JSON object now.`;
}
