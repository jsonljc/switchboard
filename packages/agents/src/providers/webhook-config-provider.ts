// ---------------------------------------------------------------------------
// Webhook Config Provider — bridges webhook store to agent router/handler
// ---------------------------------------------------------------------------

import type { WebhookDestinationConfig, DestinationCriticality } from "../route-plan.js";

export interface WebhookConfigEntry {
  id: string;
  url: string;
  secret: string;
  subscribedEvents: string[];
  criticality: DestinationCriticality;
  enabled: boolean;
}

export class InMemoryWebhookConfigProvider {
  private store = new Map<string, Map<string, WebhookConfigEntry>>();

  register(organizationId: string, entry: WebhookConfigEntry): void {
    let orgMap = this.store.get(organizationId);
    if (!orgMap) {
      orgMap = new Map();
      this.store.set(organizationId, orgMap);
    }
    orgMap.set(entry.id, entry);
  }

  remove(organizationId: string, webhookId: string): boolean {
    return this.store.get(organizationId)?.delete(webhookId) ?? false;
  }

  listForOrg(organizationId: string): WebhookConfigEntry[] {
    const orgMap = this.store.get(organizationId);
    return orgMap ? [...orgMap.values()] : [];
  }

  /** Returns configs in the shape the AgentRouter expects. */
  toRouterConfigs(organizationId: string): WebhookDestinationConfig[] {
    return this.listForOrg(organizationId).map((entry) => ({
      id: entry.id,
      url: entry.url,
      subscribedEvents: entry.subscribedEvents,
      criticality: entry.criticality,
      enabled: entry.enabled,
    }));
  }

  /** Returns a Map keyed by webhook ID for the webhook dispatch handler. */
  toHandlerConfigs(
    organizationId: string,
  ): Map<string, WebhookDestinationConfig & { secret: string }> {
    const result = new Map<string, WebhookDestinationConfig & { secret: string }>();
    for (const entry of this.listForOrg(organizationId)) {
      result.set(entry.id, {
        id: entry.id,
        url: entry.url,
        secret: entry.secret,
        subscribedEvents: entry.subscribedEvents,
        criticality: entry.criticality,
        enabled: entry.enabled,
      });
    }
    return result;
  }
}
