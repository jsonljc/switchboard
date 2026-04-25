import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "@switchboard/schemas";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "./adapter.js";
import { withRetry } from "@switchboard/core";

/**
 * Token bucket rate limiter for WhatsApp Business API (80 msg/sec per phone number).
 */
class WhatsAppRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity = 80;
  private readonly refillRate = 80; // tokens per second

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

/** Error carrying HTTP status for retry decisions. */
class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

/** WhatsApp 24-hour conversation window duration in milliseconds. */
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Check whether we are inside the WhatsApp 24-hour conversation window.
 * Outside the window, only pre-approved template messages may be sent.
 */
export function isWithinWhatsAppWindow(lastInboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  return Date.now() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  private token: string;
  private phoneNumberId: string;
  private appSecret: string | null;
  private verifyToken: string | null;
  private apiVersion: string;
  private rateLimiter = new WhatsAppRateLimiter();

  constructor(config: {
    token: string;
    phoneNumberId: string;
    appSecret?: string;
    verifyToken?: string;
    apiVersion?: string;
  }) {
    this.token = config.token;
    this.phoneNumberId = config.phoneNumberId;
    this.appSecret = config.appSecret ?? null;
    this.verifyToken = config.verifyToken ?? null;
    this.apiVersion = config.apiVersion ?? "v21.0";
  }

  /**
   * Verify webhook signature using HMAC-SHA256 with the app secret.
   */
  verifyRequest(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.appSecret) {
      console.warn(
        "[WhatsAppAdapter] verifyRequest called without appSecret configured — failing closed",
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
   * Handle WhatsApp webhook verification challenge (GET request).
   */
  handleVerification(query: {
    "hub.mode"?: string;
    "hub.verify_token"?: string;
    "hub.challenge"?: string;
  }): { status: number; body: string } {
    const providedToken = query["hub.verify_token"] ?? "";
    const tokenMatch =
      this.verifyToken !== null &&
      providedToken.length === this.verifyToken.length &&
      timingSafeEqual(Buffer.from(providedToken), Buffer.from(this.verifyToken));
    if (query["hub.mode"] === "subscribe" && tokenMatch) {
      return { status: 200, body: query["hub.challenge"] ?? "" };
    }
    return { status: 403, body: "Verification failed" };
  }

  parseIncomingMessage(rawPayload: unknown): IncomingMessage | null {
    const payload = rawPayload as Record<string, unknown>;
    if (!payload) return null;

    // WhatsApp Cloud API webhook structure:
    // { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [...] } }] }] }
    const value = extractWhatsAppValue(payload);
    if (!value) return null;

    const messages = value["messages"] as Array<Record<string, unknown>> | undefined;
    if (!messages || messages.length === 0) return null;

    const msg = messages[0]!;
    const msgType = msg["type"] as string;

    // Handle interactive message types (button replies, list replies)
    if (msgType === "interactive") {
      return parseInteractiveMessage(msg, value);
    }

    // Capture non-text messages as leads instead of silently dropping
    if (msgType !== "text") {
      if (MEDIA_TYPES.has(msgType)) {
        return parseMediaMessage(msg, value, msgType);
      }
      return parseUnsupportedMessage(msg, value, msgType);
    }

    return parseTextMessage(msg, value);
  }

  async sendTextReply(threadId: string, text: string): Promise<void> {
    // Simulate typing: mark message as read, then delay before responding
    const delayMs = this.typingDelay(text);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    await this.sendMessage(threadId, {
      messaging_product: "whatsapp",
      to: threadId,
      type: "text",
      text: { body: text },
    });
  }

  /**
   * Send a pre-approved WhatsApp template message.
   * Required for messages outside the 24-hour conversation window.
   */
  async sendTemplateMessage(
    threadId: string,
    templateName: string,
    languageCode: string,
    components?: Array<{
      type: "body" | "header" | "button";
      parameters: Array<{ type: "text"; text: string }>;
    }>,
  ): Promise<void> {
    const template: Record<string, unknown> = {
      name: templateName,
      language: { code: languageCode },
    };
    if (components && components.length > 0) {
      template["components"] = components;
    }
    await this.sendMessage(threadId, {
      messaging_product: "whatsapp",
      to: threadId,
      type: "template",
      template,
    });
  }

  async sendApprovalCard(threadId: string, card: ApprovalCardPayload): Promise<void> {
    // WhatsApp interactive message with buttons (max 3 buttons)
    const buttons = card.buttons.slice(0, 3).map((btn) => ({
      type: "reply" as const,
      reply: {
        id: btn.callbackData,
        title: btn.label.substring(0, 20), // WhatsApp button title max 20 chars
      },
    }));

    await this.sendMessage(threadId, {
      messaging_product: "whatsapp",
      to: threadId,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: `${card.summary}\n\n${card.explanation}` },
        action: { buttons },
      },
    });
  }

  async sendResultCard(threadId: string, card: ResultCardPayload): Promise<void> {
    const statusEmoji = card.success ? "\u2705" : "\u274C";
    const parts = [`${statusEmoji} *${card.summary}*`];
    if (!card.success) {
      parts.push(`Reference: ${card.auditId}`);
    }
    if (card.undoAvailable) {
      const hours = card.undoExpiresAt
        ? Math.round((card.undoExpiresAt.getTime() - Date.now()) / 3600000)
        : 24;
      parts.push(`Reply 'undo' if you change your mind (${hours}h window).`);
    }

    await this.sendTextReply(threadId, parts.join("\n"));
  }

  parseStatusUpdate(rawPayload: unknown): {
    messageId: string;
    recipientId: string;
    status: string;
    timestamp: Date;
    errorCode?: string;
    errorTitle?: string;
    pricingCategory?: string;
    billable?: boolean;
  } | null {
    const payload = rawPayload as Record<string, unknown>;
    if (!payload) return null;

    const value = extractWhatsAppValue(payload);
    if (!value) return null;

    const statuses = value["statuses"] as Array<Record<string, unknown>> | undefined;
    if (!statuses || statuses.length === 0) return null;

    const s = statuses[0]!;
    const result: {
      messageId: string;
      recipientId: string;
      status: string;
      timestamp: Date;
      errorCode?: string;
      errorTitle?: string;
      pricingCategory?: string;
      billable?: boolean;
    } = {
      messageId: s["id"] as string,
      recipientId: s["recipient_id"] as string,
      status: s["status"] as string,
      timestamp: new Date(parseInt(s["timestamp"] as string) * 1000),
    };

    const errors = s["errors"] as Array<Record<string, unknown>> | undefined;
    if (errors && errors.length > 0) {
      result.errorCode = String(errors[0]!["code"]);
      result.errorTitle = errors[0]!["title"] as string;
    }

    const pricing = s["pricing"] as Record<string, unknown> | undefined;
    if (pricing) {
      result.pricingCategory = pricing["category"] as string;
      result.billable = pricing["billable"] as boolean;
    }

    return result;
  }

  async markAsRead(messageId: string): Promise<void> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      });
    } catch {
      // Fire-and-forget — don't block message processing
    }
  }

  extractMessageId(rawPayload: unknown): string | null {
    const payload = rawPayload as Record<string, unknown>;
    const entry = (payload?.["entry"] as Array<Record<string, unknown>>)?.[0];
    const changes = (entry?.["changes"] as Array<Record<string, unknown>>)?.[0];
    const value = changes?.["value"] as Record<string, unknown>;
    const messages = value?.["messages"] as Array<Record<string, unknown>>;
    return (messages?.[0]?.["id"] as string) ?? null;
  }

  /** Calculate a human-like typing delay based on response word count. */
  private typingDelay(text: string): number {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return Math.min(Math.max(Math.round((wordCount / 50) * 60_000), 1500), 4000);
  }

  private async sendMessage(_to: string, body: Record<string, unknown>): Promise<void> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    await withRetry(
      async () => {
        await this.rateLimiter.acquire();
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new WhatsAppApiError(
            `WhatsApp API error (${response.status}): ${errorBody}`,
            response.status,
          );
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        shouldRetry: (err: unknown) => {
          if (err instanceof WhatsAppApiError) {
            return err.status === 429 || err.status >= 500;
          }
          return true; // Network errors etc.
        },
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Helper functions for parseIncomingMessage complexity reduction
// ---------------------------------------------------------------------------

const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

function extractWhatsAppValue(payload: Record<string, unknown>): Record<string, unknown> | null {
  const entry = (payload["entry"] as Array<Record<string, unknown>>)?.[0];
  if (!entry) return null;

  const changes = (entry["changes"] as Array<Record<string, unknown>>)?.[0];
  if (!changes) return null;

  const value = changes["value"] as Record<string, unknown> | undefined;
  return value ?? null;
}

function extractContactName(value: Record<string, unknown>): string | undefined {
  const contacts = value["contacts"] as Array<Record<string, unknown>> | undefined;
  return (contacts?.[0]?.["profile"] as Record<string, unknown>)?.["name"] as string | undefined;
}

function extractReferralData(msg: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const referral = msg["referral"] as Record<string, unknown> | undefined;
  if (referral) {
    if (referral["source_id"]) metadata["sourceAdId"] = referral["source_id"];
    if (referral["source_type"]) metadata["adSourceType"] = referral["source_type"];
    if (referral["headline"]) metadata["adHeadline"] = referral["headline"];
    if (referral["body"]) metadata["adBody"] = referral["body"];
  }
  return metadata;
}

function parseInteractiveMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
): IncomingMessage | null {
  const interactive = msg["interactive"] as Record<string, unknown> | undefined;
  if (!interactive) return null;

  const interactiveType = interactive["type"] as string;
  let text: string | undefined;

  if (interactiveType === "button_reply") {
    const buttonReply = interactive["button_reply"] as Record<string, unknown> | undefined;
    text = buttonReply?.["id"] as string | undefined;
  } else if (interactiveType === "list_reply") {
    const listReply = interactive["list_reply"] as Record<string, unknown> | undefined;
    text = listReply?.["id"] as string | undefined;
  }

  if (!text) return null;

  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const metadata: Record<string, unknown> = { interactiveType };
  if (contactName) metadata["contactName"] = contactName;

  // Extract referral data from Meta Lead Ads (click-to-WhatsApp)
  const referralData = extractReferralData(msg);
  Object.assign(metadata, referralData);

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text,
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments: [],
    organizationId: null,
  };
}

function parseMediaMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
  msgType: string,
): IncomingMessage {
  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const mediaObj = msg[msgType] as Record<string, unknown> | undefined;
  const mediaId = mediaObj?.["id"] as string | undefined;
  const filename = mediaObj?.["filename"] as string | undefined;

  const metadata: Record<string, unknown> = { originalType: msgType };
  if (contactName) metadata["contactName"] = contactName;
  if (mediaId) metadata["mediaId"] = mediaId;

  const referralData = extractReferralData(msg);
  Object.assign(metadata, referralData);

  const attachments: Array<{
    type: string;
    url: string | null;
    data: unknown;
    filename: string | null;
  }> = [];
  if (mediaId) {
    attachments.push({
      type: msgType,
      url: null,
      data: { mediaId },
      filename: filename ?? null,
    });
  }

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text: "",
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments,
    organizationId: null,
  };
}

function parseUnsupportedMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
  msgType: string,
): IncomingMessage {
  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const metadata: Record<string, unknown> = { unsupported: true, originalType: msgType };
  if (contactName) metadata["contactName"] = contactName;

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text: "",
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments: [],
    organizationId: null,
  };
}

function parseTextMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
): IncomingMessage | null {
  const textObj = msg["text"] as Record<string, unknown>;
  const text = textObj?.["body"] as string;
  if (!text) return null;

  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const metadata: Record<string, unknown> = {};
  if (contactName) metadata["contactName"] = contactName;

  // Extract referral data from Meta Lead Ads (click-to-WhatsApp)
  const referralData = extractReferralData(msg);
  Object.assign(metadata, referralData);

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text,
    threadId: from, // In WhatsApp, thread is keyed by phone number
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments: [],
    organizationId: null,
  };
}
