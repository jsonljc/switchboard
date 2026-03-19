// ---------------------------------------------------------------------------
// Webhook Dispatch Handler — POSTs events to webhook URLs with HMAC signing
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import type { RoutedEventEnvelope } from "../events.js";
import type { WebhookDestinationConfig } from "../route-plan.js";

export interface WebhookHandlerConfig {
  getConfigs: () => Map<string, WebhookDestinationConfig & { secret: string }>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export function createWebhookHandler(config: WebhookHandlerConfig) {
  const fetchFn = config.fetchFn ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;

  return async (
    event: RoutedEventEnvelope,
    destinationId: string,
  ): Promise<{ success: boolean }> => {
    const webhook = config.getConfigs().get(destinationId);
    if (!webhook) {
      return { success: false };
    }

    const payload = {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      organizationId: event.organizationId,
      correlationId: event.correlationId,
      payload: event.payload,
      attribution: event.attribution,
    };

    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");

    try {
      const response = await fetchFn(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Switchboard-Signature": signature,
          "X-Switchboard-Event": event.eventType,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      return { success: response.ok };
    } catch {
      return { success: false };
    }
  };
}
