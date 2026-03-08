// ---------------------------------------------------------------------------
// customer-engagement — Customer lifecycle management cartridge
// ---------------------------------------------------------------------------

// Core types
export type {
  JourneyStageId,
  JourneyStage,
  JourneySchema,
  BusinessType,
  StageMetrics,
  ContactMetricsSnapshot,
  TimeRange,
  ComparisonPeriods,
  Severity,
  JourneyStageDiagnostic,
  JourneyDropoff,
  JourneyFinding,
  JourneyDiagnosticContext,
  JourneyDiagnosticResult,
  ConsentStatus,
  CommunicationChannel,
  ContactConsent,
  CommunicationRiskLevel,
  CommunicationRiskResult,
  LeadScoreInput,
  LeadScoreResult,
  LTVScoreInput,
  LTVScoreResult,
  ServiceType,
  ServiceAffinityInput,
  ServiceAffinityResult,
  AppointmentStatus,
  AppointmentSlot,
  AppointmentDetails,
  ReviewPlatform,
  ReviewDetails,
} from "./core/types.js";

export {
  CUSTOMER_JOURNEY_SCHEMA,
  DEFAULT_JOURNEY_STAGE_IDS,
  DEFAULT_BUSINESS_TYPES,
  DEFAULT_SERVICE_TYPES,
} from "./core/types.js";

// Analysis
export { analyzeJourney } from "./core/analysis/journey-walker.js";
export type { JourneyWalkerOptions } from "./core/analysis/journey-walker.js";
export { compareStages } from "./core/analysis/stage-comparator.js";
export { analyzeDropoffs, findBottleneck } from "./core/analysis/bottleneck-detector.js";
export { percentChange, isSignificantChange, zScore } from "./core/analysis/significance.js";

// Scoring
export { computeLeadScore } from "./core/scoring/lead-score.js";
export type { LeadScoreWeights } from "./core/scoring/lead-score.js";
export { DEFAULT_LEAD_SCORE_WEIGHTS } from "./core/scoring/lead-score.js";
export { computeLTV } from "./core/scoring/ltv-score.js";
export type { LTVScoringConfig } from "./core/scoring/ltv-score.js";
export { DEFAULT_LTV_CONFIG } from "./core/scoring/ltv-score.js";
export { computeCommunicationRisk } from "./core/scoring/communication-risk.js";
export type { CommunicationRiskInput } from "./core/scoring/communication-risk.js";
export { computeServiceAffinity } from "./core/scoring/service-affinity.js";

// Advisors
export type { JourneyFindingAdvisor } from "./advisors/types.js";
export { resolveAdvisors } from "./advisors/registry.js";

// Cartridge
export { CustomerEngagementCartridge } from "./cartridge/index.js";
export { bootstrapCustomerEngagementCartridge } from "./cartridge/bootstrap.js";
export type { BootstrapResult } from "./cartridge/bootstrap.js";
export { CUSTOMER_ENGAGEMENT_MANIFEST, CUSTOMER_ENGAGEMENT_ACTIONS } from "./cartridge/manifest.js";
export { DEFAULT_CUSTOMER_ENGAGEMENT_POLICIES } from "./cartridge/defaults/policies.js";
export { DEFAULT_CUSTOMER_ENGAGEMENT_GUARDRAILS } from "./cartridge/defaults/guardrails.js";

// Escalation
export { setEscalationNotifier } from "./cartridge/actions/escalate.js";
export type { EscalationNotifier } from "./cartridge/actions/escalate.js";

// Providers
export type {
  CalendarProvider,
  SMSProvider,
  ReviewPlatformProvider,
} from "./cartridge/providers/provider.js";
export { MockCalendarProvider } from "./cartridge/providers/calendar/mock-calendar.js";
export { MockSMSProvider } from "./cartridge/providers/sms/mock-sms.js";
export { MockReviewProvider } from "./cartridge/providers/review/mock-review.js";

// Interceptors
export { HIPAARedactor } from "./cartridge/interceptors/hipaa-redactor.js";
export { MedicalClaimFilter } from "./cartridge/interceptors/medical-claim-filter.js";
export { ConsentGate } from "./cartridge/interceptors/consent-gate.js";

// Conversation engine
export { createConversationState, executeNextStep, interpolate } from "./conversation/engine.js";
export type {
  ConversationFlowDefinition,
  ConversationState,
  FlowStep,
} from "./conversation/types.js";
export { ConversationRouter } from "./conversation/router.js";
export type {
  InboundMessage,
  RouterResponse,
  ConversationRouterConfig,
} from "./conversation/router.js";
export { InMemorySessionStore, RedisSessionStore } from "./conversation/session-store.js";
export type {
  ConversationSession,
  ConversationSessionStore,
} from "./conversation/session-store.js";

// Conversation flow templates (for lead bot qualification)
export { qualificationFlow } from "./conversation/templates/qualification.js";
export { bookingFlow } from "./conversation/templates/booking.js";

// Cadence engine
export { evaluateCadenceStep } from "./cadence/engine.js";
export type { CadenceEvaluation } from "./cadence/engine.js";
export { evaluatePendingCadences, applyCadenceEvaluation } from "./cadence/scheduler.js";
export { DEFAULT_CADENCE_TEMPLATES, resolveCadenceTemplates } from "./cadence/templates.js";
export type {
  CadenceDefinition,
  CadenceInstance,
  CadenceStep,
  CadenceStatus,
} from "./cadence/types.js";

// Agents
export type { AgentModule, AgentType } from "./agents/types.js";
export { resolveAgent } from "./agents/registry.js";
export { matchObjection, DEFAULT_OBJECTION_TREES } from "./agents/intake/objection-trees.js";
export type { ObjectionMatch } from "./agents/intake/objection-trees.js";

// Orchestrator
export { runDiagnostic } from "./orchestrator/runner.js";
export { detectCorrelations } from "./orchestrator/correlator.js";
export { generateSummary } from "./orchestrator/summary.js";
