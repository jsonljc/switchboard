import type { RoutedEventEnvelope } from "@switchboard/schemas";
import type { EmployeeContext, EmployeeHandlerResult } from "@switchboard/employee-sdk";

export async function handleContentApproved(
  event: RoutedEventEnvelope,
  _context: EmployeeContext,
): Promise<EmployeeHandlerResult> {
  const { draftId, channel } = event.payload as {
    draftId: string;
    channel: string;
  };

  return {
    actions: [
      {
        type: "creative.content.publish",
        params: {
          draftId,
          channel,
        },
      },
    ],
    events: [],
  };
}
