import type { FastifyPluginAsync } from "fastify";
import { requireOrganizationScope } from "../utils/require-org.js";
import { getOrgScopedMetaAdsContext } from "../utils/meta-campaign-provider.js";

export interface CampaignAttributionRow {
  campaignId: string;
  name: string;
  spend: number | null;
  leads: number;
  bookings: number;
  paid: number;
  revenue: number;
  costPerLead: number | null;
  costPerBooking: number | null;
  roas: number | null;
}

interface ContactAttribution {
  id: string;
  sourceCampaignId: string | null;
  sourceAdId: string | null;
}

interface DealAttribution {
  id: string;
  contactId: string | null;
  stage: string;
  amount: number | null;
}

interface RevenueAttribution {
  contactId: string;
  amount: number;
}

interface CampaignMeta {
  name: string;
  spend: number | null;
}

const BOOKING_STAGES = new Set([
  "consultation_booked",
  "booked",
  "appointment_scheduled",
  "won",
  "paid",
]);
const PAID_STAGES = new Set(["won", "paid"]);

export function aggregateCampaignAttribution(
  contacts: ContactAttribution[],
  deals: DealAttribution[],
  revenueEvents: RevenueAttribution[],
  campaignSpend: Map<string, CampaignMeta>,
): CampaignAttributionRow[] {
  const dealsByContact = new Map<string, DealAttribution[]>();
  for (const deal of deals) {
    if (deal.contactId) {
      const existing = dealsByContact.get(deal.contactId) ?? [];
      existing.push(deal);
      dealsByContact.set(deal.contactId, existing);
    }
  }

  const revenueByContact = new Map<string, number>();
  for (const rev of revenueEvents) {
    revenueByContact.set(rev.contactId, (revenueByContact.get(rev.contactId) ?? 0) + rev.amount);
  }

  const byCampaign = new Map<
    string,
    { leads: number; bookings: number; paid: number; revenue: number }
  >();

  for (const contact of contacts) {
    if (!contact.sourceCampaignId) continue;
    const campId = contact.sourceCampaignId;

    if (!byCampaign.has(campId)) {
      byCampaign.set(campId, { leads: 0, bookings: 0, paid: 0, revenue: 0 });
    }
    const bucket = byCampaign.get(campId)!;
    bucket.leads += 1;

    const contactDeals = dealsByContact.get(contact.id) ?? [];
    if (contactDeals.some((d) => BOOKING_STAGES.has(d.stage))) {
      bucket.bookings += 1;
    }
    if (contactDeals.some((d) => PAID_STAGES.has(d.stage))) {
      bucket.paid += 1;
    }

    const rev = revenueByContact.get(contact.id);
    if (rev) {
      bucket.revenue += rev;
    }
  }

  const rows: CampaignAttributionRow[] = [];
  for (const [campaignId, counts] of byCampaign) {
    const meta = campaignSpend.get(campaignId);
    const spend = meta?.spend ?? null;
    rows.push({
      campaignId,
      name: meta?.name ?? campaignId,
      spend,
      leads: counts.leads,
      bookings: counts.bookings,
      paid: counts.paid,
      revenue: counts.revenue,
      costPerLead: spend != null && counts.leads > 0 ? spend / counts.leads : null,
      costPerBooking: spend != null && counts.bookings > 0 ? spend / counts.bookings : null,
      roas: spend != null && spend > 0 ? counts.revenue / spend : null,
    });
  }

  return rows.sort((a, b) => b.leads - a.leads);
}

export const campaignAttributionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/campaign-attribution", async (request, reply) => {
    const prisma = app.prisma;
    if (!prisma) return reply.code(503).send({ error: "Database unavailable" });

    const orgId = requireOrganizationScope(request, reply);
    if (!orgId) return;

    const contacts = await prisma.crmContact.findMany({
      where: { organizationId: orgId, sourceCampaignId: { not: null } },
      select: { id: true, sourceCampaignId: true, sourceAdId: true },
    });

    const contactIds = contacts.map((c: { id: string }) => c.id);

    const deals =
      contactIds.length > 0
        ? await prisma.crmDeal.findMany({
            where: { organizationId: orgId, contactId: { in: contactIds } },
            select: { id: true, contactId: true, stage: true, amount: true },
          })
        : [];

    const revenueEvents =
      contactIds.length > 0
        ? await prisma.revenueEvent.findMany({
            where: { organizationId: orgId, contactId: { in: contactIds } },
            select: { contactId: true, amount: true },
          })
        : [];

    const campaignSpend = new Map<string, CampaignMeta>();
    // Campaign names/spend aren't available via a list API — we populate names
    // from individual getCampaign lookups for each unique sourceCampaignId.
    // Spend per campaign is not available (only account-level via getAccountInsights),
    // so we leave it null and let the dashboard show "—" for spend/ROAS.
    const uniqueCampaignIds = new Set(
      contacts.map((c: { sourceCampaignId: string | null }) => c.sourceCampaignId).filter(Boolean),
    );
    try {
      const { provider } = await getOrgScopedMetaAdsContext(prisma, orgId);
      await Promise.all(
        [...uniqueCampaignIds].map(async (campId) => {
          try {
            const camp = await provider.getCampaign(campId as string);
            campaignSpend.set(campId as string, {
              name: camp.name,
              spend: null, // Per-campaign spend not available from getCampaign
            });
          } catch {
            // Individual campaign lookup failed — use ID as name
          }
        }),
      );
    } catch {
      // No ad platform connected — campaign names will fall back to IDs
    }

    const campaigns = aggregateCampaignAttribution(contacts, deals, revenueEvents, campaignSpend);

    return reply.send({ campaigns });
  });
};
