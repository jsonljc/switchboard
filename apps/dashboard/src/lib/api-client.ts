import type { IdentitySpec, AuditEntry, Policy, CartridgeManifest } from "@switchboard/schemas";

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

  async respondToApproval(id: string, body: { action: string; respondedBy: string; bindingHash: string; patchValue?: unknown }) {
    return this.request<{ envelope: unknown; approvalState: unknown; executionResult: unknown }>(`/api/approvals/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Audit
  async queryAudit(params?: { eventType?: string; limit?: number; after?: string; before?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.eventType) searchParams.set("eventType", params.eventType);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.after) searchParams.set("after", params.after);
    if (params?.before) searchParams.set("before", params.before);
    const qs = searchParams.toString();
    return this.request<{ entries: AuditEntry[]; total: number }>(`/api/audit${qs ? `?${qs}` : ""}`);
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
    return this.request<{ id: string; deleted: boolean }>(`/api/policies/${id}`, { method: "DELETE" });
  }

  // Simulate
  async simulate(body: { actionType: string; parameters: Record<string, unknown>; principalId: string; cartridgeId?: string }) {
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

  async createConnection(body: { serviceId: string; serviceName: string; authType: string; credentials: Record<string, unknown>; scopes?: string[] }) {
    return this.request<{ connection: unknown }>("/api/connections", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async getConnection(id: string) {
    return this.request<{ connection: unknown }>(`/api/connections/${id}`);
  }

  async updateConnection(id: string, body: { serviceName?: string; authType?: string; credentials?: Record<string, unknown>; scopes?: string[] }) {
    return this.request<{ connection: unknown }>(`/api/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async deleteConnection(id: string) {
    return this.request<{ id: string; deleted: boolean }>(`/api/connections/${id}`, { method: "DELETE" });
  }

  async testConnection(id: string) {
    return this.request<{ healthy: boolean; detail?: string }>(`/api/connections/${id}/test`, { method: "POST" });
  }

  // Organization Config
  async getOrgConfig(orgId: string) {
    return this.request<{ config: unknown }>(`/api/organizations/${orgId}/config`);
  }

  async updateOrgConfig(orgId: string, body: { name?: string; runtimeType?: string; runtimeConfig?: Record<string, unknown>; governanceProfile?: string; onboardingComplete?: boolean }) {
    return this.request<{ config: unknown }>(`/api/organizations/${orgId}/config`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async getIntegrationGuide(orgId: string, runtimeType?: string) {
    const qs = runtimeType ? `?runtimeType=${runtimeType}` : "";
    return this.request<{ guide: unknown }>(`/api/organizations/${orgId}/integration${qs}`);
  }
}
