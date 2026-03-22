// ---------------------------------------------------------------------------
// Context Extractor — LLM-based extraction of conversation context signals
// ---------------------------------------------------------------------------

import type { LLMAdapter, Message } from "@switchboard/core";
import { AgentContextDataSchema, type AgentContextData } from "@switchboard/schemas";

const EXTRACTION_PROMPT = `Analyze the conversation and extract these signals as JSON:
{
  "objectionsEncountered": ["list of objections or concerns raised by the lead"],
  "preferencesLearned": {"key": "value pairs of learned preferences"},
  "topicsDiscussed": ["list of topics covered"],
  "sentimentTrend": "positive" | "neutral" | "negative" | "unknown",
  "offersMade": [{"description": "offer description"}]
}

Rules:
- Merge with existing context — add new items, don't remove old ones.
- Only include objections explicitly stated by the lead, not implied.
- Preferences should be specific and actionable (e.g., "preferred time: mornings").
- Sentiment reflects the lead's overall attitude across the conversation.
- Return ONLY the JSON object, no extra text.`;

const DEFAULT_CONTEXT: AgentContextData = {
  objectionsEncountered: [],
  preferencesLearned: {},
  offersMade: [],
  topicsDiscussed: [],
  sentimentTrend: "unknown",
};

/**
 * Parse an LLM response string into AgentContextData.
 * Handles raw JSON or JSON inside markdown code blocks.
 */
export function parseContextResponse(raw: string): AgentContextData {
  try {
    // Strip markdown code blocks if present
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return AgentContextDataSchema.parse(parsed);
  } catch {
    return { ...DEFAULT_CONTEXT };
  }
}

/**
 * Extract conversation context signals via a dedicated LLM call.
 * Returns existing context unchanged if LLM call fails.
 */
export async function extractConversationContext(
  llm: LLMAdapter,
  history: Message[],
  existing: AgentContextData,
): Promise<AgentContextData> {
  if (history.length === 0) return existing;

  try {
    const existingJson = JSON.stringify(existing, null, 2);
    const reply = await llm.generateReply({
      systemPrompt:
        "You are a conversation analyst. Extract structured context from conversations.",
      conversationHistory: history,
      retrievedContext: [],
      agentInstructions: `${EXTRACTION_PROMPT}\n\nExisting context to merge with:\n${existingJson}`,
    });

    const extracted = parseContextResponse(reply.reply);

    // Merge: deduplicate arrays, overwrite sentiment
    return {
      objectionsEncountered: dedupe([
        ...existing.objectionsEncountered,
        ...extracted.objectionsEncountered,
      ]),
      preferencesLearned: {
        ...existing.preferencesLearned,
        ...extracted.preferencesLearned,
      },
      offersMade: [...existing.offersMade, ...extracted.offersMade],
      topicsDiscussed: dedupe([...existing.topicsDiscussed, ...extracted.topicsDiscussed]),
      sentimentTrend: extracted.sentimentTrend,
    };
  } catch {
    return existing;
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
