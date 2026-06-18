// ---------------------------------------------------------------------------
// Proactive Sender — AgentNotifier implementation
// ---------------------------------------------------------------------------
// Delivers proactive messages from agents to business owners via their
// configured notification channel (Telegram, Slack, WhatsApp).
// Rate-limited to prevent spam.
// ---------------------------------------------------------------------------

import { maskPhone } from "../audit/mask-phone.js";

/**
 * Thrown when a free-form WhatsApp message cannot be sent because the recipient
 * is outside the 24h customer-care window and no approved template was supplied.
 *
 * Free-form sends outside the window are silently dropped by Meta, so returning
 * (no throw) would let callers report a delivery that never happened. Callers
 * (e.g. the escalation reply route) catch this to roll back any state they
 * mutated optimistically and surface an honest failure instead of phantom
 * success. The recipient phone is masked in the message (F10/PDPA).
 */
export class WhatsAppWindowClosedError extends Error {
  readonly kind = "whatsapp_window_closed" as const;
  constructor(maskedRecipient: string) {
    super(
      `WhatsApp 24h window closed for ${maskedRecipient} and no approved template supplied: free-form message not delivered.`,
    );
    this.name = "WhatsAppWindowClosedError";
  }
}

/** Interface for sending proactive messages to business owners. */
export interface AgentNotifier {
  sendProactive(chatId: string, channelType: string, message: string): Promise<void>;
}

export interface ChannelCredentials {
  telegram?: { botToken: string };
  slack?: { botToken: string };
  whatsapp?: { token: string; phoneNumberId: string };
}

/** Maximum proactive messages per chat per day. */
const MAX_DAILY_MESSAGES = 20;

export interface ProactiveSenderConfig {
  credentials: ChannelCredentials;
  /** Optional callback to check if a chatId is within the WhatsApp 24h window. */
  isWithinWindow?: (chatId: string) => Promise<boolean>;
}

export class ProactiveSender implements AgentNotifier {
  private credentials: ChannelCredentials;
  private dailyCounts = new Map<string, { count: number; resetAt: number }>();
  private isWithinWindow: ((chatId: string) => Promise<boolean>) | null;

  constructor(credentialsOrConfig: ChannelCredentials | ProactiveSenderConfig) {
    if ("credentials" in credentialsOrConfig) {
      this.credentials = credentialsOrConfig.credentials;
      this.isWithinWindow = credentialsOrConfig.isWithinWindow ?? null;
    } else {
      this.credentials = credentialsOrConfig;
      this.isWithinWindow = null;
    }
  }

  async sendProactive(chatId: string, channelType: string, message: string): Promise<void> {
    if (!this.checkRateLimit(chatId)) {
      // chatId is the phone only on the WhatsApp channel; Telegram/Slack ids are not phones.
      const idForLog = channelType === "whatsapp" ? maskPhone(chatId) : chatId;
      console.warn(`[ProactiveSender] Rate limit reached for chat ${idForLog}. Message not sent.`);
      return;
    }

    switch (channelType) {
      case "telegram":
        await this.sendTelegram(chatId, message);
        break;
      case "slack":
        await this.sendSlack(chatId, message);
        break;
      case "whatsapp":
        await this.sendWhatsApp(chatId, message);
        break;
      default:
        console.warn(`[ProactiveSender] Unknown channel type: ${channelType}`);
    }
  }

  private checkRateLimit(chatId: string): boolean {
    const now = Date.now();
    const entry = this.dailyCounts.get(chatId);

    if (!entry || now >= entry.resetAt) {
      this.dailyCounts.set(chatId, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
      return true;
    }

    if (entry.count >= MAX_DAILY_MESSAGES) {
      return false;
    }

    entry.count++;
    return true;
  }

  private async sendTelegram(chatId: string, message: string): Promise<void> {
    const creds = this.credentials.telegram;
    if (!creds) {
      console.warn("[ProactiveSender] No Telegram credentials configured");
      return;
    }

    const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });

    if (!res.ok) {
      throw new Error(`Telegram API error: ${res.status} ${res.statusText}`);
    }
  }

  private async sendSlack(channel: string, message: string): Promise<void> {
    const creds = this.credentials.slack;
    if (!creds) {
      console.warn("[ProactiveSender] No Slack credentials configured");
      return;
    }

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.botToken}`,
      },
      body: JSON.stringify({ channel, text: message }),
    });

    if (!res.ok) {
      throw new Error(`Slack API error: ${res.status} ${res.statusText}`);
    }
  }

  private async sendWhatsApp(to: string, message: string): Promise<void> {
    const creds = this.credentials.whatsapp;
    if (!creds) {
      console.warn("[ProactiveSender] No WhatsApp credentials configured");
      return;
    }

    // Check 24h window if callback is configured. Outside the window, a free-form
    // message is silently dropped by Meta; with no approved template to substitute
    // (template fallback is a separate workstream), THROW so the caller does not
    // mistake a non-delivery for success. The recipient phone is masked (F10/PDPA).
    if (this.isWithinWindow) {
      const withinWindow = await this.isWithinWindow(to);
      if (!withinWindow) {
        const masked = maskPhone(to);
        console.warn(
          `[ProactiveSender] WhatsApp 24h window expired for ${masked}: freeform message not delivered`,
        );
        throw new WhatsAppWindowClosedError(masked);
      }
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    });

    if (!res.ok) {
      throw new Error(`WhatsApp API error: ${res.status} ${res.statusText}`);
    }
  }
}
