import type { ApprovalNotifier, ApprovalNotification } from "@switchboard/core";

export class TelegramApprovalNotifier implements ApprovalNotifier {
  private baseUrl: string;

  constructor(botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const { approvers } = notification;
    if (approvers.length === 0) return;

    const text = this.formatMessage(notification);
    const inlineKeyboard = this.buildButtons(notification);

    // Send DM to each approver
    await Promise.allSettled(
      approvers.map((approverId) =>
        this.apiCall("sendMessage", {
          chat_id: approverId,
          text,
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: inlineKeyboard },
        }),
      ),
    );
  }

  private formatMessage(n: ApprovalNotification): string {
    const riskEmoji = this.riskEmoji(n.riskCategory);
    const expiresIn = Math.round(
      (n.expiresAt.getTime() - Date.now()) / 60000,
    );

    return (
      `${riskEmoji} *Approval Required*\n\n` +
      `${n.summary}\n\n` +
      `*Risk:* ${n.riskCategory.toUpperCase()}\n` +
      `*Reason:* ${n.explanation}\n` +
      `*Expires in:* ${expiresIn} minutes\n` +
      `*Envelope:* \`${n.envelopeId}\``
    );
  }

  private buildButtons(n: ApprovalNotification): Array<Array<{ text: string; callback_data: string }>> {
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
          }),
        },
      ],
    ];
  }

  private riskEmoji(category: string): string {
    switch (category) {
      case "critical": return "\u{1F6A8}";
      case "high": return "\u{1F534}";
      case "medium": return "\u{1F7E1}";
      case "low": return "\u{1F7E2}";
      default: return "\u{2139}\u{FE0F}";
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
