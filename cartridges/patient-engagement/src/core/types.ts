// ---------------------------------------------------------------------------
// Patient Engagement — Core Domain Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Journey Schema — defines the patient lifecycle
// ---------------------------------------------------------------------------

export type JourneyStageId =
  | "new_lead"
  | "qualified"
  | "consultation_booked"
  | "consultation_completed"
  | "treatment_proposed"
  | "treatment_accepted"
  | "treatment_scheduled"
  | "treatment_completed"
  | "repeat_patient"
  | "dormant"
  | "lost";

export interface JourneyStage {
  /** Machine identifier */
  id: JourneyStageId;
  /** Human-readable name shown in diagnostics */
  name: string;
  /** The metric key for this stage (e.g. "new_leads", "qualified_leads") */
  metric: string;
  /** Whether this is a terminal state */
  terminal: boolean;
}

export interface JourneySchema {
  stages: JourneyStage[];
  /** The primary KPI metric for journey health */
  primaryKPI: string;
}

/** The canonical patient journey schema */
export const PATIENT_JOURNEY_SCHEMA: JourneySchema = {
  stages: [
    { id: "new_lead", name: "New Lead", metric: "new_leads", terminal: false },
    { id: "qualified", name: "Qualified", metric: "qualified_leads", terminal: false },
    { id: "consultation_booked", name: "Consultation Booked", metric: "consultations_booked", terminal: false },
    { id: "consultation_completed", name: "Consultation Completed", metric: "consultations_completed", terminal: false },
    { id: "treatment_proposed", name: "Treatment Proposed", metric: "treatments_proposed", terminal: false },
    { id: "treatment_accepted", name: "Treatment Accepted", metric: "treatments_accepted", terminal: false },
    { id: "treatment_scheduled", name: "Treatment Scheduled", metric: "treatments_scheduled", terminal: false },
    { id: "treatment_completed", name: "Treatment Completed", metric: "treatments_completed", terminal: false },
    { id: "repeat_patient", name: "Repeat Patient", metric: "repeat_patients", terminal: false },
    { id: "dormant", name: "Dormant", metric: "dormant_patients", terminal: true },
    { id: "lost", name: "Lost", metric: "lost_patients", terminal: true },
  ],
  primaryKPI: "treatments_completed",
};

// ---------------------------------------------------------------------------
// Clinic Types
// ---------------------------------------------------------------------------

export type ClinicType =
  | "dental"
  | "dermatology"
  | "aesthetics"
  | "orthodontics"
  | "general"
  | "specialty";

// ---------------------------------------------------------------------------
// Metric data — normalized output for journey analysis
// ---------------------------------------------------------------------------

export interface StageMetrics {
  count: number;
  /** Average value per patient at this stage (null if not applicable) */
  averageValue: number | null;
}

/** A single time-period snapshot of all journey metrics */
export interface PatientMetricsSnapshot {
  /** The organization ID */
  organizationId: string;
  /** ISO date string for period start */
  periodStart: string;
  /** ISO date string for period end */
  periodEnd: string;
  /** Total patients in the pipeline */
  totalPatients: number;
  /** Metrics keyed by JourneyStage.metric */
  stages: Record<string, StageMetrics>;
  /** Aggregate metrics */
  aggregates: {
    averageTreatmentValue: number;
    totalRevenue: number;
    noShowRate: number;
    cancellationRate: number;
    averageResponseTimeMs: number;
    reviewRating: number | null;
    reviewCount: number;
    referralCount: number;
  };
}

// ---------------------------------------------------------------------------
// Time ranges
// ---------------------------------------------------------------------------

export interface TimeRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

export interface ComparisonPeriods {
  current: TimeRange;
  previous: TimeRange;
}

// ---------------------------------------------------------------------------
// Diagnostic output
// ---------------------------------------------------------------------------

export type Severity = "critical" | "warning" | "info" | "healthy";

export interface JourneyStageDiagnostic {
  stageName: string;
  stageId: JourneyStageId;
  metric: string;
  currentValue: number;
  previousValue: number;
  /** Absolute change */
  delta: number;
  /** Percentage change (positive = increase) */
  deltaPercent: number;
  /** Whether this change is statistically meaningful */
  isSignificant: boolean;
  severity: Severity;
}

export interface JourneyDropoff {
  fromStage: string;
  toStage: string;
  currentRate: number;
  previousRate: number;
  deltaPercent: number;
}

export interface JourneyFinding {
  severity: Severity;
  stage: string;
  message: string;
  recommendation: string | null;
}

export interface JourneyDiagnosticContext {
  clinicType?: ClinicType;
  historicalSnapshots?: PatientMetricsSnapshot[];
  /** Communication compliance data */
  communicationData?: {
    totalMessagesSent: number;
    consentCoverage: number;
    escalationRate: number;
    averageResponseTimeMs: number;
  };
}

export interface JourneyDiagnosticResult {
  organizationId: string;
  periods: ComparisonPeriods;
  totalPatients: { current: number; previous: number };
  /** Primary KPI summary */
  primaryKPI: {
    name: string;
    current: number;
    previous: number;
    deltaPercent: number;
    severity: Severity;
  };
  /** Per-stage period-over-period comparison */
  stageAnalysis: JourneyStageDiagnostic[];
  /** Drop-off rates between adjacent stages */
  dropoffs: JourneyDropoff[];
  /** The stage with the most significant negative change */
  bottleneck: JourneyStageDiagnostic | null;
  /** Human-readable diagnosis strings */
  findings: JourneyFinding[];
}

// ---------------------------------------------------------------------------
// Consent & Communication
// ---------------------------------------------------------------------------

export type ConsentStatus = "active" | "revoked" | "pending" | "expired";
export type CommunicationChannel = "sms" | "email" | "phone" | "in_app";

export interface PatientConsent {
  patientId: string;
  channel: CommunicationChannel;
  status: ConsentStatus;
  grantedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

// ---------------------------------------------------------------------------
// Communication Risk
// ---------------------------------------------------------------------------

export type CommunicationRiskLevel = "safe" | "caution" | "restricted" | "blocked";

export interface CommunicationRiskResult {
  level: CommunicationRiskLevel;
  reasons: string[];
  maxMessagesPerDay: number;
}

// ---------------------------------------------------------------------------
// Lead Scoring
// ---------------------------------------------------------------------------

export interface LeadScoreInput {
  treatmentValue: number;
  urgencyLevel: number; // 0-10
  hasInsurance: boolean;
  isReturning: boolean;
  source: "referral" | "organic" | "paid" | "walk_in" | "other";
  engagementScore: number; // 0-10
  responseSpeedMs: number | null;
  hasMedicalHistory: boolean;
  budgetIndicator: number; // 0-10
  eventDriven: boolean; // wedding, vacation, etc.
}

export interface LeadScoreResult {
  score: number; // 0-100
  tier: "hot" | "warm" | "cool" | "cold";
  factors: Array<{ factor: string; contribution: number }>;
}

// ---------------------------------------------------------------------------
// LTV Scoring
// ---------------------------------------------------------------------------

export interface LTVScoreInput {
  averageTreatmentValue: number;
  visitFrequencyPerYear: number;
  retentionYears: number;
  referralCount: number;
  noShowCount: number;
  totalVisits: number;
}

export interface LTVScoreResult {
  estimatedLTV: number;
  tier: "platinum" | "gold" | "silver" | "bronze";
  components: {
    baseValue: number;
    referralValue: number;
    noShowCost: number;
    retentionDecay: number;
  };
}

// ---------------------------------------------------------------------------
// Treatment Affinity
// ---------------------------------------------------------------------------

export type TreatmentType =
  | "botox"
  | "filler"
  | "laser"
  | "chemical_peel"
  | "microneedling"
  | "dental_cleaning"
  | "whitening"
  | "orthodontics"
  | "implants"
  | "crowns"
  | "general_checkup"
  | "other";

export interface TreatmentAffinityInput {
  currentTreatment: TreatmentType;
  ageRange: "18-25" | "26-35" | "36-45" | "46-55" | "56-65" | "65+";
  budgetIndicator: number; // 0-10
  previousTreatments: TreatmentType[];
}

export interface TreatmentAffinityResult {
  recommendations: Array<{
    treatment: TreatmentType;
    affinityScore: number; // 0-1
    reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// Appointment types
// ---------------------------------------------------------------------------

export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

export interface AppointmentSlot {
  startTime: Date;
  endTime: Date;
  providerId: string;
  available: boolean;
}

export interface AppointmentDetails {
  appointmentId: string;
  patientId: string;
  providerId: string;
  startTime: Date;
  endTime: Date;
  status: AppointmentStatus;
  treatmentType: TreatmentType | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Review types
// ---------------------------------------------------------------------------

export type ReviewPlatform = "google" | "yelp" | "healthgrades" | "internal";

export interface ReviewDetails {
  reviewId: string;
  platform: ReviewPlatform;
  patientId: string | null;
  rating: number; // 1-5
  text: string;
  createdAt: Date;
  respondedAt: Date | null;
  responseText: string | null;
}
