import type { PrismaClient } from "@prisma/client";
import type { CrmDataProvider, CrmFunnelData, FunnelBenchmarks } from "@switchboard/schemas";

export const QUALIFIED_OR_LATER_STAGES = ["qualified", "booked", "won", "closed", "completed"];

const BEAUTY_AESTHETICS_DEFAULTS: FunnelBenchmarks = {
  leadToQualifiedRate: 0.3,
  qualifiedToBookingRate: 0.4,
  bookingToClosedRate: 0.5,
  leadToClosedRate: 0.06,
};

function safeRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export class PrismaCrmDataProvider implements CrmDataProvider {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async getBenchmarks(_input: {
    orgId: string;
    accountId: string;
    vertical?: string;
  }): Promise<FunnelBenchmarks> {
    return BEAUTY_AESTHETICS_DEFAULTS;
  }

  async getFunnelData(input: {
    orgId: string;
    accountId: string;
    campaignIds: string[];
    startDate: Date;
    endDate: Date;
  }): Promise<CrmFunnelData> {
    const contacts = await this.prisma.contact.findMany({
      where: {
        organizationId: input.orgId,
        createdAt: { gte: input.startDate, lte: input.endDate },
      },
      include: {
        opportunities: true,
        revenueEvents: true,
      },
    });

    const attributed = contacts.filter((c) => {
      const attr = c.attribution as Record<string, unknown> | null;
      const campaignId = attr?.["sourceCampaignId"] as string | undefined;
      return campaignId && input.campaignIds.includes(campaignId);
    });

    const leads = attributed.length;

    let qualifiedCount = 0;
    let opportunityCount = 0;
    const bookingCount = 0;
    let closedCount = 0;
    let totalRevenue = 0;
    let contactsWithEmailOrPhone = 0;
    let contactsWithOpportunity = 0;
    const contactsWithBooking = 0;
    let contactsWithRevenueEvent = 0;

    for (const contact of attributed) {
      if (contact.email || contact.phone) contactsWithEmailOrPhone++;

      const opps =
        (contact as unknown as { opportunities: { stage: string }[] }).opportunities ?? [];
      if (opps.length > 0) contactsWithOpportunity++;
      opportunityCount += opps.length;

      for (const opp of opps) {
        if (QUALIFIED_OR_LATER_STAGES.includes(opp.stage)) {
          qualifiedCount++;
        }
      }

      const revEvents =
        (contact as unknown as { revenueEvents: { status: string; amount: number }[] })
          .revenueEvents ?? [];
      const confirmedRevenue = revEvents.filter((r) => r.status === "confirmed");
      if (confirmedRevenue.length > 0) {
        contactsWithRevenueEvent++;
        closedCount++;
      }
      for (const rev of confirmedRevenue) {
        totalRevenue += rev.amount;
      }
    }

    return {
      campaignIds: input.campaignIds,
      leads,
      qualified: qualifiedCount,
      opportunities: opportunityCount,
      bookings: bookingCount,
      closed: closedCount,
      revenue: totalRevenue,
      rates: {
        leadToQualified: safeRate(qualifiedCount, leads),
        qualifiedToBooking: safeRate(bookingCount, qualifiedCount),
        bookingToClosed: safeRate(closedCount, bookingCount),
        leadToClosed: safeRate(closedCount, leads),
      },
      coverage: {
        attributedContacts: leads,
        contactsWithEmailOrPhone,
        contactsWithOpportunity,
        contactsWithBooking,
        contactsWithRevenueEvent,
      },
    };
  }
}
