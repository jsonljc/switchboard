import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Channel } from "@switchboard/schemas";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "./adapter.js";
import { withRetry } from "@switchboard/core";

/**
 * Token bucket rate limiter for Instagram/Messenger Send API.
 * Default capacity of 200 messages/sec (Meta platform-level limits).
 */
class MetaPlatformRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(capacity = 200) {
    this.capacity = capacity;
    this.refillRate = capacity;
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

/** Error carrying HTTP status for retry decisions. */
class MetaPlatformApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MetaPlatformApiError";
  }
}

/**
 * Unified adapter for Instagram DM and Facebook Messenger.
 *
 * Both platforms use the same Graph API webhook infrastructure with
 * `entry[].messaging[]` message format. The send API uses
 * `POST /me/messages` with `recipient.id`.
 *
 * The channel ("instagram" or "messenger") is determined at construction
 * time based on configuration.
 */
export class InstagramAdapter implements ChannelAdapter {
  readonly channel: Channel;
  private pageAccessToken: string;
  private appSecret: string | null;
  private verifyToken: string | null;
  private apiVersion: string;
  private rateLimiter: MetaPlatformRateLimiter;

  constructor(config: {
    pageAccessToken: string;
    appSecret?: string;
    verifyToken?: string;
    apiVersion?: string;
    /** "instagram" or "messenger" — defaults to "instagram" */
    channel?: "instagram" | "messenger";
  }) {
    this.channel = config.channel ?? "instagram";
    this.pageAccessToken = config.pageAccessToken;
    this.appSecret = config.appSecret ?? null;
    this.verifyToken = config.verifyToken ?? null;
    this.apiVersion = config.apiVersion ?? "v17.0";
    this.rateLimiter = new MetaPlatformRateLimiter();
  }

  /**
   * Verify webhook signature using HMAC-SHA256 with the app secret.
   * Identical to WhatsApp — all Meta platform webhooks use the same scheme.
   */
  verifyRequest(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.appSecret) {
      console.warn(
        `[${this.channel}Adapter] verifyRequest called without appSecret configured — failing closed`,
      );
      return false;
    }

    const signature = headers["x-hub-signature-256"];
    if (!signature) return false;

    const expectedSig =
      "sha256=" + createHmac("sha256", this.appSecret).update(rawBody).digest("hex");

    if (signature.length !== expectedSig.length) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
  }

  /**
   * Handle webhook verification challenge (GET request).
   * Same hub.mode / hub.verify_token / hub.challenge flow as WhatsApp.
   */
  handleVerification(query: Record<string, string | undefined>): {
    status: number;
    body: string;
  } {
    if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === this.verifyToken) {
      return { status: 200, body: query["hub.challenge"] ?? "" };
    }
    return { status: 403, body: "Verification failed" };
  }

  /**
   * Parse incoming webhook payload from Instagram DM or Messenger.
   *
   * Instagram/Messenger webhook structure:
   * ```
   * {
   *   object: "instagram" | "page",
   *   entry: [{
   *     id: "<page_or_ig_id>",
   *     time: 1700000000,
   *     messaging: [{
   *       sender: { id: "<sender_psid>" },
   *       recipient: { id: "<page_id>" },
   *       timestamp: 1700000000,
   *       message?: { mid: "m_...", text: "hello" },
   *       postback?: { title: "Get Started", payload: "..." }
   *     }]
   *   }]
   * }
   * ```
   */
  parseIncomingMessage(rawPayload: unknown): IncomingMessage | null {
    const payload = rawPayload as Record<string, unknown>;
    if (!payload) return null;

    const entry = (payload["entry"] as Array<Record<string, unknown>>)?.[0];
    if (!entry) return null;

    const messaging = (entry["messaging"] as Array<Record<string, unknown>>)?.[0];
    if (!messaging) return null;

    const sender = messaging["sender"] as Record<string, unknown> | undefined;
    const senderId = sender?.["id"] as string | undefined;
    if (!senderId) return null;

    const timestamp = messaging["timestamp"] as number | undefined;

    // Handle postback (button tap)
    const postback = messaging["postback"] as Record<string, unknown> | undefined;
    if (postback) {
      const postbackPayload = (postback["payload"] as string) ?? (postback["title"] as string);
      if (!postbackPayload) return null;

      const mid =
        (messaging["message"] as Record<string, unknown>)?.["mid"] ??
        `${this.channel}_pb_${Date.now()}`;

      return {
        id: mid as string,
        channel: this.channel,
        channelMessageId: mid as string,
        principalId: senderId,
        text: postbackPayload,
        threadId: senderId,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        metadata: { type: "postback" },
        attachments: [],
        organizationId: null,
      };
    }

    // Handle text message
    const message = messaging["message"] as Record<string, unknown> | undefined;
    if (!message) return null;

    const mid = message["mid"] as string | undefined;

    // Handle quick_reply
    const quickReply = message["quick_reply"] as Record<string, unknown> | undefined;
    if (quickReply) {
      const qrPayload = quickReply["payload"] as string;
      if (!qrPayload) return null;

      return {
        id: mid ?? `${this.channel}_qr_${Date.now()}`,
        channel: this.channel,
        channelMessageId: mid ?? `${this.channel}_qr_${Date.now()}`,
        principalId: senderId,
        text: qrPayload,
        threadId: senderId,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        metadata: { type: "quick_reply" },
        attachments: [],
        organizationId: null,
      };
    }

    // Plain text message
    const text = message["text"] as string | undefined;
    if (!text) return null;

    return {
      id: mid ?? `${this.channel}_${Date.now()}`,
      channel: this.channel,
      channelMessageId: mid ?? `${this.channel}_${Date.now()}`,
      principalId: senderId,
      text,
      threadId: senderId,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      metadata: {},
      attachments: [],
      organizationId: null,
    };
  }

  async sendTextReply(threadId: string, text: string): Promise<void> {
    await this.sendMessage({
      recipient: { id: threadId },
      message: { text },
    });
  }

  async sendApprovalCard(threadId: string, card: ApprovalCardPayload): Promise<void> {
    // Instagram/Messenger support quick reply buttons (max 13, but keep to 3 for UX)
    const quickReplies = card.buttons.slice(0, 3).map((btn) => ({
      content_type: "text" as const,
      title: btn.label.substring(0, 20),
      payload: btn.callbackData,
    }));

    await this.sendMessage({
      recipient: { id: threadId },
      message: {
        text: `[${card.riskCategory.toUpperCase()}] Approval Required\n\n${card.summary}\n\n${card.explanation}`,
        quick_replies: quickReplies,
      },
    });
  }

  async sendResultCard(threadId: string, card: ResultCardPayload): Promise<void> {
    const statusEmoji = card.success ? "OK" : "FAILED";
    const undoNote = card.undoAvailable
      ? `\n\nUndo available${card.undoExpiresAt ? ` until ${card.undoExpiresAt.toISOString()}` : ""}`
      : "";

    const text = [
      `[${statusEmoji}] ${card.summary}`,
      `Risk: ${card.riskCategory}`,
      `Audit: ${card.auditId}`,
      undoNote,
    ]
      .filter(Boolean)
      .join("\n");

    await this.sendTextReply(threadId, text);
  }

  extractMessageId(rawPayload: unknown): string | null {
    const payload = rawPayload as Record<string, unknown>;
    const entry = (payload?.["entry"] as Array<Record<string, unknown>>)?.[0];
    const messaging = (entry?.["messaging"] as Array<Record<string, unknown>>)?.[0];
    const message = messaging?.["message"] as Record<string, unknown> | undefined;
    return (message?.["mid"] as string) ?? null;
  }

  private async sendMessage(body: Record<string, unknown>): Promise<void> {
    const url = `https://graph.facebook.com/${this.apiVersion}/me/messages`;

    await withRetry(
      async () => {
        await this.rateLimiter.acquire();
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.pageAccessToken}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new MetaPlatformApiError(
            `${this.channel} API error (${response.status}): ${errorBody}`,
            response.status,
          );
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        shouldRetry: (err: unknown) => {
          if (err instanceof MetaPlatformApiError) {
            return err.status === 429 || err.status >= 500;
          }
          return true;
        },
      },
    );
  }
}
