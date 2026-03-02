import type { DomainEvent, EventReaction } from "@switchboard/schemas";

export type { DomainEvent, EventReaction };

export interface EventSubscription {
  id: string;
  pattern: string;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(pattern: string, handler: (event: DomainEvent) => Promise<void>): () => void;
  listSubscriptions(): EventSubscription[];
}
