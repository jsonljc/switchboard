// ---------------------------------------------------------------------------
// Webhook Channel — Sends notification payloads via HTTP POST/PUT
// ---------------------------------------------------------------------------

import type {
  WebhookChannelConfig,
  NotificationPayload,
  NotificationResult,
} from "../types.js";

export class WebhookChannel {
  constructor(private readonly config: WebhookChannelConfig) {}

  /**
   * Send a notification payload to the configured webhook URL.
   * Returns a result indicating success or failure.
   */
  async send(payload: NotificationPayload): Promise<NotificationResult> {
    const method = this.config.method ?? "POST";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    try {
      const response = await fetch(this.config.url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return {
          channelType: "webhook",
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          responseStatus: response.status,
        };
      }

      return {
        channelType: "webhook",
        success: true,
        responseStatus: response.status,
      };
    } catch (err) {
      return {
        channelType: "webhook",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
