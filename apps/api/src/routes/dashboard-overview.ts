// ---------------------------------------------------------------------------
// Dashboard aggregate endpoint — assembles all owner-today data in parallel
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from "fastify";
import type { DashboardOverview } from "@switchboard/schemas";
import { dayWindow, previousDayWindow, STALE_AFTER_MINUTES } from "@switchboard/schemas";
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

/**
 * Logs a one-line warning when a Tier-B rollup is older than the freshness contract.
 * No-op when updatedAt is null (no successful sync yet). Pure side-effect — never throws.
 */
function checkStaleness(label: string, updatedAt: string | null, now: Date): void {
  if (updatedAt === null) return;
  const ageMin = (now.getTime() - new Date(updatedAt).getTime()) / 60_000;
  if (ageMin > STALE_AFTER_MINUTES) {
    console.warn(
      `[dashboard-overview] ${label} is stale (${Math.round(ageMin)} min old; threshold ${STALE_AFTER_MINUTES} min)`,
    );
  }
}

/**
 * Below this sample size, the median is too noisy to surface as a headline metric
 * (one fast reply would read as "12s avg"). Treat the cell as muted instead.
 */
const MIN_REPLY_SAMPLE = 3;

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
  stageProgressByApproval: (
    approvalIds: string[],
  ) => Promise<
    Map<
      string,
      { stageIndex: number; stageTotal: number; stageLabel: string; closesAt: string | null }
    >
  >;
  queryAudit: (filter: AuditQueryFilter) => Promise<RawAuditEntry[]>;
  queryOperatorName: (orgId: string) => Promise<string>;
  replyTimeStats: (
    orgId: string,
    day: Date,
  ) => Promise<{ medianSeconds: number; sampleSize: number }>;
  alexStatsToday: (
    orgId: string,
    day: Date,
  ) => Promise<{ repliedToday: number; qualifiedToday: number; bookedToday: number }>;
}

// ---------------------------------------------------------------------------
// Pure builder — testable without Fastify
// ---------------------------------------------------------------------------

export async function buildDashboardOverview(
  orgId: string,
  stores: DashboardStores,
  orgCurrency = "USD",
): Promise<DashboardOverview> {
  const now = new Date();
  const today = dayWindow(now);
  const yesterday = previousDayWindow(now);

  const todayStart = today.from;
  const yesterdayStart = yesterday.from;

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
    revenueTodayRaw,
    replyTimeToday,
    replyTimeYesterday,
    alexToday,
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
    stores.sumRevenue(orgId, { from: todayStart, to: now }),
    stores.replyTimeStats(orgId, todayStart),
    stores.replyTimeStats(orgId, yesterdayStart),
    stores.alexStatsToday(orgId, todayStart),
  ]);

  // Map pending approvals (top 3).
  const approvals = pendingApprovals
    .filter((a) => a.state.status === "pending")
    .slice(0, 3)
    .map((a) => ({
      id: a.request.id,
      summary: a.request.summary,
      riskContext: null as string | null,
      createdAt:
        a.request.createdAt instanceof Date
          ? a.request.createdAt.toISOString()
          : String(a.request.createdAt),
      envelopeId: a.envelopeId,
      bindingHash: a.request.bindingHash,
      riskCategory: a.request.riskCategory,
    }));

  const approvalIds = approvals.map((a) => a.id);
  const stageMap = await stores.stageProgressByApproval(approvalIds);
  const approvalsWithStage = approvals.map((a) => {
    const sp = stageMap.get(a.id);
    return sp ? { ...a, stageProgress: sp } : a;
  });

  // Map bookings
  const bookings = bookingsRaw.map((b) => ({
    id: b.id,
    startsAt: b.startsAt instanceof Date ? b.startsAt.toISOString() : String(b.startsAt),
    service: b.service,
    contactName: b.contact.name ?? "Unknown",
    status: (b.status === "confirmed" ? "confirmed" : "pending") as "confirmed" | "pending",
    channel: b.sourceChannel ?? null,
  }));

  // Top revenue source
  const topCampaign =
    revenueByCampaign.length > 0
      ? revenueByCampaign.sort((a, b) => b.totalAmount - a.totalAmount)[0]
      : null;

  // Translate activity. agent field set by translator (resolveAgentKey).
  const activity = translateActivities(auditEntries, 8);

  // Compute today.revenue delta vs 7-day daily average
  const sevenDayAvg = revenueSummary.totalAmount / 7;
  const deltaPctVsAvg =
    sevenDayAvg > 0 ? (revenueTodayRaw.totalAmount - sevenDayAvg) / sevenDayAvg : null;

  // Tier B fields ship as placeholders in C1; the staleness check is a no-op until C2
  // gives spendUpdatedAt a real value, but the call site stays here so C2 doesn't have to thread it in.
  const spendUpdatedAt: string | null = null;
  checkStaleness("today.spend", spendUpdatedAt, now);

  // today.appointments — derive from today's bookings
  const todayBookings = bookings.filter(
    (b) => new Date(b.startsAt).toDateString() === now.toDateString(),
  );
  const nextAppt = todayBookings.length > 0 ? todayBookings[0] : null;

  return {
    generatedAt: now.toISOString(),
    greeting: { period: greetingPeriod(now.getHours()), operatorName },
    stats: {
      pendingApprovals: pendingApprovals.filter((a) => a.state.status === "pending").length,
      qualifiedLeads: funnel.qualified,
      revenue7d: { total: revenueSummary.totalAmount, count: revenueSummary.count },
      openTasks: tasksRaw.openCount,
      overdueTasks: tasksRaw.overdueCount,
    },

    today: {
      revenue: { amount: revenueTodayRaw.totalAmount, currency: orgCurrency, deltaPctVsAvg },
      // today.spend stays as a Tier-B placeholder. updatedAt=null mutes the cell.
      spend: { amount: 0, currency: orgCurrency, capPct: 0, updatedAt: spendUpdatedAt },
      replyTime:
        replyTimeToday.sampleSize < MIN_REPLY_SAMPLE
          ? null
          : {
              medianSeconds: replyTimeToday.medianSeconds,
              previousSeconds:
                replyTimeYesterday.sampleSize < MIN_REPLY_SAMPLE
                  ? null
                  : replyTimeYesterday.medianSeconds,
              sampleSize: replyTimeToday.sampleSize,
            },
      leads: { count: inquiriesToday, yesterdayCount: inquiriesYesterday },
      appointments: {
        count: todayBookings.length,
        next: nextAppt
          ? {
              startsAt: nextAppt.startsAt,
              contactName: nextAppt.contactName,
              service: nextAppt.service,
            }
          : null,
      },
    },

    agentsToday: {
      alex: alexToday,
      // Tier B — stay null until C2.
      nova: null,
      mira: null,
    },

    // Tier B — stays empty until C2.
    novaAdSets: [],

    approvals: approvalsWithStage,
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
    tasks: tasksRaw.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt instanceof Date ? t.dueAt.toISOString() : t.dueAt ? String(t.dueAt) : null,
      isOverdue: t.isOverdue,
      status: t.status,
    })),
    activity,
  };
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export const dashboardOverviewRoutes: FastifyPluginAsync = async (app) => {
  app.get("/:orgId/dashboard/overview", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available", statusCode: 503 });
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
      PrismaConversationStateStore,
      PrismaCreativeJobStore,
    } = await import("@switchboard/db");

    const bookingStore = new PrismaBookingStore(prisma);
    const ownerTaskStore = new PrismaOwnerTaskStore(prisma);
    const conversionStore = new PrismaConversionRecordStore(prisma);
    const revenueStore = new PrismaRevenueStore(prisma);
    const conversationStateStore = new PrismaConversationStateStore(prisma, {} as never);
    const creativeJobStore = new PrismaCreativeJobStore(prisma);

    const stores: DashboardStores = {
      listBookingsByDate: (id, date, limit) => bookingStore.listByDate(id, date, limit),
      listOpenTasks: (id, limit) => ownerTaskStore.listOpen(id, limit),
      activePipelineCounts: (id) => conversionStore.activePipelineCounts(id),
      sumRevenue: (id, range) => revenueStore.sumByOrg(id, range),
      sumRevenueByCampaign: (id, range) => revenueStore.sumByCampaign(id, range),
      countByType: (id, type, from, to) => conversionStore.countByType(id, type, from, to),
      replyTimeStats: (id, day) => conversationStateStore.replyTimeStats(id, day),
      alexStatsToday: (id, day) => conversionStore.alexStatsToday(id, day),

      stageProgressByApproval: (ids) => creativeJobStore.stageProgressByApproval(ids),

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
      const orgCurrency = "USD";
      const overview = await buildDashboardOverview(orgId, stores, orgCurrency);
      return reply.send(overview);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Dashboard query failed";
      return reply.code(500).send({ error: message, statusCode: 500 });
    }
  });
};
