import type { RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext, EmployeeHandlerResult } from "@switchboard/employee-sdk";

export async function handleContentRequested(
  event: RoutedEventEnvelope,
  context: EmployeeContext,
): Promise<EmployeeHandlerResult> {
  const payload = event.payload as {
    channel: string;
    format: string;
    topic?: string;
    brief?: string;
  };
  const { channel, format, topic, brief } = payload;

  // 1. Retrieve brand context
  const brandContext = await context.memory.brand.search(
    topic ?? brief ?? "brand voice and style guidelines",
    5,
  );

  // 2. Retrieve relevant skills (learned patterns from past content)
  const skills = await context.memory.skills.getRelevant("content_creation", format, 3);

  // 3. Retrieve top-performing content for this channel
  const topPerformers = await context.memory.performance.getTop(channel, 3);

  // 4. Generate content via LLM
  const brandExcerpts = brandContext.map((b) => b.content).join("\n---\n");
  const skillPatterns = skills.map((s) => s.pattern).join("\n- ");
  const performanceContext =
    topPerformers.length > 0
      ? `\nTop-performing ${channel} content IDs for reference: ${topPerformers.map((p) => p.contentId).join(", ")}`
      : "";

  const systemPrompt = context.personality.toPrompt();
  const prompt = `Create ${format} content for ${channel}.
${topic ? `Topic: ${topic}` : ""}
${brief ? `Brief: ${brief}` : ""}

Brand context:
${brandExcerpts || "No brand context available yet."}

${skillPatterns ? `Learned patterns:\n- ${skillPatterns}` : ""}
${performanceContext}

Generate the content in the appropriate format and tone for ${channel}.`;

  const response = await context.llm.generate({
    system: systemPrompt,
    prompt,
  });

  // 5. Propose the draft action
  return {
    actions: [
      {
        type: "creative.content.draft",
        params: {
          content: response.text,
          channel,
          format,
          topic: topic ?? "",
          brief: brief ?? "",
        },
      },
    ],
    events: [
      {
        type: "content.draft_ready",
        payload: {
          channel,
          format,
          topic: topic ?? "",
          contentPreview: response.text.slice(0, 200),
        },
      },
    ],
  };
}
