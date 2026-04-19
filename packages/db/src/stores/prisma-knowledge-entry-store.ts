import type { PrismaClient } from "@prisma/client";
import type { KnowledgeKind as PrismaKnowledgeKind } from "@prisma/client";
import type { KnowledgeKind } from "@switchboard/schemas";

interface KnowledgeEntryCreateInput {
  organizationId: string;
  kind: KnowledgeKind;
  scope: string;
  title: string;
  content: string;
  priority: number;
}

interface KnowledgeEntryUpdateInput {
  title?: string;
  content?: string;
  priority?: number;
}

interface KnowledgeEntryFilter {
  kind?: KnowledgeKind;
  scope?: string;
  active?: boolean;
}

export class PrismaKnowledgeEntryStore {
  constructor(private prisma: PrismaClient) {}

  async findActive(orgId: string, filters: Array<{ kind: KnowledgeKind; scope: string }>) {
    if (filters.length === 0) return [];

    const orConditions = filters.map((f) => ({
      kind: f.kind as PrismaKnowledgeKind,
      scope: f.scope,
    }));

    return this.prisma.knowledgeEntry.findMany({
      where: {
        organizationId: orgId,
        active: true,
        OR: orConditions,
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    });
  }

  async create(input: KnowledgeEntryCreateInput) {
    return this.prisma.knowledgeEntry.create({
      data: {
        organizationId: input.organizationId,
        kind: input.kind as PrismaKnowledgeKind,
        scope: input.scope,
        title: input.title,
        content: input.content,
        priority: input.priority,
        version: 1,
        active: true,
      },
    });
  }

  async update(id: string, orgId: string, data: KnowledgeEntryUpdateInput) {
    const existing = await this.prisma.knowledgeEntry.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!existing) {
      throw new Error(`KnowledgeEntry ${id} not found for org ${orgId}`);
    }

    const [, newEntry] = await this.prisma.$transaction([
      this.prisma.knowledgeEntry.update({
        where: { id },
        data: { active: false },
      }),
      this.prisma.knowledgeEntry.create({
        data: {
          organizationId: existing.organizationId,
          kind: existing.kind,
          scope: existing.scope,
          title: data.title ?? existing.title,
          content: data.content ?? existing.content,
          priority: data.priority ?? existing.priority,
          version: existing.version + 1,
          active: true,
        },
      }),
    ]);

    return newEntry;
  }

  async deactivate(id: string, orgId: string) {
    const result = await this.prisma.knowledgeEntry.updateMany({
      where: { id, organizationId: orgId },
      data: { active: false },
    });

    if (result.count === 0) {
      throw new Error(`KnowledgeEntry ${id} not found for org ${orgId}`);
    }
  }

  async getById(id: string, orgId: string) {
    return this.prisma.knowledgeEntry.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  async list(orgId: string, filters?: KnowledgeEntryFilter) {
    return this.prisma.knowledgeEntry.findMany({
      where: {
        organizationId: orgId,
        ...(filters?.kind ? { kind: filters.kind as PrismaKnowledgeKind } : {}),
        ...(filters?.scope ? { scope: filters.scope } : {}),
        ...(filters?.active !== undefined ? { active: filters.active } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
