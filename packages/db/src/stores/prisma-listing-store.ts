import type { PrismaDbClient } from "../prisma-db.js";
import type { AgentListing, AgentListingStatus, AgentType } from "@switchboard/schemas";

interface CreateListingInput {
  name: string;
  slug: string;
  description: string;
  type: AgentType;
  taskCategories: string[];
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ListingFilters {
  status?: AgentListingStatus;
  type?: AgentType;
  limit?: number;
  offset?: number;
}

export class PrismaListingStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateListingInput): Promise<AgentListing> {
    return this.prisma.agentListing.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        type: input.type,
        taskCategories: input.taskCategories,
        webhookUrl: input.webhookUrl ?? null,
        webhookSecret: input.webhookSecret ?? null,
        sourceUrl: input.sourceUrl ?? null,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    }) as unknown as AgentListing;
  }

  async findById(id: string): Promise<AgentListing | null> {
    return this.prisma.agentListing.findUnique({ where: { id } }) as unknown as AgentListing | null;
  }

  async findBySlug(slug: string): Promise<AgentListing | null> {
    return this.prisma.agentListing.findUnique({
      where: { slug },
    }) as unknown as AgentListing | null;
  }

  async list(filters?: ListingFilters): Promise<AgentListing[]> {
    return this.prisma.agentListing.findMany({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.type ? { type: filters.type } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as AgentListing[];
  }

  async update(
    id: string,
    data: Partial<Omit<AgentListing, "id" | "createdAt">>,
  ): Promise<AgentListing> {
    return this.prisma.agentListing.update({
      where: { id },
      data: data as never,
    }) as unknown as AgentListing;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.agentListing.delete({ where: { id } });
  }
}
