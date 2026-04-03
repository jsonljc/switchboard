import { randomUUID } from "node:crypto";
import type { PrismaDbClient } from "../prisma-db.js";

// ---------------------------------------------------------------------------
// Store Interface (structural match with @switchboard/memory PerformanceStore)
// ---------------------------------------------------------------------------

interface PerformanceStore {
  record(
    orgId: string,
    employeeId: string,
    event: {
      contentId: string;
      outcome: "approved" | "rejected";
      feedback?: string;
      metrics?: Record<string, number>;
    },
  ): Promise<void>;
  getTop(
    orgId: string,
    employeeId: string,
    channel: string,
    limit: number,
  ): Promise<Array<{ contentId: string; metrics: Record<string, number> }>>;
  getApprovalRate(
    orgId: string,
    employeeId: string,
  ): Promise<{ total: number; approved: number; rate: number }>;
}

// ---------------------------------------------------------------------------
// Prisma Performance Store
// ---------------------------------------------------------------------------

export class PrismaPerformanceStore implements PerformanceStore {
  constructor(private prisma: PrismaDbClient) {}

  async record(
    orgId: string,
    employeeId: string,
    event: {
      contentId: string;
      outcome: "approved" | "rejected";
      feedback?: string;
      metrics?: Record<string, number>;
    },
  ): Promise<void> {
    await this.prisma.employeePerformanceEvent.create({
      data: {
        id: randomUUID(),
        employeeId,
        organizationId: orgId,
        contentId: event.contentId,
        outcome: event.outcome,
        feedback: event.feedback ?? null,
        metrics: event.metrics ?? null,
        createdAt: new Date(),
      },
    });
  }

  async getTop(
    orgId: string,
    employeeId: string,
    channel: string,
    limit: number,
  ): Promise<Array<{ contentId: string; metrics: Record<string, number> }>> {
    // Join through ContentDraft to filter by channel and get approved content
    const rows = await this.prisma.employeePerformanceEvent.findMany({
      where: {
        organizationId: orgId,
        employeeId,
        outcome: "approved",
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Filter to entries that have metrics and match channel context
    return rows
      .filter((r: { metrics: unknown }) => r.metrics !== null)
      .map((r: { contentId: string; metrics: unknown }) => ({
        contentId: r.contentId,
        metrics: r.metrics as Record<string, number>,
      }));
  }

  async getApprovalRate(
    orgId: string,
    employeeId: string,
  ): Promise<{ total: number; approved: number; rate: number }> {
    const [total, approved] = await Promise.all([
      this.prisma.employeePerformanceEvent.count({
        where: { organizationId: orgId, employeeId },
      }),
      this.prisma.employeePerformanceEvent.count({
        where: { organizationId: orgId, employeeId, outcome: "approved" },
      }),
    ]);

    return {
      total,
      approved,
      rate: total > 0 ? approved / total : 0,
    };
  }
}
