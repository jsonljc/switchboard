import { randomUUID } from "node:crypto";
import type { DomainEvent } from "./types.js";
import type { EventBus, EventSubscription } from "./types.js";

interface SubscriptionEntry {
  id: string;
  pattern: string;
  handler: (event: DomainEvent) => Promise<void>;
}

export class InMemoryEventBus implements EventBus {
  private subscriptions: SubscriptionEntry[] = [];

  async publish(event: DomainEvent): Promise<void> {
    const matching = this.subscriptions.filter((sub) =>
      matchEventPattern(sub.pattern, event.eventType),
    );

    for (const sub of matching) {
      await sub.handler(event);
    }
  }

  subscribe(
    pattern: string,
    handler: (event: DomainEvent) => Promise<void>,
  ): () => void {
    const id = `sub_${randomUUID()}`;
    const entry: SubscriptionEntry = { id, pattern, handler };
    this.subscriptions.push(entry);

    // Return unsubscribe function
    return () => {
      this.subscriptions = this.subscriptions.filter((s) => s.id !== id);
    };
  }

  listSubscriptions(): EventSubscription[] {
    return this.subscriptions.map((s) => ({ id: s.id, pattern: s.pattern }));
  }
}

/**
 * Match event type against a pattern.
 * Supports exact match and glob patterns with "*".
 * E.g., "payments.*" matches "payments.invoice.created"
 */
function matchEventPattern(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern === eventType) return true;

  // Convert glob pattern to regex
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
  );
  return regex.test(eventType);
}
