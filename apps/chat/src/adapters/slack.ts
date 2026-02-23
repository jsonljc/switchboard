import type { IncomingMessage } from "@switchboard/schemas";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "./adapter.js";

export class SlackAdapter implements ChannelAdapter {
  readonly channel = "slack" as const;
  private botToken: string;
  private baseUrl = "https://slack.com/api";

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  parseIncomingMessage(rawPayload: unknown): IncomingMessage | null {
    const payload = rawPayload as Record<string, unknown>;

    // Slack Events API: event wrapper
    const event = payload["event"] as Record<string, unknown> | undefined;
    if (!event) return null;

    // Ignore bot messages
    if (event["bot_id"]) return null;

    const type = event["type"] as string;
    if (type !== "message" && type !== "app_mention") return null;

    return {
      id: `slack_${event["client_msg_id"] ?? event["ts"]}`,
      channel: "slack",
      channelMessageId: String(event["ts"]),
      threadId: String(event["channel"]),
      principalId: String(event["user"]),
      organizationId: (payload["team_id"] as string) ?? null,
      text: (event["text"] as string) ?? "",
      attachments: [],
      timestamp: new Date(Number(event["ts"]) * 1000),
    };
  }

  async sendTextReply(threadId: string, text: string): Promise<void> {
    await this.apiCall("chat.postMessage", {
      channel: threadId,
      text,
    });
  }

  async sendApprovalCard(threadId: string, card: ApprovalCardPayload): Promise<void> {
    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Approval Required*\n\n${card.summary}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: card.explanation },
      },
      {
        type: "actions",
        elements: card.buttons.map((btn) => ({
          type: "button",
          text: { type: "plain_text", text: btn.label },
          value: btn.callbackData,
          action_id: `approval_${btn.label.toLowerCase().replace(/\s+/g, "_")}`,
          ...(btn.label === "Reject" ? { style: "danger" } : {}),
          ...(btn.label === "Approve" ? { style: "primary" } : {}),
        })),
      },
    ];

    await this.apiCall("chat.postMessage", {
      channel: threadId,
      text: card.summary,
      blocks,
    });
  }

  async sendResultCard(threadId: string, card: ResultCardPayload): Promise<void> {
    const icon = card.success ? ":white_check_mark:" : ":x:";
    let text = `${icon} ${card.summary}\n`;
    text += `*Risk:* ${card.riskCategory}\n`;
    text += `*Audit:* \`${card.auditId}\`\n`;
    if (card.undoAvailable) {
      const hours = card.undoExpiresAt
        ? Math.round((card.undoExpiresAt.getTime() - Date.now()) / 3600000)
        : 24;
      text += `*Undo available:* reply \`undo\` within ${hours}h`;
    }

    await this.apiCall("chat.postMessage", {
      channel: threadId,
      text,
    });
  }

  extractMessageId(rawPayload: unknown): string | null {
    const payload = rawPayload as Record<string, unknown>;
    const event = payload["event"] as Record<string, unknown> | undefined;
    if (event) {
      return String(event["client_msg_id"] ?? event["ts"]);
    }
    return null;
  }

  private async apiCall(method: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });
    return response.json();
  }
}
