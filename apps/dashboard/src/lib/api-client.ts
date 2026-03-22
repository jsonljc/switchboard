import type { AdsOperatorConfig } from "@switchboard/schemas";
import { SwitchboardClientBase } from "./api-client-base";
import type {
  AgentRosterEntry,
  AgentStateEntry,
  AlertRule,
  AlertHistoryEntry,
  CreateAlertInput,
  ScheduledReportEntry,
  CreateScheduledReportInput,
  OperatorSummary,
  CampaignAttribution,
  PilotReportData,
  RevGrowthDiagnosticResult,
  RevGrowthConnectorHealth,
  RevGrowthIntervention,
  RevGrowthDigest,
} from "./api-client-types";

// Re-export all types for backwards compatibility
export type {
  AgentRosterEntry,
  AgentStateEntry,
  AlertRule,
  AlertHistoryEntry,
  CreateAlertInput,
  ScheduledReportEntry,
  CreateScheduledReportInput,
  OperatorSummary,
  CampaignAttribution,
  PilotReportData,
  RevGrowthScorerOutput,
  RevGrowthConstraint,
  RevGrowthIntervention,
  RevGrowthDiagnosticResult,
  RevGrowthConnectorHealth,
  RevGrowthDigest,
  PendingApproval,
  ApprovalDetail,
  HealthCheck,
  SimulateResult,
} from "./api-client-types";

export class SwitchboardClient extends SwitchboardClientBase {
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

  async getCampaignAttribution() {
    return this.request<{ campaigns: CampaignAttribution[] }>("/api/reports/campaign-attribution");
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

  async getPilotReport() {
    return this.request<{ report: PilotReportData | null; message?: string }>("/api/reports/pilot");
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

  async updateDeal(id: string, updates: { stage?: string; amount?: number }) {
    return this.request<{ deal: unknown }>(`/api/crm/deals/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async createRevenueEvent(event: {
    contactId: string;
    amount: number;
    currency: string;
    source: string;
    reference: string;
    recordedBy: string;
  }) {
    return this.request<{ event: unknown }>("/api/revenue", {
      method: "POST",
      body: JSON.stringify(event),
    });
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

  async completeWizard(body: Record<string, unknown>) {
    return this.request<{ success: boolean; purchasedAgents: string[]; agentsRegistered: number }>(
      "/api/agents/wizard-complete",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  // Knowledge
  async uploadKnowledge(body: Record<string, unknown>) {
    return this.request<{ documentId: string; fileName: string; chunksCreated: number }>(
      "/api/knowledge/upload",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async listKnowledgeDocuments(agentId?: string) {
    const params = agentId ? `?agentId=${agentId}` : "";
    return this.request<{ documents: unknown[] }>(`/api/knowledge/documents${params}`);
  }

  async deleteKnowledgeDocument(documentId: string) {
    return this.request<{ deleted: number }>(`/api/knowledge/documents/${documentId}`, {
      method: "DELETE",
    });
  }

  async createCorrection(body: Record<string, unknown>) {
    return this.request<{ documentId: string; correctionId: string }>(
      "/api/knowledge/corrections",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  // Test Chat
  async sendTestChatMessage(body: Record<string, unknown>) {
    return this.request<{
      reply: string;
      confidence: number;
      kbChunksUsed: number;
      kbContext: string;
      mode: string;
    }>("/api/test-chat/message", { method: "POST", body: JSON.stringify(body) });
  }

  // Go Live
  async goLiveAgent(agentId: string) {
    return this.request<{ agentId: string; status: string; message: string }>(
      `/api/agents/go-live/${agentId}`,
      { method: "PUT" },
    );
  }

  // Escalations
  async listEscalations(status = "pending") {
    return this.request<{ escalations: unknown[] }>(`/api/escalations?status=${status}`);
  }

  async getEscalation(id: string) {
    return this.request<{ escalation: unknown; conversationHistory: unknown[] }>(
      `/api/escalations/${id}`,
    );
  }

  async replyToEscalation(id: string, message: string) {
    return this.request<{ escalation: unknown; replySent: boolean }>(
      `/api/escalations/${id}/reply`,
      { method: "POST", body: JSON.stringify({ message }) },
    );
  }
}
