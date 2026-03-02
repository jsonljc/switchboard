// ---------------------------------------------------------------------------
// Action: patient-engagement.reminder.send
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";
import type { SMSProvider } from "../providers/provider.js";

export async function executeSendReminder(
  params: Record<string, unknown>,
  sms: SMSProvider,
  fromNumber: string,
): Promise<ExecuteResult> {
  const start = Date.now();
  const patientId = params.patientId as string;
  const phoneNumber = params.phoneNumber as string;
  const message = params.message as string;

  try {
    const result = await sms.sendMessage(phoneNumber, fromNumber, message);

    return {
      success: true,
      summary: `Sent reminder to patient ${patientId}: "${message.slice(0, 50)}..."`,
      externalRefs: { patientId, messageId: result.messageId },
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
      externalRefs: { patientId },
      rollbackAvailable: false,
      partialFailures: [{ step: "send_reminder", error: errorMsg }],
      durationMs: Date.now() - start,
      undoRecipe: null,
    };
  }
}
