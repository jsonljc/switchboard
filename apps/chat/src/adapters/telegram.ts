import type { IncomingMessage } from "@switchboard/schemas";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "./adapter.js";

export type PrincipalLookup = (principalId: string) => Promise<{ organizationId: string | null } | null>;

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = "telegram" as const;
  private baseUrl: string;
  private principalLookup: PrincipalLookup | null;

  constructor(botToken: string, principalLookup?: PrincipalLookup) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
    this.principalLookup = principalLookup ?? null;
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
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  }
}
