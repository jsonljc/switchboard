// ---------------------------------------------------------------------------
// Weekly Lead Bot Performance Digest — generates formatted digest for business owners
// ---------------------------------------------------------------------------

import type { PrismaClient } from "@switchboard/db";
import type Redis from "ioredis";
import { buildOperatorSummary, type OperatorSummary } from "./operator-summary.js";

export interface WeeklyDigest {
  organizationId: string;
  period: { from: Date; to: Date };
  metrics: {
    totalLeads: number;
    qualifiedLeads: number;
    bookings: number;
    qualificationRate: number;
    bookingRate: number;
    speedToLeadPercent: number | null;
    costPerBooking: number | null;
    spend: number | null;
  };
  weekOverWeek: {
    leadsChange: number | null;
    bookingsChange: number | null;
    costPerBookingChange: number | null;
  };
  formattedMessage: string;
}

interface DigestDeps {
  prisma: PrismaClient;
  redis?: Redis | null;
  organizationId: string;
}

export async function generateWeeklyDigest(deps: DigestDeps): Promise<WeeklyDigest> {
  const now = new Date();
  const periodEnd = now;
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const priorStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const summary = await buildOperatorSummary({
    prisma: deps.prisma,
    redis: deps.redis,
    organizationId: deps.organizationId,
  });

  const priorMetrics = await buildPeriodMetrics(
    deps.prisma,
    deps.organizationId,
    priorStart,
    periodStart,
  );

  const totalLeads = summary.outcomes.leads30d;
  const qualifiedLeads = summary.outcomes.qualifiedLeads30d;
  const bookings = summary.outcomes.bookings30d;
  const qualificationRate = totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;
  const bookingRate = totalLeads > 0 ? Math.round((bookings / totalLeads) * 100) : 0;
  const speedToLeadPercent = summary.speedToLead.percentWithin60s;
  const costPerBooking = summary.outcomes.costPerBooking30d;
  const spend = summary.spend.last30Days;

  const leadsChange =
    priorMetrics.leads > 0
      ? Math.round(((totalLeads - priorMetrics.leads) / priorMetrics.leads) * 100)
      : null;
  const bookingsChange =
    priorMetrics.bookings > 0
      ? Math.round(((bookings - priorMetrics.bookings) / priorMetrics.bookings) * 100)
      : null;
  const costPerBookingChange =
    costPerBooking !== null &&
    priorMetrics.costPerBooking !== null &&
    priorMetrics.costPerBooking > 0
      ? Math.round(
          ((costPerBooking - priorMetrics.costPerBooking) / priorMetrics.costPerBooking) * 100,
        )
      : null;

  const formattedMessage = formatDigestMessage({
    periodStart,
    periodEnd,
    totalLeads,
    qualifiedLeads,
    qualificationRate,
    bookings,
    bookingRate,
    speedToLeadPercent,
    costPerBooking,
    spend,
    leadsChange,
    bookingsChange,
    costPerBookingChange,
  });

  return {
    organizationId: deps.organizationId,
    period: { from: periodStart, to: periodEnd },
    metrics: {
      totalLeads,
      qualifiedLeads,
      bookings,
      qualificationRate,
      bookingRate,
      speedToLeadPercent,
      costPerBooking,
      spend,
    },
    weekOverWeek: {
      leadsChange,
      bookingsChange,
      costPerBookingChange,
    },
    formattedMessage,
  };
}

async function buildPeriodMetrics(
  prisma: PrismaClient,
  organizationId: string,
  from: Date,
  to: Date,
): Promise<{ leads: number; bookings: number; costPerBooking: number | null }> {
  const [leads, bookingDeals] = await Promise.all([
    prisma.crmContact.count({
      where: { organizationId, createdAt: { gte: from, lt: to } },
    }),
    prisma.crmDeal.findMany({
      where: {
        organizationId,
        createdAt: { gte: from, lt: to },
        stage: { in: ["consultation_booked", "booked", "appointment_scheduled", "closed_won"] },
        contactId: { not: null },
      },
      distinct: ["contactId"],
      select: { contactId: true },
    }),
  ]);

  return {
    leads,
    bookings: bookingDeals.length,
    costPerBooking: null, // Spend comparison requires Meta API calls; skip for prior period
  };
}

function formatDigestMessage(data: {
  periodStart: Date;
  periodEnd: Date;
  totalLeads: number;
  qualifiedLeads: number;
  qualificationRate: number;
  bookings: number;
  bookingRate: number;
  speedToLeadPercent: number | null;
  costPerBooking: number | null;
  spend: number | null;
  leadsChange: number | null;
  bookingsChange: number | null;
  costPerBookingChange: number | null;
}): string {
  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const fmtChange = (v: number | null) => {
    if (v === null) return "";
    const sign = v >= 0 ? "+" : "";
    return ` (${sign}${v}% vs last week)`;
  };

  const lines: string[] = [
    `Weekly Report (${fmtDate(data.periodStart)} – ${fmtDate(data.periodEnd)})`,
    "",
    `Leads: ${data.totalLeads}${fmtChange(data.leadsChange)}`,
    `Qualified: ${data.qualifiedLeads} (${data.qualificationRate}%)`,
    `Booked: ${data.bookings} (${data.bookingRate}%)${fmtChange(data.bookingsChange)}`,
  ];

  if (data.speedToLeadPercent !== null) {
    lines.push(`Speed to lead: ${data.speedToLeadPercent}% within 60s`);
  }

  if (data.costPerBooking !== null) {
    lines.push(
      `Cost per booking: $${data.costPerBooking.toFixed(2)}${fmtChange(data.costPerBookingChange)}`,
    );
  }

  if (data.spend !== null) {
    lines.push(`Total spend: $${data.spend.toFixed(2)}`);
  }

  return lines.join("\n");
}

/** Build digest from a pre-computed OperatorSummary (for testing). */
export function formatDigestFromSummary(
  summary: OperatorSummary,
  priorMetrics: { leads: number; bookings: number; costPerBooking: number | null },
  periodStart: Date,
  periodEnd: Date,
): WeeklyDigest {
  const totalLeads = summary.outcomes.leads30d;
  const qualifiedLeads = summary.outcomes.qualifiedLeads30d;
  const bookings = summary.outcomes.bookings30d;
  const qualificationRate = totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;
  const bookingRate = totalLeads > 0 ? Math.round((bookings / totalLeads) * 100) : 0;
  const costPerBooking = summary.outcomes.costPerBooking30d;
  const spend = summary.spend.last30Days;

  const leadsChange =
    priorMetrics.leads > 0
      ? Math.round(((totalLeads - priorMetrics.leads) / priorMetrics.leads) * 100)
      : null;
  const bookingsChange =
    priorMetrics.bookings > 0
      ? Math.round(((bookings - priorMetrics.bookings) / priorMetrics.bookings) * 100)
      : null;
  const costPerBookingChange =
    costPerBooking !== null &&
    priorMetrics.costPerBooking !== null &&
    priorMetrics.costPerBooking > 0
      ? Math.round(
          ((costPerBooking - priorMetrics.costPerBooking) / priorMetrics.costPerBooking) * 100,
        )
      : null;

  const formattedMessage = formatDigestMessage({
    periodStart,
    periodEnd,
    totalLeads,
    qualifiedLeads,
    qualificationRate,
    bookings,
    bookingRate,
    speedToLeadPercent: summary.speedToLead.percentWithin60s,
    costPerBooking,
    spend,
    leadsChange,
    bookingsChange,
    costPerBookingChange,
  });

  return {
    organizationId: summary.organizationId,
    period: { from: periodStart, to: periodEnd },
    metrics: {
      totalLeads,
      qualifiedLeads,
      bookings,
      qualificationRate,
      bookingRate,
      speedToLeadPercent: summary.speedToLead.percentWithin60s,
      costPerBooking,
      spend,
    },
    weekOverWeek: { leadsChange, bookingsChange, costPerBookingChange },
    formattedMessage,
  };
}
