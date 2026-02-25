import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "@switchboard/schemas";
import type { ChannelAdapter, ApprovalCardPayload, ResultCardPayload } from "./adapter.js";

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  private token: string;
  private phoneNumberId: string;
  private appSecret: string | null;
  private verifyToken: string | null;
  private apiVersion: string;

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
    this.apiVersion = config.apiVersion ?? "v17.0";
  }

  /**
   * Verify webhook signature using HMAC-SHA256 with the app secret.
   */
  verifyRequest(rawBody: string, headers: Record<string, string | undefined>): boolean {
    if (!this.appSecret) {
      console.warn("[WhatsAppAdapter] verifyRequest called without appSecret configured — failing closed");
      return false;
    }

    const signature = headers["x-hub-signature-256"];
    if (!signature) return false;

    const expectedSig = "sha256=" + createHmac("sha256", this.appSecret)
      .update(rawBody)
      .digest("hex");

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
    if (
      query["hub.mode"] === "subscribe" &&
      query["hub.verify_token"] === this.verifyToken
    ) {
      return { status: 200, body: query["hub.challenge"] ?? "" };
    }
    return { status: 403, body: "Verification failed" };
  }

  parseIncomingMessage(rawPayload: unknown): IncomingMessage | null {
    const payload = rawPayload as Record<string, unknown>;
    if (!payload) return null;

    // WhatsApp Cloud API webhook structure:
    // { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [...] } }] }] }
    const entry = (payload["entry"] as Array<Record<string, unknown>>)?.[0];
    if (!entry) return null;

    const changes = (entry["changes"] as Array<Record<string, unknown>>)?.[0];
    if (!changes) return null;

    const value = changes["value"] as Record<string, unknown> | undefined;
    if (!value) return null;

    const messages = value["messages"] as Array<Record<string, unknown>> | undefined;
    if (!messages || messages.length === 0) return null;

    const msg = messages[0]!;
    const msgType = msg["type"] as string;

    // Handle interactive message types (button replies, list replies)
    if (msgType === "interactive") {
      const interactive = msg["interactive"] as Record<string, unknown> | undefined;
      if (interactive) {
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

        const contacts = value["contacts"] as Array<Record<string, unknown>> | undefined;
        const contactName = (contacts?.[0]?.["profile"] as Record<string, unknown>)?.["name"] as string | undefined;

        return {
          id: msgId ?? `wa_${Date.now()}`,
          channel: "whatsapp",
          principalId: from ?? "unknown",
          text,
          threadId: from,
          timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
          metadata: contactName ? { contactName, interactiveType } : { interactiveType },
          organizationId: null,
        };
      }
    }

    // Only handle text messages
    if (msgType !== "text") return null;

    const textObj = msg["text"] as Record<string, unknown>;
    const text = textObj?.["body"] as string;
    if (!text) return null;

    const from = msg["from"] as string;
    const msgId = msg["id"] as string;
    const timestamp = msg["timestamp"] as string;

    // Extract contact name if available
    const contacts = value["contacts"] as Array<Record<string, unknown>> | undefined;
    const contactName = (contacts?.[0]?.["profile"] as Record<string, unknown>)?.["name"] as string | undefined;

    return {
      id: msgId ?? `wa_${Date.now()}`,
      channel: "whatsapp",
      principalId: from ?? "unknown",
      text,
      threadId: from, // In WhatsApp, thread is keyed by phone number
      timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
      metadata: contactName ? { contactName } : {},
      organizationId: null,
    };
  }

  async sendTextReply(threadId: string, text: string): Promise<void> {
    await this.sendMessage(threadId, {
      messaging_product: "whatsapp",
      to: threadId,
      type: "text",
      text: { body: text },
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
        header: { type: "text", text: `[${card.riskCategory.toUpperCase()}] Approval Required` },
        body: { text: `${card.summary}\n\n${card.explanation}` },
        action: { buttons },
      },
    });
  }

  async sendResultCard(threadId: string, card: ResultCardPayload): Promise<void> {
    const statusEmoji = card.success ? "✅" : "❌";
    const undoNote = card.undoAvailable
      ? `\n\nUndo available${card.undoExpiresAt ? ` until ${card.undoExpiresAt.toISOString()}` : ""}`
      : "";

    const text = [
      `${statusEmoji} *${card.summary}*`,
      `Risk: ${card.riskCategory}`,
      `Audit: ${card.auditId}`,
      undoNote,
    ].filter(Boolean).join("\n");

    await this.sendTextReply(threadId, text);
  }

  extractMessageId(rawPayload: unknown): string | null {
    const payload = rawPayload as Record<string, unknown>;
    const entry = (payload?.["entry"] as Array<Record<string, unknown>>)?.[0];
    const changes = (entry?.["changes"] as Array<Record<string, unknown>>)?.[0];
    const value = changes?.["value"] as Record<string, unknown>;
    const messages = value?.["messages"] as Array<Record<string, unknown>>;
    return (messages?.[0]?.["id"] as string) ?? null;
  }

  private async sendMessage(to: string, body: Record<string, unknown>): Promise<void> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

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
      throw new Error(`WhatsApp API error (${response.status}): ${errorBody}`);
    }
  }
}
