import type {
  DiagnosticContext,
  EntityLevel,
  FunnelSchema,
  MetricSnapshot,
  TimeRange,
} from "../types.js";
import type { PlatformClient } from "../../platforms/types.js";
import { buildTrailingPeriods } from "./comparator.js";

// ---------------------------------------------------------------------------
// Diagnostic Context Builder
// ---------------------------------------------------------------------------
// Pre-fetches sub-entity breakdowns and historical snapshots needed by
// the structural health advisors and creative exhaustion detector.
//
// Uses the existing buildTrailingPeriods() utility to compute N trailing
// time ranges, then fetches snapshots for each in parallel.
// ---------------------------------------------------------------------------

export interface ContextBuilderOptions {
  client: PlatformClient;
  entityId: string;
  entityLevel: EntityLevel;
  funnel: FunnelSchema;
  referenceDate: Date;
  periodDays: number;
  /** Whether to fetch historical snapshots for trend analysis */
  enableHistorical?: boolean;
  /** Number of trailing periods to fetch (default: 4) */
  historicalPeriods?: number;
  /** Whether to fetch sub-entity breakdowns for structural analysis */
  enableStructural?: boolean;
  /** Current-period snapshot (to extract revenue data) */
  currentSnapshot?: MetricSnapshot;
  /** Previous-period snapshot (to extract previous revenue) */
  previousSnapshot?: MetricSnapshot;
}

/**
 * Build a DiagnosticContext by fetching historical snapshots and/or
 * sub-entity breakdowns as needed.
 *
 * This is designed to be called before analyzeFunnel() so the context
 * can be passed through to advisors.
 */
export async function buildDiagnosticContext(
  options: ContextBuilderOptions
): Promise<DiagnosticContext> {
  const {
    client,
    entityId,
    entityLevel,
    funnel,
    referenceDate,
    periodDays,
    enableHistorical = false,
    historicalPeriods = 4,
    enableStructural = false,
    currentSnapshot,
    previousSnapshot,
  } = options;

  const context: DiagnosticContext = {};

  // Fetch historical snapshots in parallel
  if (enableHistorical) {
    const trailingPeriods = buildTrailingPeriods(
      referenceDate,
      periodDays,
      historicalPeriods
    );

    const snapshotPromises = trailingPeriods.map((period: TimeRange) =>
      client.fetchSnapshot(entityId, entityLevel, period, funnel)
    );

    context.historicalSnapshots = await Promise.all(snapshotPromises);
  }

  // Fetch sub-entity breakdowns if the client supports it
  if (enableStructural && hasSubEntitySupport(client)) {
    const currentEnd = new Date(referenceDate);
    const currentStart = new Date(referenceDate);
    currentStart.setDate(currentStart.getDate() - periodDays + 1);

    const timeRange: TimeRange = {
      since: currentStart.toISOString().slice(0, 10),
      until: currentEnd.toISOString().slice(0, 10),
    };

    context.subEntities = await client.fetchSubEntityBreakdowns!(
      entityId,
      entityLevel,
      timeRange,
      funnel
    );
  }

  // Extract revenue data from current/previous snapshots
  if (currentSnapshot && previousSnapshot) {
    context.revenueData = extractRevenueData(currentSnapshot, previousSnapshot, funnel);
  }

  return context;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Type guard for clients that support sub-entity breakdowns.
 */
function hasSubEntitySupport(
  client: PlatformClient
): client is PlatformClient & {
  fetchSubEntityBreakdowns: NonNullable<PlatformClient["fetchSubEntityBreakdowns"]>;
} {
  return typeof (client as any).fetchSubEntityBreakdowns === "function";
}

/**
 * Extract revenue data from snapshots using the funnel's primary KPI.
 * Looks for conversion counts and revenue values (action_values, conversions_value, etc.)
 */
function extractRevenueData(
  current: MetricSnapshot,
  previous: MetricSnapshot,
  funnel: FunnelSchema
): DiagnosticContext["revenueData"] {
  // Look for revenue in topLevel fields
  const totalRevenue =
    current.topLevel.conversions_value ??
    current.topLevel.complete_payment_value ??
    current.topLevel.purchase_value ??
    0;

  const previousTotalRevenue =
    previous.topLevel.conversions_value ??
    previous.topLevel.complete_payment_value ??
    previous.topLevel.purchase_value ??
    0;

  // Get conversion count for AOV calculation
  const primaryKPIMetric = funnel.primaryKPI;
  const conversions = current.stages[primaryKPIMetric]?.count ?? 0;

  if (conversions === 0 || totalRevenue === 0) return undefined;

  return {
    averageOrderValue: totalRevenue / conversions,
    totalRevenue,
    previousTotalRevenue,
  };
}
