// ---------------------------------------------------------------------------
// Dashboard aggregate endpoint — assembles all owner-today data in parallel
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import type { DashboardOverview } from "@switchboard/schemas";
import type { AuditQueryFilter } from "@switchboard/core";
import { requireOrganizationScope } from "../utils/require-org.js";
import { translateActivities } from "../services/activity-translator.js";
import type { RawAuditEntry } from "../services/activity-translator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greetingPeriod(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

// ---------------------------------------------------------------------------
// Structural store interface — keeps builder testable without Fastify or Prisma
// ---------------------------------------------------------------------------

interface BookingRow {
  id: string;
  startsAt: Date;
  service: string;
  status: string;
  sourceChannel: string | null;
  contact: { name: string | null };
}

interface TaskRow {
  id: string;
  title: string;
  dueAt: Date | null;
  isOverdue: boolean;
  status: string;
}

type TaskListResult = TaskRow[] & { openCount: number; overdueCount: number };

interface FunnelCounts {
  inquiry: number;
  qualified: number;
  booked: number;
  purchased: number;
  completed: number;
}

interface RevenueSummary {
  totalAmount: number;
  count: number;
}

interface CampaignRevenueSummary {
  sourceCampaignId: string;
  totalAmount: number;
  count: number;
}

interface ApprovalRecord {
  request: {
    id: string;
    summary: string;
    riskCategory: string;
    bindingHash: string;
    createdAt: Date | string;
  };
  envelopeId: string;
  state: { status: string };
}

export interface DashboardStores {
  listBookingsByDate: (orgId: string, date: Date, limit: number) => Promise<BookingRow[]>;
  listOpenTasks: (orgId: string, limit: number) => Promise<TaskListResult>;
  activePipelineCounts: (orgId: string) => Promise<FunnelCounts>;
  sumRevenue: (orgId: string, range: { from: Date; to: Date }) => Promise<RevenueSummary>;
  sumRevenueByCampaign: (
    orgId: string,
    range: { from: Date; to: Date },
  ) => Promise<CampaignRevenueSummary[]>;
  countByType: (orgId: string, type: string, from: Date, to: Date) => Promise<number>;
  queryApprovals: (orgId: string) => Promise<ApprovalRecord[]>;
  queryAudit: (filter: AuditQueryFilter) => Promise<RawAuditEntry[]>;
  queryOperatorName: (orgId: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Pure builder — testable without Fastify
// ---------------------------------------------------------------------------

export async function buildDashboardOverview(
  orgId: string,
  stores: DashboardStores,
): Promise<DashboardOverview> {
  const now = new Date();

  // Date boundaries
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const revenueRange = { from: sevenDaysAgo, to: now };

  // Run all queries in parallel
  const [
    operatorName,
    pendingApprovals,
    bookingsRaw,
    tasksRaw,
    funnel,
    revenueSummary,
    revenueByCampaign,
    inquiriesToday,
    inquiriesYesterday,
    auditEntries,
  ] = await Promise.all([
    stores.queryOperatorName(orgId),
    stores.queryApprovals(orgId),
    stores.listBookingsByDate(orgId, now, 10),
    stores.listOpenTasks(orgId, 10),
    stores.activePipelineCounts(orgId),
    stores.sumRevenue(orgId, revenueRange),
    stores.sumRevenueByCampaign(orgId, revenueRange),
    stores.countByType(orgId, "inquiry", todayStart, now),
    stores.countByType(orgId, "inquiry", yesterdayStart, todayStart),
    stores.queryAudit({ organizationId: orgId, limit: 8 }),
  ]);

  // Map pending approvals (top 3)
  const approvals = pendingApprovals
    .filter((a) => a.state.status === "pending")
    .slice(0, 3)
    .map((a) => ({
      id: a.request.id,
      summary: a.request.summary,
      riskContext: null,
      createdAt:
        a.request.createdAt instanceof Date
          ? a.request.createdAt.toISOString()
          : String(a.request.createdAt),
      envelopeId: a.envelopeId,
      bindingHash: a.request.bindingHash,
      riskCategory: a.request.riskCategory,
    }));

  // Map bookings
  const bookings = bookingsRaw.map((b) => ({
    id: b.id,
    startsAt: b.startsAt instanceof Date ? b.startsAt.toISOString() : String(b.startsAt),
    service: b.service,
    contactName: b.contact.name ?? "Unknown",
    status: (b.status === "confirmed" ? "confirmed" : "pending") as "confirmed" | "pending",
    channel: b.sourceChannel ?? null,
  }));

  // Map tasks
  const tasks = tasksRaw.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt instanceof Date ? t.dueAt.toISOString() : t.dueAt ? String(t.dueAt) : null,
    isOverdue: t.isOverdue,
    status: t.status,
  }));

  // Top revenue source
  const topCampaign =
    revenueByCampaign.length > 0
      ? revenueByCampaign.sort((a, b) => b.totalAmount - a.totalAmount)[0]
      : null;

  // Translate activity
  const activity = translateActivities(auditEntries, 8);

  return {
    generatedAt: now.toISOString(),
    greeting: {
      period: greetingPeriod(now.getHours()),
      operatorName,
    },
    stats: {
      pendingApprovals: pendingApprovals.filter((a) => a.state.status === "pending").length,
      newInquiriesToday: inquiriesToday,
      newInquiriesYesterday: inquiriesYesterday,
      qualifiedLeads: funnel.qualified,
      bookingsToday: bookings.length,
      revenue7d: { total: revenueSummary.totalAmount, count: revenueSummary.count },
      openTasks: tasksRaw.openCount,
      overdueTasks: tasksRaw.overdueCount,
    },
    approvals,
    bookings,
    funnel,
    revenue: {
      total: revenueSummary.totalAmount,
      count: revenueSummary.count,
      topSource: topCampaign
        ? { name: topCampaign.sourceCampaignId, amount: topCampaign.totalAmount }
        : null,
      periodDays: 7,
    },
    tasks,
    activity,
  };
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export const dashboardOverviewRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:orgId/dashboard/overview", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const prisma = app.prisma;

    // Dynamic import to avoid pulling broken Prisma types at compile time.
    // The db package store files reference relations not yet in the generated client;
    // lazy import keeps this route's own types clean.
    const {
      PrismaBookingStore,
      PrismaOwnerTaskStore,
      PrismaConversionRecordStore,
      PrismaRevenueStore,
    } = await import("@switchboard/db");

    const bookingStore = new PrismaBookingStore(prisma);
    const ownerTaskStore = new PrismaOwnerTaskStore(prisma);
    const conversionStore = new PrismaConversionRecordStore(prisma);
    const revenueStore = new PrismaRevenueStore(prisma);

    const stores: DashboardStores = {
      listBookingsByDate: (id, date, limit) => bookingStore.listByDate(id, date, limit),
      listOpenTasks: (id, limit) => ownerTaskStore.listOpen(id, limit),
      activePipelineCounts: (id) => conversionStore.activePipelineCounts(id),
      sumRevenue: (id, range) => revenueStore.sumByOrg(id, range),
      sumRevenueByCampaign: (id, range) => revenueStore.sumByCampaign(id, range),
      countByType: (id, type, from, to) => conversionStore.countByType(id, type, from, to),

      queryApprovals: async (id) => {
        if (!app.storageContext?.approvals) return [];
        const results = await app.storageContext.approvals.listPending(id);
        return results as unknown as ApprovalRecord[];
      },

      queryAudit: async (filter) => {
        if (!app.auditLedger) return [];
        const entries = await app.auditLedger.query(filter);
        return entries as unknown as RawAuditEntry[];
      },

      queryOperatorName: async (id) => {
        const operator = await prisma.agentRoster.findFirst({
          where: { organizationId: id, agentRole: "primary_operator" },
          select: { displayName: true },
        });
        return operator?.displayName ?? "there";
      },
    };

    try {
      const overview = await buildDashboardOverview(orgId, stores);
      return reply.send(overview);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Dashboard query failed";
      return reply.code(500).send({ error: message });
    }
  });
};
