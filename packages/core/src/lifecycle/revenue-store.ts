import type { LifecycleRevenueEvent } from "@switchboard/schemas";

/**
 * Opaque transaction context threaded from the app-layer `runInTransaction` runner
 * into store calls. Core never inspects or constructs this value — it only forwards
 * whatever the runner supplies. The concrete type is `PrismaDbClient` in packages/db.
 */
export type StoreTransactionContext = unknown;

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
  /** Welds a verified payment to its booking row (spec 1A chain). */
  bookingId?: string | null;
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
  record(input: RecordRevenueInput, tx?: StoreTransactionContext): Promise<LifecycleRevenueEvent>;
  findByOpportunity(orgId: string, opportunityId: string): Promise<LifecycleRevenueEvent[]>;
  findByContact(orgId: string, contactId: string): Promise<LifecycleRevenueEvent[]>;
  sumByOrg(orgId: string, dateRange?: DateRange): Promise<RevenueSummary>;
  sumByCampaign(orgId: string, dateRange?: DateRange): Promise<CampaignRevenueSummary[]>;
}
