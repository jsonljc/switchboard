// ---------------------------------------------------------------------------
// Agent Router — resolves destinations for events, produces RoutePlans
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import type { AgentRegistry } from "./registry.js";
import type {
  RoutePlan,
  ResolvedDestination,
  WebhookDestinationConfig,
  ConnectorDestinationConfig,
} from "./route-plan.js";

export interface AgentRouterConfig {
  webhooks?: WebhookDestinationConfig[];
  connectors?: ConnectorDestinationConfig[];
}

export class AgentRouter {
  constructor(
    private registry: AgentRegistry,
    private config: AgentRouterConfig = {},
  ) {}

  resolve(event: RoutedEventEnvelope): RoutePlan {
    const destinations: ResolvedDestination[] = [];

    // 1. Find active agents that accept this event
    const agents = this.registry.findByInboundEvent(event.organizationId, event.eventType);
    for (const agent of agents) {
      destinations.push({
        type: "agent",
        id: agent.agentId,
        criticality: "required",
        sequencing: "parallel",
      });
    }

    // 2. Find native connectors subscribed to this event
    const connectors = (this.config.connectors ?? []).filter(
      (c) => c.enabled && c.subscribedEvents.includes(event.eventType),
    );
    for (const connector of connectors) {
      destinations.push({
        type: "connector",
        id: connector.id,
        criticality: connector.criticality,
        sequencing: "parallel",
      });
    }

    // 3. Find webhooks subscribed to this event
    const webhooks = (this.config.webhooks ?? []).filter(
      (w) => w.enabled && w.subscribedEvents.includes(event.eventType),
    );
    for (const webhook of webhooks) {
      destinations.push({
        type: "webhook",
        id: webhook.id,
        criticality: webhook.criticality,
        sequencing: "parallel",
      });
    }

    // 4. If no destinations found, route to manual queue
    if (destinations.length === 0) {
      destinations.push({
        type: "manual_queue",
        id: "unrouted",
        criticality: "required",
        sequencing: "parallel",
      });
    }

    return { event, destinations };
  }
}
