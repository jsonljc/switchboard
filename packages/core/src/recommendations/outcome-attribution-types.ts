import type { AttributableKind } from "./outcome-attribution-config.js";

/**
 * Visibility flags that govern whether an outcome row is renderable in the
 * cockpit. Any non-empty flags array ⇒ cockpitRenderable = false.
 */
export type VisibilityFlag =
  | "meta_data_missing"
  | "zero_pre_baseline"
  | "below_noise_floor"
  | "same_campaign_overlap"
  | "same_kind_retry";

/**
 * Aggregated metrics for a single attribution window. Implementations must
 * return null when the window has no data; sparse data (<50% of window days)
 * is the provider's call to count as "sparse" via the dailyRowCount field.
 */
export interface WindowMetrics {
  /** Sum of spend across the window, in account-currency cents. */
  spendCents: number;
  /** Click-through rate as decimal (0.05 = 5%). */
  ctr: number;
  /** Number of daily rows actually observed in the window (used for sparse detection). */
  dailyRowCount: number;
}

export interface InsightsWindowQuery {
  campaignId: string;
  startInclusive: Date;
  endExclusive: Date;
}

/**
 * Layer-3 interface satisfied by the ad-optimizer's meta-campaign-insights-provider
 * at the apps/api wiring layer. Pure logic in `core` MUST NOT import the
 * concrete provider — only this interface.
 */
export interface MetaInsightsProvider {
  /** Returns null when no insights rows exist for the campaign in this window. */
  getWindowMetrics(query: InsightsWindowQuery): Promise<WindowMetrics | null>;
}

/**
 * Mirrors `Recommendation` projection but only the fields attribution needs.
 * Avoids importing the full Recommendation type to keep the test surface small.
 */
export interface AttributableRecommendation {
  id: string;
  organizationId: string;
  campaignId: string;
  actionKind: AttributableKind;
  resolvedAt: Date;
}

/**
 * Read-side store interface attribution uses to find candidates and detect
 * overlap. Concrete implementation lives in @switchboard/db.
 */
export interface AttributableRecommendationStore {
  /**
   * Returns acted Riley recommendations for orgId where:
   *   - actionKind ∈ V1_ATTRIBUTABLE_KINDS
   *   - resolvedAt + windowDays(kind) + SETTLEMENT_LAG_HOURS <= now
   *   - no existing RecommendationOutcome row for this recommendation id
   * Ordered by resolvedAt ASC.
   */
  findAttributableCandidates(args: {
    organizationId: string;
    now: Date;
  }): Promise<AttributableRecommendation[]>;

  /**
   * For overlap detection: returns acted Riley recommendations on the SAME campaign
   * within [windowStart, windowEnd], EXCLUDING the candidate row by id.
   * Used to detect same_campaign_overlap / same_kind_retry.
   */
  findOverlapsForCampaign(args: {
    organizationId: string;
    campaignId: string;
    excludeRecommendationId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Pick<AttributableRecommendation, "id" | "actionKind">[]>;
}

/**
 * Row shape persisted via RecommendationOutcomeStore. Mirrors the Prisma
 * model in db package; defined here so core does not import @prisma/client.
 */
export interface RileyOutcomeRow {
  recommendationId: string;
  executableWorkUnitId: string | null;
  organizationId: string;
  agentRole: "riley";
  actionKind: AttributableKind;
  anchorAt: Date;
  windowStartedAt: Date;
  windowEndedAt: Date;
  attributionMethod: "directional";
  confidence: "low" | "medium";
  cockpitRenderable: boolean;
  metricSummary: {
    preWindowDays: number;
    postWindowDays: number;
    preWindow: WindowMetrics | null;
    postWindow: WindowMetrics | null;
    deltas: { deltaPct: number | null; deltaAmountCents: number | null };
  };
  copyTemplate: string | null;
  copyValues: { deltaPct: number; windowDays: number } | null;
  visibilityFlags: VisibilityFlag[];
}

export interface RecommendationOutcomeStore {
  /** Idempotent: throws if row for recommendationId already exists. */
  insert(row: RileyOutcomeRow): Promise<void>;

  /** Quick existence check used by the worker to short-circuit before Meta queries. */
  existsByRecommendationId(recommendationId: string): Promise<boolean>;
}
