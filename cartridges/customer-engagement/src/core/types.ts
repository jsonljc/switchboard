// ---------------------------------------------------------------------------
// Customer Engagement — Core Domain Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Journey Schema — defines the customer lifecycle
// ---------------------------------------------------------------------------

/** Journey stage identifier — open string to allow profile-defined stages. */
export type JourneyStageId = string;

/** Default journey stage IDs used when no profile is loaded. */
export const DEFAULT_JOURNEY_STAGE_IDS: JourneyStageId[] = [
  "new_lead",
  "qualified",
  "consultation_booked",
  "consultation_completed",
  "service_proposed",
  "service_accepted",
  "service_scheduled",
  "service_completed",
  "repeat_customer",
  "dormant",
  "lost",
];

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

/** The canonical customer journey schema */
export const CUSTOMER_JOURNEY_SCHEMA: JourneySchema = {
  stages: [
    { id: "new_lead", name: "New Lead", metric: "new_leads", terminal: false },
    { id: "qualified", name: "Qualified", metric: "qualified_leads", terminal: false },
    {
      id: "consultation_booked",
      name: "Consultation Booked",
      metric: "consultations_booked",
      terminal: false,
    },
    {
      id: "consultation_completed",
      name: "Consultation Completed",
      metric: "consultations_completed",
      terminal: false,
    },
    {
      id: "service_proposed",
      name: "Service Proposed",
      metric: "services_proposed",
      terminal: false,
    },
    {
      id: "service_accepted",
      name: "Service Accepted",
      metric: "services_accepted",
      terminal: false,
    },
    {
      id: "service_scheduled",
      name: "Service Scheduled",
      metric: "services_scheduled",
      terminal: false,
    },
    {
      id: "service_completed",
      name: "Service Completed",
      metric: "services_completed",
      terminal: false,
    },
    { id: "repeat_customer", name: "Repeat Customer", metric: "repeat_customers", terminal: false },
    { id: "dormant", name: "Dormant", metric: "dormant_customers", terminal: true },
    { id: "lost", name: "Lost", metric: "lost_customers", terminal: true },
  ],
  primaryKPI: "services_completed",
};

// ---------------------------------------------------------------------------
// Clinic Types
// ---------------------------------------------------------------------------

/** Business type — open string to allow profile-defined verticals. */
export type BusinessType = string;

/** Default business types. */
export const DEFAULT_BUSINESS_TYPES: BusinessType[] = [
  "dental",
  "dermatology",
  "aesthetics",
  "orthodontics",
  "general",
  "specialty",
];

// ---------------------------------------------------------------------------
// Metric data — normalized output for journey analysis
// ---------------------------------------------------------------------------

export interface StageMetrics {
  count: number;
  /** Average value per patient at this stage (null if not applicable) */
  averageValue: number | null;
}

/** A single time-period snapshot of all journey metrics */
export interface ContactMetricsSnapshot {
  /** The organization ID */
  organizationId: string;
  /** ISO date string for period start */
  periodStart: string;
  /** ISO date string for period end */
  periodEnd: string;
  /** Total contacts in the pipeline */
  totalContacts: number;
  /** Metrics keyed by JourneyStage.metric */
  stages: Record<string, StageMetrics>;
  /** Aggregate metrics */
  aggregates: {
    averageServiceValue: number;
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
  businessType?: BusinessType;
  historicalSnapshots?: ContactMetricsSnapshot[];
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
  totalContacts: { current: number; previous: number };
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

export interface ContactConsent {
  contactId: string;
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
  serviceValue: number;
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
  averageServiceValue: number;
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

/** Service type — open string to allow profile-defined service categories. */
export type ServiceType = string;

/** Default service types. */
export const DEFAULT_SERVICE_TYPES: ServiceType[] = [
  "botox",
  "filler",
  "laser",
  "chemical_peel",
  "microneedling",
  "dental_cleaning",
  "whitening",
  "orthodontics",
  "implants",
  "crowns",
  "general_checkup",
  "other",
];

export interface ServiceAffinityInput {
  currentService: ServiceType;
  ageRange: "18-25" | "26-35" | "36-45" | "46-55" | "56-65" | "65+";
  budgetIndicator: number; // 0-10
  previousServices: ServiceType[];
}

export interface ServiceAffinityResult {
  recommendations: Array<{
    treatment: ServiceType;
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
  contactId: string;
  providerId: string;
  startTime: Date;
  endTime: Date;
  status: AppointmentStatus;
  serviceType: ServiceType | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Review types
// ---------------------------------------------------------------------------

export type ReviewPlatform = "google" | "yelp" | "healthgrades" | "internal";

export interface ReviewDetails {
  reviewId: string;
  platform: ReviewPlatform;
  contactId: string | null;
  rating: number; // 1-5
  text: string;
  createdAt: Date;
  respondedAt: Date | null;
  responseText: string | null;
}
