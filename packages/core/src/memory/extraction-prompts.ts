export function buildSummarizationPrompt(
  messages: Array<{ role: string; content: string }>,
): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Customer" : "Agent"}: ${m.content}`)
    .join("\n");

  return `Summarize this conversation between a customer and an AI agent. Return JSON only.

<transcript>
${transcript}
</transcript>

Return exactly this JSON structure (no markdown, no explanation):
{
  "summary": "1-2 sentence summary of what happened",
  "outcome": "booked|qualified|lost|info_request|escalated"
}`;
}

export function buildFactExtractionPrompt(
  messages: Array<{ role: string; content: string }>,
): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Customer" : "Agent"}: ${m.content}`)
    .join("\n");

  return `Extract factual information about the business and customer preferences from this conversation. Only extract facts that are explicitly stated or strongly implied. Do NOT hallucinate or infer facts that aren't supported by the text.

<transcript>
${transcript}
</transcript>

Return exactly this JSON structure (no markdown, no explanation):
{
  "facts": [
    {
      "fact": "concise statement of the fact",
      "confidence": 0.5-1.0,
      "category": "preference|faq|objection|pattern|fact"
    }
  ],
  "questions": ["questions the customer asked, verbatim or close to it"]
}

If no facts can be extracted, return {"facts": [], "questions": []}.`;
}
