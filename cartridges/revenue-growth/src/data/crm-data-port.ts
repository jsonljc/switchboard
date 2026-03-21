// ---------------------------------------------------------------------------
// CRM Data Port — Abstraction layer for CRM data integration
// ---------------------------------------------------------------------------
// Provides a typed interface for fetching CRM data (leads, deals, stage
// conversions) that can be backed by any CRM provider. Includes a
// NullCrmAdapter (returns empty data) and a MockCrmAdapter for testing.
// ---------------------------------------------------------------------------

import type { CrmSummary } from "@switchboard/schemas";
import type { CartridgeConnector } from "./normalizer.js";

// ---------------------------------------------------------------------------
// CRM Data Port interface
// ---------------------------------------------------------------------------

export interface CrmLead {
  id: string;
  sourceAdId: string | null;
  createdAt: string;
  status: "new" | "contacted" | "qualified" | "disqualified";
}

export interface CrmDeal {
  id: string;
  leadId: string;
  value: number;
  stage: string;
  createdAt: string;
  closedAt: string | null;
  firstContactAt: string | null;
}

export interface CrmStageConversion {
  fromStage: string;
  toStage: string;
  conversionRate: number;
}

export interface CrmDataPort {
  fetchLeads(accountId: string): Promise<CrmLead[]>;
  fetchDeals(accountId: string): Promise<CrmDeal[]>;
  fetchStageConversions(accountId: string): Promise<CrmStageConversion[]>;
}

// ---------------------------------------------------------------------------
// NullCrmAdapter — Returns empty data (production default when no CRM)
// ---------------------------------------------------------------------------

export class NullCrmAdapter implements CrmDataPort {
  async fetchLeads(_accountId: string): Promise<CrmLead[]> {
    return [];
  }

  async fetchDeals(_accountId: string): Promise<CrmDeal[]> {
    return [];
  }

  async fetchStageConversions(_accountId: string): Promise<CrmStageConversion[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// MockCrmAdapter — Configurable test data
// ---------------------------------------------------------------------------

export class MockCrmAdapter implements CrmDataPort {
  constructor(
    private readonly data: {
      leads?: CrmLead[];
      deals?: CrmDeal[];
      stageConversions?: CrmStageConversion[];
    } = {},
  ) {}

  async fetchLeads(_accountId: string): Promise<CrmLead[]> {
    return this.data.leads ?? [];
  }

  async fetchDeals(_accountId: string): Promise<CrmDeal[]> {
    return this.data.deals ?? [];
  }

  async fetchStageConversions(_accountId: string): Promise<CrmStageConversion[]> {
    return this.data.stageConversions ?? [];
  }
}

// ---------------------------------------------------------------------------
// CrmConnector — Wraps a CrmDataPort into a CartridgeConnector
// ---------------------------------------------------------------------------

export class CrmConnector implements Pick<CartridgeConnector, "id" | "name" | "fetchCrmSummary"> {
  readonly id = "crm";
  readonly name = "CRM Connector";

  constructor(private readonly port: CrmDataPort) {}

  async fetchCrmSummary(accountId: string): Promise<CrmSummary | null> {
    const [leads, deals, conversions] = await Promise.all([
      this.port.fetchLeads(accountId),
      this.port.fetchDeals(accountId),
      this.port.fetchStageConversions(accountId),
    ]);

    if (leads.length === 0 && deals.length === 0) return null;

    const matchedLeads = leads.filter((l) => l.sourceAdId !== null).length;
    const closedDeals = deals.filter((d) => d.closedAt !== null);
    const openDeals = deals.filter((d) => d.closedAt === null);

    const avgDealValue =
      closedDeals.length > 0
        ? closedDeals.reduce((sum, d) => sum + d.value, 0) / closedDeals.length
        : null;

    const dealsWithContact = deals.filter((d) => d.firstContactAt !== null);
    const avgTimeToFirstContact =
      dealsWithContact.length > 0
        ? dealsWithContact.reduce((sum, d) => {
            const created = new Date(d.createdAt).getTime();
            const contacted = new Date(d.firstContactAt!).getTime();
            return sum + (contacted - created) / (1000 * 60 * 60); // hours
          }, 0) / dealsWithContact.length
        : null;

    const leadToCloseRate =
      leads.length > 0 && closedDeals.length > 0 ? closedDeals.length / leads.length : null;

    const stageConversionRates: Record<string, number> = {};
    for (const conv of conversions) {
      stageConversionRates[`${conv.fromStage}→${conv.toStage}`] = conv.conversionRate;
    }

    const avgDaysToClose =
      closedDeals.length > 0
        ? closedDeals.reduce((sum, d) => {
            const created = new Date(d.createdAt).getTime();
            const closed = new Date(d.closedAt!).getTime();
            return sum + (closed - created) / (1000 * 60 * 60 * 24); // days
          }, 0) / closedDeals.length
        : null;

    const adAttributedLeads = leads.filter((l) => l.sourceAdId !== null).length;

    const followUpWithin24h = dealsWithContact.filter((d) => {
      const created = new Date(d.createdAt).getTime();
      const contacted = new Date(d.firstContactAt!).getTime();
      return contacted - created <= 24 * 60 * 60 * 1000;
    });

    const followUpWithin24hRate = deals.length > 0 ? followUpWithin24h.length / deals.length : null;

    return {
      totalLeads: leads.length,
      matchedLeads,
      matchRate: leads.length > 0 ? matchedLeads / leads.length : 0,
      openDeals: openDeals.length,
      averageDealValue: avgDealValue,
      averageTimeToFirstContact: avgTimeToFirstContact,
      leadToCloseRate,
      stageConversionRates:
        Object.keys(stageConversionRates).length > 0 ? stageConversionRates : null,
      averageDaysToClose: avgDaysToClose,
      adAttributedLeads,
      followUpWithin24hRate,
    };
  }
}
