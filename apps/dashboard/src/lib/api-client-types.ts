export interface AgentRosterEntry {
  id: string;
  organizationId: string;
  agentRole: string;
  displayName: string;
  description: string;
  status: string;
  tier: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  agentState?: AgentStateEntry | null;
}

export interface AgentStateEntry {
  id: string;
  agentRosterId: string;
  organizationId: string;
  activityStatus: string;
  currentTask: string | null;
  lastActionAt: string | null;
  lastActionSummary: string | null;
  metrics: Record<string, unknown>;
  updatedAt: string;
}

export interface AlertRule {
  id: string;
  organizationId: string;
  name: string;
  enabled: boolean;
  metricPath: string;
  operator: string;
  threshold: number;
  platform: string | null;
  vertical: string;
  notifyChannels: string[];
  notifyRecipients: string[];
  cooldownMinutes: number;
  lastTriggeredAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertInput {
  name: string;
  metricPath: string;
  operator: string;
  threshold: number;
  platform?: string | null;
  vertical?: string;
  notifyChannels?: string[];
  notifyRecipients?: string[];
  cooldownMinutes?: number;
  enabled?: boolean;
}

export interface AlertHistoryEntry {
  id: string;
  alertRuleId: string;
  organizationId: string;
  triggeredAt: string;
  metricValue: number;
  threshold: number;
  findingsSummary: string;
  notificationsSent: Array<{ channel: string; recipient: string; success: boolean }>;
}

export interface ScheduledReportEntry {
  id: string;
  organizationId: string;
  name: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  reportType: string;
  platform: string | null;
  vertical: string;
  deliveryChannels: string[];
  deliveryTargets: string[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorSummary {
  organizationId: string;
  spend: {
    source: "meta";
    currency: "USD";
    connectionStatus: "connected" | "missing" | "error";
    today: number | null;
    last7Days: number | null;
    last30Days: number | null;
    trend: Array<{
      date: string;
      spend: number | null;
      leads: number;
      bookings: number;
    }>;
    freshness: {
      fetchedAt: string | null;
      cacheTtlSeconds: number;
    };
  };
  outcomes: {
    leads30d: number;
    qualifiedLeads30d: number;
    bookings30d: number;
    revenue30d: number | null;
    costPerLead30d: number | null;
    costPerQualifiedLead30d: number | null;
    costPerBooking30d: number | null;
    outcomeBreakdown?: {
      booked: number;
      lost: number;
      escalated_unresolved: number;
      escalated_resolved: number;
      unresponsive: number;
      reactivated: number;
    };
  };
  operator: {
    actionsToday: number;
    deniedToday: number;
  };
  speedToLead?: {
    averageMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    percentWithin60s: number | null;
    sampleSize: number;
  };
}

export interface CampaignAttribution {
  campaignId: string;
  name: string;
  leads: number;
  bookings: number;
  paid: number;
  revenue: number;
  spend: number | null;
  costPerLead: number | null;
  costPerBooking: number | null;
  roas: number | null;
}

export interface PilotReportData {
  period: { startDate: string; endDate: string; days: number };
  speedToLead: {
    medianMs: number | null;
    percentWithin2Min: number | null;
    sampleSize: number;
    baseline: string | null;
  };
  conversion: {
    leads: number;
    payingPatients: number;
    ratePercent: number | null;
    baselinePercent: number | null;
  };
  costPerPatient: {
    amount: number | null;
    currency: string;
    adSpend: number | null;
    totalRevenue: number | null;
    roas: number | null;
    baselineAmount: number | null;
  };
  funnel: {
    leads: number;
    qualified: number;
    booked: number;
    showedUp: number;
    paid: number;
  };
  campaigns: Array<{
    name: string;
    spend: number | null;
    leads: number;
    payingPatients: number;
    revenue: number;
    costPerPatient: number | null;
  }>;
}

export interface CreateScheduledReportInput {
  name: string;
  cronExpression: string;
  timezone?: string;
  reportType: "funnel" | "portfolio";
  platform?: string | null;
  vertical?: string;
  deliveryChannels?: string[];
  deliveryTargets?: string[];
  enabled?: boolean;
}

export interface PendingApproval {
  id: string;
  summary: string;
  riskCategory: string;
  status: string;
  envelopeId: string;
  expiresAt: string;
  bindingHash: string;
  createdAt: string;
}

export interface ApprovalDetail {
  request: {
    id: string;
    summary: string;
    riskCategory: string;
    bindingHash: string;
    approvers: string[];
    createdAt: string;
  };
  state: {
    status: string;
    expiresAt: string;
    respondedBy?: string;
    respondedAt?: string;
  };
  envelopeId: string;
}

export interface HealthCheck {
  healthy: boolean;
  checks: Record<string, { status: string; latencyMs: number; error?: string; detail?: unknown }>;
  checkedAt: string;
}

export interface SimulateResult {
  decisionTrace: {
    actionId: string;
    envelopeId: string;
    checks: Array<{
      checkCode: string;
      checkData: Record<string, unknown>;
      humanDetail: string;
      matched: boolean;
      effect: string;
    }>;
    computedRiskScore: {
      rawScore: number;
      category: string;
      factors: Array<{ factor: string; weight: number; contribution: number; detail: string }>;
    };
    finalDecision: string;
    approvalRequired: string;
    explanation: string;
    evaluatedAt: string;
  };
  wouldExecute: boolean;
  approvalRequired: string;
  explanation: string;
}

// Revenue Growth types
export interface RevGrowthScorerOutput {
  scorerName: string;
  constraintType: string;
  score: number;
  confidence: string;
  findings: string[];
  rawMetrics: Record<string, unknown>;
}

export interface RevGrowthConstraint {
  type: string;
  score: number;
  confidence: string;
  reasoning: string;
}

export interface RevGrowthIntervention {
  id: string;
  cycleId: string;
  constraintType: string;
  actionType: string;
  status: string;
  priority: number;
  estimatedImpact: string;
  reasoning: string;
  artifacts: Array<{ type: string; title: string; content: string; generatedAt: string }>;
  outcomeStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevGrowthDiagnosticResult {
  cycleId: string;
  accountId: string;
  dataTier: string;
  scorerOutputs: RevGrowthScorerOutput[];
  primaryConstraint: RevGrowthConstraint | null;
  secondaryConstraints: RevGrowthConstraint[];
  interventions: RevGrowthIntervention[];
  constraintTransition: string | null;
  completedAt: string;
}

export interface RevGrowthConnectorHealth {
  connectorId: string;
  name: string;
  status: string;
  lastSyncAt: string | null;
  matchRate: number | null;
  errorMessage: string | null;
}

export interface RevGrowthDigest {
  id: string;
  accountId: string;
  headline: string;
  summary: string;
  constraintHistory: Array<{ type: string; score: number; cycleId: string }>;
  outcomeHighlights: Array<{ interventionId: string; actionType: string; outcomeStatus: string }>;
  generatedAt: string;
}
