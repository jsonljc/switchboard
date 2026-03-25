import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";
import type { OwnerTask, TaskStatus } from "@switchboard/schemas";

// ---------------------------------------------------------------------------
// Store Interface (structural match with @switchboard/core)
// ---------------------------------------------------------------------------

interface CreateOwnerTaskInput {
  organizationId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  type: "fallback_handoff" | "approval_required" | "manual_action" | "review_needed";
  title: string;
  description: string;
  suggestedAction?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  triggerReason: string;
  sourceAgent?: string | null;
  fallbackReason?: "not_configured" | "paused" | "errored" | null;
  dueAt?: Date | null;
}

interface OwnerTaskStore {
  create(input: CreateOwnerTaskInput): Promise<OwnerTask>;
  findPending(orgId: string): Promise<OwnerTask[]>;
  updateStatus(
    orgId: string,
    id: string,
    status: TaskStatus,
    completedAt?: Date,
  ): Promise<OwnerTask>;
  autoComplete(orgId: string, opportunityId: string, reason: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Prisma Store Implementation
// ---------------------------------------------------------------------------

export class PrismaOwnerTaskStore implements OwnerTaskStore {
  constructor(private prisma: PrismaDbClient) {}

  async create(input: CreateOwnerTaskInput): Promise<OwnerTask> {
    const id = randomUUID();
    const now = new Date();

    const created = await this.prisma.ownerTask.create({
      data: {
        id,
        organizationId: input.organizationId,
        contactId: input.contactId ?? null,
        opportunityId: input.opportunityId ?? null,
        type: input.type,
        title: input.title,
        description: input.description,
        suggestedAction: input.suggestedAction ?? null,
        status: "pending",
        priority: input.priority,
        triggerReason: input.triggerReason,
        sourceAgent: input.sourceAgent ?? null,
        fallbackReason: input.fallbackReason ?? null,
        dueAt: input.dueAt ?? null,
        createdAt: now,
      },
    });

    return mapRowToOwnerTask(created);
  }

  async findPending(orgId: string): Promise<OwnerTask[]> {
    const rows = await this.prisma.ownerTask.findMany({
      where: {
        organizationId: orgId,
        status: "pending",
      },
      orderBy: [
        // Map priority to numeric for ordering: urgent=4, high=3, medium=2, low=1
        { priority: "desc" },
        { createdAt: "asc" },
      ],
    });

    // Sort by priority properly (Prisma sorts alphabetically, we need custom order)
    const priorityOrder: Record<string, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    const sorted = rows.sort((a, b) => {
      const priorityDiff = (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return sorted.map(mapRowToOwnerTask);
  }

  async updateStatus(
    _orgId: string,
    id: string,
    status: TaskStatus,
    completedAt?: Date,
  ): Promise<OwnerTask> {
    const updated = await this.prisma.ownerTask.update({
      where: { id },
      data: {
        status,
        completedAt: completedAt ?? undefined,
      },
    });

    return mapRowToOwnerTask(updated);
  }

  async autoComplete(orgId: string, opportunityId: string, _reason: string): Promise<number> {
    const result = await this.prisma.ownerTask.updateMany({
      where: {
        organizationId: orgId,
        opportunityId,
        status: "pending",
      },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });

    return result.count;
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRowToOwnerTask(row: {
  id: string;
  organizationId: string;
  contactId: string | null;
  opportunityId: string | null;
  type: string;
  title: string;
  description: string;
  suggestedAction: string | null;
  status: string;
  priority: string;
  triggerReason: string;
  sourceAgent: string | null;
  fallbackReason: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}): OwnerTask {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    type: row.type as "fallback_handoff" | "approval_required" | "manual_action" | "review_needed",
    title: row.title,
    description: row.description,
    suggestedAction: row.suggestedAction,
    status: row.status as TaskStatus,
    priority: row.priority as "low" | "medium" | "high" | "urgent",
    triggerReason: row.triggerReason,
    sourceAgent: row.sourceAgent,
    fallbackReason: row.fallbackReason as
      | "not_configured"
      | "paused"
      | "errored"
      | null
      | undefined,
    dueAt: row.dueAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}
