// ---------------------------------------------------------------------------
// Proactive Sender — AgentNotifier implementation for apps/api
// ---------------------------------------------------------------------------
// Reusable by the agent runner to deliver proactive messages from agents.
// ---------------------------------------------------------------------------

import type { AgentNotifier } from "@switchboard/core";

interface ChannelCredentials {
  telegram?: { botToken: string };
  slack?: { botToken: string };
  whatsapp?: { token: string; phoneNumberId: string };
}

const MAX_DAILY_MESSAGES = 20;

export class ProactiveSender implements AgentNotifier {
  private credentials: ChannelCredentials;
  private dailyCounts = new Map<string, { count: number; resetAt: number }>();

  constructor(credentials: ChannelCredentials) {
    this.credentials = credentials;
  }

  async sendProactive(chatId: string, channelType: string, message: string): Promise<void> {
    if (!this.checkRateLimit(chatId)) {
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
        break;
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
    if (!creds) return;

    await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      }),
    });
  }

  private async sendSlack(channel: string, message: string): Promise<void> {
    const creds = this.credentials.slack;
    if (!creds) return;

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.botToken}`,
      },
      body: JSON.stringify({ channel, text: message }),
    });
  }

  private async sendWhatsApp(to: string, message: string): Promise<void> {
    const creds = this.credentials.whatsapp;
    if (!creds) return;

    await fetch(`https://graph.facebook.com/v18.0/${creds.phoneNumberId}/messages`, {
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
  }
}
