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
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

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
    const sorted = rows.sort((a, b) => {
      const priorityDiff = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return sorted.map(mapRowToOwnerTask);
  }

  async updateStatus(
    orgId: string,
    id: string,
    status: TaskStatus,
    completedAt?: Date,
  ): Promise<OwnerTask> {
    const existing = await this.prisma.ownerTask.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) {
      throw new Error(`Task not found or does not belong to organization: ${id}`);
    }

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

  async listOpen(
    orgId: string,
    limit = 10,
  ): Promise<
    Array<{
      id: string;
      title: string;
      dueAt: Date | null;
      isOverdue: boolean;
      status: string;
      priority: string;
    }> & { openCount: number; overdueCount: number }
  > {
    const now = new Date();
    const pendingWhere = { organizationId: orgId, status: "pending" as const };

    const [rows, totalOpen, totalOverdue] = await Promise.all([
      this.prisma.ownerTask.findMany({
        where: pendingWhere,
        orderBy: { createdAt: "asc" },
        take: limit,
      }),
      this.prisma.ownerTask.count({ where: pendingWhere }),
      this.prisma.ownerTask.count({
        where: { ...pendingWhere, dueAt: { lt: now } },
      }),
    ]);

    rows.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] ?? 0;
      const pb = PRIORITY_RANK[b.priority] ?? 0;
      if (pb !== pa) return pb - pa;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const mapped = rows.map((r) => ({
      id: r.id,
      title: r.title,
      dueAt: r.dueAt,
      isOverdue: r.dueAt !== null && r.dueAt < now,
      status: r.status,
      priority: r.priority,
    }));

    const result = mapped as typeof mapped & { openCount: number; overdueCount: number };
    result.openCount = totalOpen;
    result.overdueCount = totalOverdue;
    return result;
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
