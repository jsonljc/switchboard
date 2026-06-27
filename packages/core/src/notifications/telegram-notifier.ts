import type { ApprovalNotifier, ApprovalNotification } from "./notifier.js";
import {
  isWithinTelegramCallbackLimit,
  TELEGRAM_APPROVAL_DASHBOARD_FALLBACK,
  TELEGRAM_CALLBACK_DATA_MAX_BYTES,
} from "./telegram-callback-data.js";

export class TelegramApprovalNotifier implements ApprovalNotifier {
  private baseUrl: string;

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const { approvers } = notification;
    if (approvers.length === 0) return;

    const inlineKeyboard = this.buildButtons(notification);

    // Telegram rejects the ENTIRE sendMessage when any inline button's
    // callback_data exceeds 64 bytes, which silently drops the whole approval
    // card. Approval callback_data (`{action, approvalId, bindingHash}`) never
    // fits, so when the keyboard is undeliverable send the card without buttons
    // plus a dashboard fallback — the operator still sees the approval rather
    // than nothing (CHAN-4 / BUG-4).
    const deliverable = inlineKeyboard
      .flat()
      .every((btn) => isWithinTelegramCallbackLimit(btn.callback_data));
    const text = deliverable
      ? this.formatMessage(notification)
      : `${this.formatMessage(notification)}\n\n${TELEGRAM_APPROVAL_DASHBOARD_FALLBACK}`;
    if (!deliverable) {
      console.warn(
        `[TelegramApprovalNotifier] approval ${notification.approvalId} callback_data exceeds ` +
          `${TELEGRAM_CALLBACK_DATA_MAX_BYTES} bytes; sending card without inline buttons (dashboard fallback).`,
      );
    }

    await Promise.allSettled(
      approvers.map((approverId) => {
        const body: Record<string, unknown> = {
          chat_id: approverId,
          text,
          parse_mode: "Markdown",
        };
        if (deliverable) {
          body["reply_markup"] = { inline_keyboard: inlineKeyboard };
        }
        return this.apiCall("sendMessage", body);
      }),
    );
  }

  private formatMessage(n: ApprovalNotification): string {
    const riskEmoji = this.riskEmoji(n.riskCategory);
    const expiresIn = Math.round((n.expiresAt.getTime() - Date.now()) / 60000);

    return (
      `${riskEmoji} *Approval Required*\n\n` +
      `${n.summary}\n\n` +
      `*Risk:* ${n.riskCategory.toUpperCase()}\n` +
      `*Reason:* ${n.explanation}\n` +
      `*Expires in:* ${expiresIn} minutes\n` +
      `*Envelope:* \`${n.envelopeId}\``
    );
  }

  private buildButtons(
    n: ApprovalNotification,
  ): Array<Array<{ text: string; callback_data: string }>> {
    return [
      [
        {
          text: "Approve",
          callback_data: JSON.stringify({
            action: "approve",
            approvalId: n.approvalId,
            bindingHash: n.bindingHash,
          }),
        },
        {
          text: "Reject",
          callback_data: JSON.stringify({
            action: "reject",
            approvalId: n.approvalId,
            bindingHash: n.bindingHash,
          }),
        },
      ],
    ];
  }

  private riskEmoji(category: string): string {
    switch (category) {
      case "critical":
        return "\u{1F6A8}";
      case "high":
        return "\u{1F534}";
      case "medium":
        return "\u{1F7E1}";
      case "low":
        return "\u{1F7E2}";
      default:
        return "\u{2139}\u{FE0F}";
    }
  }

  private async apiCall(method: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  }
}
