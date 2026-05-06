// packages/core/src/reports/interfaces.ts
import type { ReportDataV1 } from "@switchboard/schemas";
import type { PeriodRange, RollupContext } from "./types.js";

// ---------------------------------------------------------------------------
// Store interfaces (implemented now: in-memory + Prisma)
// ---------------------------------------------------------------------------

export interface ReportCacheRow {
  organizationId: string;
  window: string;
  payload: ReportDataV1;
  computedAt: Date;
  expiresAt: Date;
}

export interface ReportCacheStore {
  /** Returns the row if present (regardless of freshness). */
  findByKey(orgId: string, window: string): Promise<ReportCacheRow | null>;
  /** Upsert the row; replaces any existing row for (orgId, window). */
  upsert(row: ReportCacheRow): Promise<void>;
  /** Removes the row for (orgId, window) if present. Idempotent. */
  invalidate(orgId: string, window: string): Promise<void>;
}

export interface PdfCacheRow {
  organizationId: string;
  window: string;
  pdfBytes: Uint8Array;
  computedAt: Date;
  expiresAt: Date;
}

export interface PdfCacheStore {
  findByKey(orgId: string, window: string): Promise<PdfCacheRow | null>;
  upsert(row: PdfCacheRow): Promise<void>;
  invalidate(orgId: string, window: string): Promise<void>;
}

export type BaselineDimension = "ads" | "conversations";

export interface BaselineRow {
  organizationId: string;
  dimension: BaselineDimension;
  metric: string;
  value: number;
  periodStart: Date;
  periodEnd: Date;
  capturedAt: Date;
}

export interface BaselineStore {
  /** All baseline rows for the org+dimension; empty array if none captured yet. */
  listByDimension(orgId: string, dimension: BaselineDimension): Promise<BaselineRow[]>;
  /** Idempotent: replaces any existing row matching (orgId, dimension, metric, periodStart, periodEnd). */
  insertMany(rows: ReadonlyArray<BaselineRow>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Thin read-only store contracts for report rollups.
// Implemented by Prisma stores in packages/db; wired at the API route layer.
// ---------------------------------------------------------------------------

export interface ReportStores {
  revenue: {
    sumByOrg(
      orgId: string,
      dateRange: { from: Date; to: Date },
    ): Promise<{ totalAmount: number; count: number }>;

    revenueWithFirstTouch(input: { orgId: string; from: Date; to: Date }): Promise<
      Array<{
        amount: number;
        firstTouchSourceAdId: string | null;
        firstTouchSourceCampaignId: string | null;
        firstTouchSourceChannel: string | null;
      }>
    >;

    revenueByCampaign(input: {
      orgId: string;
      from: Date;
      to: Date;
    }): Promise<Array<{ sourceCampaignId: string; totalAmount: number }>>;
  };

  bookings: {
    countExcludingStatuses(input: {
      orgId: string;
      excludeStatuses: readonly string[];
      from: Date;
      to: Date;
    }): Promise<number>;
  };

  opportunities: {
    countClosedWon(input: { orgId: string; from: Date; to: Date }): Promise<number>;
  };

  conversions: {
    countByType(orgId: string, type: string, from: Date, to: Date): Promise<number>;

    leadsBySource(input: { orgId: string; from: Date; to: Date }): Promise<
      Array<{
        sourceAdId: string | null;
        sourceCampaignId: string | null;
        sourceChannel: string | null;
      }>
    >;
  };

  recommendations: {
    latestByAgent(input: {
      orgId: string;
      agentKey: string;
      from: Date;
      to: Date;
    }): Promise<{ date: Date; humanSummary: string } | null>;
  };

  orgConfig: {
    getStripePriceId(orgId: string): Promise<string | null>;
  };

  conversations: {
    threadCountsByAgent(input: {
      orgId: string;
      from: Date;
      to: Date;
    }): Promise<Array<{ assignedAgent: string; count: number }>>;
  };

  deployment: {
    getAlexSlug(orgId: string): Promise<string | null>;
  };

  connection: {
    findMetaConnection(orgId: string): Promise<{
      externalAccountId: string;
      credentials: string;
    } | null>;
  };
}

// ---------------------------------------------------------------------------
// Rollup function signatures (locked; implementations land in PR-R3..R5)
// ---------------------------------------------------------------------------

/** Per-agent attribution split for the period (first-touch rule). Implemented in PR-R3. */
export type AttributionRule = (ctx: RollupContext) => Promise<ReportDataV1["attribution"]>;

/** 6-stage funnel rows + narrative. Implemented in PR-R3. */
export type FunnelRollup = (ctx: RollupContext) => Promise<{
  funnel: ReportDataV1["funnel"];
  funnelNarrative: ReportDataV1["funnelNarrative"];
}>;

/** Per-campaign rows. Implemented in PR-R4. */
export type CampaignRollup = (ctx: RollupContext) => Promise<ReportDataV1["campaigns"]>;

/** Managed-vs-unmanaged comparison block (or null if unavailable). Implemented in PR-R4. */
export type ManagedComparisonRollup = (
  ctx: RollupContext,
) => Promise<ReportDataV1["managedComparison"]>;

/** Paid (Stripe) + alt (constants) + saving + narrative. Implemented in PR-R3. */
export type CostVsValueRule = (ctx: RollupContext) => Promise<{
  cost: ReportDataV1["cost"];
  costNarrative: ReportDataV1["costNarrative"];
}>;

/** Agent-voice pull-quote string slots from upstream rollup data. Implemented in PR-R5. */
export type PullQuoteGenerator = (input: {
  ctx: RollupContext;
  attribution: ReportDataV1["attribution"];
  cost: ReportDataV1["cost"];
  funnelNarrative: ReportDataV1["funnelNarrative"];
}) => Promise<ReportDataV1["pullquote"]>;

/** Top-level orchestrator that calls all section rollups and emits a complete ReportDataV1. Implemented in PR-R3. */
export type PeriodRollup = (input: {
  orgId: string;
  current: PeriodRange;
  prior: PeriodRange;
  computedAt: Date;
}) => Promise<ReportDataV1>;
