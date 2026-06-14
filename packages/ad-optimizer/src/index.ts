export { MetaAdsClient } from "./meta-ads-client.js";
export { MetaCAPIClient } from "./meta-capi-client.js";
export { analyzeFunnel } from "./funnel-analyzer.js";
export type { CrmFunnelData, FunnelBenchmarks, FunnelInput } from "./funnel-analyzer.js";
export { comparePeriods } from "./period-comparator.js";
export type { MetricSet } from "./period-comparator.js";
export { LearningPhaseGuard } from "./learning-phase-guard.js";
export type {
  CampaignLearningInput,
  PerformanceMetrics,
  PerformanceTargets,
} from "./learning-phase-guard.js";
export { diagnose } from "./metric-diagnostician.js";
export type { Diagnosis } from "./metric-diagnostician.js";
export {
  generateRecommendations,
  generateSignalHealthRecommendations,
} from "./recommendation-engine.js";
export type { RecommendationInput } from "./recommendation-engine.js";
export {
  decideForCampaign,
  insightToMetrics,
  deriveLearningPhaseActive,
} from "./campaign-decision.js";
export type { CampaignDecisionInput, CampaignDecisionResult } from "./campaign-decision.js";
export { AuditRunner } from "./audit-runner.js";
export type {
  AuditDependencies,
  AuditConfig,
  AdsClientInterface,
  BookedValueByCampaignProvider,
} from "./audit-runner.js";
export {
  createWeeklyAuditCron,
  executeWeeklyAudit,
  createDailyCheckCron,
  createDailySignalHealthCron,
  executeDailySignalHealthCheck,
  createRileyOutcomeAttributionDispatch,
  executeRileyOutcomeAttributionDispatch,
} from "./inngest-functions.js";
export type {
  CronDependencies,
  SignalHealthCronDependencies,
  RileyOutcomeAttributionDispatchDeps,
} from "./inngest-functions.js";
export { parseLeadWebhook, fetchLeadDetail, extractFieldValue } from "./meta-leads-ingester.js";
export type { LeadData } from "./meta-leads-ingester.js";
export {
  buildAuthorizationUrl,
  buildSignedState,
  verifySignedState,
  STATE_MAX_AGE_MS,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
  refreshTokenIfNeeded,
} from "./facebook-oauth.js";
export type { FacebookOAuthConfig, TokenResult, AdAccount } from "./facebook-oauth.js";
export { buildConversionEvent } from "./crm-event-emitter.js";
export type { BuildConversionEventParams } from "./crm-event-emitter.js";
export { MetaCAPIDispatcher } from "./meta-capi-dispatcher.js";
export { MetaCampaignInsightsProvider } from "./meta-campaign-insights-provider.js";
export { MetaReportInsightsProvider } from "./meta-report-insights-provider.js";
export { LearningPhaseGuardV2 } from "./learning-phase-guard.js";
export { detectFunnelShape, getFunnelStageTemplate } from "./funnel-detector.js";
export { detectTrends, projectBreach, classifyTrendTier } from "./trend-engine.js";
export { analyzeBudgetDistribution, detectCBO } from "./budget-analyzer.js";
export { deduplicateCreatives, analyzeCreatives } from "./creative-analyzer.js";
export type { RawAdData } from "./creative-analyzer.js";
export { detectSaturation } from "./saturation-detector.js";
export * from "./lead-intake/index.js";
export * from "./outcome-dispatcher.js";
export { RealCrmDataProvider } from "./crm-data-provider/real-provider.js";
export {
  compareSources,
  compareCampaigns,
  trueRoasFromCents,
} from "./analyzers/source-comparator.js";
export {
  decideSourceReallocation,
  computeAuditEconomicsSections,
  findShiftCandidates,
  MIN_SOURCE_LEADS,
  MIN_SOURCE_BOOKINGS,
} from "./analyzers/source-reallocation.js";
export type {
  SourceReallocationInput,
  AuditEconomicsSectionsInput,
} from "./analyzers/source-reallocation.js";
export {
  resolveEconomicTarget,
  resolveEconomicTargetForCampaign,
} from "./analyzers/economic-target.js";
export type {
  ResolvedEconomicTarget,
  PerCampaignEconomicTarget,
  PerCampaignEconomicTargetInput,
} from "./analyzers/economic-target.js";
export * from "./onboarding/coverage-validator.js";
export type {
  SourceComparisonRow,
  SourceComparisonInput,
  SourceComparisonResult,
  CampaignEconomicsRow,
  CampaignComparisonInput,
} from "./analyzers/source-comparator.js";
export type {
  CrmFunnelStore,
  CrmFunnelCountRow,
  SourceFunnel,
  CrmFunnelDataWithSources,
} from "./crm-data-provider/real-provider.js";
export { runRecommendationSink } from "./recommendation-sink.js";
export { SignalHealthChecker } from "./signal-health-checker.js";
export type {
  PixelHealth,
  EventVolume,
  EventVolumeEntry,
  CAPIHealth,
  DaCheck,
  DaChecks,
  Breach,
  BreachSignal,
  SignalHealthScore,
  SignalHealthReport,
} from "./signal-health-checker.js";
export type {
  RunRecommendationSinkArgs,
  RunRecommendationSinkResult,
  RecommendationEmitter,
  EmitOutcome,
} from "./recommendation-sink.js";

// Riley v3 slice 1: the consolidated account-level RevenueState pre-flight object
// (the decision layer + eval seam construct it; per-campaign tier stays separate).
export { assembleRevenueState, withSpendAttributionCoverage } from "./revenue-state.js";
export type { RevenueState, AssembleRevenueStateInput } from "./revenue-state.js";

// Riley v3 slice 2: the consolidated per-action contract (single source for the
// sink booleans + reset class + evidence family), the mutating-ness question, and
// the cross-campaign arbitrator (the eval harness drives it through the barrel).
export {
  ACTION_CONTRACT,
  isMutating,
  isPhaseCActionClassEligible,
  PHASE_C_EXECUTION_SEAM,
} from "./action-contract.js";
export type { ActionContract, PhaseCExecutionContract } from "./action-contract.js";
// Spec-1B act leg: the ENFORCED blast-radius contract (numeric caps + machine-
// comparable guardrails + automated rollback) and its pure fail-closed cap check.
// The apps/api reallocate executor (Spec-1B) consumes these; the declarative
// PhaseCExecutionContract above stays the pause class's recorded-not-enforced seam.
export { assertWithinBlastRadius } from "./blast-radius-contract.js";
export type {
  BlastRadiusContract,
  BlastRadiusGuardrail,
  BlastRadiusGuardrailMetric,
  BlastRadiusRollback,
  BlastRadiusVerdict,
} from "./blast-radius-contract.js";
// Spec-1B act leg: pure fail-closed drift guard the reallocate executor composes
// with the blast-radius cap before the Meta budget write (read-modify-re-read, spec section 7).
export { assessBudgetDrift, computeBudgetDelta } from "./budget-reallocation-plan.js";
export type { BudgetDriftVerdict } from "./budget-reallocation-plan.js";
// Spec-1B reallocation dispatch (L2): the candidate producer + injected-submitter type the
// apps/api submit-request builder + sink consume (the L2->L5->L3 governed path).
export { buildRileyBudgetCandidate } from "./riley-budget-dispatch.js";
export type { RileyBudgetCandidate, RileyBudgetSubmitter } from "./riley-budget-dispatch.js";
// Phase-C wiring: raised execution floor for the self-submitted pause.
export {
  RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR,
  meetsRileyPauseExecutionFloor,
} from "./riley-pause-execution-floor.js";
export {
  arbitrate,
  PROXIMITY_BY_TIER,
  MEASUREMENT_UNTRUSTED_FACTOR,
  SIGNAL_YELLOW_FACTOR,
  LEARNING_RESET_PENALTY,
  ATTRIBUTION_CONFLICT_PENALTY,
} from "./analyzers/opportunity-arbitrator.js";
export type {
  ArbitrateInput,
  ArbitrationResult,
  RankedOpportunity,
  MeasurementFixRef,
} from "./analyzers/opportunity-arbitrator.js";

// Riley v3 (spec 2.2): the ownership derivation and the single five-field
// emitted-risk-contract producer (both PURE modules; the dashboard parity
// tripwire and any future operator surface consume these through the barrel).
// deriveOwnershipAnnotations stays package-internal (only the audit runner
// builds the report annotation); the sink module is never public API.
export { deriveOwnership } from "./recommendation-ownership.js";
export type { DeriveOwnershipInput, OwnershipAnnotation } from "./recommendation-ownership.js";
export { emittedRiskContractFor, URGENCY_TO_RISK } from "./recommendation-risk-contract.js";
export type { EmittedRiskContract } from "./recommendation-risk-contract.js";

// Abstention helpers (consumed by the Riley->agent recommendation-handoff seam).
export { meetsEvidenceFloor, evidenceFamilyFor, EVIDENCE_FLOORS } from "./evidence-floor.js";
export type { Evidence, EvidenceFamily } from "./evidence-floor.js";
export {
  resetsLearningFor,
  learningPhaseImpactText,
  ACTION_RESETS_LEARNING,
} from "./action-reset-classification.js";
export {
  shouldAbstainFromHandoff,
  CREATIVE_HANDOFF_ACTIONS,
} from "./recommendation-handoff-abstention.js";
export type {
  HandoffAbstentionDecision,
  HandoffAbstentionInput,
  HandoffAbstentionReason,
} from "./recommendation-handoff-abstention.js";
// Only the submit-callback type crosses the package boundary (apps/api wires the
// callback). The candidate/context/dispatch helpers stay package-internal (relative
// imports), so they are deliberately NOT re-exported from the barrel.
export type { RecommendationHandoffSubmitter } from "./recommendation-handoff-dispatch.js";
// Phase-C pause initiator seam: candidate decision is package-internal; only the
// submitter type + builder cross the boundary (apps/api wires the callback).
export { buildRileyPauseCandidate } from "./riley-pause-dispatch.js";
export type { RileyPauseCandidate, RileyPauseSubmitter } from "./riley-pause-dispatch.js";
