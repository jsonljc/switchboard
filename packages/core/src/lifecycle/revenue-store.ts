import type { LifecycleRevenueEvent } from "@switchboard/schemas";

export interface RecordRevenueInput {
  organizationId: string;
  contactId: string;
  opportunityId: string;
  amount: number;
  currency?: string;
  type: "payment" | "deposit" | "invoice" | "refund";
  status?: "pending" | "confirmed" | "refunded" | "failed";
  recordedBy: "owner" | "staff" | "stripe" | "integration";
  externalReference?: string | null;
  verified?: boolean;
  sourceCampaignId?: string | null;
  sourceAdId?: string | null;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface RevenueSummary {
  totalAmount: number;
  count: number;
}

export interface CampaignRevenueSummary {
  sourceCampaignId: string;
  totalAmount: number;
  count: number;
}

export interface RevenueStore {
  record(input: RecordRevenueInput): Promise<LifecycleRevenueEvent>;
  findByOpportunity(orgId: string, opportunityId: string): Promise<LifecycleRevenueEvent[]>;
  sumByOrg(orgId: string, dateRange?: DateRange): Promise<RevenueSummary>;
  sumByCampaign(orgId: string, dateRange?: DateRange): Promise<CampaignRevenueSummary[]>;
}
