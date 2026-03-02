import type { EventReaction } from "./types.js";
import type { EventReactionStore } from "./reaction-store.js";

export class InMemoryEventReactionStore implements EventReactionStore {
  private store = new Map<string, EventReaction>();

  async save(reaction: EventReaction): Promise<void> {
    this.store.set(reaction.id, { ...reaction });
  }

  async getById(id: string): Promise<EventReaction | null> {
    const r = this.store.get(id);
    return r ? { ...r } : null;
  }

  async listByOrganization(organizationId: string): Promise<EventReaction[]> {
    return [...this.store.values()].filter(
      (r) => r.organizationId === organizationId,
    );
  }

  async listByEventPattern(
    eventType: string,
    organizationId: string,
  ): Promise<EventReaction[]> {
    return [...this.store.values()]
      .filter(
        (r) =>
          r.organizationId === organizationId &&
          r.enabled &&
          matchEventPattern(r.eventTypePattern, eventType),
      )
      .sort((a, b) => b.priority - a.priority);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }
}

function matchEventPattern(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern === eventType) return true;
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
  );
  return regex.test(eventType);
}
