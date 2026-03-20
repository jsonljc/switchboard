// ---------------------------------------------------------------------------
// Conversation Router — pre-processing transform for message.received events
// ---------------------------------------------------------------------------

import type { RoutedEventEnvelope } from "./events.js";
import { agentForStage } from "./lifecycle.js";
import type { LifecycleStage } from "./lifecycle.js";

export interface StageResolver {
  getStage(contactId: string): Promise<LifecycleStage | undefined>;
}

export interface ConversationRouterConfig {
  getStage: (contactId: string) => Promise<LifecycleStage | undefined>;
}

export class ConversationRouter {
  private getStage: (contactId: string) => Promise<LifecycleStage | undefined>;

  constructor(config: ConversationRouterConfig) {
    this.getStage = config.getStage;
  }

  async transform(event: RoutedEventEnvelope): Promise<RoutedEventEnvelope> {
    if (event.eventType !== "message.received") {
      return event;
    }

    const payload = event.payload as Record<string, unknown>;
    const contactId = payload.contactId as string | undefined;
    if (!contactId) {
      return event;
    }

    const stage = await this.getStage(contactId);
    const targetAgent = agentForStage(stage as LifecycleStage | undefined);

    if (targetAgent) {
      return {
        ...event,
        metadata: { ...event.metadata, targetAgentId: targetAgent },
      };
    }

    // No agent handles this stage — mark for owner escalation
    return {
      ...event,
      metadata: { ...event.metadata, escalateToOwner: true },
    };
  }
}
