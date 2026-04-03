import type { RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext, EmployeeHandlerResult } from "@switchboard/employee-sdk";

export async function handleOnboarded(
  _event: RoutedEventEnvelope,
  context: EmployeeContext,
): Promise<EmployeeHandlerResult> {
  // Retrieve brand context to understand the business
  const brandContext = await context.memory.brand.search(
    "brand identity, target audience, content strategy",
    5,
  );
  const brandExcerpts = brandContext.map((b) => b.content).join("\n---\n");

  // Generate initial content calendar suggestions
  const systemPrompt = context.personality.toPrompt();
  const response = await context.llm.generate({
    system: systemPrompt,
    prompt: `You've just been onboarded as the content creator for this business. Based on the brand context below, suggest an initial content calendar for the first 2 weeks.

Brand context:
${brandExcerpts || "No brand context uploaded yet. Suggest a discovery plan instead."}

Format your response as a list of content ideas with channel, topic, and suggested posting date.`,
  });

  return {
    actions: [
      {
        type: "creative.calendar.plan",
        params: {
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          channels: ["linkedin", "twitter"],
          suggestion: response.text,
        },
      },
    ],
    events: [
      {
        type: "content.calendar_updated",
        payload: {
          suggestion: response.text.slice(0, 500),
        },
      },
    ],
  };
}
