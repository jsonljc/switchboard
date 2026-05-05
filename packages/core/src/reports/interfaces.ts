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
  findByKey(orgId: string, window: string): Promise<ReportCacheRow | null>;
  upsert(row: ReportCacheRow): Promise<void>;
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
  listByDimension(orgId: string, dimension: BaselineDimension): Promise<BaselineRow[]>;
  insertMany(rows: ReadonlyArray<BaselineRow>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Rollup function signatures (locked; implementations land in PR-R3..R5)
// ---------------------------------------------------------------------------

export type AttributionRule = (ctx: RollupContext) => Promise<ReportDataV1["attribution"]>;

export type FunnelRollup = (ctx: RollupContext) => Promise<{
  funnel: ReportDataV1["funnel"];
  funnelNarrative: ReportDataV1["funnelNarrative"];
}>;

export type CampaignRollup = (ctx: RollupContext) => Promise<ReportDataV1["campaigns"]>;

export type ManagedComparisonRollup = (
  ctx: RollupContext,
) => Promise<ReportDataV1["managedComparison"]>;

export type CostVsValueRule = (ctx: RollupContext) => Promise<{
  cost: ReportDataV1["cost"];
  costNarrative: ReportDataV1["costNarrative"];
}>;

export type PullQuoteGenerator = (input: {
  ctx: RollupContext;
  attribution: ReportDataV1["attribution"];
  cost: ReportDataV1["cost"];
  funnelNarrative: ReportDataV1["funnelNarrative"];
}) => Promise<ReportDataV1["pullquote"]>;

export type PeriodRollup = (input: {
  orgId: string;
  current: PeriodRange;
  prior: PeriodRange;
  computedAt: Date;
}) => Promise<ReportDataV1>;
