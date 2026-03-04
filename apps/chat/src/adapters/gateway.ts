import type { ChannelAdapter } from "./adapter.js";

/**
 * ChannelGateway manages multiple channel adapters and routes
 * incoming messages to the correct adapter based on channel type.
 */
export class ChannelGateway {
  private adapters = new Map<string, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
  }

  get(channel: string): ChannelAdapter | null {
    return this.adapters.get(channel) ?? null;
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Detect which adapter should handle a raw webhook payload.
   * Returns the adapter and the parsed channel name, or null if no match.
   */
  detect(rawPayload: unknown): { adapter: ChannelAdapter; channel: string } | null {
    const payload = rawPayload as Record<string, unknown>;

    // Telegram: has "message" or "callback_query" at top level
    if (payload["message"] || payload["callback_query"]) {
      const adapter = this.adapters.get("telegram");
      if (adapter) return { adapter, channel: "telegram" };
    }

    // Slack: has "event" with "type" field, or "challenge" for URL verification
    if (payload["event"] || payload["challenge"]) {
      const adapter = this.adapters.get("slack");
      if (adapter) return { adapter, channel: "slack" };
    }

    // WhatsApp: has "entry" array with object="whatsapp_business_account"
    if (Array.isArray(payload["entry"])) {
      const objectType = payload["object"] as string | undefined;

      // Instagram DM webhooks have object="instagram"
      if (objectType === "instagram") {
        const adapter = this.adapters.get("instagram");
        if (adapter) return { adapter, channel: "instagram" };
      }

      // Messenger webhooks have object="page"
      if (objectType === "page") {
        const adapter = this.adapters.get("messenger");
        if (adapter) return { adapter, channel: "messenger" };
      }

      // WhatsApp webhooks have object="whatsapp_business_account"
      const adapter = this.adapters.get("whatsapp");
      if (adapter) return { adapter, channel: "whatsapp" };
    }

    return null;
  }
}
