// ---------------------------------------------------------------------------
// Thread Prompt Utils — shared helpers for injecting thread context into prompts
// ---------------------------------------------------------------------------

import type { AgentContextData } from "@switchboard/schemas";

/**
 * Build a "CONVERSATION MEMORY" block from thread context for injection
 * into agent instructions. Used by both LeadResponder and SalesCloser.
 */
export function buildThreadContextBlock(ctx: AgentContextData): string {
  const parts: string[] = ["\n\n--- CONVERSATION MEMORY ---"];

  if (ctx.objectionsEncountered.length > 0) {
    parts.push(`Objections raised: ${ctx.objectionsEncountered.join(", ")}`);
  }

  const prefs = Object.entries(ctx.preferencesLearned);
  if (prefs.length > 0) {
    parts.push(`Known preferences: ${prefs.map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  }

  if (ctx.topicsDiscussed.length > 0) {
    parts.push(`Topics covered: ${ctx.topicsDiscussed.join(", ")}`);
  }

  if (ctx.sentimentTrend !== "unknown") {
    parts.push(`Lead sentiment: ${ctx.sentimentTrend}`);
  }

  if (ctx.offersMade.length > 0) {
    parts.push(`Offers made: ${ctx.offersMade.map((o) => o.description).join(", ")}`);
  }

  parts.push(
    "Use this memory to maintain continuity. Don't repeat offers or re-ask answered questions.",
  );
  parts.push("--- END MEMORY ---");

  return parts.join("\n");
}
