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
  /**
   * Org-aware send (A15). Resolves the SENDING org's own WhatsApp send creds
   * (per-field fallback to the global env creds) and scopes the 24h-window gate to
   * that org, so a second tenant's reply ships from its own WABA number and clears
   * the window gate on its OWN inbound — never the freshest cross-org row.
   * Non-WhatsApp channels behave exactly like {@link AgentNotifier.sendProactive}.
   */
  sendProactiveForOrg(
    organizationId: string,
    chatId: string,
    channelType: string,
    message: string,
  ): Promise<void>;
}

export interface ChannelCredentials {
  telegram?: { botToken: string };
  slack?: { botToken: string };
  whatsapp?: { token: string; phoneNumberId: string };
}

/**
 * Per-org WhatsApp send credentials returned by a
 * {@link ProactiveSenderConfig.resolveOrgSendCreds} resolver. A field is null when the
 * org's stored connection omits it; the sender then falls back per-field to the global
 * env creds (the single-tenant pilot has no per-org connection at all). Shape mirrors
 * the API-side `resolveOrgWhatsAppSendCreds` helper.
 */
export interface OrgWhatsAppSendCreds {
  token: string | null;
  phoneNumberId: string | null;
}

/** Maximum proactive messages per chat per day. */
const MAX_DAILY_MESSAGES = 20;

export interface ProactiveSenderConfig {
  credentials: ChannelCredentials;
  /**
   * Optional callback to check if a chatId is within the WhatsApp 24h window.
   * `organizationId` is the SENDING org on the org-aware path
   * ({@link ProactiveSender.sendProactiveForOrg}) and undefined on the legacy
   * org-blind {@link ProactiveSender.sendProactive} path.
   */
  isWithinWindow?: (chatId: string, organizationId?: string) => Promise<boolean>;
  /**
   * Optional per-org WhatsApp send-creds resolver. When set, sendProactiveForOrg
   * resolves the org's own {token, phoneNumberId} and falls back per-field to the
   * global `credentials.whatsapp`. Absent → the global creds are used for every org.
   */
  resolveOrgSendCreds?: (organizationId: string) => Promise<OrgWhatsAppSendCreds | null>;
}

export class ProactiveSender implements AgentNotifier {
  private credentials: ChannelCredentials;
  private dailyCounts = new Map<string, { count: number; resetAt: number }>();
  private isWithinWindow: ((chatId: string, organizationId?: string) => Promise<boolean>) | null;
  private resolveOrgSendCreds:
    | ((organizationId: string) => Promise<OrgWhatsAppSendCreds | null>)
    | null;

  constructor(credentialsOrConfig: ChannelCredentials | ProactiveSenderConfig) {
    if ("credentials" in credentialsOrConfig) {
      this.credentials = credentialsOrConfig.credentials;
      this.isWithinWindow = credentialsOrConfig.isWithinWindow ?? null;
      this.resolveOrgSendCreds = credentialsOrConfig.resolveOrgSendCreds ?? null;
    } else {
      this.credentials = credentialsOrConfig;
      this.isWithinWindow = null;
      this.resolveOrgSendCreds = null;
    }
  }

  /**
   * Legacy org-blind send. WhatsApp uses the global `credentials.whatsapp` and the
   * window gate is consulted with no org (so it fails closed without one). Prefer
   * {@link sendProactiveForOrg} for the multi-tenant operator/escalation reply paths.
   */
  async sendProactive(chatId: string, channelType: string, message: string): Promise<void> {
    await this.dispatch(chatId, channelType, message, this.credentials.whatsapp, undefined);
  }

  /** Org-aware send (A15) — see {@link AgentNotifier.sendProactiveForOrg}. */
  async sendProactiveForOrg(
    organizationId: string,
    chatId: string,
    channelType: string,
    message: string,
  ): Promise<void> {
    const whatsappCreds =
      channelType === "whatsapp"
        ? await this.resolveWhatsAppCreds(organizationId)
        : this.credentials.whatsapp;
    await this.dispatch(chatId, channelType, message, whatsappCreds, organizationId);
  }

  /**
   * Resolve the sending org's WhatsApp creds, per-field falling back to the global
   * `credentials.whatsapp`. Returns undefined (→ "no creds" warn+skip) only when BOTH
   * the org and the global lack a field. No resolver configured → the global creds.
   */
  private async resolveWhatsAppCreds(
    organizationId: string,
  ): Promise<{ token: string; phoneNumberId: string } | undefined> {
    const global = this.credentials.whatsapp;
    if (!this.resolveOrgSendCreds) return global;
    const resolved = await this.resolveOrgSendCreds(organizationId);
    const token = resolved?.token ?? global?.token ?? null;
    const phoneNumberId = resolved?.phoneNumberId ?? global?.phoneNumberId ?? null;
    if (!token || !phoneNumberId) return undefined;
    return { token, phoneNumberId };
  }

  /**
   * Shared send core. Applies the single daily-rate-limit map (one instance per
   * notifier, never reset per request) then dispatches by channel. The resolved
   * `whatsappCreds` + `organizationId` are threaded to the WhatsApp leg only.
   */
  private async dispatch(
    chatId: string,
    channelType: string,
    message: string,
    whatsappCreds: { token: string; phoneNumberId: string } | undefined,
    organizationId: string | undefined,
  ): Promise<void> {
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
        await this.sendWhatsApp(chatId, message, whatsappCreds, organizationId);
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

  private async sendWhatsApp(
    to: string,
    message: string,
    creds: { token: string; phoneNumberId: string } | undefined,
    organizationId: string | undefined,
  ): Promise<void> {
    if (!creds) {
      console.warn("[ProactiveSender] No WhatsApp credentials configured");
      return;
    }

    // Check 24h window if callback is configured. Outside the window, a free-form
    // message is silently dropped by Meta; with no approved template to substitute
    // (template fallback is a separate workstream), THROW so the caller does not
    // mistake a non-delivery for success. The recipient phone is masked (F10/PDPA).
    // organizationId scopes the gate to the SENDING org (A15); undefined on the
    // legacy org-blind path, where the gate fails closed.
    if (this.isWithinWindow) {
      const withinWindow = await this.isWithinWindow(to, organizationId);
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
