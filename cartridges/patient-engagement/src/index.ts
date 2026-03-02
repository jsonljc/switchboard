// ---------------------------------------------------------------------------
// patient-engagement — Patient lifecycle management cartridge
// ---------------------------------------------------------------------------

// Core types
export type {
  JourneyStageId,
  JourneyStage,
  JourneySchema,
  ClinicType,
  StageMetrics,
  PatientMetricsSnapshot,
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
  PatientConsent,
  CommunicationRiskLevel,
  CommunicationRiskResult,
  LeadScoreInput,
  LeadScoreResult,
  LTVScoreInput,
  LTVScoreResult,
  TreatmentType,
  TreatmentAffinityInput,
  TreatmentAffinityResult,
  AppointmentStatus,
  AppointmentSlot,
  AppointmentDetails,
  ReviewPlatform,
  ReviewDetails,
} from "./core/types.js";

export { PATIENT_JOURNEY_SCHEMA } from "./core/types.js";

// Analysis
export { analyzeJourney } from "./core/analysis/journey-walker.js";
export type { JourneyWalkerOptions } from "./core/analysis/journey-walker.js";
export { compareStages } from "./core/analysis/stage-comparator.js";
export { analyzeDropoffs, findBottleneck } from "./core/analysis/bottleneck-detector.js";
export { percentChange, isSignificantChange, zScore } from "./core/analysis/significance.js";

// Scoring
export { computeLeadScore } from "./core/scoring/lead-score.js";
export { computeLTV } from "./core/scoring/ltv-score.js";
export { computeCommunicationRisk } from "./core/scoring/communication-risk.js";
export type { CommunicationRiskInput } from "./core/scoring/communication-risk.js";
export { computeTreatmentAffinity } from "./core/scoring/treatment-affinity.js";

// Advisors
export type { JourneyFindingAdvisor } from "./advisors/types.js";
export { resolveAdvisors } from "./advisors/registry.js";

// Cartridge
export { PatientEngagementCartridge } from "./cartridge/index.js";
export { bootstrapPatientEngagementCartridge } from "./cartridge/bootstrap.js";
export type { BootstrapResult } from "./cartridge/bootstrap.js";
export { PATIENT_ENGAGEMENT_MANIFEST, PATIENT_ENGAGEMENT_ACTIONS } from "./cartridge/manifest.js";
export { DEFAULT_PATIENT_ENGAGEMENT_POLICIES } from "./cartridge/defaults/policies.js";
export { DEFAULT_PATIENT_ENGAGEMENT_GUARDRAILS } from "./cartridge/defaults/guardrails.js";

// Providers
export type { CalendarProvider, SMSProvider, ReviewPlatformProvider } from "./cartridge/providers/provider.js";
export { MockCalendarProvider } from "./cartridge/providers/calendar/mock-calendar.js";
export { MockSMSProvider } from "./cartridge/providers/sms/mock-sms.js";
export { MockReviewProvider } from "./cartridge/providers/review/mock-review.js";

// Interceptors
export { HIPAARedactor } from "./cartridge/interceptors/hipaa-redactor.js";
export { MedicalClaimFilter } from "./cartridge/interceptors/medical-claim-filter.js";
export { ConsentGate } from "./cartridge/interceptors/consent-gate.js";

// Conversation engine
export { createConversationState, executeNextStep, interpolate } from "./conversation/engine.js";
export type { ConversationFlowDefinition, ConversationState, FlowStep } from "./conversation/types.js";

// Cadence engine
export { evaluateCadenceStep } from "./cadence/engine.js";
export type { CadenceEvaluation } from "./cadence/engine.js";
export { evaluatePendingCadences, applyCadenceEvaluation } from "./cadence/scheduler.js";
export { DEFAULT_CADENCE_TEMPLATES } from "./cadence/templates.js";
export type { CadenceDefinition, CadenceInstance, CadenceStep, CadenceStatus } from "./cadence/types.js";

// Agents
export type { AgentModule, AgentType } from "./agents/types.js";
export { resolveAgent } from "./agents/registry.js";
export { matchObjection } from "./agents/intake/objection-trees.js";

// Orchestrator
export { runDiagnostic } from "./orchestrator/runner.js";
export { detectCorrelations } from "./orchestrator/correlator.js";
export { generateSummary } from "./orchestrator/summary.js";
