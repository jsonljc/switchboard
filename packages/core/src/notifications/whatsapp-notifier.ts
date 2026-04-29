import type { ApprovalNotifier, ApprovalNotification } from "./notifier.js";

export interface WhatsAppNotifierConfig {
  token: string;
  phoneNumberId: string;
  apiVersion?: string;
}

export class WhatsAppApprovalNotifier implements ApprovalNotifier {
  private token: string;
  private phoneNumberId: string;
  private apiVersion: string;

  constructor(config: WhatsAppNotifierConfig) {
    this.token = config.token;
    this.phoneNumberId = config.phoneNumberId;
    this.apiVersion = config.apiVersion ?? "v18.0";
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const { approvers } = notification;
    if (approvers.length === 0) return;

    const message = this.buildMessage(notification);

    await Promise.allSettled(approvers.map((phone) => this.sendMessage(phone, message)));
  }

  private buildMessage(n: ApprovalNotification): Record<string, unknown> {
    const riskEmoji = this.riskEmoji(n.riskCategory);
    const expiresIn = Math.round((n.expiresAt.getTime() - Date.now()) / 60000);

    return {
      type: "interactive",
      interactive: {
        type: "button",
        header: {
          type: "text",
          text: `${riskEmoji} Approval Required — ${n.riskCategory.toUpperCase()} risk`,
        },
        body: {
          text:
            `${n.summary}\n\n` +
            `Reason: ${n.explanation}\n` +
            `Expires in: ${expiresIn} minutes\n` +
            `Envelope: ${n.envelopeId}`,
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: JSON.stringify({
                  action: "approve",
                  approvalId: n.approvalId,
                  bindingHash: n.bindingHash,
                }),
                title: "Approve",
              },
            },
            {
              type: "reply",
              reply: {
                id: JSON.stringify({
                  action: "reject",
                  approvalId: n.approvalId,
                  bindingHash: n.bindingHash,
                }),
                title: "Reject",
              },
            },
          ],
        },
      },
    };
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

  private async sendMessage(to: string, message: Record<string, unknown>): Promise<void> {
    await fetch(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        ...message,
      }),
    });
  }
}
