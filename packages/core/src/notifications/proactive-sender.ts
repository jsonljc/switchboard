// ---------------------------------------------------------------------------
// Proactive Sender — AgentNotifier implementation
// ---------------------------------------------------------------------------
// Delivers proactive messages from agents to business owners via their
// configured notification channel (Telegram, Slack, WhatsApp).
// Rate-limited to prevent spam.
// ---------------------------------------------------------------------------

import type { AgentNotifier } from "../agents/types.js";

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
      console.warn(`[ProactiveSender] Rate limit reached for chat ${chatId}. Message not sent.`);
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

    // Check 24h window if callback is configured
    if (this.isWithinWindow) {
      const withinWindow = await this.isWithinWindow(to);
      if (!withinWindow) {
        console.warn(
          `[ProactiveSender] WhatsApp 24h window expired for ${to} — skipping freeform message`,
        );
        return;
      }
    }

    const res = await fetch(`https://graph.facebook.com/v18.0/${creds.phoneNumberId}/messages`, {
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
