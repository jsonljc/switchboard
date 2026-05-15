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
