import type { ApprovalNotifier, ApprovalNotification } from "./notifier.js";

export interface SlackNotifierOptions {
  /**
   * The conversation (channel id C... or user id U... for a DM) that approval
   * messages post to. When set it is the ONLY target and notification.approvers
   * is ignored for targeting. When unset, legacy behavior posts to each
   * approvers entry as a Slack conversation id.
   */
  defaultConversationId?: string;
}

export class SlackApprovalNotifier implements ApprovalNotifier {
  private token: string;
  private defaultConversationId: string | undefined;

  constructor(botToken: string, options: SlackNotifierOptions = {}) {
    this.token = botToken;
    this.defaultConversationId = options.defaultConversationId;
  }

  async notify(notification: ApprovalNotification): Promise<void> {
    const targets = this.defaultConversationId
      ? [this.defaultConversationId]
      : notification.approvers;
    if (targets.length === 0) return;

    const blocks = this.buildBlocks(notification);

    const results = await Promise.allSettled(
      targets.map((conversation) => this.postMessage(conversation, blocks)),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        // Logged, never thrown: a notification is best-effort delivery of an
        // invitation to act (spec section 6). The lifecycle and the dashboard
        // Inbox remain canonical. The target is an operational identifier
        // (debugging aid); never log bindingHash or message content.
        console.error(
          `[SlackApprovalNotifier] send failed (approvalId=${notification.approvalId}, target=${targets[i]})`,
          result.reason,
        );
      }
    });
  }

  private buildBlocks(n: ApprovalNotification): unknown[] {
    const riskEmoji = this.riskEmoji(n.riskCategory);

    const blocks: unknown[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `${riskEmoji} Approval Required`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Risk:*\n${n.riskCategory.toUpperCase()}` },
          { type: "mrkdwn", text: `*Expires in:*\n${this.formatExpiry(n.expiresAt)}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:* ${n.summary}\n*Reason:* ${n.explanation}` },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Envelope: \`${n.envelopeId}\`` }],
      },
    ];

    // Buttons only when actionable: an empty bindingHash (the escalation-handoff
    // shape) cannot form a payload parseApprovalResponsePayload accepts, so render
    // alert-only (with an Inbox cue) instead of buttons whose taps would fall
    // through as raw JSON text.
    if (n.bindingHash.length > 0) {
      blocks.push({
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
              bindingHash: n.bindingHash,
            }),
          },
        ],
      });
    } else {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "This approval cannot be actioned from Slack. Open the Inbox to review.",
          },
        ],
      });
    }

    return blocks;
  }

  private formatExpiry(expiresAt: Date): string {
    const minutes = Math.round((expiresAt.getTime() - Date.now()) / 60000);
    if (minutes >= 180) return `${Math.round(minutes / 60)} hours`;
    return `${minutes} minutes`;
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

  private async postMessage(channel: string, blocks: unknown[]): Promise<void> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
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
    if (!response.ok) {
      throw new Error(`Slack HTTP error ${response.status}`);
    }
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error ?? "unknown"}`);
    }
  }
}
