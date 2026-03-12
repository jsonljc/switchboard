/* eslint-disable max-lines */
import type {
  IdentitySpec,
  AuditEntry,
  Policy,
  CartridgeManifest,
  AdsOperatorConfig,
} from "@switchboard/schemas";

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
  };
  operator: {
    actionsToday: number;
    deniedToday: number;
  };
  speedToLead?: {
    averageMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    sampleSize: number;
  };
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

export class SwitchboardClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `API error: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  // Identity
  async getIdentitySpec(id: string) {
    return this.request<{ spec: IdentitySpec }>(`/api/identity/specs/${id}`);
  }

  async getIdentitySpecByPrincipal(principalId: string) {
    return this.request<{ spec: IdentitySpec }>(`/api/identity/specs/by-principal/${principalId}`);
  }

  async updateIdentitySpec(id: string, data: Partial<IdentitySpec>) {
    return this.request<{ spec: IdentitySpec }>(`/api/identity/specs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async createIdentitySpec(data: Omit<IdentitySpec, "id" | "createdAt" | "updatedAt">) {
    return this.request<{ spec: IdentitySpec }>("/api/identity/specs", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Approvals
  async listPendingApprovals() {
    return this.request<{ approvals: PendingApproval[] }>("/api/approvals/pending");
  }

  async getApproval(id: string) {
    return this.request<ApprovalDetail>(`/api/approvals/${id}`);
  }

  async respondToApproval(
    id: string,
    body: { action: string; respondedBy: string; bindingHash: string; patchValue?: unknown },
  ) {
    return this.request<{ envelope: unknown; approvalState: unknown; executionResult: unknown }>(
      `/api/approvals/${id}/respond`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
  }

  // Audit
  async queryAudit(params?: {
    eventType?: string;
    limit?: number;
    after?: string;
    before?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.eventType) searchParams.set("eventType", params.eventType);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.after) searchParams.set("after", params.after);
    if (params?.before) searchParams.set("before", params.before);
    const qs = searchParams.toString();
    return this.request<{ entries: AuditEntry[]; total: number }>(
      `/api/audit${qs ? `?${qs}` : ""}`,
    );
  }

  // Policies
  async listPolicies() {
    return this.request<{ policies: Policy[] }>("/api/policies");
  }

  async createPolicy(data: Omit<Policy, "id" | "createdAt" | "updatedAt">) {
    return this.request<{ policy: Policy }>("/api/policies", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updatePolicy(id: string, data: Partial<Policy>) {
    return this.request<{ policy: Policy }>(`/api/policies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deletePolicy(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/policies/${id}`, {
      method: "DELETE",
    });
  }

  // Simulate
  async simulate(body: {
    actionType: string;
    parameters: Record<string, unknown>;
    principalId: string;
    cartridgeId?: string;
  }) {
    return this.request<SimulateResult>("/api/simulate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Health
  async healthCheck() {
    return this.request<{ healthy: boolean }>("/api/health");
  }

  async deepHealthCheck() {
    return this.request<HealthCheck>("/api/health/deep");
  }

  // Cartridges
  async listCartridges() {
    return this.request<{ cartridges: CartridgeManifest[] }>("/api/cartridges");
  }

  // Connections
  async listConnections() {
    return this.request<{ connections: unknown[] }>("/api/connections");
  }

  async createConnection(body: {
    serviceId: string;
    serviceName: string;
    authType: string;
    credentials: Record<string, unknown>;
    scopes?: string[];
  }) {
    return this.request<{ connection: unknown }>("/api/connections", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getConnection(id: string) {
    return this.request<{ connection: unknown }>(`/api/connections/${id}`);
  }

  async updateConnection(
    id: string,
    body: {
      serviceName?: string;
      authType?: string;
      credentials?: Record<string, unknown>;
      scopes?: string[];
    },
  ) {
    return this.request<{ connection: unknown }>(`/api/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async deleteConnection(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/connections/${id}`, {
      method: "DELETE",
    });
  }

  async testConnection(id: string) {
    return this.request<{ healthy: boolean; detail?: string }>(`/api/connections/${id}/test`, {
      method: "POST",
    });
  }

  // Organization Config
  async getOrgConfig(orgId: string) {
    return this.request<{ config: unknown }>(`/api/organizations/${orgId}/config`);
  }

  async updateOrgConfig(
    orgId: string,
    body: {
      name?: string;
      runtimeType?: string;
      runtimeConfig?: Record<string, unknown>;
      governanceProfile?: string;
      skinId?: string;
      onboardingComplete?: boolean;
    },
  ) {
    return this.request<{ config: unknown }>(`/api/organizations/${orgId}/config`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async getIntegrationGuide(orgId: string, runtimeType?: string) {
    const qs = runtimeType ? `?runtimeType=${runtimeType}` : "";
    return this.request<{ guide: unknown }>(`/api/organizations/${orgId}/integration${qs}`);
  }

  // Managed Provisioning
  async provision(
    orgId: string,
    body: {
      channels: Array<{
        channel: string;
        botToken: string;
        webhookSecret?: string;
        signingSecret?: string;
      }>;
    },
  ) {
    return this.request<{
      channels: Array<{
        channel: string;
        botUsername?: string;
        webhookUrl?: string;
        status: string;
        note?: string;
      }>;
      provisioningStatus: string;
    }>(`/api/organizations/${orgId}/provision`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getManagedChannels(orgId: string) {
    return this.request<{
      channels: Array<{
        id: string;
        channel: string;
        botUsername: string | null;
        webhookPath: string;
        webhookRegistered: boolean;
        status: string;
        statusDetail: string | null;
        lastHealthCheck: string | null;
        createdAt: string;
      }>;
    }>(`/api/organizations/${orgId}/channels`);
  }

  async deleteChannel(orgId: string, channelId: string) {
    return this.request<{ deleted: boolean }>(`/api/organizations/${orgId}/channels/${channelId}`, {
      method: "DELETE",
    });
  }

  // Post-onboarding handoff
  async triggerHandoff(orgId: string, principalId: string) {
    return this.request<{ triggered: boolean; message: string }>(
      `/api/organizations/${orgId}/handoff`,
      {
        method: "POST",
        body: JSON.stringify({ principalId }),
      },
    );
  }

  // Token Usage
  async getTokenUsage(params?: { period?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.period) searchParams.set("period", params.period);
    const qs = searchParams.toString();
    return this.request<{
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
      period: string;
      orgId: string;
    }>(`/api/token-usage${qs ? `?${qs}` : ""}`);
  }

  async getTokenUsageTrend(params?: { days?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.days) searchParams.set("days", String(params.days));
    const qs = searchParams.toString();
    return this.request<{
      trend: Array<{
        date: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }>;
      orgId: string;
    }>(`/api/token-usage/trend${qs ? `?${qs}` : ""}`);
  }

  // Alerts
  async listAlerts() {
    return this.request<{ rules: AlertRule[] }>("/api/alerts");
  }

  async createAlert(data: CreateAlertInput) {
    return this.request<{ rule: AlertRule }>("/api/alerts", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateAlert(
    id: string,
    data: Partial<CreateAlertInput> & { enabled?: boolean; snoozedUntil?: string | null },
  ) {
    return this.request<{ rule: AlertRule }>(`/api/alerts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteAlert(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/alerts/${id}`, {
      method: "DELETE",
    });
  }

  async getAlertHistory(id: string) {
    return this.request<{ history: AlertHistoryEntry[] }>(`/api/alerts/${id}/history`);
  }

  async testAlert(id: string) {
    return this.request<{
      evaluation: {
        triggered: boolean;
        metricValue: number;
        threshold: number;
        description: string;
      };
    }>(`/api/alerts/${id}/test`, { method: "POST" });
  }

  async snoozeAlert(id: string, durationMinutes: number) {
    return this.request<{ rule: AlertRule }>(`/api/alerts/${id}/snooze`, {
      method: "POST",
      body: JSON.stringify({ durationMinutes }),
    });
  }

  // Scheduled Reports
  async listScheduledReports() {
    return this.request<{ reports: ScheduledReportEntry[] }>("/api/scheduled-reports");
  }

  async createScheduledReport(data: CreateScheduledReportInput) {
    return this.request<{ report: ScheduledReportEntry }>("/api/scheduled-reports", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateScheduledReport(
    id: string,
    data: Partial<CreateScheduledReportInput> & { enabled?: boolean },
  ) {
    return this.request<{ report: ScheduledReportEntry }>(`/api/scheduled-reports/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteScheduledReport(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/scheduled-reports/${id}`, {
      method: "DELETE",
    });
  }

  async runScheduledReport(id: string) {
    return this.request<{ success: boolean; data: unknown }>(`/api/scheduled-reports/${id}/run`, {
      method: "POST",
    });
  }

  // DLQ
  async listDlqMessages(status?: string, limit?: number) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return this.request<{ messages: unknown[] }>(`/api/dlq/messages${qs ? `?${qs}` : ""}`);
  }

  async getDlqStats() {
    return this.request<{
      stats: { pending: number; exhausted: number; resolved: number; total: number };
    }>("/api/dlq/stats");
  }

  async retryDlqMessage(id: string) {
    return this.request<{ message: unknown; exhausted: boolean }>(`/api/dlq/messages/${id}/retry`, {
      method: "POST",
    });
  }

  async resolveDlqMessage(id: string) {
    return this.request<{ message: unknown }>(`/api/dlq/messages/${id}/resolve`, {
      method: "POST",
    });
  }

  // Competence
  async listCompetenceRecords(principalId?: string) {
    const qs = principalId ? `?principalId=${principalId}` : "";
    return this.request<{ records: unknown[] }>(`/api/competence/records${qs}`);
  }

  async listCompetencePolicies() {
    return this.request<{ policies: unknown[] }>("/api/competence/policies");
  }

  async createCompetencePolicy(data: Record<string, unknown>) {
    return this.request<{ policy: unknown }>("/api/competence/policies", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCompetencePolicy(id: string, data: Record<string, unknown>) {
    return this.request<{ policy: unknown }>(`/api/competence/policies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteCompetencePolicy(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/competence/policies/${id}`, {
      method: "DELETE",
    });
  }

  // Webhooks
  async listWebhooks() {
    return this.request<{ webhooks: unknown[] }>("/api/webhooks");
  }

  async createWebhook(data: Record<string, unknown>) {
    return this.request<{ webhook: unknown }>("/api/webhooks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteWebhook(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/webhooks/${id}`, {
      method: "DELETE",
    });
  }

  async testWebhook(id: string) {
    return this.request<{ success: boolean }>(`/api/webhooks/${id}/test`, { method: "POST" });
  }

  // Clinic Reports
  async getOperatorSummary() {
    return this.request<{ summary: OperatorSummary }>("/api/reports/operator-summary");
  }

  async getClinicReport(params?: { startDate?: string; endDate?: string; adSpend?: number }) {
    const query = new URLSearchParams();
    if (params?.startDate) query.set("startDate", params.startDate);
    if (params?.endDate) query.set("endDate", params.endDate);
    if (params?.adSpend != null) query.set("adSpend", String(params.adSpend));
    const qs = query.toString();
    return this.request<{
      period: { startDate: string; endDate: string };
      organizationId: string;
      leads: {
        total: number;
        byStage: Array<{ stage: string; count: number; totalValue: number }>;
      };
      bookings: { count: number; fromDeals: number; fromAudit: number };
      responseTime: {
        averageMs: number | null;
        p50Ms: number | null;
        p95Ms: number | null;
        sampleSize: number;
      };
      adCorrelation: {
        leadsFromAds: number;
        bookingsFromAds: number;
        adAttributionRate: number;
        bySource: Array<{
          sourceAdId: string | null;
          utmSource: string | null;
          leadCount: number;
          bookingCount: number;
        }>;
      };
      costMetrics: {
        adSpend: number | null;
        costPerBooking: number | null;
        costPerLead: number | null;
      };
    }>(`/api/reports/clinic${qs ? `?${qs}` : ""}`);
  }

  // Conversations
  async getConversations(filters?: {
    status?: string;
    channel?: string;
    principalId?: string;
    limit?: number;
  }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.channel) params.set("channel", filters.channel);
    if (filters?.principalId) params.set("principalId", filters.principalId);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return this.request<{
      conversations: Array<{
        id: string;
        threadId: string;
        channel: string;
        principalId: string;
        organizationId: string | null;
        status: string;
        currentIntent: string | null;
        firstReplyAt: string | null;
        lastActivityAt: string;
      }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/api/conversations${qs ? `?${qs}` : ""}`);
  }

  async getConversation(id: string) {
    return this.request<{
      id: string;
      threadId: string;
      channel: string;
      principalId: string;
      organizationId: string | null;
      status: string;
      currentIntent: string | null;
      firstReplyAt: string | null;
      lastActivityAt: string;
      messages: Array<{ role: string; text: string; timestamp: string }>;
    }>(`/api/conversations/${id}`);
  }

  async setConversationOverride(id: string, override: boolean) {
    return this.request<{ id: string; status: string }>(`/api/conversations/${id}/override`, {
      method: "PATCH",
      body: JSON.stringify({ override }),
    });
  }

  // CRM Contacts
  async getContacts(filters?: { search?: string; limit?: number; offset?: number }) {
    const params = new URLSearchParams();
    if (filters?.search) params.set("search", filters.search);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return this.request<{ data: unknown[]; total: number; limit: number; offset: number }>(
      `/api/crm/contacts${qs ? `?${qs}` : ""}`,
    );
  }

  async getContact(id: string) {
    return this.request<{ contact: unknown }>(`/api/crm/contacts/${id}`);
  }

  // CRM Deals
  async getDeals(filters?: {
    stage?: string;
    contactId?: string;
    limit?: number;
    offset?: number;
  }) {
    const params = new URLSearchParams();
    if (filters?.stage) params.set("stage", filters.stage);
    if (filters?.contactId) params.set("contactId", filters.contactId);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return this.request<{ data: unknown[]; total: number; limit: number; offset: number }>(
      `/api/crm/deals${qs ? `?${qs}` : ""}`,
    );
  }

  // Agent Roster & State
  async getAgentRoster() {
    return this.request<{ roster: AgentRosterEntry[] }>("/api/agents/roster");
  }

  async updateAgentRoster(
    id: string,
    body: {
      displayName?: string;
      description?: string;
      status?: string;
      config?: Record<string, unknown>;
    },
  ) {
    return this.request<{ agent: AgentRosterEntry }>(`/api/agents/roster/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async getAgentState() {
    return this.request<{ states: AgentStateEntry[] }>("/api/agents/state");
  }

  async initializeRoster(body?: {
    operatorName?: string;
    operatorConfig?: Record<string, unknown>;
  }) {
    return this.request<{ roster: AgentRosterEntry[]; alreadyInitialized?: boolean }>(
      "/api/agents/roster/initialize",
      {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      },
    );
  }

  // Operator Config
  async createOperatorConfig(data: Omit<AdsOperatorConfig, "id" | "createdAt" | "updatedAt">) {
    return this.request<{ config: AdsOperatorConfig }>("/api/operator-config", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getOperatorConfig(orgId: string) {
    return this.request<{ config: AdsOperatorConfig }>(`/api/operator-config/${orgId}`);
  }

  async updateOperatorConfig(
    orgId: string,
    updates: Partial<
      Omit<AdsOperatorConfig, "id" | "organizationId" | "principalId" | "createdAt" | "updatedAt">
    >,
  ) {
    return this.request<{ config: AdsOperatorConfig }>(`/api/operator-config/${orgId}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async getAutonomyAssessment(orgId: string) {
    return this.request<{
      assessment: {
        currentProfile: string;
        recommendedProfile: string;
        autonomousEligible: boolean;
        reason: string;
        progressPercent: number;
        stats: {
          totalSuccesses: number;
          totalFailures: number;
          competenceScore: number;
          failureRate: number;
        };
      };
    }>(`/api/operator-config/${orgId}/autonomy`);
  }

  // Revenue Growth
  async runRevGrowthDiagnostic(accountId: string) {
    return this.request<{
      outcome: string;
      data?: RevGrowthDiagnosticResult;
      summary?: string;
      explanation?: string;
      envelopeId: string;
    }>(`/api/revenue-growth/${accountId}/run`, { method: "POST" });
  }

  async getRevGrowthLatest(accountId: string) {
    return this.request<{ data: RevGrowthDiagnosticResult | null; summary: string }>(
      `/api/revenue-growth/${accountId}/latest`,
    );
  }

  async getRevGrowthConnectors(accountId: string) {
    return this.request<{ connectors: RevGrowthConnectorHealth[] }>(
      `/api/revenue-growth/${accountId}/connectors`,
    );
  }

  async listRevGrowthInterventions(accountId: string) {
    return this.request<{ interventions: RevGrowthIntervention[] }>(
      `/api/revenue-growth/${accountId}/interventions`,
    );
  }

  async approveRevGrowthIntervention(interventionId: string) {
    return this.request<{ outcome: string; summary?: string; envelopeId?: string }>(
      `/api/revenue-growth/interventions/${interventionId}/approve`,
      { method: "POST" },
    );
  }

  async deferRevGrowthIntervention(interventionId: string, reason: string) {
    return this.request<{ summary: string }>(
      `/api/revenue-growth/interventions/${interventionId}/defer`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
  }

  async getRevGrowthDigest(accountId: string) {
    return this.request<{ digest: RevGrowthDigest | null; summary: string }>(
      `/api/revenue-growth/${accountId}/digest`,
    );
  }
}
