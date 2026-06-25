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

/**
 * Thrown on the org-aware send path when the SENDING org has its own WhatsApp connection but that
 * connection does not yield usable send credentials — either it lacks a phone number id of its own
 * (`org_phone_missing`: the phoneNumberId is the tenant FROM-identity, so borrowing the global/pilot
 * number would ship the message FROM another tenant's WABA number — a cross-tenant leak), or no send
 * token resolves anywhere (`config_missing` for an already-onboarded org). In both cases the tenant
 * is onboarded, so we fail closed and THROW (rather than silently skip) — the caller surfaces an
 * honest delivery failure instead of a phantom success, and a silently-dropped operator or
 * escalation reply is worse than a visible 502. The single-tenant pilot (no per-org connection at
 * all) is NOT this error — it keeps the legacy silent warn+skip. The message carries only the
 * (non-PII) organization id and the reason; never the recipient phone or any credential.
 */
export class WhatsAppSendCredsUnavailableError extends Error {
  readonly kind = "whatsapp_send_creds_unavailable" as const;
  readonly reason: "org_phone_missing" | "config_missing";
  constructor(organizationId: string, reason: "org_phone_missing" | "config_missing") {
    super(
      `WhatsApp send blocked for org ${organizationId} (${reason}): its connection did not yield ` +
        `usable send credentials of its own. Refusing to borrow another tenant's number or report ` +
        `a phantom delivery (fail-closed tenant isolation).`,
    );
    this.name = "WhatsAppSendCredsUnavailableError";
    this.reason = reason;
  }
}

/** Interface for sending proactive messages to business owners. */
export interface AgentNotifier {
  sendProactive(chatId: string, channelType: string, message: string): Promise<void>;
  /**
   * Org-aware send (A15). Resolves the SENDING org's own WhatsApp send creds (phone
   * id org-only and fail-closed; only the token may fall back to the global system-user
   * token) and scopes the 24h-window gate to
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
 * org's stored connection omits it. The sender resolves these via the fail-closed
 * {@link resolveEffectiveWhatsAppSendCreds} rule: the phone id is org-only and fails closed
 * when missing (never borrowed from the global creds — it is the tenant FROM-identity),
 * while the token may fall back to the global system-user token. (The single-tenant pilot
 * has no per-org connection at all and uses the global creds.) Shape mirrors the API-side
 * `resolveOrgWhatsAppSendCreds` helper.
 */
export interface OrgWhatsAppSendCreds {
  token: string | null;
  phoneNumberId: string | null;
}

/**
 * The EFFECTIVE WhatsApp send creds for a sending org, or the reason no safe pair could be formed.
 * `org_phone_missing` is the multi-tenant fail-closed: a per-org connection exists but lacks its own
 * phone number id, so there is no number we may send this org's message from. `config_missing` is a
 * deployment-wide gap (the single-tenant pilot env is unset, or no token resolves anywhere).
 */
export type EffectiveWhatsAppCreds =
  | { ok: true; token: string; phoneNumberId: string }
  | { ok: false; reason: "config_missing" | "org_phone_missing" };

/**
 * Resolve the effective WhatsApp send creds for a sending org, FAIL-CLOSED on the multi-tenant
 * isolation boundary. Pure (no I/O) so it is unit-testable in isolation. Mirrors the API-side
 * `resolveEffectiveSendCreds` (Robin recovery, PR #1271); the two paths share one isolation rule.
 *
 * `perOrg` is the org's own creds from its canonical "whatsapp" Connection, or `null` when the org
 * has NO per-org connection at all (the single-tenant pilot). `global` is the deployment env creds.
 *
 * The rule is ASYMMETRIC because the two fields play different roles:
 * - `phoneNumberId` is the tenant FROM-identity (which number the recipient sees). When a per-org
 *   connection EXISTS it is org-only — a missing one fails closed (`org_phone_missing`), NEVER
 *   falling back to the global/pilot number. That fallback is the cross-tenant leak this guards.
 * - `token` only authorizes the Graph call, so it MAY fall back to the global system-user token
 *   (the Meta Tech Provider model: one system token authorizes many per-org WABA numbers).
 *
 * With NO per-org connection (`perOrg === null`) this is the pilot: the global token + phone id are
 * both required (else `config_missing`).
 */
export function resolveEffectiveWhatsAppSendCreds(
  perOrg: OrgWhatsAppSendCreds | null,
  global: { token: string; phoneNumberId: string } | undefined,
): EffectiveWhatsAppCreds {
  if (perOrg === null) {
    // Single-tenant pilot: no per-org connection. Use the global creds; both fields are required.
    if (!global?.token || !global?.phoneNumberId) return { ok: false, reason: "config_missing" };
    return { ok: true, token: global.token, phoneNumberId: global.phoneNumberId };
  }
  // A per-org connection EXISTS. The phone id is the tenant FROM-identity: org-only, NEVER global.
  if (!perOrg.phoneNumberId) return { ok: false, reason: "org_phone_missing" };
  // The token authorizes only; it may fall back to the global system-user token (Tech Provider).
  const token = perOrg.token ?? global?.token ?? null;
  if (!token) return { ok: false, reason: "config_missing" };
  return { ok: true, token, phoneNumberId: perOrg.phoneNumberId };
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
   * resolves the org's own {token, phoneNumberId} via the fail-closed
   * {@link resolveEffectiveWhatsAppSendCreds} rule (phone id org-only; only the token may
   * fall back to the global `credentials.whatsapp`). Absent → the global creds are used
   * for every org.
   */
  resolveOrgSendCreds?: (organizationId: string) => Promise<OrgWhatsAppSendCreds | null>;
}

export class ProactiveSender implements AgentNotifier {
  private credentials: ChannelCredentials;
  // Daily send counts keyed per (sending org, chat) — see {@link rateLimitKey}. Keying by org as
  // well as chat keeps one tenant's outreach to a recipient from consuming another tenant's daily
  // budget for the SAME recipient (a customer phone shared across businesses, or a chat-id collision
  // across channels) — a cross-tenant interference + activity-inference seam.
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
   * Resolve the sending org's effective WhatsApp creds via the fail-closed
   * {@link resolveEffectiveWhatsAppSendCreds} rule (phone id org-only, token may fall back). No
   * resolver configured → the global creds (no per-org notion exists, e.g. no DB).
   *
   * When a per-org connection EXISTS (`perOrg !== null`) but does not yield usable creds — a missing
   * phone id (`org_phone_missing`) OR no token anywhere (`config_missing` for an onboarded org) — we
   * THROW {@link WhatsAppSendCredsUnavailableError}: the tenant is onboarded, so we never borrow the
   * global/pilot number and never report a phantom success; the caller surfaces an honest failure.
   * Only the genuine single-tenant pilot (`perOrg === null` with an incomplete global config) returns
   * undefined, preserving the legacy silent warn+skip in {@link sendWhatsApp} (an unconfigured
   * deployment-wide channel, not a tenant-isolation fault).
   */
  private async resolveWhatsAppCreds(
    organizationId: string,
  ): Promise<{ token: string; phoneNumberId: string } | undefined> {
    const global = this.credentials.whatsapp;
    if (!this.resolveOrgSendCreds) return global;
    const perOrg = await this.resolveOrgSendCreds(organizationId);
    const effective = resolveEffectiveWhatsAppSendCreds(perOrg, global);
    if (effective.ok) return { token: effective.token, phoneNumberId: effective.phoneNumberId };
    // A per-org connection exists but yields no usable creds → fail closed loudly (onboarded tenant).
    if (perOrg !== null) {
      throw new WhatsAppSendCredsUnavailableError(organizationId, effective.reason);
    }
    // perOrg === null → single-tenant pilot, deployment-wide gap: keep the legacy silent warn+skip.
    return undefined;
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
    if (!this.checkRateLimit(chatId, organizationId)) {
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

  /**
   * Build the per-(org, chat) rate-limit key. The NUL separator can appear in neither a cuid org id
   * nor a phone / chat id, so distinct (org, chat) pairs can never collide onto one key. The legacy
   * org-blind path (no org) uses a single `*` bucket, preserving its per-chat behavior.
   */
  private rateLimitKey(chatId: string, organizationId: string | undefined): string {
    return `${organizationId ?? "*"}\u0000${chatId}`;
  }

  private checkRateLimit(chatId: string, organizationId: string | undefined): boolean {
    const key = this.rateLimitKey(chatId, organizationId);
    const now = Date.now();
    const entry = this.dailyCounts.get(key);

    if (!entry || now >= entry.resetAt) {
      this.dailyCounts.set(key, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
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
