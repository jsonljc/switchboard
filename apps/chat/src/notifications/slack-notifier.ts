import type { ApprovalNotifier, ApprovalNotification } from "@switchboard/core";

export class SlackApprovalNotifier implements ApprovalNotifier {
  private token: string;

  constructor(botToken: string) {
    this.token = botToken;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const { approvers } = notification;
    if (approvers.length === 0) return;

    const blocks = this.buildBlocks(notification);

    await Promise.allSettled(
      approvers.map((userId) =>
        this.postMessage(userId, blocks),
      ),
    );
  }

  private buildBlocks(n: ApprovalNotification): unknown[] {
    const riskEmoji = this.riskEmoji(n.riskCategory);
    const expiresIn = Math.round(
      (n.expiresAt.getTime() - Date.now()) / 60000,
    );

    return [
      {
        type: "header",
        text: { type: "plain_text", text: `${riskEmoji} Approval Required`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Risk:*\n${n.riskCategory.toUpperCase()}` },
          { type: "mrkdwn", text: `*Expires in:*\n${expiresIn} minutes` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:* ${n.summary}\n*Reason:* ${n.explanation}` },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Envelope: \`${n.envelopeId}\`` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve", emoji: true },
            style: "primary",
            action_id: "approval_approve",
            value: JSON.stringify({
              action: "approve",
              approvalId: n.approvalId,
              bindingHash: n.bindingHash,
            }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Reject", emoji: true },
            style: "danger",
            action_id: "approval_reject",
            value: JSON.stringify({
              action: "reject",
              approvalId: n.approvalId,
            }),
          },
        ],
      },
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

  private async postMessage(channel: string, blocks: unknown[]): Promise<void> {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        channel,
        text: "Approval Required",
        blocks,
      }),
    });
  }
}
