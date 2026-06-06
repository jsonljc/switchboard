import type { OperationalStateConfirmation } from "@switchboard/schemas";
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
 * Slice-3 enrichment enums (Riley v3 OutcomeLedger, spec section 2.5).
 *
 * causalStrength: "corroborated" (emitted since slice 4d) means a SECOND,
 * INDEPENDENT booked-value estimate agrees with the directional outcome
 * under explicit judgeability floors (outcome-corroboration.ts). It does
 * NOT mean causal proof: no consumer, copy surface, or future scoring
 * change may treat it as one (the whole system's bar is not overclaiming).
 */
export type CausalStrength = "directional" | "corroborated" | "inconclusive";

/**
 * "unknown" until the slice-4 operational-state source exists; never a
 * fabricated "stable" (spec section 7.4).
 */
export type BusinessContextStability = "stable" | "unstable" | "unknown";

/**
 * Advisory display signal: should trust in this action class move, given
 * the outcome direction and its causal strength. Recorded and rendered on
 * the cockpit outcome feed; never fed back into recommendation scoring
 * (that switch is Phase-C, spec section 2.5).
 */
export type TrustDelta = "up" | "none" | "down";

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
  /**
   * Slice-4d: org-level (ad-account-level) spend for the SAME window, in
   * cents. Populated when the provider fetches account-scope data (the
   * apps/api adapter does: its Graph call already returns every campaign and
   * this is the sum BEFORE the campaign filter). Optional: a provider that
   * cannot supply it leaves the corroboration predicate unjudgeable (honest
   * absence, never fabricated; spec 4d F1).
   */
  accountSpendCents?: number;
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
 * Slice-4c: the 4a store's window read. Implementation is
 * PrismaOperationalStateStore in @switchboard/db, injected at the app layer
 * (core is Layer 3 and cannot import db). Contract: the latest confirmation
 * at-or-before windowStart (the governing regime) plus every confirmation in
 * (windowStart, windowEnd], oldest first; [] = honest unknown.
 */
export interface OperationalStateReader {
  getConfirmationsOverlappingWindow(
    organizationId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<OperationalStateConfirmation[]>;
}

/**
 * Slice-4d: org-level windowed booked stats, the CRM-side independent second
 * estimate for the corroboration predicate (spec 2.5: "read from the
 * booked-value/CRM side"). Implementation is
 * PrismaConversionRecordStore.getBookedStatsForOrgWindow in @switchboard/db,
 * injected at the app layer (core is Layer 3 and cannot import db). A counted
 * booking is type:"booked" AND value > 0 (the same predicate as the summed
 * value, so the count can never be satisfied by zero-value rows the sum
 * excludes); the window is HALF-OPEN [startInclusive, endExclusive),
 * mirroring the engine's Meta window queries. Values are CENTS end to end.
 * Zeros are honest absence: they fail the corroboration floors, they are
 * never an error.
 */
export interface OrgBookedWindowStats {
  bookedValueCents: number;
  bookedCount: number;
}

export interface OrgBookedStatsReader {
  getBookedStatsForOrgWindow(args: {
    organizationId: string;
    startInclusive: Date;
    endExclusive: Date;
  }): Promise<OrgBookedWindowStats>;
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
  /** Slice-3 enrichments: always present on engine output; NULL on legacy DB rows. */
  causalStrength: CausalStrength;
  businessContextStable: BusinessContextStability;
  trustDelta: TrustDelta;
}

export interface RecommendationOutcomeStore {
  /** Idempotent: throws if row for recommendationId already exists. */
  insert(row: RileyOutcomeRow): Promise<void>;

  /** Quick existence check used by the worker to short-circuit before Meta queries. */
  existsByRecommendationId(recommendationId: string): Promise<boolean>;
}
