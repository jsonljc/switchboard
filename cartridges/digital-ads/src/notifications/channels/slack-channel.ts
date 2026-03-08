// ---------------------------------------------------------------------------
// Slack Channel — Formats alerts as Slack Block Kit messages and sends
//                 via incoming webhook
// ---------------------------------------------------------------------------

import type { SlackChannelConfig, NotificationPayload, NotificationResult } from "../types.js";

/** Severity-to-color mapping for the Slack attachment sidebar. */
const SEVERITY_COLORS: Record<NotificationPayload["severity"], string> = {
  critical: "#e01e5a", // red
  warning: "#ecb22e", // amber
  info: "#36a64f", // green
};

const SEVERITY_EMOJI: Record<NotificationPayload["severity"], string> = {
  critical: ":rotating_light:",
  warning: ":warning:",
  info: ":information_source:",
};

export class SlackChannel {
  constructor(private readonly config: SlackChannelConfig) {}

  /**
   * Format the notification payload as a Slack Block Kit message and send
   * it to the configured incoming webhook URL.
   */
  async send(payload: NotificationPayload): Promise<NotificationResult> {
    const slackPayload = this.buildSlackPayload(payload);

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slackPayload),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          channelType: "slack",
          success: false,
          error: `Slack webhook returned HTTP ${response.status}: ${body}`,
          responseStatus: response.status,
        };
      }

      return {
        channelType: "slack",
        success: true,
        responseStatus: response.status,
      };
    } catch (err) {
      return {
        channelType: "slack",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildSlackPayload(payload: NotificationPayload): Record<string, unknown> {
    const emoji = SEVERITY_EMOJI[payload.severity];
    const color = SEVERITY_COLORS[payload.severity];

    const detailLines = Object.entries(payload.details)
      .map(([key, value]) => `*${key}:* ${String(value)}`)
      .join("\n");

    const blocks: Array<Record<string, unknown>> = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji}  ${payload.title}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: payload.message,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Alert Type:*\n${payload.alertType}`,
          },
          {
            type: "mrkdwn",
            text: `*Severity:*\n${payload.severity.toUpperCase()}`,
          },
          {
            type: "mrkdwn",
            text: `*Account:*\n${payload.accountId}`,
          },
          {
            type: "mrkdwn",
            text: `*Time:*\n${payload.timestamp}`,
          },
        ],
      },
    ];

    // Add detail block if there are details
    if (detailLines.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: detailLines,
        },
      });
    }

    // Divider at the end
    blocks.push({ type: "divider" });

    const slackMessage: Record<string, unknown> = {
      blocks,
      attachments: [
        {
          color,
          blocks: [],
        },
      ],
    };

    // Optional overrides
    if (this.config.channel) {
      slackMessage.channel = this.config.channel;
    }
    if (this.config.username) {
      slackMessage.username = this.config.username;
    }
    if (this.config.iconEmoji) {
      slackMessage.icon_emoji = this.config.iconEmoji;
    }

    return slackMessage;
  }
}
