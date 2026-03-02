import type { PrismaClient } from "@prisma/client";
import type { EventReaction } from "@switchboard/schemas";
import type { EventReactionStore } from "@switchboard/core";

export class PrismaEventReactionStore implements EventReactionStore {
  constructor(private prisma: PrismaClient) {}

  async save(reaction: EventReaction): Promise<void> {
    await this.prisma.eventReaction.upsert({
      where: { id: reaction.id },
      create: {
        id: reaction.id,
        name: reaction.name,
        eventTypePattern: reaction.eventTypePattern,
        organizationId: reaction.organizationId,
        targetAction: reaction.targetAction as object,
        condition: reaction.condition as object ?? undefined,
        enabled: reaction.enabled,
        priority: reaction.priority,
        actorId: reaction.actorId,
        createdAt: reaction.createdAt,
        updatedAt: reaction.updatedAt,
      },
      update: {
        name: reaction.name,
        eventTypePattern: reaction.eventTypePattern,
        targetAction: reaction.targetAction as object,
        condition: reaction.condition as object ?? undefined,
        enabled: reaction.enabled,
        priority: reaction.priority,
        updatedAt: reaction.updatedAt,
      },
    });
  }

  async getById(id: string): Promise<EventReaction | null> {
    const row = await this.prisma.eventReaction.findUnique({ where: { id } });
    if (!row) return null;
    return toEventReaction(row);
  }

  async listByOrganization(organizationId: string): Promise<EventReaction[]> {
    const rows = await this.prisma.eventReaction.findMany({
      where: { organizationId },
      orderBy: { priority: "desc" },
    });
    return rows.map(toEventReaction);
  }

  async listByEventPattern(
    eventType: string,
    organizationId: string,
  ): Promise<EventReaction[]> {
    // Fetch all enabled reactions for the org, then filter by pattern match in-memory
    // (glob patterns like "payments.*" can't be expressed as SQL WHERE clauses)
    const rows = await this.prisma.eventReaction.findMany({
      where: { organizationId, enabled: true },
      orderBy: { priority: "desc" },
    });

    return rows
      .filter((row) => matchEventPattern(row.eventTypePattern, eventType))
      .map(toEventReaction);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.eventReaction.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
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

function toEventReaction(row: {
  id: string;
  name: string;
  eventTypePattern: string;
  organizationId: string;
  targetAction: unknown;
  condition: unknown;
  enabled: boolean;
  priority: number;
  actorId: string;
  createdAt: Date;
  updatedAt: Date;
}): EventReaction {
  return {
    id: row.id,
    name: row.name,
    eventTypePattern: row.eventTypePattern,
    organizationId: row.organizationId,
    targetAction: row.targetAction as EventReaction["targetAction"],
    condition: (row.condition as Record<string, unknown>) ?? null,
    enabled: row.enabled,
    priority: row.priority,
    actorId: row.actorId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
