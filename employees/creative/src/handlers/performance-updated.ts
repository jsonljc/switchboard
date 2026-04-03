import type { RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext, EmployeeHandlerResult } from "@switchboard/employee-sdk";

export async function handlePerformanceUpdated(
  event: RoutedEventEnvelope,
  context: EmployeeContext,
): Promise<EmployeeHandlerResult> {
  const { contentId, channel, metrics } = event.payload as {
    contentId: string;
    channel: string;
    metrics: Record<string, number>;
  };

  // Use LLM to extract performance patterns
  const response = await context.llm.generate({
    system:
      "You are a content performance analyst. Extract actionable patterns from content metrics.",
    prompt: `Content ${contentId} on ${channel} received the following metrics:
${Object.entries(metrics)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}

Extract any actionable pattern from these metrics. If engagement is significantly above or below average, explain what might have caused it. Be concise.`,
  });

  // Learn performance patterns with high confidence
  const hasHighEngagement = Object.values(metrics).some((v) => v > 100);
  if (hasHighEngagement) {
    await context.learn({
      type: "performance_pattern",
      pattern: response.text,
      evidence: [contentId],
      channel,
    });
  }

  return {
    actions: [],
    events: [],
  };
}
