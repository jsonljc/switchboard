// ---------------------------------------------------------------------------
// Conversation Router — pre-processing transform for message.received events
// ---------------------------------------------------------------------------

import type { ThreadStage } from "@switchboard/schemas";
import type { ConversationThreadStore } from "@switchboard/core";
import { createDefaultThread } from "@switchboard/core";
import type { RoutedEventEnvelope } from "./events.js";
import { agentForStage, agentForThreadStage } from "./lifecycle.js";
import type { LifecycleStage } from "./lifecycle.js";

export interface StageResolver {
  getStage(contactId: string): Promise<LifecycleStage | undefined>;
}

export interface ConversationRouterConfig {
  getStage: (contactId: string) => Promise<LifecycleStage | undefined>;
  threadStore?: ConversationThreadStore;
}

export class ConversationRouter {
  private getStage: (contactId: string) => Promise<LifecycleStage | undefined>;
  private threadStore: ConversationThreadStore | undefined;

  constructor(config: ConversationRouterConfig) {
    this.getStage = config.getStage;
    this.threadStore = config.threadStore;
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

    // If thread store available, use thread-based routing
    if (this.threadStore) {
      return this.transformWithThread(event, contactId);
    }

    // Fallback: lifecycle-based routing (no thread store)
    const stage = await this.getStage(contactId);
    const targetAgent = agentForStage(stage as LifecycleStage | undefined);

    if (targetAgent) {
      return {
        ...event,
        metadata: { ...event.metadata, targetAgentId: targetAgent },
      };
    }

    return {
      ...event,
      metadata: { ...event.metadata, escalateToOwner: true },
    };
  }

  private async transformWithThread(
    event: RoutedEventEnvelope,
    contactId: string,
  ): Promise<RoutedEventEnvelope> {
    const orgId = event.organizationId;

    let thread = await this.threadStore!.getByContact(contactId, orgId);

    if (!thread) {
      thread = createDefaultThread(contactId, orgId);
      await this.threadStore!.create(thread);
    }

    const targetAgent = agentForThreadStage(thread.stage as ThreadStage);

    if (targetAgent) {
      return {
        ...event,
        metadata: {
          ...event.metadata,
          targetAgentId: targetAgent,
          conversationThread: thread,
        },
      };
    }

    // No agent for this stage — escalate to owner
    return {
      ...event,
      metadata: {
        ...event.metadata,
        escalateToOwner: true,
        conversationThread: thread,
      },
    };
  }
}
