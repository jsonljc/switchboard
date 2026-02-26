import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "@switchboard/schemas";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "./adapter.js";

/**
 * Token bucket rate limiter for Slack API (Tier 1: ~1 msg/sec per method).
 * Uses same pattern as TelegramRateLimiter but with Slack-appropriate limits.
 */
class SlackRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity = 20;
  private readonly refillRate = 1; // tokens per second (Slack Tier 1)

  constructor() {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

/**
 * Verify Slack request signature using HMAC-SHA256.
 * Slack signs requests with: v0=HMAC-SHA256(signingSecret, "v0:timestamp:body")
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  maxTimestampDriftMs = 5 * 60 * 1000, // 5 minutes
): boolean {
  // Reject requests with stale timestamps to prevent replay attacks
  const requestTimestamp = parseInt(timestamp, 10) * 1000;
  if (isNaN(requestTimestamp) || Math.abs(Date.now() - requestTimestamp) > maxTimestampDriftMs) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const expectedSig = "v0=" + createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature));
  } catch {
    return false; // Different lengths
  }
}

export class SlackAdapter implements ChannelAdapter {
  readonly channel = "slack" as const;
  private botToken: string;
  private signingSecret: string | null;
  private baseUrl = "https://slack.com/api";
  private rateLimiter = new SlackRateLimiter();

  constructor(botToken: string, signingSecret?: string) {
    this.botToken = botToken;
    this.signingSecret = signingSecret ?? null;

    // Production guard: signing secret is required to prevent request forgery
    if (!this.signingSecret) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "Slack signing secret is required in production. " +
          "Set the SLACK_SIGNING_SECRET environment variable.",
        );
      } else {
        console.warn(
          "[SlackAdapter] No signing secret configured — request signature verification is disabled. " +
          "This is unsafe for production use.",
        );
      }
    }
  }

  /**
   * Verify the incoming request signature.
   * Call this before parseIncomingMessage() in the webhook handler.
   * Returns true if the request is authentic, false otherwise.
   */
  verifyRequest(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.signingSecret) return true; // No signing secret configured

    const timestamp = headers["x-slack-request-timestamp"];
    const signature = headers["x-slack-signature"];

    if (!timestamp || !signature) return false;

    return verifySlackSignature(this.signingSecret, timestamp, rawBody, signature);
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
    await this.rateLimiter.acquire();
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

    await this.rateLimiter.acquire();
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

    await this.rateLimiter.acquire();
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
