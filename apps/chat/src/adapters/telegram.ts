import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "@switchboard/schemas";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "./adapter.js";
import { withRetry } from "@switchboard/core";

/** Error carrying HTTP status for retry decisions. */
class TelegramApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

/**
 * Token bucket rate limiter for Telegram Bot API (30 msg/sec limit).
 */
class TelegramRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity = 30;
  private readonly refillRate = 30; // tokens per second

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

export type PrincipalLookup = (principalId: string) => Promise<{ organizationId: string | null } | null>;

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = "telegram" as const;
  private baseUrl: string;
  private principalLookup: PrincipalLookup | null;
  private rateLimiter = new TelegramRateLimiter();
  private webhookSecret: string | null;

  constructor(botToken: string, principalLookup?: PrincipalLookup, webhookSecret?: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
    this.principalLookup = principalLookup ?? null;
    this.webhookSecret = webhookSecret ?? null;

    if (process.env.NODE_ENV === "production" && !webhookSecret) {
      throw new Error("TELEGRAM_WEBHOOK_SECRET must be set in production for webhook verification");
    }
    if (!webhookSecret && process.env.NODE_ENV !== "test") {
      console.warn("[TelegramAdapter] No webhook secret configured — webhook verification is disabled");
    }
  }

  /**
   * Verify Telegram webhook secret token using timing-safe comparison.
   * Telegram sends the secret in the X-Telegram-Bot-Api-Secret-Token header.
   */
  verifyRequest(_rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.webhookSecret) return true; // No secret configured
    const token = headers["x-telegram-bot-api-secret-token"];
    if (!token) return false;
    try {
      return timingSafeEqual(Buffer.from(this.webhookSecret), Buffer.from(token));
    } catch {
      return false; // Different lengths
    }
  }

  async resolveOrganizationId(principalId: string): Promise<string | null> {
    if (!this.principalLookup) return null;
    const principal = await this.principalLookup(principalId);
    return principal?.organizationId ?? null;
  }

  parseIncomingMessage(rawPayload: unknown): IncomingMessage | null {
    const payload = rawPayload as Record<string, unknown>;
    const message = payload["message"] as Record<string, unknown> | undefined;
    const callbackQuery = payload["callback_query"] as Record<string, unknown> | undefined;

    if (message) {
      const from = message["from"] as Record<string, unknown>;
      const chat = message["chat"] as Record<string, unknown>;

      return {
        id: `tg_${message["message_id"]}`,
        channel: "telegram",
        channelMessageId: String(message["message_id"]),
        threadId: String(chat["id"]),
        principalId: String(from["id"]),
        organizationId: null, // resolved async via resolveOrganizationId
        text: (message["text"] as string) ?? "",
        attachments: [],
        timestamp: new Date((message["date"] as number) * 1000),
      };
    }

    if (callbackQuery) {
      const from = callbackQuery["from"] as Record<string, unknown>;
      const cbMessage = callbackQuery["message"] as Record<string, unknown>;
      const chat = cbMessage["chat"] as Record<string, unknown>;

      return {
        id: `tg_cb_${callbackQuery["id"]}`,
        channel: "telegram",
        channelMessageId: String(callbackQuery["id"]),
        threadId: String(chat["id"]),
        principalId: String(from["id"]),
        organizationId: null, // resolved async via resolveOrganizationId
        text: (callbackQuery["data"] as string) ?? "",
        attachments: [],
        timestamp: new Date(),
      };
    }

    return null;
  }

  async sendTextReply(threadId: string, text: string): Promise<void> {
    await this.apiCall("sendMessage", {
      chat_id: threadId,
      text,
      parse_mode: "Markdown",
    });
  }

  async sendApprovalCard(threadId: string, card: ApprovalCardPayload): Promise<void> {
    const inlineKeyboard = card.buttons.map((btn) => [
      { text: btn.label, callback_data: btn.callbackData },
    ]);

    await this.apiCall("sendMessage", {
      chat_id: threadId,
      text: card.summary + "\n\n" + card.explanation,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: inlineKeyboard },
    });
  }

  async sendResultCard(threadId: string, card: ResultCardPayload): Promise<void> {
    const icon = card.success ? "Done" : "Failed";
    let text = `${icon}: ${card.summary}\n`;
    text += `Risk: ${card.riskCategory}\n`;
    text += `Audit: ${card.auditId}\n`;
    if (card.undoAvailable) {
      text += `Undo available: reply 'undo' within ${card.undoExpiresAt ? Math.round((card.undoExpiresAt.getTime() - Date.now()) / 3600000) : 24}h`;
    }

    await this.apiCall("sendMessage", {
      chat_id: threadId,
      text,
      parse_mode: "Markdown",
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.apiCall("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: text ?? "",
    });
  }

  extractMessageId(rawPayload: unknown): string | null {
    const payload = rawPayload as Record<string, unknown>;
    const message = payload["message"] as Record<string, unknown> | undefined;
    if (message) {
      return String(message["message_id"]);
    }
    const callback = payload["callback_query"] as Record<string, unknown> | undefined;
    if (callback) {
      return String(callback["id"]);
    }
    return null;
  }

  private async apiCall(method: string, body: Record<string, unknown>): Promise<unknown> {
    return withRetry(
      async () => {
        await this.rateLimiter.acquire();
        const response = await fetch(`${this.baseUrl}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text();
          const retryAfter = response.headers.get("retry-after");
          const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
          throw new TelegramApiError(
            `Telegram API error ${response.status}: ${text}`,
            response.status,
            retryAfterMs,
          );
        }

        return response.json();
      },
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        shouldRetry: (err: unknown) => {
          if (err instanceof TelegramApiError) {
            return err.status === 429 || err.status >= 500;
          }
          return true; // Network errors etc.
        },
        onRetry: (err: unknown) => {
          if (err instanceof TelegramApiError && err.retryAfterMs) {
            return err.retryAfterMs;
          }
          return undefined;
        },
      },
    );
  }
}
