import { SwitchboardClientBase } from "./api-client-base";
import type { AgentRosterEntry, AgentStateEntry } from "./api-client-types";

// Marketplace types
export interface MarketplaceListing {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: string;
  status: string;
  taskCategories: string[];
  trustScore: number;
  autonomyLevel: string;
  priceTier: string;
  priceMonthly: number;
  webhookUrl: string | null;
  sourceUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceDeployment {
  id: string;
  organizationId: string;
  listingId: string;
  status: string;
  inputConfig: Record<string, unknown>;
  governanceSettings: Record<string, unknown>;
  outputDestination: Record<string, unknown> | null;
  connectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceTask {
  id: string;
  deploymentId: string;
  organizationId: string;
  listingId: string;
  category: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  acceptanceCriteria: string | null;
  reviewResult: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeJobSummary {
  id: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
  productImages: string[];
  references: string[];
  pastPerformance: Record<string, unknown> | null;
  currentStage: string;
  stoppedAt: string | null;
  stageOutputs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TrustScoreBreakdown {
  listingId: string;
  priceTier: string;
  breakdown: Array<{
    taskCategory: string;
    score: number;
    autonomyLevel: string;
    totalApprovals: number;
    totalRejections: number;
    consecutiveApprovals: number;
    lastActivityAt: string;
  }>;
}

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

  // ── Marketplace ──

  async listMarketplaceListings(filters?: {
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.type) params.set("type", filters.type);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return this.request<{ listings: MarketplaceListing[] }>(
      `/api/marketplace/listings${qs ? `?${qs}` : ""}`,
    );
  }

  async getMarketplaceListing(id: string) {
    return this.request<{ listing: MarketplaceListing }>(`/api/marketplace/listings/${id}`);
  }

  async getListingTrustScore(id: string) {
    return this.request<TrustScoreBreakdown>(`/api/marketplace/listings/${id}/trust`);
  }

  async getListingTrustProgression(id: string) {
    return this.request<{
      listingId: string;
      progression: Array<{ timestamp: string; score: number }>;
    }>(`/api/marketplace/listings/${id}/trust/progression`);
  }

  async deployListing(
    id: string,
    config: {
      inputConfig?: Record<string, unknown>;
      governanceSettings?: Record<string, unknown>;
      outputDestination?: Record<string, unknown>;
      connectionIds?: string[];
    },
  ) {
    return this.request<{ deployment: MarketplaceDeployment }>(
      `/api/marketplace/listings/${id}/deploy`,
      { method: "POST", body: JSON.stringify(config) },
    );
  }

  async listDeployments() {
    return this.request<{ deployments: MarketplaceDeployment[] }>(`/api/marketplace/deployments`);
  }

  async createTask(data: {
    deploymentId: string;
    listingId: string;
    category: string;
    input?: Record<string, unknown>;
    acceptanceCriteria?: string;
  }) {
    return this.request<{ task: MarketplaceTask }>(`/api/marketplace/tasks`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async listTasks(filters?: { status?: string; deploymentId?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.deploymentId) params.set("deploymentId", filters.deploymentId);
    const qs = params.toString();
    return this.request<{ tasks: MarketplaceTask[] }>(
      `/api/marketplace/tasks${qs ? `?${qs}` : ""}`,
    );
  }

  async submitTaskOutput(taskId: string, output: Record<string, unknown>) {
    return this.request<{ task: MarketplaceTask }>(`/api/marketplace/tasks/${taskId}/submit`, {
      method: "POST",
      body: JSON.stringify({ output }),
    });
  }

  async reviewTask(taskId: string, result: "approved" | "rejected", reviewResult?: string) {
    return this.request<{ task: MarketplaceTask }>(`/api/marketplace/tasks/${taskId}/review`, {
      method: "POST",
      body: JSON.stringify({ result, reviewResult }),
    });
  }

  // ── Agent Persona ──

  async getPersona() {
    return this.request<{ persona: unknown }>("/api/marketplace/persona");
  }

  async upsertPersona(body: {
    businessName: string;
    businessType: string;
    productService: string;
    valueProposition: string;
    tone: string;
    qualificationCriteria: Record<string, unknown>;
    disqualificationCriteria: Record<string, unknown>;
    escalationRules: Record<string, unknown>;
    bookingLink?: string;
    customInstructions?: string;
  }) {
    return this.request<{ persona: unknown }>("/api/marketplace/persona", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async deploySalesPipeline(body: {
    businessName: string;
    businessType: string;
    productService: string;
    valueProposition: string;
    tone: string;
    qualificationCriteria: Record<string, unknown>;
    disqualificationCriteria: Record<string, unknown>;
    escalationRules: Record<string, unknown>;
    bookingLink?: string;
    customInstructions?: string;
  }) {
    return this.request<{ persona: unknown; deployments: unknown[]; count: number }>(
      "/api/marketplace/persona/deploy",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  // ── Deployment Connections ──

  async createWidgetToken(deploymentId: string) {
    return this.request<{ connection: { id: string; type: string; token: string } }>(
      `/api/marketplace/deployments/${deploymentId}/connections/widget`,
      { method: "POST", body: JSON.stringify({ deploymentId }) },
    );
  }

  async connectTelegram(deploymentId: string, botToken: string, webhookBaseUrl: string) {
    return this.request<{
      connection: { id: string; type: string; botUsername: string };
      webhookPath: string;
    }>(`/api/marketplace/deployments/${deploymentId}/connections/telegram`, {
      method: "POST",
      body: JSON.stringify({ deploymentId, botToken, webhookBaseUrl }),
    });
  }

  async getDeploymentConnections(deploymentId: string) {
    return this.request<{
      connections: Array<{
        id: string;
        type: string;
        status: string;
        metadata?: Record<string, unknown>;
      }>;
    }>(`/api/marketplace/deployments/${deploymentId}/connections`);
  }

  async disconnectChannel(deploymentId: string, connectionId: string) {
    return this.request<{ ok: boolean }>(
      `/api/marketplace/deployments/${deploymentId}/connections/${connectionId}`,
      { method: "DELETE" },
    );
  }

  // ── Creative Pipeline ──

  async submitCreativeBrief(body: {
    deploymentId: string;
    listingId: string;
    brief: {
      productDescription: string;
      targetAudience: string;
      platforms: string[];
      brandVoice?: string | null;
      productImages?: string[];
      references?: string[];
      pastPerformance?: Record<string, unknown> | null;
    };
  }) {
    return this.request<{ task: MarketplaceTask; job: CreativeJobSummary }>(
      "/api/marketplace/creative-jobs",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async listCreativeJobs(filters?: { deploymentId?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (filters?.deploymentId) params.set("deploymentId", filters.deploymentId);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString();
    return this.request<{ jobs: CreativeJobSummary[] }>(
      `/api/marketplace/creative-jobs${qs ? `?${qs}` : ""}`,
    );
  }

  async getCreativeJob(id: string) {
    return this.request<{ job: CreativeJobSummary }>(`/api/marketplace/creative-jobs/${id}`);
  }

  async getCostEstimate(jobId: string) {
    return this.request<{
      estimates: {
        basic: { cost: number; description: string };
        pro: { cost: number; description: string };
      } | null;
    }>(`/api/marketplace/creative-jobs/${jobId}/estimate`);
  }

  async approveCreativeJobStage(id: string, action: "continue" | "stop") {
    return this.request<{ job: CreativeJobSummary; action: string }>(
      `/api/marketplace/creative-jobs/${id}/approve`,
      { method: "POST", body: JSON.stringify({ action }) },
    );
  }
}
