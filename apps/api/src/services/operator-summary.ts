import type { PrismaClient } from "@switchboard/db";
import type Redis from "ioredis";
import { getOrgScopedMetaAdsContext } from "../utils/meta-campaign-provider.js";

const SUMMARY_CACHE_TTL_SECONDS = 300;
const BOOKING_STAGES = ["consultation_booked", "booked", "appointment_scheduled", "closed_won"];
const QUALIFIED_STAGES = ["qualified", ...BOOKING_STAGES];

export interface OperatorSummary {
  organizationId: string;
  spend: {
    source: "meta";
    currency: "USD";
    connectionStatus: "connected" | "missing" | "error";
    today: number | null;
    last7Days: number | null;
    last30Days: number | null;
    trend: Array<{
      date: string;
      spend: number | null;
      leads: number;
      bookings: number;
    }>;
    freshness: {
      fetchedAt: string | null;
      cacheTtlSeconds: number;
    };
  };
  outcomes: {
    leads30d: number;
    qualifiedLeads30d: number;
    bookings30d: number;
    revenue30d: number | null;
    costPerLead30d: number | null;
    costPerQualifiedLead30d: number | null;
    costPerBooking30d: number | null;
  };
  operator: {
    actionsToday: number;
    deniedToday: number;
  };
  speedToLead: {
    averageMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    percentWithin60s: number | null;
    sampleSize: number;
  };
}

interface OperatorSummaryDeps {
  prisma: PrismaClient;
  redis?: Redis | null;
  organizationId: string;
}

export async function buildOperatorSummary(deps: OperatorSummaryDeps): Promise<OperatorSummary> {
  const cacheKey = `operator-summary:${deps.organizationId}`;
  const cached = deps.redis ? await deps.redis.get(cacheKey) : null;
  if (cached) {
    return JSON.parse(cached) as OperatorSummary;
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const start7Days = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const start30Days = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));

  const [outcomes, operator, spend, speedToLead] = await Promise.all([
    buildOutcomeSummary(deps.prisma, deps.organizationId, start30Days),
    buildOperatorActivitySummary(deps.prisma, deps.organizationId, todayStart),
    buildSpendSummary(deps.prisma, deps.organizationId, now, todayStart, start7Days, start30Days),
    buildSpeedToLead(deps.prisma, deps.organizationId, start30Days),
  ]);

  const summary: OperatorSummary = {
    organizationId: deps.organizationId,
    spend,
    outcomes: {
      ...outcomes,
      costPerLead30d:
        spend.last30Days !== null && outcomes.leads30d > 0
          ? roundCurrency(spend.last30Days / outcomes.leads30d)
          : null,
      costPerQualifiedLead30d:
        spend.last30Days !== null && outcomes.qualifiedLeads30d > 0
          ? roundCurrency(spend.last30Days / outcomes.qualifiedLeads30d)
          : null,
      costPerBooking30d:
        spend.last30Days !== null && outcomes.bookings30d > 0
          ? roundCurrency(spend.last30Days / outcomes.bookings30d)
          : null,
    },
    operator,
    speedToLead,
  };

  if (deps.redis) {
    await deps.redis.set(cacheKey, JSON.stringify(summary), "EX", SUMMARY_CACHE_TTL_SECONDS);
  }

  return summary;
}

async function buildOutcomeSummary(
  prisma: PrismaClient,
  organizationId: string,
  start30Days: Date,
): Promise<{
  leads30d: number;
  qualifiedLeads30d: number;
  bookings30d: number;
  revenue30d: number | null;
}> {
  const orgFilter = { organizationId };
  const dateFilter = { createdAt: { gte: start30Days } };

  const [leads30d, qualifiedDeals, bookingDeals, revenue] = await Promise.all([
    prisma.crmContact.count({
      where: { ...orgFilter, ...dateFilter },
    }),
    prisma.crmDeal.findMany({
      where: {
        ...orgFilter,
        ...dateFilter,
        stage: { in: QUALIFIED_STAGES },
        contactId: { not: null },
      },
      distinct: ["contactId"],
      select: { contactId: true },
    }),
    prisma.crmDeal.findMany({
      where: {
        ...orgFilter,
        ...dateFilter,
        stage: { in: BOOKING_STAGES },
        contactId: { not: null },
      },
      distinct: ["contactId"],
      select: { contactId: true },
    }),
    prisma.crmDeal.aggregate({
      where: {
        ...orgFilter,
        ...dateFilter,
        stage: "closed_won",
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    leads30d,
    qualifiedLeads30d: qualifiedDeals.length,
    bookings30d: bookingDeals.length,
    revenue30d: revenue._sum.amount ?? null,
  };
}

async function buildOperatorActivitySummary(
  prisma: PrismaClient,
  organizationId: string,
  todayStart: Date,
): Promise<{
  actionsToday: number;
  deniedToday: number;
}> {
  const [actionsToday, deniedToday] = await Promise.all([
    prisma.auditEntry.count({
      where: {
        organizationId,
        eventType: "action.executed",
        timestamp: { gte: todayStart },
      },
    }),
    prisma.auditEntry.count({
      where: {
        organizationId,
        eventType: "action.denied",
        timestamp: { gte: todayStart },
      },
    }),
  ]);

  return { actionsToday, deniedToday };
}

async function buildSpendSummary(
  prisma: PrismaClient,
  organizationId: string,
  now: Date,
  todayStart: Date,
  start7Days: Date,
  start30Days: Date,
): Promise<OperatorSummary["spend"]> {
  const leadTrendPromise = prisma.crmContact.findMany({
    where: {
      organizationId,
      createdAt: { gte: start7Days, lte: now },
    },
    select: { createdAt: true },
  });
  const bookingTrendPromise = prisma.crmDeal.findMany({
    where: {
      organizationId,
      stage: { in: BOOKING_STAGES },
      createdAt: { gte: start7Days, lte: now },
    },
    select: { createdAt: true, contactId: true },
    distinct: ["contactId", "createdAt"],
  });

  const trendDates = enumerateDateKeys(start7Days, now);
  const leadCountsByDayPromise = leadTrendPromise.then((rows) =>
    countByDay(rows.map((row) => row.createdAt)),
  );
  const bookingCountsByDayPromise = bookingTrendPromise.then((rows) =>
    countByDay(rows.map((row) => row.createdAt)),
  );

  try {
    const { provider, adAccountId } = await getOrgScopedMetaAdsContext(prisma, organizationId);
    const [today, last7Days, last30Days, leadCountsByDay, bookingCountsByDay, trendSpend] =
      await Promise.all([
        fetchSpend(provider, adAccountId, todayStart, now),
        fetchSpend(provider, adAccountId, start7Days, now),
        fetchSpend(provider, adAccountId, start30Days, now),
        leadCountsByDayPromise,
        bookingCountsByDayPromise,
        Promise.all(
          trendDates.map(async (date) => ({
            date,
            spend: await fetchSpend(
              provider,
              adAccountId,
              new Date(`${date}T00:00:00.000Z`),
              new Date(`${date}T23:59:59.999Z`),
            ),
          })),
        ),
      ]);

    return {
      source: "meta",
      currency: "USD",
      connectionStatus: "connected",
      today,
      last7Days,
      last30Days,
      trend: trendDates.map((date) => ({
        date,
        spend: trendSpend.find((entry) => entry.date === date)?.spend ?? 0,
        leads: leadCountsByDay.get(date) ?? 0,
        bookings: bookingCountsByDay.get(date) ?? 0,
      })),
      freshness: {
        fetchedAt: now.toISOString(),
        cacheTtlSeconds: SUMMARY_CACHE_TTL_SECONDS,
      },
    };
  } catch (err) {
    const [leadCountsByDay, bookingCountsByDay] = await Promise.all([
      leadCountsByDayPromise,
      bookingCountsByDayPromise,
    ]);

    return {
      source: "meta",
      currency: "USD",
      connectionStatus: isMissingMetaConnectionError(err) ? "missing" : "error",
      today: null,
      last7Days: null,
      last30Days: null,
      trend: trendDates.map((date) => ({
        date,
        spend: null,
        leads: leadCountsByDay.get(date) ?? 0,
        bookings: bookingCountsByDay.get(date) ?? 0,
      })),
      freshness: {
        fetchedAt: null,
        cacheTtlSeconds: SUMMARY_CACHE_TTL_SECONDS,
      },
    };
  }
}

async function fetchSpend(
  provider: Awaited<ReturnType<typeof getOrgScopedMetaAdsContext>>["provider"],
  adAccountId: string,
  since: Date,
  until: Date,
): Promise<number> {
  const rows = await provider.getAccountInsights(adAccountId, {
    dateRange: {
      since: since.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    },
    fields: ["spend"],
  });

  return roundCurrency(rows.reduce((sum, row) => sum + Number(row["spend"] ?? 0), 0));
}

async function buildSpeedToLead(
  prisma: PrismaClient,
  organizationId: string,
  start30Days: Date,
): Promise<OperatorSummary["speedToLead"]> {
  const conversations = await prisma.conversationState.findMany({
    where: {
      organizationId,
      firstReplyAt: { not: null },
      lastActivityAt: { gte: start30Days },
    },
    select: { firstReplyAt: true, messages: true },
  });

  const responseTimes: number[] = [];
  for (const conv of conversations) {
    let messages: Array<{ role: string; timestamp: string }> = [];
    try {
      messages =
        typeof conv.messages === "string"
          ? (JSON.parse(conv.messages) as Array<{ role: string; timestamp: string }>)
          : ((conv.messages as Array<{ role: string; timestamp: string }>) ?? []);
    } catch {
      continue;
    }
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (firstUserMsg && conv.firstReplyAt) {
      const userMsgTime = new Date(firstUserMsg.timestamp).getTime();
      const replyTime = new Date(conv.firstReplyAt).getTime();
      const diff = replyTime - userMsgTime;
      if (diff >= 0) {
        responseTimes.push(diff);
      }
    }
  }

  if (responseTimes.length === 0) {
    return { averageMs: null, p50Ms: null, p95Ms: null, percentWithin60s: null, sampleSize: 0 };
  }

  responseTimes.sort((a, b) => a - b);
  const avg = responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;
  const p50 = responseTimes[Math.floor(responseTimes.length * 0.5)]!;
  const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)]!;
  const within60s = responseTimes.filter((t) => t <= 60_000).length;
  const percentWithin60s = Math.round((within60s / responseTimes.length) * 100);

  return {
    averageMs: Math.round(avg),
    p50Ms: p50,
    p95Ms: p95,
    percentWithin60s,
    sampleSize: responseTimes.length,
  };
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function enumerateDateKeys(start: Date, end: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function countByDay(dates: Date[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isMissingMetaConnectionError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("Meta Ads connection not found");
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
