import { SwitchboardSettingsClient } from "./settings";
export type {
  MarketplaceListing,
  MarketplaceDeployment,
  MarketplaceTask,
  CreativeJobSummary,
  TrustScoreBreakdown,
  DraftFAQ,
  ExecutionTraceSummary,
} from "./marketplace-types";
import type {
  MarketplaceListing,
  MarketplaceDeployment,
  MarketplaceTask,
  CreativeJobSummary,
  TrustScoreBreakdown,
  DraftFAQ,
  ExecutionTraceSummary,
} from "./marketplace-types";

export class SwitchboardMarketplaceClient extends SwitchboardSettingsClient {
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

  async getBusinessFacts(deploymentId: string) {
    const { deployment } = await this.request<{ deployment: MarketplaceDeployment }>(
      `/api/marketplace/deployments/${deploymentId}`,
    );
    const config = deployment?.inputConfig as Record<string, unknown> | undefined;
    return { config: config?.businessFacts ?? null };
  }

  async upsertBusinessFacts(deploymentId: string, facts: Record<string, unknown>) {
    return this.request<{ deployment: MarketplaceDeployment }>(
      `/api/marketplace/deployments/${deploymentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ inputConfig: { businessFacts: facts } }),
      },
    );
  }

  async listFacebookAdAccounts(deploymentId: string) {
    return this.request<{
      adAccounts: Array<{
        accountId: string;
        name: string;
        currency: string;
        status: string;
      }>;
    }>(`/api/marketplace/deployments/${deploymentId}/facebook/ad-accounts`);
  }

  async setAdAccountSelection(deploymentId: string, adAccountId: string, adAccountName: string) {
    return this.request<{ deployment: MarketplaceDeployment }>(
      `/api/marketplace/deployments/${deploymentId}/facebook/ad-account`,
      {
        method: "POST",
        body: JSON.stringify({ adAccountId, adAccountName }),
      },
    );
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

  async onboard(body: {
    listingId: string;
    setupAnswers?: Record<string, unknown>;
    scannedProfile?: Record<string, unknown>;
    businessName: string;
  }) {
    return this.request<{
      deploymentId: string;
      slug: string;
      dashboardUrl: string;
      storefrontUrl?: string;
      widgetToken?: string;
      embedCode?: string;
    }>("/api/marketplace/onboard", { method: "POST", body: JSON.stringify(body) });
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

  // ── FAQ Drafts ──

  async listDraftFAQs(orgId: string, deploymentId: string) {
    return this.request<{ data: DraftFAQ[] }>(
      `/api/marketplace/${orgId}/deployments/${deploymentId}/faq-drafts`,
    );
  }

  async approveDraftFAQ(orgId: string, deploymentId: string, faqId: string) {
    return this.request<{ success: boolean }>(
      `/api/marketplace/${orgId}/deployments/${deploymentId}/faq-drafts/${faqId}/approve`,
      { method: "POST" },
    );
  }

  async rejectDraftFAQ(orgId: string, deploymentId: string, faqId: string) {
    return this.request<void>(
      `/api/marketplace/${orgId}/deployments/${deploymentId}/faq-drafts/${faqId}/reject`,
      { method: "POST" },
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

  async approveCreativeJobStage(
    id: string,
    action: "continue" | "stop",
    productionTier?: "basic" | "pro",
  ) {
    return this.request<{ job: CreativeJobSummary; action: string }>(
      `/api/marketplace/creative-jobs/${id}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ action, ...(productionTier ? { productionTier } : {}) }),
      },
    );
  }

  async listTraces(deploymentId: string, opts?: { limit?: number; cursor?: string }) {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.cursor) params.set("cursor", opts.cursor);
    const qs = params.toString();
    return this.request<{ traces: ExecutionTraceSummary[]; nextCursor?: string }>(
      `/api/marketplace/deployments/${deploymentId}/traces${qs ? `?${qs}` : ""}`,
    );
  }
}
