import type { RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext, EmployeeHandlerResult } from "@switchboard/employee-sdk";

export async function handleContentRejected(
  event: RoutedEventEnvelope,
  context: EmployeeContext,
): Promise<EmployeeHandlerResult> {
  const { draftId, content, channel, format, feedback } = event.payload as {
    draftId: string;
    content: string;
    channel: string;
    format: string;
    feedback: string;
  };

  // Learn from the rejection
  await context.learn({
    type: "rejection",
    pattern: `Rejected ${format} for ${channel}: ${feedback}`,
    input: content.slice(0, 500),
    feedback,
    channel,
  });

  // Retrieve brand context for revision
  const brandContext = await context.memory.brand.search(feedback, 3);
  const brandExcerpts = brandContext.map((b) => b.content).join("\n---\n");

  // Generate revised content
  const systemPrompt = context.personality.toPrompt();
  const response = await context.llm.generate({
    system: systemPrompt,
    prompt: `Revise the following ${format} content for ${channel}.

Original content:
${content}

Rejection feedback:
${feedback}

Brand context:
${brandExcerpts || "No brand context available."}

Apply the feedback to create an improved version. Keep the same general topic but address the specific issues raised.`,
  });

  return {
    actions: [
      {
        type: "creative.content.revise",
        params: {
          content: response.text,
          originalDraftId: draftId,
          feedback,
        },
      },
    ],
    events: [
      {
        type: "content.draft_ready",
        payload: {
          channel,
          format,
          revision: true,
          originalDraftId: draftId,
          contentPreview: response.text.slice(0, 200),
        },
      },
    ],
  };
}
