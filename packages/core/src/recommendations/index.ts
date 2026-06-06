export { routeRecommendation } from "./router.js";
export type { RouteInput } from "./router.js";
export type {
  Recommendation,
  PersistRecommendationInput,
  RecommendationStatus,
  RecommendationSurface,
  RecommendationAction,
  RecommendationInput,
  RecommendationPresentation,
  AgentKey,
  EmitResult,
  ActResult,
} from "./types.js";
export type { RecommendationStore } from "./interfaces.js";
export { emitRecommendation } from "./emit.js";
export { actOnRecommendation, RecommendationStaleStatusError } from "./act.js";
export type { ActOnRecommendationInput } from "./act.js";
export { createInMemoryRecommendationStore } from "./in-memory-store.js";
export {
  buildRileyEmissionWorkTrace,
  type RecommendationEmissionMirror,
  type BuildRileyEmissionWorkTraceArgs,
} from "./emission-mirror.js";
export {
  createInMemoryEmissionMirror,
  type CapturedTrace,
  type CreateInMemoryEmissionMirrorOptions,
} from "./in-memory-emission-mirror.js";
export type { EmitRecommendationOptions } from "./emit.js";

// PR-3: Outcome attribution
export {
  SETTLEMENT_LAG_HOURS,
  V1_ATTRIBUTABLE_KINDS,
  KIND_CONFIG,
  isAttributableKind,
  type AttributableKind,
} from "./outcome-attribution-config.js";
export type {
  VisibilityFlag,
  WindowMetrics,
  InsightsWindowQuery,
  MetaInsightsProvider,
  OperationalStateReader,
  OrgBookedStatsReader,
  OrgBookedWindowStats,
  AttributableRecommendation,
  AttributableRecommendationStore,
  RileyOutcomeRow,
  RecommendationOutcomeStore,
  CausalStrength,
  BusinessContextStability,
  TrustDelta,
} from "./outcome-attribution-types.js";
export {
  attributeOneRecommendation,
  runRileyOutcomeAttribution,
  type AttributeOneInput,
  type RileyOutcomeRunSummary,
  type RunRileyOutcomeAttributionInput,
} from "./outcome-attribution.js";
