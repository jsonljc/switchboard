export { evaluateRule } from "./rule-evaluator.js";
export type { EvaluationContext, ConditionResult, RuleResult } from "./rule-evaluator.js";
export {
  computeRiskScore,
  DEFAULT_RISK_CONFIG,
  computeCompositeRiskAdjustment,
  DEFAULT_COMPOSITE_RISK_CONFIG,
} from "./risk-scorer.js";
export type { RiskScoringConfig, CompositeRiskConfig } from "./risk-scorer.js";
export { createTraceBuilder, addCheck, buildTrace } from "./decision-trace.js";
export type { DecisionTraceBuilder } from "./decision-trace.js";
export {
  resolveEntities,
  buildClarificationQuestion,
  buildNotFoundExplanation,
} from "./resolver.js";
export type { EntityResolver, ResolverResult } from "./resolver.js";
export { evaluatePlan } from "./composites.js";
export type { PlanEvaluationResult } from "./composites.js";
export { formatSimulationResult } from "./simulator.js";
export type { SimulationInput, SimulationResult } from "./simulator.js";
export { evaluate, simulate, createGuardrailState } from "./policy-engine.js";
export type {
  PolicyEngineConfig,
  PolicyEngineContext,
  GuardrailState,
  SpendLookup,
} from "./policy-engine.js";
export { InMemoryRiskPostureStore } from "./risk-posture.js";
export type { RiskPostureStore } from "./risk-posture.js";
