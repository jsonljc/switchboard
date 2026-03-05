// ---------------------------------------------------------------------------
// Action: customer-engagement.reminder.send
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { SMSProvider } from "../providers/provider.js";

export async function executeSendReminder(
  params: Record<string, unknown>,
  sms: SMSProvider,
  fromNumber: string,
): Promise<ExecuteResult> {
  const start = Date.now();
  const contactId = params.contactId as string;
  const phoneNumber = params.phoneNumber as string;
  const message = params.message as string;

  try {
    const result = await sms.sendMessage(phoneNumber, fromNumber, message);

    return {
      success: true,
      summary: `Sent reminder to contact ${contactId}: "${message.slice(0, 50)}..."`,
      externalRefs: { contactId, messageId: result.messageId },
      rollbackAvailable: false,
      partialFailures: [],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      summary: `Failed to send reminder: ${errorMsg}`,
      externalRefs: { contactId },
      rollbackAvailable: false,
      partialFailures: [{ step: "send_reminder", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
