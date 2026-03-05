// ---------------------------------------------------------------------------
// Action: customer-engagement.conversation.escalate
// ---------------------------------------------------------------------------

import type { ExecuteResult } from "@switchboard/cartridge-sdk";

/**
 * Callback for delivering escalation notifications to staff.
 * Implementations should route the notification to the configured channel
 * (e.g. WhatsApp, Telegram, Slack) using the platform notifier infrastructure.
 */
export interface EscalationNotifier {
  notify(escalation: {
    contactId: string;
    reason: string;
    conversationId?: string;
    escalatedAt: string;
  }): Promise<void>;
}

/** Module-level notifier, injected at bootstrap time. */
let registeredNotifier: EscalationNotifier | null = null;

export function setEscalationNotifier(notifier: EscalationNotifier): void {
  registeredNotifier = notifier;
}

export async function executeEscalate(params: Record<string, unknown>): Promise<ExecuteResult> {
  const start = Date.now();
  const contactId = params.contactId as string;
  const reason = (params.reason as string) ?? "unspecified";
  const conversationId = params.conversationId as string | undefined;
  const escalatedAt = new Date().toISOString();

  // Send notification to staff if a notifier is configured
  const notificationResults: Array<{ step: string; error: string }> = [];
  if (registeredNotifier) {
    try {
      await registeredNotifier.notify({ contactId, reason, conversationId, escalatedAt });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[escalate] Notification failed: ${errorMsg}`);
      notificationResults.push({ step: "notification", error: errorMsg });
    }
  }

  return {
    success: true,
    summary: `Escalated conversation for patient ${contactId}. Reason: ${reason}`,
    externalRefs: { contactId },
    rollbackAvailable: false,
    partialFailures: notificationResults,
    durationMs: Date.now() - start,
    undoRecipe: null,
    data: {
      contactId,
      reason,
      conversationId,
      escalatedAt,
      status: "pending_human_review",
      notificationSent: registeredNotifier !== null && notificationResults.length === 0,
    },
  };
}
