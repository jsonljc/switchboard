import type { EventReaction } from "./types.js";

export interface EventReactionStore {
  save(reaction: EventReaction): Promise<void>;
  getById(id: string): Promise<EventReaction | null>;
  listByOrganization(organizationId: string): Promise<EventReaction[]>;
  listByEventPattern(eventType: string, organizationId: string): Promise<EventReaction[]>;
  delete(id: string): Promise<boolean>;
}
